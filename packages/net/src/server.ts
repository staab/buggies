import {
  COUNTDOWN_TICKS,
  DEFAULT_VEHICLE_PROFILE,
  FINISH_GRACE_TICKS,
  HOLD_FOREVER,
  NEUTRAL_INPUT,
  NO_PORTAL,
  NPC_CARS,
  NPC_FRAGILITY,
  PLAYABLE_PROFILE_IDS,
  RACERS_MOST,
  advance,
  awardAchievements,
  botInput,
  botPutBackSpot,
  botSetBack,
  botStuck,
  buildCourse,
  carriedOf,
  carryOver,
  changeVehicle,
  checkpointSpawn,
  createRacerBot,
  createVehicleInput,
  freeSeat,
  keepOf,
  leaveSeat,
  legOf,
  nextWorld,
  npcInput,
  occupiedSeats,
  planOf,
  portalCrossed,
  portalSpawn,
  respawn,
  respawnLost,
  respawnNearby,
  seatNpc,
  setRules,
  spawnWhere,
  takeSeat,
  type Achievement,
  type Arena,
  type ArenaRules,
  type Carried,
  type RaceLeg,
  type RacerBot,
  type Seat,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleSpawn,
} from '@buggies/game'
import { groundDistance, type World } from '@buggies/terrain'
import { v3, vcopy, vdistance, type Vec3 } from '@buggies/physics'

import {
  addMember,
  addSlot,
  beginRace,
  botOfPass,
  createDemoGame,
  createGame,
  editGame,
  gameFault,
  gameSummary,
  gameView,
  joinable,
  leaderWorld,
  memberOfPass,
  placeRacers,
  prepareRace,
  racerIndexOf,
  removeMember,
  removeSlot,
  setBotVehicle,
  setReady,
  stepGame,
  type GameMember,
  type GameRecord,
  type Racer,
} from './game-registry.ts'
import { InputTimeline } from './input-timeline.ts'
import { newChallenge, verifyAuth } from './nostr.ts'
import { MemoryPlayerStore, type PlayerStore } from './player-store.ts'
import {
  CLIENT_AUTH,
  CLIENT_CHANGE_VEHICLE,
  CLIENT_CREATE_GAME,
  CLIENT_GAME_EDIT,
  CLIENT_GAME_READY,
  CLIENT_GAME_START,
  CLIENT_HELLO,
  CLIENT_INPUT,
  CLIENT_JOIN_GAME,
  CLIENT_LEAVE_GAME,
  CLIENT_LOBBY,
  CLIENT_SLOT_ADD,
  CLIENT_SLOT_REMOVE,
  CLIENT_SLOT_VEHICLE,
  INPUT_TIMELINE_TICKS,
  NO_SEAT,
  NO_TICK,
  PROTOCOL_VERSION,
  REJECT_HANDSHAKE_ORDER,
  REJECT_IDLE,
  REJECT_MALFORMED_MESSAGE,
  REJECT_PROTOCOL_MISMATCH,
  REJECT_SERVER_FULL,
  TICKS_PER_SECOND,
  TICKS_PER_SNAPSHOT,
  rejectLabel,
} from './protocol.ts'
import { createRoomSnapshots, gatherSnapshot, rememberTold, type RoomSnapshots } from './room-snapshot.ts'
import type { TransportConnection, TransportHandlers } from './transport.ts'
import {
  decodeAuth,
  decodeChangeVehicle,
  decodeCreateGame,
  decodeGameEdit,
  decodeGameReady,
  decodeHello,
  decodeInput,
  decodeJoinGame,
  decodeLobbyHello,
  decodeSlotRemove,
  decodeSlotVehicle,
  encodeGame,
  encodeGames,
  encodeLobby,
  encodeLobbyWelcome,
  encodeRacePlan,
  encodeReject,
  encodeSignedIn,
  encodeSnapshot,
  encodeStandings,
  encodeWelcome,
  flagsOf,
  HELD,
  isGameStart,
  isLeaveGame,
  isRespawn,
  isSlotAdd,
  messageTypeOf,
  withAck,
  NO_ARRIVAL,
  NO_PASS,
  type GameMode,
  type GameSummary,
  type HelloMessage,
  type RaceRacerView,
  type RaceView,
} from './wire.ts'

const HANDSHAKE_TIMEOUT_TICKS = TICKS_PER_SECOND * 5
/** How long someone may wait for their world to be made before giving up on it. */
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

/** How often the bananas everyone holds are kept against their keys, besides when they leave: a server that stops loses no more than this. */
const BANANAS_KEPT_TICKS = TICKS_PER_SECOND * 10

/** A player heard nothing from for this long is let go: a tab left behind is not a driver. */
const IDLE_TIMEOUT_TICKS = TICKS_PER_SECOND * 15

/**
 * How long what a player left a room holding waits for them to come out of
 * a portal into the next, or back into it: long enough for their page to
 * make the world on the other side before it joins its room.
 */
const CARRY_TICKS = TICKS_PER_SECOND * 120

/** The planets a host who does not choose one may draw: a seed, over the whole range one has. */
const SEED_MOST = 0x0ffffffe

/** What a room's watchers are let go with when the room they are watching closes: their pages find the race again. */
export const ROOM_CLOSED = 'the room has closed'

/** How long the server's own demo race is given to get home before it is called over all the same, in ticks. */
const DEMO_TICKS = TICKS_PER_SECOND * 60 * 4

/** A leg with no way at all to follow, for a car that is not a bot of a race. */
const NO_ROUTE: readonly Vec3[] = []

/** What a room is made of: the world of a game it is, which of that world's portals it keeps, and the game's rules. */
export interface ArenaRequest {
  readonly game: number
  readonly world: number
  /** The portals the world keeps, as indices into it as generated: every one else is gone. `null` in free drive, which keeps them all. */
  readonly keep: readonly number[] | null
  readonly weapons: boolean
  readonly bananas: boolean
}

/** How the server gets its worlds: one to build a course with, and one made into an arena to drive on. */
export interface GameSources {
  worldFor(world: number): World | Promise<World>
  arenaFor(request: ArenaRequest): Arena | Promise<Arena>
}

export interface GameServerEvents {
  onJoined(seat: Seat, connectionId: number, room: Room): void
  onLeft(seat: Seat, connectionId: number, room: Room): void
  onRejected(connectionId: number, reason: string): void
  onRespawned(seat: Seat, why: 'lost' | 'asked'): void
  onChangedVehicle(seat: Seat): void
  /** A player has been paid for a feat. */
  onAchieved?(seat: Seat, achievement: Achievement): void
  /** A player has proved which nostr key is theirs, in a seat if it has one already. */
  onSignedIn?(seat: Seat | null, pubkey: string): void
  /** A host has made a game. */
  onGameOpened?(game: GameRecord): void
  /** A race's countdown has begun: its course is made and its racers are on the grid. */
  onGameStarted?(game: GameRecord): void
  /** A race is over and its standings stand. */
  onGameFinished?(game: GameRecord): void
  /** A game has been deleted behind its last member or its standings. */
  onGameClosed?(game: GameRecord): void
  /** A race's course could not be built, and why: its host is told in the room. */
  onCourseFailed?(game: GameRecord, reason: string): void
  /** A room has been made for a world of a game nobody was on, or closed behind the last to leave it. */
  onRoomOpened(room: Room): void
  onRoomClosed(room: Room): void
}

export interface GameServerStats {
  tick: number
  games: number
  rooms: number
  players: number
  spectators: number
  lobbyConnections: number
  inputsApplied: number
  inputsHeld: number
  inputsLate: number
  inputsAhead: number
  /** Inputs past a player's allowance, thrown away. */
  inputsDropped: number
  snapshotBytes: number
}

/** What the server does of its own accord, besides tending the games it is told of. */
export interface GameServerSettings {
  /** Whether it keeps a demo race going while anyone browses the start screen. On unless told otherwise. */
  readonly demo?: boolean
  /** The seed a new demo race draws: random unless a server whose worlds are all made says otherwise. */
  readonly demoSeed?: () => number
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
  /** The pass of the game's member this seat belongs to: the same at every portal and after a dropped connection. */
  pass: number
  /** The game this seat is one of, and the racer it drives in it, if that game is a race. */
  game: number
  racer: number
  /** What they go by, as they gave it. */
  name: string
  /** What they were given to sign with their nostr key, and the key, once they have. */
  challenge: string
  pubkey: string | null
}

/**
 * What a player left a room holding, and when, for the room they come out
 * into; and where, for them to be put back there if they only lost the
 * connection and joined the same room again.
 */
