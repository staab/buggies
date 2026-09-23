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
  onJoined(seat: Seat, connectionId: number, seed: number): void
  onLeft(seat: Seat, connectionId: number, seed: number): void
  onRejected(connectionId: number, reason: string): void
  onRespawned(seat: Seat, why: 'lost' | 'asked'): void
  /** A room has been made for a seed nobody was on, or closed behind the last to leave it. */
  onRoomOpened(seed: number): void
  onRoomClosed(seed: number): void
}

export interface GameServerStats {
  tick: number
  rooms: number
  players: number
  inputsApplied: number
  inputsHeld: number
  inputsLate: number
  inputsAhead: number
  snapshotBytes: number
}

interface Player {
  connection: TransportConnection
  room: Room
  seat: Seat
  timeline: InputTimeline
  respawnedTick: number
}

interface Handshake {
  connection: TransportConnection
  openedTick: number
}

/**
 * One island and everyone on it. Each seed anyone asks for is a room of its
 * own, with its own arena, clock and snapshots; nothing crosses between them.
 */
export interface Room {
  readonly seed: number
  readonly arena: Arena
  readonly players: Map<number, Player>
  readonly snapshotVehicles: VehicleSnapshot[]
  readonly snapshotPickups: PickupSnapshot[]
  readonly snapshotSpilled: SpilledSnapshot[]
  lastSnapshotBytes: number
}

/**
 * The arenas that count, one a seed. Players send inputs for ticks; the
 * server drives each seat with them, steps every room, and every few ticks
 * tells everyone in a room where everything in it is. Nothing a client says
 * about its own position is believed. A room is made when the first player
 * asks for its seed and closed when the last leaves.
 */
export class GameServer implements TransportHandlers {
  private readonly arenaFor: (seed: number) => Arena
  private readonly events: Partial<GameServerEvents>
  private readonly rooms = new Map<number, Room>()
  private readonly players = new Map<number, Player>()
  private readonly handshaking = new Map<number, Handshake>()
  private readonly scratchInput: VehicleInput = createVehicleInput()
  /** The server's own clock, for handshakes, which belong to no room yet. */
  private clock = 0

  constructor(arenaFor: (seed: number) => Arena, events: Partial<GameServerEvents> = {}) {
    this.arenaFor = arenaFor
    this.events = events
  }

  get tick(): number {
    return this.clock
  }

  get playerCount(): number {
    return this.players.size
  }

  get roomCount(): number {
    return this.rooms.size
  }

  /** The room for a seed, if anyone is on it. */
  roomFor(seed: number): Room | undefined {
    return this.rooms.get(seed)
  }

  stats(): GameServerStats {
    const stats: GameServerStats = {
      tick: this.clock,
      rooms: this.rooms.size,
      players: this.players.size,
      inputsApplied: 0,
      inputsHeld: 0,
      inputsLate: 0,
      inputsAhead: 0,
      snapshotBytes: 0,
    }
    for (const { timeline } of this.players.values()) {
      stats.inputsApplied += timeline.applied
      stats.inputsHeld += timeline.held
      stats.inputsLate += timeline.late
      stats.inputsAhead += timeline.ahead
    }
    for (const room of this.rooms.values()) stats.snapshotBytes += room.lastSnapshotBytes
    return stats
  }

