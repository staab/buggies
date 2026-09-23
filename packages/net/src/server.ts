import {
  NO_OWNER,
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
  INPUT_TIMELINE_TICKS,
  PROTOCOL_VERSION,
  REJECT_HANDSHAKE_ORDER,
  REJECT_IDLE,
  REJECT_MALFORMED_MESSAGE,
  REJECT_PROTOCOL_MISMATCH,
  REJECT_SERVER_FULL,
  ROOMS_LISTED,
  TICKS_PER_SECOND,
  TICKS_PER_SNAPSHOT,
  rejectLabel,
} from './protocol.ts'
import type { TransportConnection, TransportHandlers } from './transport.ts'
import {
  decodeHello,
  decodeInput,
  encodeReject,
  encodeRooms,
  encodeSnapshot,
  type PickupSnapshot,
  type RocketSnapshot,
  type RoomSummary,
  type SnapshotMessage,
  type SpilledSnapshot,
  encodeWelcome,
  isRespawn,
  isRoomsRequest,
  messageTypeOf,
  withAck,
  type VehicleSnapshot,
} from './wire.ts'

const HANDSHAKE_TIMEOUT_TICKS = TICKS_PER_SECOND * 5

/** A player asking to be put back more often than this is just held down. */
const RESPAWN_COOLDOWN_TICKS = TICKS_PER_SECOND

/**
 * How many inputs a player may have in hand to send at once, and how many
 * more they get each tick. An honest client sends one a tick, and a burst
 * of a second's worth after a stall, so this is twice what it needs; past
 * it, inputs are dropped on the floor rather than driven.
 */
const INPUT_ALLOWANCE = INPUT_TIMELINE_TICKS * 2
const INPUTS_PER_TICK = 2

/** A player heard nothing from for this long is let go: a tab left behind is not a driver. */
const IDLE_TIMEOUT_TICKS = TICKS_PER_SECOND * 15

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
  /** Inputs past a player's allowance, thrown away. */
  inputsDropped: number
  snapshotBytes: number
}

interface Player {
  connection: TransportConnection
  room: Room
  seat: Seat
  timeline: InputTimeline
  respawnedTick: number
  /** Whether they have had the bananas in full yet: until then, changes would mean nothing to them. */
  told: boolean
  /** How many inputs they may still send just now, and how many they sent past that. */
  allowance: number
  dropped: number
  /** The server tick they were last heard from. */
  heardTick: number
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
  readonly snapshotRemoved: number[]
  readonly snapshotRockets: RocketSnapshot[]
  /** The bananas as the last snapshot told of them: each slot's generation, and which spilled were out. */
  readonly toldGenerations: number[]
  readonly toldSpilled: Set<number>
  readonly spilledNow: Set<number>
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

  /** The islands with the most people on them, busiest first, and the lower seed among equals. */
  popularRooms(limit = ROOMS_LISTED): RoomSummary[] {
    return [...this.rooms.values()]
      .map((room) => ({ seed: room.seed, players: room.players.size }))
      .filter((room) => room.players > 0)
      .sort((a, b) => b.players - a.players || a.seed - b.seed)
      .slice(0, limit)
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
      inputsDropped: 0,
      snapshotBytes: 0,
    }
    for (const { timeline, dropped } of this.players.values()) {
      stats.inputsApplied += timeline.applied
      stats.inputsHeld += timeline.held
      stats.inputsLate += timeline.late
      stats.inputsAhead += timeline.ahead
      stats.inputsDropped += dropped
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
    this.tendPlayers()
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
    player.heardTick = this.clock

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
    if (player.allowance <= 0) {
      player.dropped += 1
      return
    }
    player.allowance -= 1
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

  /** Each tick a player may send a couple more inputs, and one silent for too long is let go. */
  private tendPlayers(): void {
    for (const player of this.players.values()) {
      player.allowance = Math.min(INPUT_ALLOWANCE, player.allowance + INPUTS_PER_TICK)
      if (this.clock - player.heardTick > IDLE_TIMEOUT_TICKS) this.reject(player.connection, REJECT_IDLE)
    }
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
      snapshotRemoved: [],
      snapshotRockets: [],
      toldGenerations: [],
      toldSpilled: new Set(),
      spilledNow: new Set(),
      lastSnapshotBytes: 0,
    }
    this.rooms.set(seed, room)
    this.events.onRoomOpened?.(seed)
    return room
  }

