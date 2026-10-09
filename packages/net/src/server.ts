import {
  NEUTRAL_INPUT,
  NPC_CARS,
  PLAYABLE_PROFILE_IDS,
  advance,
  awardGames,
  endRace,
  playRace,
  startRace,
  carriedOf,
  carryOver,
  changeVehicle,
  takeSeat,
  createVehicleInput,
  freeSeat,
  leaveSeat,
  respawnLost,
  npcInput,
  portalSpawn,
  respawn,
  respawnNearby,
  seatNpc,
  setGame,
  spawnWhere,
  validGame,
  type Arena,
  type Carried,
  type Seat,
  type VehicleInput,
  type VehicleSpawn,
} from '@buggies/game'
import { vdistance } from '@buggies/physics'
import { InputTimeline } from './input-timeline.ts'
import {
  CLIENT_CHANGE_VEHICLE,
  CLIENT_GAME,
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
  decodeChangeVehicle,
  decodeGame,
  NO_ARRIVAL,
  NO_PASS,
  decodeHello,
  decodeInput,
  encodeReject,
  encodeRooms,
  encodeSnapshot,
  type RoomSummary,
  encodeWelcome,
  type HelloMessage,
  isRespawn,
  isRoomsRequest,
  decodePeekRequest,
  encodePeek,
  type IslandMark,
  messageTypeOf,
  withAck,
} from './wire.ts'

const HANDSHAKE_TIMEOUT_TICKS = TICKS_PER_SECOND * 5
/** How long someone may wait for their island to be made before giving up on it. */
const MAKING_TIMEOUT_TICKS = TICKS_PER_SECOND * 60

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

/** How long what a player left a room holding waits for them to come out of a portal into the next, or back into it. */
const CARRY_TICKS = TICKS_PER_SECOND * 30

export interface GameServerEvents {
  onJoined(seat: Seat, connectionId: number, seed: number): void
  onLeft(seat: Seat, connectionId: number, seed: number): void
  onRejected(connectionId: number, reason: string): void
  onRespawned(seat: Seat, why: 'lost' | 'asked'): void
  onChangedVehicle(seat: Seat): void
  /** A player has set a count to play for, or cleared theirs, and has won one. */
  onGameSet?(seat: Seat): void
  onGameWon?(seat: Seat): void
  /** A player has set a race going on their island, and a race is over, won or called off. */
  onRaceStarted?(seat: Seat, racers: readonly Seat[]): void
  onRaceEnded?(seed: number, winner: Seat | null): void
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
  /** What they show on coming through a portal, for what they held here to be carried over. */
  pass: number
}

/**
 * What a player left a room holding, and when, for the room they come out
 * into; and where, for them to be put back there if they only lost the
 * connection and joined the same room again.
 */
interface Left {
  readonly carried: Carried
  readonly tick: number
  readonly seed: number
  readonly where: VehicleSpawn
}

interface Handshake {
  connection: TransportConnection
  openedTick: number
  /** The hello of someone waiting for their island to be made, to be seated on it once it is. */
  waiting: HelloMessage | null
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
  private readonly arenaFor: (seed: number) => Arena | Promise<Arena>
  /** The islands being made for someone waiting, made elsewhere while every room goes on. */
  private readonly making = new Map<number, Promise<Arena>>()
  private disposed = false
  private readonly events: Partial<GameServerEvents>
  private readonly rooms = new Map<number, Room>()
  private readonly players = new Map<number, Player>()
  private readonly handshaking = new Map<number, Handshake>()
  private readonly scratchInput: VehicleInput = createVehicleInput()
  /** What a car nobody drives asks for, a seat at a time: each is used before the next is asked. */
  private readonly npcCommand: VehicleInput = createVehicleInput()
  /** The server's own clock, for handshakes, which belong to no room yet. */
  private clock = 0
  /** What players left their rooms holding, by their pass, a while. */
  private readonly left = new Map<number, Left>()