  /** One fixed step for every room. */
  advance(): void {
    this.clock += 1
    for (const room of this.rooms.values()) {
      const tick = room.arena.tick
      advance(room.arena, (seat) => this.playerIn(room, seat)?.timeline.consume(tick) ?? this.scratchInput)
      for (const seat of respawnLost(room.arena)) this.events.onRespawned?.(seat, 'lost')
      if (room.arena.tick % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot(room)
    }
    this.expireHandshakes()
  }

  dispose(): void {
    for (const room of this.rooms.values()) room.arena.world.free()
    this.rooms.clear()
    this.players.clear()
  }

  onOpen = (connection: TransportConnection): void => {
    this.handshaking.set(connection.id, { connection, openedTick: this.clock })
  }

  onMessage = (connection: TransportConnection, payload: Uint8Array): void => {
    if (this.handshaking.has(connection.id)) {
      this.completeHandshake(connection, payload)
      return
    }

    const player = this.players.get(connection.id)
    if (player === undefined) return
    const { arena } = player.room

    if (isRespawn(payload)) {
      if (arena.tick - player.respawnedTick < RESPAWN_COOLDOWN_TICKS) return
      player.respawnedTick = arena.tick
      respawnNearby(arena, player.seat)
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
    const { room } = player
    room.players.delete(connection.id)
    leaveSeat(room.arena, player.seat.id)
    this.events.onLeft?.(player.seat, connection.id, room.seed)
    // The last one out closes the room: an empty island is not worth stepping.
    if (room.players.size === 0) {
      this.rooms.delete(room.seed)
      room.arena.world.free()
      this.events.onRoomClosed?.(room.seed)
    }
  }

  private playerIn(room: Room, seat: Seat): Player | undefined {
    for (const player of room.players.values()) if (player.seat === seat) return player
    return undefined
  }

  private expireHandshakes(): void {
    for (const handshake of this.handshaking.values()) {
      if (this.clock - handshake.openedTick < HANDSHAKE_TIMEOUT_TICKS) continue
      this.reject(handshake.connection, REJECT_HANDSHAKE_ORDER)
    }
  }

  /** The room for a seed, made if nobody is on it yet. */
  private openRoom(seed: number): Room {
    const existing = this.rooms.get(seed)
    if (existing !== undefined) return existing
    const room: Room = {
      seed,
      arena: this.arenaFor(seed),
      players: new Map(),
      snapshotVehicles: [],
      snapshotPickups: [],
      snapshotSpilled: [],
      lastSnapshotBytes: 0,
    }
    this.rooms.set(seed, room)
    this.events.onRoomOpened?.(seed)
    return room
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
    const room = this.openRoom(hello.seed)
    const { arena } = room
    const free = freeSeat(arena)
    if (free === undefined) {
      this.reject(connection, REJECT_SERVER_FULL)
      if (room.players.size === 0) this.closeRoom(room)
      return
    }

    this.handshaking.delete(connection.id)
    const seat = takeSeat(arena, free.id, hello.profile)
    const player: Player = {
      connection,
      room,
      seat,
      timeline: new InputTimeline(arena.tick),
      respawnedTick: arena.tick,
    }
    this.players.set(connection.id, player)
    room.players.set(connection.id, player)
    connection.send(
      encodeWelcome({
        protocolVersion: PROTOCOL_VERSION,
        seed: arena.map.seed,
        seat: seat.id,
        epoch: seat.epoch,
        tick: arena.tick,
        maxPlayers: arena.seats.length,
        profile: seat.profile,
      }),
    )
    this.events.onJoined?.(seat, connection.id, room.seed)
  }

  private closeRoom(room: Room): void {
    this.rooms.delete(room.seed)
    room.arena.world.free()
    this.events.onRoomClosed?.(room.seed)
  }

  private reject(connection: TransportConnection, reason: number): void {
    this.handshaking.delete(connection.id)
    connection.send(encodeReject({ reason }))
    connection.close(rejectLabel(reason))
    this.events.onRejected?.(connection.id, rejectLabel(reason))
  }

  private collectPickups(room: Room): PickupSnapshot[] {
    const pickups = room.snapshotPickups
    room.arena.pickups.forEach((pickup, slot) => {
      const out = (pickups[slot] ??= { generation: 0, ticksUntilOut: 0 })
      out.generation = pickup.generation
      out.ticksUntilOut = Math.max(pickup.spawnTick - room.arena.tick, 0)
    })
    pickups.length = room.arena.pickups.length
    return pickups
  }

  private collectSpilled(room: Room): SpilledSnapshot[] {
    const spilled = room.snapshotSpilled
    room.arena.spilled.forEach((banana, at) => {
      const out = (spilled[at] ??= { from: v3(), position: v3(), age: 0 })
      vcopy(out.from, banana.from)
      vcopy(out.position, banana.position)
      out.age = room.arena.tick - banana.bornTick
    })
    spilled.length = room.arena.spilled.length
    return spilled
  }

  private collectSnapshot(room: Room): VehicleSnapshot[] {
    const vehicles = room.snapshotVehicles
    let count = 0
    for (const seat of occupiedSeats(room.arena)) {
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
      Object.assign(vehicle.appliedInput, this.playerIn(room, seat)?.timeline.appliedInput ?? this.scratchInput)
      count += 1
    }
    vehicles.length = count
    return vehicles
  }

  private broadcastSnapshot(room: Room): void {
    if (room.players.size === 0) return
    const encoded = encodeSnapshot({
      tick: room.arena.tick,
      ackInputTick: -1,
      vehicles: this.collectSnapshot(room),
      pickups: this.collectPickups(room),
      spilled: this.collectSpilled(room),
    })
    room.lastSnapshotBytes = encoded.length
    for (const player of room.players.values()) {
      player.connection.send(withAck(encoded, player.timeline.receivedTick))
    }
  }
}