interface Left {
  readonly carried: Carried
  /** The nostr key they had proved theirs, which comes through with them. */
  readonly pubkey: string | null
  readonly tick: number
  readonly game: number
  readonly world: number
  readonly where: VehicleSpawn
}

/** A connection that has said hello, waiting to be seated in a world, or on nothing yet. */
interface Handshake {
  connection: TransportConnection
  openedTick: number
  /** The hello of someone waiting for their world to be made, to be seated on it once it is. */
  waiting: HelloMessage | null
}

/** A connection on the start screen or in a game room: a member of a game, or browsing them, and no seat in any world. */
interface LobbyConnection {
  readonly connection: TransportConnection
  name: string
  /** The game this connection is a member of, or 0 while browsing. */
  game: number
  /** Its member id in that game, or 0 while browsing. */
  member: number
  /** What it was given to sign with its nostr key, and the key once it has. */
  challenge: string
  pubkey: string | null
}

/**
 * One world of one game. Each is a room of its own, with its own arena and
 * clock: a race's first world and a free drive on it are two rooms, and see
 * nothing of each other.
 */
export interface Room {
  readonly key: string
  readonly game: number
  readonly world: number
  readonly mode: GameMode
  readonly arena: Arena
  readonly players: Map<number, Player>
  /** The cars in it that nobody on a connection drives: a race's bots, or a free drive's traffic, by the seat each holds. */
  readonly bots: Map<number, RoomBot>
  /** Who is watching it without a seat: they are told what a player is, and send nothing. */
  readonly spectators: Map<number, Spectator>
  /** What its snapshots are gathered into, and what the last told. */
  readonly snapshots: RoomSnapshots
  lastSnapshotBytes: number
}

/** A car in a room that nobody drives: a bot of a race, following its leg, or a free drive's traffic, going where it may. */
export interface RoomBot {
  /** The pass of the slot it belongs to: a race's racer is known by it. */
  readonly pass: number
  readonly name: string
  /** What drives it in a race; `null` in a free drive, where the seat is one of the traffic's own. */
  readonly bot: RacerBot | null
  /** The way it drives, when it is a race's: its leg's route, from where it is entered to where it is left. */
  readonly route: readonly Vec3[] | null
  /** Where its car was the last tick, which is how driving through the portal out is told. */
  readonly previous: Vec3
}

/** A connection watching a room: it takes no seat, and is told the plan, the snapshots and the standings as they come. */
export interface Spectator {
  readonly connection: TransportConnection
  /** Whether it has been told the whole of the bananas yet, or is to be told only what changed. */
  told: boolean
}

/** The name a room of a game's world is known by. */
export function roomKey(game: number, world: number): string {
  return `${game}:${world}`
}

/**
 * Every game, every room of one, and every seat. Players on a lobby
 * connection make and join games and choose what they are played by; a
 * world connection names the game it is a member of and the world it is
 * to be seated in. Inputs are sent for ticks; the server drives each seat
 * with them, steps every room, keeps every race's course to itself, and
 * every few ticks tells everyone in a room where everything in it is.
 * Nothing a client says about its own position is believed.
 */
export class GameServer implements TransportHandlers {
  private readonly sources: GameSources
  private readonly events: Partial<GameServerEvents>
  /** How many cars nobody drives each island has, while seats are free for them. */
  private readonly npcs: number
  /** What is kept of each nostr key for good: the achievements it has been paid, and the bananas it holds between free drives. */
  private readonly store: PlayerStore
  /** The worlds of a game being made for someone waiting, made elsewhere while every room goes on. */
  private readonly making = new Map<string, Promise<Arena>>()
  private disposed = false
  /** Every game on the server, by id, and the id the next one gets. */
  private readonly games = new Map<number, GameRecord>()
  private nextGameId = 1
  private readonly rooms = new Map<string, Room>()
  private readonly players = new Map<number, Player>()
  private readonly lobbies = new Map<number, LobbyConnection>()
  private readonly handshaking = new Map<number, Handshake>()
  /** The room each watching connection is watching, without a seat in it. */
  private readonly watching = new Map<number, Room>()
  private readonly scratchInput: VehicleInput = createVehicleInput()
  /** What a car nobody drives asks for, a seat at a time: each is used before the next is asked. */
  private readonly npcCommand: VehicleInput = createVehicleInput()
  /** What a bot of a race asks of its car for this tick, a seat at a time, as `npcCommand` is for the traffic. */
  private readonly botCommand: VehicleInput = createVehicleInput()
  /** The server's own clock, which every game's, race's and handshake's timing is kept in. */
  private clock = 0
  /** What players left their rooms holding, by their pass, a while. */
  private readonly left = new Map<number, Left>()
  /** The demo race's id while one is on, or 0. */
  private demo = 0
  /** The world each race is followed in as last listed, so the games list is only pushed when it changes. */
  private readonly leaders = new Map<number, number>()
  private readonly demoOn: boolean
  private readonly demoSeed: () => number

  /**
   * `sources` says how the server gets its worlds: the one it builds a
   * race's course from, at once or eventually, and the arena it drives on,
   * which the real server makes off the thread that steps the rooms so
   * that making one never holds up a game already being played.
   */
  constructor(
    sources: GameSources,
    events: Partial<GameServerEvents> = {},
    npcs = NPC_CARS,
    store: PlayerStore = new MemoryPlayerStore(),
    settings: GameServerSettings = {},
  ) {
    this.sources = sources
    this.events = events
    this.npcs = npcs
    this.store = store
    this.demoOn = settings.demo ?? true
    this.demoSeed = settings.demoSeed ?? (() => 1 + Math.floor(Math.random() * SEED_MOST))
  }

  tick(): number {
    return this.clock
  }

  playerCount(): number {
    return this.players.size
  }

  roomCount(): number {
    return this.rooms.size
  }

  gameCount(): number {
    return this.games.size
  }

  /** A game on the server, by its id. */
  gameFor(id: number): GameRecord | undefined {
    return this.games.get(id)
  }

  /** The room of one world of one game, if anyone is on it. */
  roomFor(game: number, world: number): Room | undefined {
    return this.rooms.get(roomKey(game, world))
  }

  stats(): GameServerStats {
    const stats: GameServerStats = {
      tick: this.clock,
      games: this.games.size,
      rooms: this.rooms.size,
      players: this.players.size,
      spectators: this.watching.size,
      lobbyConnections: this.lobbies.size,
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

  /** One fixed step for every game and every room, then a look at every player and every handshake. */
  advance(): void {
    this.clock += 1
    for (const game of [...this.games.values()]) this.tendGame(game)
    for (const game of [...this.games.values()]) this.tendRacers(game)
    for (const room of [...this.rooms.values()]) this.stepRoom(room)
    for (const game of [...this.games.values()]) if (game.status === 'racing') this.stepRace(game)
    this.tendDemo()
    if (this.clock % BANANAS_KEPT_TICKS === 0) for (const player of this.players.values()) this.keepBananas(player)
    this.expireHandshakes()
    this.tendPlayers()
    for (const [pass, { tick }] of this.left) if (this.clock - tick > CARRY_TICKS) this.left.delete(pass)
  }

  dispose(): void {
    this.disposed = true
    for (const room of this.rooms.values()) {
      room.arena.world.free()
      for (const spectator of room.spectators.values()) spectator.connection.close(ROOM_CLOSED)
    }
    this.rooms.clear()
    this.players.clear()
    this.lobbies.clear()
    this.watching.clear()
    this.games.clear()
  }

  onOpen = (connection: TransportConnection): void => {
    this.handshaking.set(connection.id, { connection, openedTick: this.clock, waiting: null })
  }

  onMessage = (connection: TransportConnection, payload: Uint8Array): void => {
    if (this.handshaking.has(connection.id)) {
      this.start(connection, payload)
      return
    }
    const lobby = this.lobbies.get(connection.id)
    if (lobby !== undefined) {
      this.lobbyMessage(lobby, payload)
      return
    }
    const player = this.players.get(connection.id)
    if (player === undefined) return
    this.worldMessage(player, payload)
  }

  onClose = (connection: TransportConnection): void => {
    this.handshaking.delete(connection.id)
    const lobby = this.lobbies.get(connection.id)
    if (lobby !== undefined) {
      this.lobbies.delete(connection.id)
      this.dropLobby(lobby)
    }
    const player = this.players.get(connection.id)
    if (player !== undefined) this.leave(player)
    const watching = this.watching.get(connection.id)
    if (watching !== undefined) {
      this.watching.delete(connection.id)
      watching.spectators.delete(connection.id)
    }
  }

  /** What a connection is, decided by its first message: a lobby connection, or a seat in a world. */
  private start(connection: TransportConnection, payload: Uint8Array): void {
    if (messageTypeOf(payload) === CLIENT_LOBBY) {
      this.openLobby(connection, payload)
      return
    }
    if (messageTypeOf(payload) !== CLIENT_HELLO) {
      this.reject(connection, REJECT_HANDSHAKE_ORDER)
      return
    }
    const hello = decodeHello(payload)
    if (hello === null || (hello.profile !== null && !PLAYABLE_PROFILE_IDS.includes(hello.profile))) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      this.reject(connection, REJECT_PROTOCOL_MISMATCH)
      return
    }
    const handshake = this.handshaking.get(connection.id)
    // Asked twice while their world is made: the first is enough.
    if (handshake === undefined || handshake.waiting !== null) return
    // Someone back with the pass of a seat still taken has lost that connection
    // without it closing yet: that one is let go, for them to take up where it left off.
    const stale = hello.pass === NO_PASS ? undefined : [...this.players.values()].find((player) => player.pass === hello.pass)
    if (stale !== undefined) {
      this.leave(stale, stale.room.key === roomKey(hello.game, hello.seed))
      stale.connection.close('joined again')
    }
    this.arrive(connection, hello)
  }

  // ---- the lobby: games, their rooms, and who is in them ----

  private openLobby(connection: TransportConnection, payload: Uint8Array): void {
    const hello = decodeLobbyHello(payload)
    if (hello === null) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      this.reject(connection, REJECT_PROTOCOL_MISMATCH)
      return
    }
    this.handshaking.delete(connection.id)
    const lobby: LobbyConnection = { connection, name: hello.name, game: 0, member: 0, challenge: newChallenge(), pubkey: null }
    this.lobbies.set(connection.id, lobby)
    lobby.connection.send(encodeLobbyWelcome({ challenge: lobby.challenge, signedIn: '' }))
    // Asking after a game of its own, as a link to one does: in it, if it is still there to be joined.
    if (hello.game !== 0) this.join(lobby, hello.game, DEFAULT_VEHICLE_PROFILE)
    if (lobby.game === 0) lobby.connection.send(encodeGames(this.gamesListed()))
    else this.pushGame(this.games.get(lobby.game)!)
  }