  private completeHandshake(connection: TransportConnection, payload: Uint8Array): void {
    // Someone only asking which islands are busy is told, and let go.
    if (isRoomsRequest(payload)) {
      this.handshaking.delete(connection.id)
      connection.send(encodeRooms(this.popularRooms()))
      connection.close('rooms listed')
      return
    }
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
      told: false,
      allowance: INPUT_ALLOWANCE,
      dropped: 0,
      heardTick: this.clock,
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

  /** The slots whose banana has moved on since the last snapshot told of them, or every slot. */
  private collectPickups(room: Room, all: boolean): PickupSnapshot[] {
    const pickups = room.snapshotPickups
    let count = 0
    room.arena.pickups.forEach((pickup, slot) => {
      if (!all && pickup.generation === room.toldGenerations[slot]) return
      const out = (pickups[count] ??= { slot: 0, generation: 0, ticksUntilOut: 0 })
      out.slot = slot
      out.generation = pickup.generation
      out.ticksUntilOut = Math.max(pickup.spawnTick - room.arena.tick, 0)
      count += 1
    })
    pickups.length = count
    return pickups
  }

  /** The bananas spilled since the last snapshot told of them, or every one out. */
  private collectSpilled(room: Room, all: boolean): SpilledSnapshot[] {
    const spilled = room.snapshotSpilled
    let count = 0
    for (const banana of room.arena.spilled) {
      if (!all && room.toldSpilled.has(banana.id)) continue
      const out = (spilled[count] ??= { id: 0, kind: 'banana', owner: NO_OWNER, from: v3(), position: v3(), age: 0 })
      out.id = banana.id
      out.kind = banana.kind
      out.owner = banana.owner
      vcopy(out.from, banana.from)
      vcopy(out.position, banana.position)
      out.age = room.arena.tick - banana.bornTick
      count += 1
    }
    spilled.length = count
    return spilled
  }

  /** The spilled bananas the last snapshot told of that are gone since, taken or faded. */
  private collectRemoved(room: Room): number[] {
    const removed = room.snapshotRemoved
    removed.length = 0
    room.spilledNow.clear()
    for (const banana of room.arena.spilled) room.spilledNow.add(banana.id)
    for (const id of room.toldSpilled) if (!room.spilledNow.has(id)) removed.push(id)
    return removed
  }

  /** Every rocket in the air: few, and short-lived, so all of them every time. */
  private collectRockets(room: Room): RocketSnapshot[] {
    const rockets = room.snapshotRockets
    let count = 0
    for (const rocket of room.arena.rockets) {
      const out = (rockets[count] ??= { id: 0, owner: 0, target: 0, position: v3(), velocity: v3(), age: 0 })
      out.id = rocket.id
      out.owner = rocket.owner
      out.target = rocket.target
      vcopy(out.position, rocket.position)
      vcopy(out.velocity, rocket.velocity)
      out.age = room.arena.tick - rocket.bornTick
      count += 1
    }
    rockets.length = count
    return rockets
  }

  /** What this snapshot told of the bananas, for the next to tell only what differs. */
  private rememberTold(room: Room): void {
    room.arena.pickups.forEach((pickup, slot) => (room.toldGenerations[slot] = pickup.generation))
    room.toldSpilled.clear()
    for (const banana of room.arena.spilled) room.toldSpilled.add(banana.id)
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
        weapon: 'none',
        ammoTicks: 0,
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
      vehicle.weapon = seat.weapon
      vehicle.ammoTicks = seat.ammoTicks
      Object.assign(vehicle.appliedInput, this.playerIn(room, seat)?.timeline.appliedInput ?? this.scratchInput)
      count += 1
    }
    vehicles.length = count
    return vehicles
  }

  /**
   * Where everything is, to everyone in the room. The vehicles go every
   * time; of the bananas, a newcomer gets the whole word once and everyone
   * else only what changed since the last, which is nothing as a rule.
   */
  private broadcastSnapshot(room: Room): void {
    if (room.players.size === 0) return
    const message: SnapshotMessage = {
      tick: room.arena.tick,
      ackInputTick: -1,
      full: false,
      spilledNext: room.arena.spilledNext,
      vehicles: this.collectSnapshot(room),
      pickups: room.snapshotPickups,
      spilled: room.snapshotSpilled,
      removed: room.snapshotRemoved,
      rockets: this.collectRockets(room),
    }
    // Each is encoded at most once, whoever asks first, from the same scratch.
    let changes: Uint8Array | null = null
    let whole: Uint8Array | null = null
    for (const player of room.players.values()) {
      let encoded: Uint8Array
      if (player.told) {
        if (changes === null) {
          message.full = false
          this.collectPickups(room, false)
          this.collectSpilled(room, false)
          this.collectRemoved(room)
          changes = encodeSnapshot(message)
        }
        encoded = changes
      } else {
        if (whole === null) {
          message.full = true
          this.collectPickups(room, true)
          this.collectSpilled(room, true)
          room.snapshotRemoved.length = 0
          whole = encodeSnapshot(message)
        }
        encoded = whole
        player.told = true
      }
      player.connection.send(withAck(encoded, player.timeline.receivedTick))
    }
    room.lastSnapshotBytes = (changes ?? whole ?? encodeSnapshot(message)).length
    this.rememberTold(room)
  }
}
