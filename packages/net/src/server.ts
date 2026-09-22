import {
  advance,
  takeSeat,
  createVehicleInput,
  freeSeat,
  leaveSeat,
  occupiedSeats,
  respawnLost,
  respawnNearby,
  type Arena,
  type Seat,
  type VehicleInput,
} from '@buggies/game'
import { quat, v3, vcopy } from '@buggies/physics'

import { InputTimeline } from './input-timeline.ts'
import {
  CLIENT_HELLO,
  CLIENT_INPUT,
  PROTOCOL_VERSION,
  REJECT_HANDSHAKE_ORDER,
  REJECT_MALFORMED_MESSAGE,
  REJECT_PROTOCOL_MISMATCH,
  REJECT_SERVER_FULL,
  TICKS_PER_SECOND,
  TICKS_PER_SNAPSHOT,
  rejectLabel,
} from './protocol.ts'
import type { TransportConnection, TransportHandlers } from './transport.ts'
import {
  decodeHello,
  decodeInput,
  encodeReject,
  encodeSnapshot,
  type PickupSnapshot,
  type SpilledSnapshot,
  encodeWelcome,
  isRespawn,
  messageTypeOf,
  withAck,
  type VehicleSnapshot,
} from './wire.ts'

const HANDSHAKE_TIMEOUT_TICKS = TICKS_PER_SECOND * 5

/** A player asking to be put back more often than this is just held down. */
const RESPAWN_COOLDOWN_TICKS = TICKS_PER_SECOND

export interface GameServerEvents {
  onJoined(seat: Seat, connectionId: number): void
  onLeft(seat: Seat, connectionId: number): void
  onRejected(connectionId: number, reason: string): void
  onRespawned(seat: Seat, why: 'lost' | 'asked'): void
}

export interface GameServerStats {
  tick: number
  players: number
  inputsApplied: number
  inputsHeld: number
  inputsLate: number
  inputsAhead: number
  snapshotBytes: number
}

interface Player {
  connection: TransportConnection
  seat: Seat
  timeline: InputTimeline
  respawnedTick: number
}

interface Handshake {
  connection: TransportConnection
  openedTick: number
}

/**
 * The one arena that counts. Players send inputs for ticks; the server drives
 * each seat with them, steps, and every few ticks tells everyone where
 * everything is. Nothing a client says about its own position is believed.
 */
export class GameServer implements TransportHandlers {
  readonly arena: Arena

  private readonly events: Partial<GameServerEvents>
  private readonly players = new Map<number, Player>()
  private readonly handshaking = new Map<number, Handshake>()
  private readonly scratchInput: VehicleInput = createVehicleInput()
  private readonly snapshotVehicles: VehicleSnapshot[] = []
  private readonly snapshotPickups: PickupSnapshot[] = []
  private readonly snapshotSpilled: SpilledSnapshot[] = []
  private lastSnapshotBytes = 0

  constructor(arena: Arena, events: Partial<GameServerEvents> = {}) {
    this.arena = arena
    this.events = events
  }

  get tick(): number {
    return this.arena.tick
  }

  get playerCount(): number {
    return this.players.size
  }

  stats(): GameServerStats {
    const stats: GameServerStats = {
      tick: this.arena.tick,
      players: this.players.size,
      inputsApplied: 0,
      inputsHeld: 0,
      inputsLate: 0,
      inputsAhead: 0,
      snapshotBytes: this.lastSnapshotBytes,
    }
    for (const { timeline } of this.players.values()) {
      stats.inputsApplied += timeline.applied
      stats.inputsHeld += timeline.held
      stats.inputsLate += timeline.late
      stats.inputsAhead += timeline.ahead
    }
    return stats
  }

