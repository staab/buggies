import {
  advance,
  takeSeat,
  createVehicleInput,
  freeSeat,
  leaveSeat,
  respawnLost,
  respawnNearby,
  type Arena,
  type Seat,
  type VehicleInput,
} from '@buggies/game'
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
import { createRoomSnapshots, gatherSnapshot, rememberTold, type RoomSnapshots } from './room-snapshot.ts'
import type { TransportConnection, TransportHandlers } from './transport.ts'
import {
  decodeHello,
  decodeInput,
  encodeReject,
  encodeRooms,
  encodeSnapshot,
  type RoomSummary,
  encodeWelcome,
  isRespawn,
  isRoomsRequest,
  messageTypeOf,
  withAck,
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
  /** What its snapshots are gathered into, and what the last told. */
  readonly snapshots: RoomSnapshots
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
      snapshots: createRoomSnapshots(),
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

  /**
   * Where everything is, to everyone in the room. The vehicles go every
   * time; of the bananas, a newcomer gets the whole word once and everyone
   * else only what changed since the last, which is nothing as a rule.
   */
  private broadcastSnapshot(room: Room): void {
    if (room.players.size === 0) return
    const { arena, snapshots } = room
    const appliedInputOf = (seat: Seat): VehicleInput =>
      this.playerIn(room, seat)?.timeline.appliedInput ?? this.scratchInput
    // Each is encoded at most once, whoever asks first: the changes for those told before, the whole for a newcomer.
    let changes: Uint8Array | null = null
    let whole: Uint8Array | null = null
    for (const player of room.players.values()) {
      let encoded: Uint8Array
      if (player.told) {
        encoded = changes ??= encodeSnapshot(gatherSnapshot(arena, snapshots, appliedInputOf, false))
      } else {
        encoded = whole ??= encodeSnapshot(gatherSnapshot(arena, snapshots, appliedInputOf, true))
        player.told = true
      }
      player.connection.send(withAck(encoded, player.timeline.receivedTick))
    }
    room.lastSnapshotBytes = (changes ?? whole)?.length ?? 0
    rememberTold(arena, snapshots)
  }
}