  /** How many cars nobody drives each island has, while seats are free for them. */
  private readonly npcs: number

  /**
   * `arenaFor` makes the arena for a seed nobody is on: at once, or
   * eventually, as when its island is generated off the thread that steps
   * the rooms, which then go on while it is made.
   */
  constructor(arenaFor: (seed: number) => Arena | Promise<Arena>, events: Partial<GameServerEvents> = {}, npcs = NPC_CARS) {
    this.arenaFor = arenaFor
    this.events = events
    this.npcs = npcs
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
  /** Where every car on an island is, driven or not: none, if nobody is on it. */
  peek(seed: number): IslandMark[] {
    const room = this.rooms.get(seed)
    if (room === undefined) return []
    const { arena } = room
    const marks: IslandMark[] = []
    for (const seat of arena.seats) {
      if (seat.occupied) marks.push({ kind: seat.npc ? 'npc' : 'player', seat: seat.id, position: { ...seat.vehicle.frame.position } })
    }
    return marks
  }

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
      advance(room.arena, (seat) =>
        seat.npc ? npcInput(room.arena, seat, this.npcCommand) : (this.playerIn(room, seat)?.timeline.consume(tick) ?? NEUTRAL_INPUT),
      )
      for (const seat of respawnLost(room.arena)) this.events.onRespawned?.(seat, 'lost')
      for (const seat of awardGames(room.arena.seats)) this.events.onGameWon?.(seat)
      const raced = playRace(room.arena)
      if (raced !== null) this.events.onRaceEnded?.(room.arena.planet.seed, raced.winner)
      if (room.arena.tick % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot(room)
    }
    this.expireHandshakes()
    this.tendPlayers()
    for (const [pass, { tick }] of this.left) if (this.clock - tick > CARRY_TICKS) this.left.delete(pass)
  }

  dispose(): void {
    this.disposed = true
    for (const room of this.rooms.values()) room.arena.world.free()
    this.rooms.clear()
    this.players.clear()
  }