  /** One fixed step for everyone. */
  advance(): void {
    const tick = this.arena.tick
    advance(this.arena, (seat) => this.playerIn(seat)?.timeline.consume(tick) ?? this.scratchInput)
    for (const seat of respawnLost(this.arena)) this.events.onRespawned?.(seat, 'lost')
    this.expireHandshakes()
    if (this.arena.tick % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot()
  }

  dispose(): void {
    this.arena.world.free()
  }

  onOpen = (connection: TransportConnection): void => {
    this.handshaking.set(connection.id, { connection, openedTick: this.arena.tick })
  }

  onMessage = (connection: TransportConnection, payload: Uint8Array): void => {
    if (this.handshaking.has(connection.id)) {
      this.completeHandshake(connection, payload)
      return
    }

    const player = this.players.get(connection.id)
    if (player === undefined) return

    if (isRespawn(payload)) {
      if (this.arena.tick - player.respawnedTick < RESPAWN_COOLDOWN_TICKS) return
      player.respawnedTick = this.arena.tick
      respawnNearby(this.arena, player.seat)
      this.events.onRespawned?.(player.seat, 'asked')
      return
    }

    if (messageTypeOf(payload) !== CLIENT_INPUT) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    const tick = decodeInput(payload, this.scratchInput)
    if (tick === null) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    player.timeline.record(tick, this.scratchInput)
  }

  onClose = (connection: TransportConnection): void => {
    this.handshaking.delete(connection.id)
    const player = this.players.get(connection.id)
    if (player === undefined) return
    this.players.delete(connection.id)
    leaveSeat(this.arena, player.seat.id)
    this.events.onLeft?.(player.seat, connection.id)
  }

  private playerIn(seat: Seat): Player | undefined {
    for (const player of this.players.values()) if (player.seat === seat) return player
    return undefined
  }

  private expireHandshakes(): void {
    for (const handshake of this.handshaking.values()) {
      if (this.arena.tick - handshake.openedTick < HANDSHAKE_TIMEOUT_TICKS) continue
      this.reject(handshake.connection, REJECT_HANDSHAKE_ORDER)
    }
  }

  private completeHandshake(connection: TransportConnection, payload: Uint8Array): void {
    if (messageTypeOf(payload) !== CLIENT_HELLO) {
      this.reject(connection, REJECT_HANDSHAKE_ORDER)
      return
    }
    const hello = decodeHello(payload)
    if (hello === null) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      this.reject(connection, REJECT_PROTOCOL_MISMATCH)
      return
    }
    const free = freeSeat(this.arena)
    if (free === undefined) {
      this.reject(connection, REJECT_SERVER_FULL)
      return
    }

    this.handshaking.delete(connection.id)
    const seat = takeSeat(this.arena, free.id, hello.profile)
    this.players.set(connection.id, {
      connection,
      seat,
      timeline: new InputTimeline(this.arena.tick),
      respawnedTick: this.arena.tick,
    })
    connection.send(
      encodeWelcome({
        protocolVersion: PROTOCOL_VERSION,
        seed: this.arena.map.seed,
        seat: seat.id,
        epoch: seat.epoch,
        tick: this.arena.tick,
        maxPlayers: this.arena.seats.length,
        profile: seat.profile,
      }),
    )
    this.events.onJoined?.(seat, connection.id)
  }

  private reject(connection: TransportConnection, reason: number): void {
    this.handshaking.delete(connection.id)
    connection.send(encodeReject({ reason }))
    connection.close(rejectLabel(reason))
    this.events.onRejected?.(connection.id, rejectLabel(reason))
  }

  private collectPickups(): PickupSnapshot[] {
    const pickups = this.snapshotPickups
    this.arena.pickups.forEach((pickup, slot) => {
      const out = (pickups[slot] ??= { generation: 0, ticksUntilOut: 0 })
      out.generation = pickup.generation
      out.ticksUntilOut = Math.max(pickup.spawnTick - this.arena.tick, 0)
    })
    pickups.length = this.arena.pickups.length
    return pickups
  }

  private collectSpilled(): SpilledSnapshot[] {
    const spilled = this.snapshotSpilled
    this.arena.spilled.forEach((banana, at) => {
      const out = (spilled[at] ??= { from: v3(), position: v3(), age: 0 })
      vcopy(out.from, banana.from)
      vcopy(out.position, banana.position)
      out.age = this.arena.tick - banana.bornTick
    })
    spilled.length = this.arena.spilled.length
    return spilled
  }

  private collectSnapshot(): VehicleSnapshot[] {
    const vehicles = this.snapshotVehicles
    let count = 0
    for (const seat of occupiedSeats(this.arena)) {
      const { body } = seat.vehicle
      const vehicle = (vehicles[count] ??= {
        seat: 0,
        epoch: 0,
        profile: seat.profile,
        position: v3(),
        rotation: quat(),
        linearVelocity: v3(),
        angularVelocity: v3(),
        damage: 0,
        wrecked: false,
        score: 0,
        appliedInput: createVehicleInput(),
      })
      vehicle.seat = seat.id
      vehicle.epoch = seat.epoch
      vehicle.profile = seat.profile
      body.translation(vehicle.position)
      body.rotation(vehicle.rotation)
      body.linvel(vehicle.linearVelocity)
      body.angvel(vehicle.angularVelocity)
      vehicle.damage = seat.vehicle.damage
      vehicle.wrecked = seat.vehicle.wrecked
      vehicle.score = seat.score
      Object.assign(vehicle.appliedInput, this.playerIn(seat)?.timeline.appliedInput ?? this.scratchInput)
      count += 1
    }
    vehicles.length = count
    return vehicles
  }

  private broadcastSnapshot(): void {
    if (this.players.size === 0) return
    const encoded = encodeSnapshot({
      tick: this.arena.tick,
      ackInputTick: -1,
      vehicles: this.collectSnapshot(),
      pickups: this.collectPickups(),
      spilled: this.collectSpilled(),
    })
    this.lastSnapshotBytes = encoded.length
    for (const player of this.players.values()) {
      player.connection.send(withAck(encoded, player.timeline.receivedTick))
    }
  }
}