  private lobbyMessage(lobby: LobbyConnection, payload: Uint8Array): void {
    const type = messageTypeOf(payload)

    if (type === CLIENT_AUTH) {
      this.signInLobby(lobby, decodeAuth(payload))
      return
    }

    if (type === CLIENT_JOIN_GAME) {
      const joining = decodeJoinGame(payload)
      if (joining === null || !PLAYABLE_PROFILE_IDS.includes(joining.vehicle)) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      this.join(lobby, joining.game, joining.vehicle)
      return
    }

    if (type === CLIENT_CREATE_GAME) {
      const vehicle = decodeCreateGame(payload)
      if (vehicle === null || !PLAYABLE_PROFILE_IDS.includes(vehicle)) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      this.host(lobby, vehicle)
      return
    }

    if (type === CLIENT_LEAVE_GAME) {
      if (!isLeaveGame(payload)) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      this.leaveGame(lobby)
      return
    }

    if (type === CLIENT_GAME_READY) {
      const ready = decodeGameReady(payload)
      if (ready === null || !PLAYABLE_PROFILE_IDS.includes(ready.vehicle)) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      const game = this.games.get(lobby.game)
      if (game === undefined) return
      setReady(game, lobby.member, ready.vehicle, ready.ready)
      this.pushGame(game)
      this.pushGames()
      return
    }

    if (type === CLIENT_GAME_EDIT) {
      const options = decodeGameEdit(payload)
      if (options === null) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      const game = this.games.get(lobby.game)
      if (game === undefined) return
      const was = game.options.mode
      if (editGame(game, lobby.member, options)) {
        // A game played for something else has no world to its name: its rooms were of the old one.
        if (game.options.mode !== was) this.closeRoomsOf(game)
        for (const room of this.rooms.values()) if (room.game === game.id) setRules(room.arena, this.rulesOf(game))
        this.pushGame(game)
        this.pushGames()
      }
      return
    }

    if (type === CLIENT_GAME_START) {
      if (!isGameStart(payload)) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      this.startGame(lobby)
      return
    }

    if (type === CLIENT_SLOT_ADD) {
      if (!isSlotAdd(payload)) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      this.changeSlots(lobby, (game, member) => addSlot(game, member))
      return
    }

    if (type === CLIENT_SLOT_REMOVE) {
      const slot = decodeSlotRemove(payload)
      if (slot === null) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      this.changeSlots(lobby, (game, member) => removeSlot(game, member, slot))
      return
    }

    if (type === CLIENT_SLOT_VEHICLE) {
      const changed = decodeSlotVehicle(payload)
      if (changed === null || !PLAYABLE_PROFILE_IDS.includes(changed.vehicle)) {
        this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      this.changeSlots(lobby, (game, member) => setBotVehicle(game, member, changed.slot, changed.vehicle))
      return
    }

    this.reject(lobby.connection, REJECT_MALFORMED_MESSAGE)
  }

  /** Have a game's host change its slots, and tell everyone if it happened: the room, the start screen, and whoever is in a world of it. */
  private changeSlots(lobby: LobbyConnection, change: (game: GameRecord, member: number) => boolean): void {
    const game = this.games.get(lobby.game)
    if (game === undefined || !change(game, lobby.member)) return
    this.pushGame(game)
    this.pushGames()
  }

  /** Make a game of the player's own, a race until its host says otherwise, and be in it: out of whichever game it was in. */
  private host(lobby: LobbyConnection, vehicle: VehicleProfileId): void {
    if (lobby.game !== 0) this.leaveGame(lobby)
    const seed = this.newSeed()
    const game = createGame(this.nextGameId, lobby.connection, lobby.name, vehicle, lobby.challenge, seed, this.newPass())
    this.nextGameId += 1
    this.games.set(game.id, game)
    const member = game.members.get(game.host)
    if (member !== undefined && lobby.pubkey !== null) member.pubkey = lobby.pubkey
    lobby.game = game.id
    lobby.member = game.host
    this.events.onGameOpened?.(game)
    this.pushGame(game)
    this.pushGames()
  }

  /** A seed for a game nobody chose one for: a planet's, over the whole range one has. */
  private newSeed(): number {
    return 1 + Math.floor(Math.random() * SEED_MOST)
  }

  /** Join the game with this id, in this vehicle, if it is joinable: out of whichever game it was in, taking a bot's slot. */
  private join(lobby: LobbyConnection, id: number, vehicle: VehicleProfileId): void {
    if (lobby.game === id) return
    const game = this.games.get(id)
    if (game === undefined || !joinable(game)) return
    if (lobby.game !== 0) this.leaveGame(lobby)
    const member = addMember(game, lobby.connection, lobby.name, vehicle, lobby.challenge, this.newPass())
    if (member === null) return
    if (lobby.pubkey !== null) member.pubkey = lobby.pubkey
    lobby.game = id
    lobby.member = member.id
    this.pushGame(game)
    this.pushGames()
  }

  /** Out of the game the player is in, and back to the start screen. */
  private leaveGame(lobby: LobbyConnection): void {
    const game = this.games.get(lobby.game)
    const member = lobby.member
    lobby.game = 0
    lobby.member = 0
    if (game === undefined) {
      lobby.connection.send(encodeGames(this.gamesListed()))
      return
    }
    this.dropMember(game, member)
    // The room as it is now, for a member no longer in it, so the screen it was on knows to go back.
    if (this.games.get(game.id) === game) lobby.connection.send(encodeGame(gameView(game, 0), 0, 0))
    lobby.connection.send(encodeGames(this.gamesListed()))
  }

  /** A lobby connection's player is gone: out of its game, and out of the world it was driving in. */
  private dropLobby(lobby: LobbyConnection): void {
    const game = this.games.get(lobby.game)
    const member = lobby.member
    lobby.game = 0
    lobby.member = 0
    if (game !== undefined) this.dropMember(game, member)
  }

  /** Take a member out of a game, its seat in the world with it; the game goes if it was the last. */
  private dropMember(game: GameRecord, member: number): void {
    const gone = game.members.get(member)
    removeMember(game, member)
    if (gone !== undefined) {
      const player = this.playerOf(game.id, gone.drivePass)
      if (player !== undefined) this.leave(player)
    }
    if (game.members.size === 0) {
      this.closeGame(game)
      return
    }
    this.pushGame(game)
    this.pushGames()
  }

  /** Close every room of a game while it has no player in one: what they are is the game's, and that has changed. */
  private closeRoomsOf(game: GameRecord): void {
    for (const room of [...this.rooms.values()]) if (room.game === game.id) this.closeRoom(room)
  }

  /** Delete a game behind its last member or its standings: its rooms and everyone in them go with it. */
  private closeGame(game: GameRecord): void {
    if (this.games.get(game.id) !== game) return
    for (const lobby of this.lobbies.values()) {
      if (lobby.game !== game.id) continue
      lobby.game = 0
      lobby.member = 0
    }
    this.games.delete(game.id)
    this.leaders.delete(game.id)
    if (this.demo === game.id) this.demo = 0
    for (const room of [...this.rooms.values()]) {
      if (room.game !== game.id) continue
      for (const player of [...room.players.values()]) this.leave(player)
      room.bots.clear()
      this.closeRoom(room)
    }
    this.events.onGameClosed?.(game)
    this.pushGames()
  }

  private memberOf(game: GameRecord, lobby: LobbyConnection): GameMember | undefined {
    return game.members.get(lobby.member)
  }

  /** Every game on the server, as the start screen lists them. */
  private gamesListed(): GameSummary[] {
    const listed: GameSummary[] = []
    for (const game of this.games.values()) listed.push(gameSummary(game))
    return listed
  }

  private pushGames(): void {
    if (this.lobbies.size === 0) return
    const encoded = encodeGames(this.gamesListed())
    for (const lobby of this.lobbies.values()) lobby.connection.send(encoded)
  }

  /** One game as its room sees it, to each of its members on their own connection. */
  private pushGame(game: GameRecord): void {
    for (const member of game.members.values()) member.connection.send(encodeGame(gameView(game, member.id), member.id, member.drivePass))
  }

  /** How a race finished, to its room's connections and to everyone in its worlds, watchers included. */
  private pushStandings(game: GameRecord): void {
    const encoded = encodeStandings(game.standings)
    for (const lobby of this.lobbies.values()) if (lobby.game === game.id) lobby.connection.send(encoded)
    for (const room of this.rooms.values()) {
      if (room.game !== game.id) continue
      for (const player of room.players.values()) player.connection.send(encoded)
      for (const spectator of room.spectators.values()) spectator.connection.send(encoded)
    }
  }

  /** The host's Start: the course is made off the tick, and the room says so while it is. */
  private startGame(lobby: LobbyConnection): void {
    const game = this.games.get(lobby.game)
    if (game === undefined || game.host !== lobby.member || gameFault(game) !== null) return
    this.beginRaceOf(game)
  }

  /** A game's race is on its way: the course is made off the tick, and everyone is told while it is. */
  private beginRaceOf(game: GameRecord): void {
    if (!prepareRace(game)) return
    this.pushGame(game)
    this.pushGames()
    void this.makeCourse(game)
  }

  /**
   * Build the race's course, a few worlds of seconds each, and put the
   * racers on its first grid. A game that has gone, or is no longer
   * preparing, is left alone; a course that cannot be made puts the game
   * back to waiting with the reason in front of its host.
   */
  private async makeCourse(game: GameRecord): Promise<void> {
    let course
    try {
      course = await buildCourse(game.options.seed, game.options.raceLength, (world) => this.sources.worldFor(world))
    } catch (error) {
      if (this.games.get(game.id) !== game || game.status !== 'preparing') return
      game.status = 'open'
      game.lastFault = error instanceof Error ? error.message : String(error)
      this.events.onCourseFailed?.(game, game.lastFault)
      // A demo whose course cannot be made is dropped rather than waited on, for the next to be drawn.
      if (game.demo) {
        this.closeGame(game)
        return
      }
      this.pushGame(game)
      this.pushGames()
      return
    }
    if (this.games.get(game.id) !== game || game.status !== 'preparing') return
    beginRace(game, course, this.clock)
    this.pushGame(game)
    this.pushGames()
  }

  /** A player proving which nostr key is theirs on their lobby connection: who the seat it drives, if it has one, is. */
  private signInLobby(lobby: LobbyConnection, event: unknown): void {
    const pubkey = verifyAuth(event, lobby.challenge, Date.now() / 1000)
    if (pubkey === null || lobby.pubkey === pubkey) return
    lobby.pubkey = pubkey
    const game = this.games.get(lobby.game)
    const member = game === undefined ? undefined : this.memberOf(game, lobby)
    if (member !== undefined) {
      member.pubkey = pubkey
      this.pushGame(game!)
    }
    const player = game === undefined ? undefined : this.playerOf(game.id, member?.drivePass ?? 0)
    if (player !== undefined) this.welcomeKey(player, pubkey)
    lobby.connection.send(encodeSignedIn({ pubkey, earned: this.store.earned(pubkey).size }))
    this.events.onSignedIn?.(player?.seat ?? null, pubkey)
  }

  // ---- worlds and the seats in them ----

  /**
   * Seat a hello in the world it asks for, of the game it says it is a
   * member of: made first if nobody is on it, and waited for if it takes a
   * while. Anything it may not join is refused, and nothing is seated.
   */
  private arrive(connection: TransportConnection, hello: HelloMessage): void {
    const game = this.games.get(hello.game)
    if (game === undefined) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    // A hello with no car asks to watch the world rather than to be in it.
    if (hello.profile === null) {
      this.spectate(connection, hello, game)
      return
    }
    const member = hello.pass === NO_PASS ? undefined : memberOfPass(game, hello.pass)
    if (member === undefined) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    let racer: Racer | null = null
    let leg: RaceLeg | null = null
    let legIndex = 0
    if (game.options.mode === 'race') {
      const course = game.course
      const at = course === null ? null : legOf(course, hello.seed)
      const driving = game.racers.get(hello.pass)
      if (course === null || at === null || driving === undefined || (game.status !== 'starting' && game.status !== 'racing')) {
        this.reject(connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      // On into the next world only by the portal that leads to it, with every gate before it passed.
      if (at.index !== driving.leg) {
        const leaving = course.legs[driving.leg]
        const through = leaving !== undefined && at.index === driving.leg + 1 && driving.checkpoint >= leaving.checkpoints.length - 1
        if (!through || hello.arrival !== at.leg.arrival) {
          this.reject(connection, REJECT_MALFORMED_MESSAGE)
          return
        }
      }
      racer = driving
      leg = at.leg
      legIndex = at.index
    } else if (!member.ready) {
      // A free drive is joined by being ready to drive in it.
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }

    const key = roomKey(hello.game, hello.seed)
    const existing = this.rooms.get(key)
    if (existing !== undefined) {
      this.seat(connection, hello, existing, game, member, racer, leg, legIndex)
      return
    }
    const request: ArenaRequest = {
      game: hello.game,
      world: hello.seed,
      keep: leg === null ? null : keepOf(leg),
      weapons: game.options.weapons,
      bananas: game.options.bananas,
    }
    const made = this.making.get(key) ?? this.sources.arenaFor(request)
    if (!(made instanceof Promise)) {
      this.seat(connection, hello, this.openRoom(request, made), game, member, racer, leg, legIndex)
      return
    }
    // Not made yet: they wait for it, and whoever else asks for it meanwhile waits with them.
    const handshake = this.handshaking.get(connection.id)
    if (handshake !== undefined) handshake.waiting = hello
    if (!this.making.has(key)) this.whenMade(key, request, made)
  }

  /**
   * Seat a watcher in a room of a race nobody has to be in: it is told the
   * welcome, the plan of this world and every snapshot, and takes no seat.
   * Only a room that is already open is watched, and only a race's (or the
   * demo's): a free drive is nobody's to watch.
   */
  private spectate(connection: TransportConnection, hello: HelloMessage, game: GameRecord): void {
    const at = game.course === null ? null : legOf(game.course, hello.seed)
    const room = this.rooms.get(roomKey(hello.game, hello.seed))
    const racing = game.options.mode === 'race' && (game.status === 'starting' || game.status === 'racing')
    if (at === null || room === undefined || !racing) {
      this.reject(connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    this.handshaking.delete(connection.id)
    const spectator: Spectator = { connection, told: false }
    room.spectators.set(connection.id, spectator)
    this.watching.set(connection.id, room)
    connection.send(
      encodeWelcome({
        protocolVersion: PROTOCOL_VERSION,
        game: game.id,
        seed: room.world,
        seat: NO_SEAT,
        epoch: 0,
        tick: room.arena.tick,
        maxPlayers: RACERS_MOST,
        profile: DEFAULT_VEHICLE_PROFILE,
        pass: NO_PASS,
        race: true,
        flags: flagsOf(game.options),
        challenge: '',
        signedIn: '',
      }),
    )
    connection.send(encodeRacePlan(planOf(game.course!, at.index, game.id)))
  }

  /**
   * Once a world being made is ready, its room is made of it and everyone
   * waiting for it is seated there, by asking again. The room is made and
   * filled without a tick between, so that it is never stepped empty and
   * closed with the world still on its way.
   */
  private whenMade(key: string, request: ArenaRequest, made: Promise<Arena>): void {
    this.making.set(key, made)
    const waiting = (): Handshake[] => [...this.handshaking.values()].filter((handshake) => handshake.waiting !== null && roomKey(handshake.waiting.game, handshake.waiting.seed) === key)
    made.then(
      (arena) => {
        this.making.delete(key)
        if (this.disposed) {
          arena.world.free()
          return
        }
        const room = this.rooms.get(key) ?? this.openRoom(request, arena)
        // Made twice while it was being made: the room there is has this arena, and the other is nobody's.
        if (room.arena !== arena) arena.world.free()
        for (const handshake of waiting()) this.arrive(handshake.connection, handshake.waiting!)
        // Made for nobody after all: not worth stepping.
        this.closeIfEmpty(room)
      },
      () => {
        this.making.delete(key)
        for (const handshake of waiting()) this.reject(handshake.connection, REJECT_MALFORMED_MESSAGE)
      },
    )
  }

  /**
   * The room of a world of a game, made if it is not open yet, at once or
   * once the arena is: whoever asks for it while it is being made waits on
   * the same promise as everyone else.
   */
  private makeRoom(request: ArenaRequest): Promise<Room> {
    const key = roomKey(request.game, request.world)
    const known = this.rooms.get(key)
    if (known !== undefined) return Promise.resolve(known)
    const made = this.making.get(key) ?? this.sources.arenaFor(request)
    if (!(made instanceof Promise)) return Promise.resolve(this.openRoom(request, made))
    this.making.set(key, made)
    return made.then(
      (arena) => {
        this.making.delete(key)
        if (this.disposed) {
          arena.world.free()
          throw new Error('the server is gone')
        }
        const room = this.rooms.get(key) ?? this.openRoom(request, arena)
        // Made twice while it was being made: the room there is has this arena, and the other is nobody's.
        if (room.arena !== arena) arena.world.free()
        return room
      },
      (error: unknown) => {
        this.making.delete(key)
        throw error
      },
    )
  }

  /** A room for a world nobody is on, its arena made from the world the request names. */
  private openRoom(request: ArenaRequest, arena: Arena): Room {
    const game = this.games.get(request.game)
    const room: Room = {
      key: roomKey(request.game, request.world),
      game: request.game,
      world: request.world,
      mode: game?.options.mode ?? 'free',
      arena,
      players: new Map(),
      bots: new Map(),
      spectators: new Map(),
      snapshots: createRoomSnapshots(),
      lastSnapshotBytes: 0,
    }
    this.rooms.set(room.key, room)
    this.holdRoom(room, game)
    // A free drive's bots roam its world as its traffic does, by their names, and are counted among it.
    if (game !== undefined && game.options.mode === 'free') this.seatFreeBots(room, game)
    this.topUpNpcs(room.arena)
    this.events.onRoomOpened?.(room)
    return room
  }

  /** Seat a free drive's bots in a world just made: one of the traffic's own cars each, in its slot's vehicle, by its name. */
  private seatFreeBots(room: Room, game: GameRecord): void {
    for (const slot of game.slots) {
      if (slot.kind !== 'bot') continue
      const free = freeSeat(room.arena)
      if (free === undefined) return
      const seat = seatNpc(room.arena, free.id)
      if (seat === null) return
      // A rover is the moon's own traffic: nothing else would drive there.
      if (seat.rover === null && seat.profile !== slot.vehicle) {
        changeVehicle(room.arena, seat, slot.vehicle)
        seat.tuning.damageToWreck /= NPC_FRAGILITY
      }
      room.bots.set(seat.id, { pass: slot.pass, name: slot.name, bot: null, route: null, previous: v3() })
    }
    this.broadcastLobby(room)
  }

  /**
   * A race's first world holds its cars still until the countdown is over:
   * from the moment the room is made, and no later than the tick the
   * countdown ends. Any other room, and every free-drive room, drives.
   */
  private holdRoom(room: Room, game: GameRecord | undefined): void {
    const first = game?.course?.legs[0]
    if (game === undefined || first === undefined || first.world !== room.world) return
    if (game.startsAt === NO_TICK) room.arena.holdUntil = game.status === 'starting' ? HOLD_FOREVER : 0
    else room.arena.holdUntil = room.arena.tick + Math.max(game.startsAt - this.clock, 0)
  }

  /** Put a member in a seat of a room, where the race has it or where it comes out of a portal. */
  private seat(
    connection: TransportConnection,
    hello: HelloMessage,
    room: Room,
    game: GameRecord,
    member: GameMember,
    racer: Racer | null,
    leg: RaceLeg | null,
    legIndex: number,
  ): void {
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
      this.closeIfEmpty(room)
      return
    }

    this.handshaking.delete(connection.id)
    const seat = takeSeat(arena, free.id, member.vehicle)
    const left = this.left.get(member.drivePass)
    // Back in the room it was cut off from, rather than come into it from another: the room's word is where it was.
    const back = left !== undefined && left.game === game.id && left.world === room.world ? left : null
    // Come through a portal into this room, or back into the one it left: what it held waits for it.
    const through = hello.arrival !== NO_ARRIVAL
    const carried = back ?? (through && left !== undefined && left.game === game.id ? left : null)
    if (racer !== null && leg !== null && racer.leg !== legIndex) {
      racer.leg = legIndex
      racer.checkpoint = 0
    }
    if (back !== null) respawn(seat, back.where)
    else if (racer !== null && leg !== null && game.course !== null) this.placeOnLeg(room, game, seat, racer, leg, legIndex, hello.arrival)
    else if (hello.arrival !== NO_ARRIVAL) {
      // Come through a portal, the car comes out of the one it arrives by, beside anyone already there.
      const out = arrivalSpawn(arena, hello.arrival, seat)
      if (out !== null) respawn(seat, out)
    }
    // With what it held when it went, which is its own wallet, not the one its key keeps.
    if (carried !== null) {
      this.left.delete(member.drivePass)
      carryOver(seat, carried.carried)
      if (carried.pubkey !== null) member.pubkey = carried.pubkey
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
      pass: member.drivePass,
      game: game.id,
      racer: racer?.key ?? 0,
      name: member.name,
      challenge: newChallenge(),
      // A key proved on the lobby connection, or on the other side of a portal, is still theirs.
      pubkey: member.pubkey,
    }
    if (player.pubkey !== null) this.welcomeKey(player, player.pubkey, carried === null)
    this.players.set(connection.id, player)
    room.players.set(connection.id, player)
    connection.send(
      encodeWelcome({
        protocolVersion: PROTOCOL_VERSION,
        game: game.id,
        seed: room.world,
        seat: seat.id,
        epoch: seat.epoch,
        tick: arena.tick,
        maxPlayers: RACERS_MOST,
        profile: seat.profile,
        pass: player.pass,
        race: room.mode === 'race',
        flags: flagsOf(game.options),
        challenge: player.challenge,
        signedIn: player.pubkey ?? '',
      }),
    )
    // In a race the gates of this world come before anything else does.
    if (racer !== null && leg !== null && game.course !== null) connection.send(encodeRacePlan(planOf(game.course, legIndex, game.id)))
    this.events.onJoined?.(seat, connection.id, room)
    this.broadcastLobby(room)
  }

  /** Where a racer's car goes in a world of the course it joins: the grid it starts from, the portal it comes out of, or its last gate. */
  private placeOnLeg(
    room: Room,
    game: GameRecord,
    seat: Seat,
    racer: Racer,
    leg: RaceLeg,
    legIndex: number,
    arrival: number,
  ): void {
    const course = game.course
    if (course === null) return
    if (leg.arrival === NO_PORTAL && legIndex === 0) {
      if (game.status !== 'starting') {
        respawn(seat, checkpointSpawn(course, room.arena.planet, racer.leg, racer.checkpoint, racerIndexOf(game, racer.key)))
        return
      }
      const grid = leg.grid[racerIndexOf(game, racer.key)] ?? leg.grid[leg.grid.length - 1]
      if (grid !== undefined) respawn(seat, grid)
      return
    }
    // Out of the portal a car arrives by, beside anyone already there.
    const out = arrivalSpawn(room.arena, arrival, seat)
    if (out !== null) respawn(seat, out)
  }

  // ---- what a connection in a world says ----

  private worldMessage(player: Player, payload: Uint8Array): void {
    const { arena } = player.room
    player.heardTick = this.clock

    if (messageTypeOf(payload) === CLIENT_AUTH) {
      this.signIn(player, decodeAuth(payload))
      return
    }

    if (isRespawn(payload)) {
      if (arena.tick - player.respawnedTick < RESPAWN_COOLDOWN_TICKS) return
      player.respawnedTick = arena.tick
      if (!this.replaceAtCheckpoint(player.room, player.seat)) respawnNearby(arena, player.seat)
      this.events.onRespawned?.(player.seat, 'asked')
      return
    }

    if (messageTypeOf(payload) === CLIENT_CHANGE_VEHICLE) {
      const profile = decodeChangeVehicle(payload)
      if (profile === null || !PLAYABLE_PROFILE_IDS.includes(profile)) {
        this.reject(player.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      // A change puts the car back on the road, so it waits out a respawn's cooldown too.
      if (profile === player.seat.profile || arena.tick - player.respawnedTick < RESPAWN_COOLDOWN_TICKS) return
      player.respawnedTick = arena.tick
      changeVehicle(arena, player.seat, profile)
      this.events.onChangedVehicle?.(player.seat)
      return
    }

    if (messageTypeOf(payload) !== CLIENT_INPUT) {
      this.reject(player.connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    if (player.allowance <= 0) {
      player.dropped += 1
      return
    }
    player.allowance -= 1
    const tick = decodeInput(payload, this.scratchInput)
    if (tick === null) {
      this.reject(player.connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    player.timeline.record(tick, this.scratchInput)
  }

  /** Let a player go, holding on to what they held. The last one out closes the room, unless it is about to be joined again. */
  private leave(player: Player, keepRoom = false): void {
    const { connection, room } = player
    this.players.delete(connection.id)
    room.players.delete(connection.id)
    this.keepBananas(player)
    // Gone through a portal, or cut off, as far as anyone here knows: what they held waits for them.
    this.left.set(player.pass, {
      carried: carriedOf(player.seat),
      pubkey: player.pubkey,
      tick: this.clock,
      game: player.game,
      world: room.world,
      where: spawnWhere(player.seat),
    })
    leaveSeat(room.arena, player.seat.id)
    this.topUpNpcs(room.arena)
    this.events.onLeft?.(player.seat, connection.id, room)
    this.broadcastLobby(room)
    // An empty room is not worth stepping.
    if (!keepRoom) this.closeIfEmpty(room)
  }

  private playerIn(room: Room, seat: Seat): Player | undefined {
    for (const player of room.players.values()) if (player.seat === seat) return player
    return undefined
  }

  /** The pass of the racer driving a seat of a room: a player's, a bot's, or `null` when nobody is racing in it. */
  private racerIn(room: Room, seat: Seat): number | null {
    const player = this.playerIn(room, seat)
    if (player !== undefined) return player.racer === 0 ? null : player.racer
    const bot = room.bots.get(seat.id)
    return bot !== undefined && bot.bot !== null ? bot.pass : null
  }

  /** The seat a game's member is driving in, on whichever of its worlds it is. */
  private playerOf(game: number, pass: number): Player | undefined {
    if (pass === NO_PASS) return undefined
    for (const player of this.players.values()) if (player.game === game && player.pass === pass) return player
    return undefined
  }

  /** Each tick a player may send a couple more inputs, and one silent for too long is let go. */
  private tendPlayers(): void {
    for (const player of this.players.values()) {
      player.allowance = Math.min(INPUT_ALLOWANCE, player.allowance + INPUTS_PER_TICK)
      if (this.clock - player.heardTick <= IDLE_TIMEOUT_TICKS) continue
      // Let go at once, not again each tick until its connection is seen to close.
      this.reject(player.connection, REJECT_IDLE)
      this.leave(player)
    }
  }

  private expireHandshakes(): void {
    for (const handshake of this.handshaking.values()) {
      if (this.clock - handshake.openedTick < (handshake.waiting === null ? HANDSHAKE_TIMEOUT_TICKS : MAKING_TIMEOUT_TICKS)) continue
      this.reject(handshake.connection, REJECT_HANDSHAKE_ORDER)
    }
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

  // ---- stepping a game and its rooms ----

  /** One step of a game's life: the countdown, the race's end, and the game's delete. */
  private tendGame(game: GameRecord): void {
    const first = game.course?.legs[0]
    const countdown = game.startsAt
    const effect = stepGame(game, this.clock, first !== undefined && this.everyoneSeated(game, first.world))
    if (countdown === NO_TICK && game.startsAt !== NO_TICK) {
      // The countdown has begun: the cars on the grid are held until it ends.
      if (first !== undefined) {
        const room = this.rooms.get(roomKey(game.id, first.world))
        if (room !== undefined) room.arena.holdUntil = room.arena.tick + COUNTDOWN_TICKS
      }
      this.events.onGameStarted?.(game)
      this.pushGame(game)
    }
    // The lobby lists every game with how it is going, so it hears each change of status too.
    if (effect.started) {
      this.pushGame(game)
      this.pushGames()
    }
    if (effect.finished) {
      // A demo's standings stand where it was: the next demo is a new one, with a seed of its own.
      if (game.id === this.demo) this.demo = 0
      this.events.onGameFinished?.(game)
      this.pushGame(game)
      this.pushGames()
      this.pushStandings(game)
    }
    if (effect.closed) this.closeGame(game)
  }

  /** Whether every racer of a race is seated, and driving, in the world its first leg runs on: a bot as soon as it is on the grid. */
  private everyoneSeated(game: GameRecord, world: number): boolean {
    if (game.racers.size === 0) return false
    const room = this.rooms.get(roomKey(game.id, world))
    if (room === undefined) return false
    // On the grid means driving there: a page still making the world after taking its seat sends no input yet, and would miss the countdown.
    const seated = new Set<number>()
    for (const player of room.players.values()) if (player.timeline.receivedTick !== NO_TICK) seated.add(player.racer)
    for (const { pass } of room.bots.values()) seated.add(pass)
    for (const key of game.racers.keys()) if (!seated.has(key)) return false
    return true
  }

  /**
   * Seat every bot racer of a race that is between worlds: on the grid of
   * the first, or at the portal it comes out of in the next. The world a bot
   * is to be put in is made here, if nobody has made it yet, while the bot
   * waits.
   */
  private tendRacers(game: GameRecord): void {
    const course = game.course
    if (game.options.mode !== 'race' || course === null) return
    if (game.status !== 'starting' && game.status !== 'racing') return
    for (const racer of game.racers.values()) {
      if (!racer.bot || this.botRoomOf(game, racer.key) !== undefined) continue
      const leg = course.legs[racer.leg]
      if (leg === undefined) continue
      const room = this.rooms.get(roomKey(game.id, leg.world))
      if (room === undefined) {
        const key = roomKey(game.id, leg.world)
        if (this.making.has(key)) continue
        const request: ArenaRequest = { game: game.id, world: leg.world, keep: keepOf(leg), weapons: game.options.weapons, bananas: game.options.bananas }
        void this.makeRoom(request).catch(() => undefined)
        continue
      }
      this.seatBot(room, game, racer, leg)
    }
  }

  /** The room a race's bot is driving in, if it is driving in one yet. */
  private botRoomOf(game: GameRecord, pass: number): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.game !== game.id) continue
      for (const bot of room.bots.values()) if (bot.bot !== null && bot.pass === pass) return room
    }
    return undefined
  }

  /** Put a bot racer in a free seat of a race's world, where the race has it: on the grid, or out of the portal it arrives by. */
  private seatBot(room: Room, game: GameRecord, racer: Racer, leg: RaceLeg): void {
    const { arena } = room
    const free = freeSeat(arena)
    if (free === undefined) return
    const slot = botOfPass(game, racer.key)
    const vehicle = slot?.kind === 'bot' ? slot.vehicle : racer.vehicle
    const seat = takeSeat(arena, free.id, vehicle)
    seat.npc = false
    seat.driver = null
    seat.rover = null
    const entry: RoomBot = { pass: racer.key, name: racer.name, bot: createRacerBot(racer.slot), route: leg.route, previous: v3() }
    room.bots.set(seat.id, entry)
    const grid = leg.arrival === NO_PORTAL && game.status === 'starting' ? (leg.grid[racerIndexOf(game, racer.key)] ?? leg.grid[leg.grid.length - 1]) : undefined
    if (grid !== undefined) respawn(seat, grid)
    else {
      const out = arrivalSpawn(arena, leg.arrival, seat)
      if (out !== null) respawn(seat, out)
    }
    // Set down, it is nowhere it crossed to get there.
    vcopy(entry.previous, seat.vehicle.frame.position)
    this.broadcastLobby(room)
  }

  /** One step of one room: its cars driven, its bots kept to their routes, its wrecks put back, its feats paid, and its word to everyone in it. */
  private stepRoom(room: Room): void {
    const { arena } = room
    const tick = arena.tick
    advance(arena, (seat) => this.inputOf(room, seat, tick))
    // A bot through the portal out of its leg leaves this room for the next.
    for (const [id, entry] of [...room.bots]) {
      const seat = arena.seats[id]
      if (seat !== undefined && seat.occupied && entry.bot !== null) this.botCrossed(room, id, entry, seat)
    }
    for (const seat of respawnLost(arena)) {
      // In a race a car comes back to the last gate its racer passed, not to the nearest road.
      this.replaceAtCheckpoint(room, seat)
      this.events.onRespawned?.(seat, 'lost')
    }
    this.putStuckBotsBack(room)
    // What is left of this tick is where each bot's car is, for the next tick's crossing.
    for (const [id, entry] of room.bots) {
      const seat = arena.seats[id]
      if (seat !== undefined && seat.occupied) vcopy(entry.previous, seat.vehicle.frame.position)
    }
    for (const { seat, achievement } of awardAchievements(arena, (seat, feat) => this.unpaid(room, seat, feat.id))) this.paid(room, seat, achievement)
    if (arena.tick % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot(room)
    // Out of its last player and its last bot, a room is not worth stepping.
    this.closeIfEmpty(room)
  }

  /** What the car in a seat is asked for this tick: a player's input, a bot's way along its route, or the traffic's own driving. */
  private inputOf(room: Room, seat: Seat, tick: number): VehicleInput {
    if (seat.npc) return npcInput(room.arena, seat, this.npcCommand)
    const entry = room.bots.get(seat.id)
    if (entry !== undefined && entry.bot !== null) return botInput(entry.bot, seat, entry.route ?? NO_ROUTE, this.botCommand, room.arena)
    return this.playerIn(room, seat)?.timeline.consume(tick) ?? NEUTRAL_INPUT
  }

  /**
   * A bot through the portal out of its leg: out of this room, to be seated in
   * the next one the tick its world is ready. Its racer keeps everything but
   * the leg it is on, and the gates it has still to pass there.
   */
  private botCrossed(room: Room, id: number, entry: RoomBot, seat: Seat): void {
    const game = this.games.get(room.game)
    if (game === undefined) return
    const course = game.course
    if (course === null) return
    const at = legOf(course, room.world)
    if (at === null || at.leg.exit === NO_PORTAL) return
    const racer = game.racers.get(entry.pass)
    if (racer === undefined || racer.leg !== at.index) return
    // Only the portal out takes a bot on, and only once the gates up to it are passed: the exit is its next gate, or the one it has just gone through.
    if (racer.checkpoint < at.leg.checkpoints.length - 1) return
    if (portalCrossed(room.arena.planet, entry.previous, seat.vehicle.frame.position) !== at.leg.exit) return
    if (nextWorld(course, at.index) === null) return
    leaveSeat(room.arena, id)
    room.bots.delete(id)
    this.broadcastLobby(room)
    racer.leg = at.index + 1
    racer.checkpoint = 0
  }

  /**
   * Put a bot back on its route once it has been stuck long enough to need it:
   * a few points back from where it got to, clear of every other car, rather
   * than at its last gate, so that one stopped on the grid or in the way is
   * got round instead of run into again.
   */
  private putStuckBotsBack(room: Room): void {
    const { arena } = room
    // At the grid a bot is held, not stuck: its clock runs whether or not the car is being driven.
    if (arena.tick < arena.holdUntil) {
      for (const { bot } of room.bots.values()) {
        if (bot === null) continue
        bot.stuckFor = 0
        bot.blockedFor = 0
        bot.reverseFor = 0
      }
      return
    }
    for (const [id, entry] of room.bots) {
      if (entry.bot === null || !botStuck(entry.bot)) continue
      const seat = arena.seats[id]
      const taken = occupiedSeats(arena)
        .filter((each) => each !== seat)
        .map((each) => each.vehicle.frame.position)
      const spot = entry.route === null ? null : botPutBackSpot(entry.route, entry.bot.along, taken)
      botSetBack(entry.bot, spot === null ? entry.bot.along : spot.along)
      if (seat === undefined) continue
      if (spot === null) this.replaceAtCheckpoint(room, seat)
      else respawn(seat, spot.spawn)
    }
  }

  /**
   * A car put back in a race goes where its racer's last gate was, facing the
   * next; `false` in free drive. A bot put back has nothing counted against it
   * there either.
   */
  private replaceAtCheckpoint(room: Room, seat: Seat): boolean {
    if (room.mode !== 'race') return false
    const game = this.games.get(room.game)
    if (game === undefined || game.course === null) return false
    const key = this.racerIn(room, seat)
    if (key === null) return false
    const racer = game.racers.get(key)
    if (racer === undefined) return false
    const entry = room.bots.get(seat.id)
    if (entry !== undefined && entry.bot !== null) botSetBack(entry.bot, entry.bot.along)
    respawn(seat, checkpointSpawn(game.course, room.arena.planet, racer.leg, racer.checkpoint, racerIndexOf(game, racer.key)))
    return true
  }

  /**
   * The gates of a race: each racer that drives through its next one passes
   * it, in order, and a wreck passes nothing. Past the last gate of the
   * last world is the finish line, and the first over it wins; the race is
   * called over a grace after that, or as soon as every racer is home. The
   * lobby hears of the leader's world as it changes, for whoever watches it.
   */
  private stepRace(game: GameRecord): void {
    const course = game.course
    if (course === null) return
    for (const room of this.rooms.values()) {
      if (room.game !== game.id) continue
      const at = legOf(course, room.world)
      if (at === null) continue
      const last = at.index === course.legs.length - 1
      for (const seat of occupiedSeats(room.arena)) {
        const key = this.racerIn(room, seat)
        if (key === null) continue
        const racer = game.racers.get(key)
        if (racer === undefined || racer.leg !== at.index || racer.finishedAt !== 0) continue
        const { vehicle } = seat
        // A wreck passes nothing until it is put back.
        if (vehicle.wrecked) continue
        const gate = at.leg.checkpoints[racer.checkpoint]
        if (gate === undefined || groundDistance(vehicle.frame.position, gate.at) > gate.radius) continue
        racer.checkpoint += 1
        // The last gate of the last world is the line: the race is done for this one.
        if (!last || racer.checkpoint < at.leg.checkpoints.length) continue
        racer.finishedAt = this.clock
        seat.progress.racesWon += 1
        seat.racesWon = (seat.racesWon + 1) & 0xff
      }
    }
    placeRacers(game)
    const leader = leaderWorld(game)
    if (this.leaders.get(game.id) !== leader) {
      this.leaders.set(game.id, leader)
      this.pushGames()
    }
    // A demo nobody drives is given so long to get home, and called over all the same: it never waits on a person.
    if (game.demo && game.overAt === NO_TICK && game.startsAt !== NO_TICK && this.clock - game.startsAt > DEMO_TICKS) game.overAt = this.clock
    if (game.overAt !== NO_TICK) return
    const racers = [...game.racers.values()]
    let first = 0
    let finished = 0
    for (const racer of racers) {
      if (racer.finishedAt === 0) continue
      finished += 1
      first = first === 0 ? racer.finishedAt : Math.min(first, racer.finishedAt)
    }
    if (finished === 0) return
    // Everyone home is the race over at once; otherwise the rest are given a grace from the winner's finish.
    if (finished === racers.length || this.clock - first >= FINISH_GRACE_TICKS) {
      game.overAt = this.clock
      placeRacers(game)
    }
  }

  // ---- what is kept of a player ----

  /**
   * A player proving which nostr key is theirs, on their world connection:
   * an event signed by it naming the challenge they were welcomed with.
   * Believed, the key is theirs for their achievements, each of which it is
   * paid once, ever; and in a free drive it starts them off with the
   * bananas it held when they last left one.
   */
  private signIn(player: Player, event: unknown): void {
    const pubkey = verifyAuth(event, player.challenge, Date.now() / 1000)
    // Not believed, or signed by some other key than the one the seat already plays under: nothing changes.
    if (pubkey === null || (player.pubkey !== null && player.pubkey !== pubkey)) return
    player.connection.send(encodeSignedIn({ pubkey, earned: this.store.earned(pubkey).size }))
    if (player.pubkey !== null) return
    this.welcomeKey(player, pubkey)
    const game = this.games.get(player.game)
    const member = game === undefined ? undefined : memberOfPass(game, player.pass)
    if (member !== undefined) member.pubkey = pubkey
  }

  /**
   * The key is proved: mark off every feat it has been paid and, unless the
   * car came into this room holding what it took from the last, start it
   * with whatever bananas its free-drive balance holds.
   */
  private welcomeKey(player: Player, pubkey: string, withBalance = true): void {
    player.pubkey = pubkey
    this.giveKept(player.seat, pubkey)
    if (withBalance && this.keepsBananas(player)) player.seat.score += this.store.bananas(pubkey)
  }

  /** Give a seat every feat its key has been paid, marked off, for none to be paid again. */
  private giveKept(seat: Seat, pubkey: string): void {
    for (const id of this.store.earned(pubkey)) if (id < seat.progress.earned.length) seat.progress.earned[id] = 1
  }

  /**
   * Whether this seat's bananas are the player's own, kept between sessions:
   * only a free drive has a wallet, and only with bananas on. A race's
   * bananas are the race's, and are thrown away with it.
   */
  private keepsBananas(player: Player): boolean {
    if (player.room.mode !== 'free') return false
    return this.games.get(player.game)?.options.bananas ?? true
  }

  /** The bananas a player holds, kept against their key, if they have proved one, for their next free drive. */
  private keepBananas(player: Player): void {
    if (player.pubkey !== null && this.keepsBananas(player)) this.store.keepBananas(player.pubkey, player.seat.score)
  }

  /** The nostr key a seat's player has proved theirs, if they have. */
  private keyOf(room: Room, seat: Seat): string | null {
    return this.playerIn(room, seat)?.pubkey ?? null
  }

  /** The seats of everyone playing with a key, on whichever world: the same player, at once, in more than one tab. */
  private seatsWith(pubkey: string): Seat[] {
    return [...this.players.values()].filter((player) => player.pubkey === pubkey).map((player) => player.seat)
  }

  /** Whether a seat may be paid for a feat: only one whose player has proved their key, and only if that key never has been. */
  private unpaid(room: Room, seat: Seat, id: number): boolean {
    const pubkey = this.keyOf(room, seat)
    return pubkey !== null && !this.store.earned(pubkey).has(id)
  }

  /** A feat paid: never again to the key, here or on any world it is playing on at once. */
  private paid(room: Room, seat: Seat, achievement: Achievement): void {
    const pubkey = this.keyOf(room, seat)
    if (pubkey !== null) {
      this.store.record(pubkey, achievement.id)
      for (const each of this.seatsWith(pubkey)) each.progress.earned[achievement.id] = 1
    }
    this.events.onAchieved?.(seat, achievement)
  }

  private rulesOf(game: GameRecord): ArenaRules {
    return { weapons: game.options.weapons, bananas: game.options.bananas }
  }

  // ---- leaving ----

  /** A pass nobody holds or has left behind: random, so nobody takes another's by guessing. */
  private newPass(): number {
    for (;;) {
      const pass = Math.floor(Math.random() * 0x1_0000_0000)
      if (pass === NO_PASS || this.left.has(pass) || [...this.players.values()].some((player) => player.pass === pass)) continue
      if ([...this.games.values()].some((game) => memberOfPass(game, pass) !== undefined)) continue
      return pass
    }
  }

  // ---- the server's own demo race ----

  /**
   * The demo race: one is kept going while anyone is on the start screen
   * with no game of their own, and let go once nobody is. It is a race of
   * four bots, two worlds long, on a seed of its own, which nobody hosts.
   */
  private tendDemo(): void {
    if (!this.demoOn) return
    let browsing = false
    for (const lobby of this.lobbies.values()) browsing ||= lobby.game === 0
    const demo = this.games.get(this.demo)
    if (!browsing) {
      if (demo !== undefined) this.closeGame(demo)
      return
    }
    // The standings of a demo are seen out before the next one takes its place.
    for (const game of this.games.values()) if (game.demo && game.status === 'finished') return
    if (demo === undefined) this.openDemo()
  }

  /** Start the demo race: a new seed's course, made off the tick as a host's is, and no room of it made until its bots take their places. */
  private openDemo(): void {
    const game = createDemoGame(this.nextGameId, this.demoSeed())
    this.nextGameId += 1
    this.games.set(game.id, game)
    this.demo = game.id
    this.events.onGameOpened?.(game)
    this.beginRaceOf(game)
  }

  // ---- telling everyone ----------------

  private closeRoom(room: Room): void {
    if (this.rooms.get(room.key) !== room) return
    this.rooms.delete(room.key)
    room.arena.world.free()
    // Whoever is watching it finds the race again from the start screen.
    for (const [id, spectator] of room.spectators) {
      room.spectators.delete(id)
      this.watching.delete(id)
      spectator.connection.close(ROOM_CLOSED)
    }
    this.events.onRoomClosed?.(room)
  }

  /** Close a room nobody is in any more: no player, and no bot either. */
  private closeIfEmpty(room: Room): void {
    if (room.players.size === 0 && room.bots.size === 0) this.closeRoom(room)
  }

  private reject(connection: TransportConnection, reason: number): void {
    this.handshaking.delete(connection.id)
    connection.send(encodeReject({ reason }))
    connection.close(rejectLabel(reason))
    this.events.onRejected?.(connection.id, rejectLabel(reason))
  }

  /** Who is on the island, by name, to everyone on it: the bots seated there among them. */
  private broadcastLobby(room: Room): void {
    if (room.players.size === 0) return
    const players = [...room.players.values()].map((player) => ({ seat: player.seat.id, name: player.name }))
    for (const [id, bot] of room.bots) players.push({ seat: id, name: bot.name })
    players.sort((a, b) => a.seat - b.seat)
    const encoded = encodeLobby({ players })
    for (const player of room.players.values()) player.connection.send(encoded)
  }

  /**
   * Where everything is, to everyone in the room and to whoever is watching
   * it, and how the race stands in this world of it. The vehicles go every
   * time; of the bananas, a newcomer gets the whole word once and everyone
   * else only what changed since the last, which is nothing as a rule.
   */
  private broadcastSnapshot(room: Room): void {
    if (room.players.size === 0 && room.spectators.size === 0) return
    const { arena, snapshots } = room
    const race = this.raceViewOf(room)
    // A player's car is told with the input it was last stepped with; a car nobody drives, with what its
    // driver last asked of it; anything else, with none. Never the scratch buffer, which holds whatever
    // input any player sent last: told with that, every car nobody drives would honk when a player did.
    const appliedInputOf = (seat: Seat): VehicleInput => this.playerIn(room, seat)?.timeline.appliedInput ?? seat.vehicle.command
    // Each is encoded at most once, whoever asks first: the changes for those told before, the whole for a newcomer.
    let changes: Uint8Array | null = null
    let whole: Uint8Array | null = null
    for (const player of room.players.values()) {
      let encoded: Uint8Array
      if (player.told) {
        encoded = changes ??= encodeSnapshot(gatherSnapshot(arena, snapshots, appliedInputOf, false, race))
      } else {
        encoded = whole ??= encodeSnapshot(gatherSnapshot(arena, snapshots, appliedInputOf, true, race))
        player.told = true
      }
      player.connection.send(withAck(encoded, player.timeline.receivedTick))
    }
    for (const spectator of room.spectators.values()) {
      let encoded: Uint8Array
      if (spectator.told) {
        encoded = changes ??= encodeSnapshot(gatherSnapshot(arena, snapshots, appliedInputOf, false, race))
      } else {
        encoded = whole ??= encodeSnapshot(gatherSnapshot(arena, snapshots, appliedInputOf, true, race))
        spectator.told = true
      }
      spectator.connection.send(encoded)
    }
    room.lastSnapshotBytes = (changes ?? whole)?.length ?? 0
    rememberTold(arena, snapshots)
  }

  /** How the race stands in this world of it, for the snapshot, or `null` in a free drive: every racer here, bots among them. */
  private raceViewOf(room: Room): RaceView | null {
    const game = this.games.get(room.game)
    if (game === undefined || game.course === null) return null
    const at = legOf(game.course, room.world)
    if (at === null) return null
    const racers: RaceRacerView[] = []
    for (const seat of occupiedSeats(room.arena)) {
      const key = this.racerIn(room, seat)
      if (key === null) continue
      const racer = game.racers.get(key)
      if (racer === undefined) continue
      racers.push({ seat: seat.id, place: racer.place, checkpoint: racer.checkpoint, finished: racer.finishedAt !== 0 })
    }
    return {
      world: at.index + 1,
      ofWorlds: game.course.legs.length,
      // Held while the racers are still being seated, then negative through the 3-2-1, then the time since driving began.
      elapsed: game.startsAt === NO_TICK ? HELD : this.clock - game.startsAt,
      over: game.status === 'finished',
      racing: game.racers.size,
      racers,
    }
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