  onOpen = (connection: TransportConnection): void => {
    this.handshaking.set(connection.id, { connection, openedTick: this.clock, waiting: null })
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

    if (messageTypeOf(payload) === CLIENT_CHANGE_VEHICLE) {
      const profile = decodeChangeVehicle(payload)
      if (profile === null || !PLAYABLE_PROFILE_IDS.includes(profile)) {
        this.reject(connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      // A change puts the car back on the road, so it waits out a respawn's cooldown too.
      if (profile === player.seat.profile || arena.tick - player.respawnedTick < RESPAWN_COOLDOWN_TICKS) return
      player.respawnedTick = arena.tick
      changeVehicle(arena, player.seat, profile)
      this.events.onChangedVehicle?.(player.seat)
      return
    }

    if (messageTypeOf(payload) === CLIENT_GAME) {
      const request = decodeGame(payload)
      const game = request === null ? null : request === undefined ? undefined : validGame(request, arena.planet.radius)
      if (game === undefined || (request !== null && game === null)) {
        this.reject(connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      if (game === null) {
        // Clearing is of the player's own count, and of the race on if they set it going.
        setGame(player.seat, null, arena.tick)
        if (arena.race?.starter === player.seat.id) {
          endRace(arena)
          this.events.onRaceEnded?.(arena.planet.seed, null)
        }
      } else if (game.kind !== 'race') setGame(player.seat, { kind: game.kind, target: game.target }, arena.tick)
      else if (arena.race === null) {
        // One race at a time: asked for while another is on, it is too late, and nothing comes of it.
        this.events.onRaceStarted?.(player.seat, startRace(arena, game.course, player.seat, game.target))
        return
      } else return
      this.events.onGameSet?.(player.seat)
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
    if (player !== undefined) this.leave(player)
  }

  /** Let a player go, holding on to what they held. The last one out closes the room, unless it is about to be joined again. */
  private leave(player: Player, keepRoom = false): void {
    const { connection, room } = player
    this.players.delete(connection.id)
    room.players.delete(connection.id)
    // Gone through a portal, or cut off, as far as anyone here knows: what they held waits for them.
    this.left.set(player.pass, { carried: carriedOf(player.seat), tick: this.clock, seed: room.seed, where: spawnWhere(player.seat) })
    leaveSeat(room.arena, player.seat.id)
    this.topUpNpcs(room.arena)
    this.events.onLeft?.(player.seat, connection.id, room.seed)
    // An empty island is not worth stepping.
    if (room.players.size === 0 && !keepRoom) this.closeRoom(room)
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
      if (this.clock - handshake.openedTick < (handshake.waiting === null ? HANDSHAKE_TIMEOUT_TICKS : MAKING_TIMEOUT_TICKS)) continue
      this.reject(handshake.connection, REJECT_HANDSHAKE_ORDER)
    }
  }

  /** A room for a seed nobody is on, with its arena made. */
  private openRoom(seed: number, arena: Arena): Room {
    const room: Room = {
      seed,
      arena,
      players: new Map(),
      snapshots: createRoomSnapshots(),
      lastSnapshotBytes: 0,
    }
    this.rooms.set(seed, room)
    this.topUpNpcs(room.arena)
    this.events.onRoomOpened?.(seed)
    return room
  }

  /** Seat cars nobody drives in the last seats, until there are as many as an island has, or no seat is left. */
  private topUpNpcs(arena: Arena): void {
    let count = arena.seats.filter((seat) => seat.npc).length
    for (let id = arena.seats.length - 1; id >= 0 && count < this.npcs; id--) {
      if (arena.seats[id]!.occupied) continue
      if (seatNpc(arena, id) === null) return
      count++
    }
  }

  private completeHandshake(connection: TransportConnection, payload: Uint8Array): void {
    // Someone only asking which islands are busy is told, and let go.
    // Or where everything is on one island.
    const peeked = decodePeekRequest(payload)
    if (peeked !== null) {
      this.handshaking.delete(connection.id)
      connection.send(encodePeek(this.peek(peeked)))
      connection.close('peeked')
      return
    }
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
    if (hello === null || !PLAYABLE_PROFILE_IDS.includes(hello.profile)) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      this.reject(connection, REJECT_PROTOCOL_MISMATCH)
      return
    }
    const handshake = this.handshaking.get(connection.id)
    // Asked twice while their island is made: the first is enough.
    if (handshake === undefined || handshake.waiting !== null) return
    // Someone back with the pass of a player still seated has lost that connection
    // without it closing yet: that one is let go, for them to take up where it left off.
    const stale = hello.pass === NO_PASS ? undefined : [...this.players.values()].find((player) => player.pass === hello.pass)
    if (stale !== undefined) {
      this.leave(stale, stale.room.seed === hello.seed)
      stale.connection.close('joined again')
    }
    const existing = this.rooms.get(hello.seed)
    if (existing !== undefined) {
      this.seat(connection, hello, existing)
      return
    }
    const made = this.making.get(hello.seed) ?? this.arenaFor(hello.seed)
    if (!(made instanceof Promise)) {
      this.seat(connection, hello, this.openRoom(hello.seed, made))
      return
    }
    // Not made yet: they wait for it, and whoever else asks for it meanwhile waits with them.
    handshake.waiting = hello
    if (!this.making.has(hello.seed)) this.whenMade(hello.seed, made)
  }

  /** Once an island being made is ready, a room for it, with everyone waiting for it seated there. */
  private whenMade(seed: number, made: Promise<Arena>): void {
    this.making.set(seed, made)
    const waiting = (): Handshake[] => [...this.handshaking.values()].filter((handshake) => handshake.waiting?.seed === seed)
    made.then(
      (arena) => {
        this.making.delete(seed)
        if (this.disposed) {
          arena.world.free()
          return
        }
        const room = this.rooms.get(seed) ?? this.openRoom(seed, arena)
        if (room.arena !== arena) arena.world.free()
        for (const handshake of waiting()) this.seat(handshake.connection, handshake.waiting!, room)
        if (room.players.size === 0) this.closeRoom(room)
      },
      () => {
        this.making.delete(seed)
        for (const handshake of waiting()) this.reject(handshake.connection, REJECT_MALFORMED_MESSAGE)
      },
    )
  }

  /** Seat someone who has said hello in the room for their island. */
  private seat(connection: TransportConnection, hello: HelloMessage, room: Room): void {
    const { arena } = room
    // A car nobody drives gives up its seat to someone who will.
    let free = freeSeat(arena)
    const npc = arena.seats.find((seat) => seat.npc)
    if (free === undefined && npc !== undefined) {
      leaveSeat(arena, npc.id)
      free = npc
    }
    if (free === undefined) {
      this.reject(connection, REJECT_SERVER_FULL)
      if (room.players.size === 0) this.closeRoom(room)
      return
    }

    this.handshaking.delete(connection.id)
    const seat = takeSeat(arena, free.id, hello.profile)
    const left = hello.pass === NO_PASS ? undefined : this.left.get(hello.pass)
    // Come through a portal, the car comes out of the one it arrives by, beside anyone already there.
    const through = hello.arrival !== NO_ARRIVAL
    if (through) {
      const out = arrivalSpawn(arena, hello.arrival, seat)
      if (out !== null) respawn(seat, out)
    } else if (left !== undefined && left.seed === room.seed) {
      // Back on the island it was cut off from: where it was.
      respawn(seat, left.where)
    }
    // With what it held when it went, if it shows the pass it was given for it.
    if (left !== undefined && (through || left.seed === room.seed)) {
      this.left.delete(hello.pass)
      carryOver(seat, left.carried)
    }
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
      pass: this.newPass(),
    }
    this.players.set(connection.id, player)
    room.players.set(connection.id, player)
    connection.send(
      encodeWelcome({
        protocolVersion: PROTOCOL_VERSION,
        seed: arena.planet.seed,
        seat: seat.id,
        epoch: seat.epoch,
        tick: arena.tick,
        maxPlayers: arena.seats.length,
        profile: seat.profile,
        pass: player.pass,
      }),
    )
    this.events.onJoined?.(seat, connection.id, room.seed)
  }

  /** A pass nobody holds or has left behind: random, so nobody takes another's by guessing. */
  private newPass(): number {
    for (;;) {
      const pass = Math.floor(Math.random() * 0x1_0000_0000)
      if (pass === NO_PASS || this.left.has(pass) || [...this.players.values()].some((player) => player.pass === pass)) continue
      return pass
    }
  }

  private closeRoom(room: Room): void {
    if (this.rooms.get(room.seed) !== room) return
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
    // A player's car is told with the input it was last stepped with; a car nobody drives, with what its
    // driver last asked of it; anything else, with none. Never the scratch buffer, which holds whatever
    // input any player sent last: told with that, every car nobody drives would honk when a player did.
    const appliedInputOf = (seat: Seat): VehicleInput =>
      this.playerIn(room, seat)?.timeline.appliedInput ?? (seat.npc ? seat.vehicle.command : NEUTRAL_INPUT)
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

/** Where a car comes out of a portal: the first place out of it that no other car in play is standing on. */
function arrivalSpawn(arena: Arena, portal: number, seat: Seat): VehicleSpawn | null {
  for (let place = 0; place < 8; place++) {
    const out = portalSpawn(arena.planet, portal, place)
    if (out === null) return null
    const taken = arena.seats.some((other) => other !== seat && other.occupied && vdistance(other.vehicle.frame.position, out.position) < ARRIVAL_CLEAR)
    if (!taken) return out
  }
  return portalSpawn(arena.planet, portal, 0)
}

/** How far apart two cars coming out of a portal must stand. */
const ARRIVAL_CLEAR = 3
