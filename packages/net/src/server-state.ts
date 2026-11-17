/**
 * What one server knows: every connection it has, every game on it, every
 * room of one, and what it keeps of every player's key. Plain data, so that
 * the server's parts are functions over it and the server itself is the thin
 * wrapper that holds it and wires it to the transport and the clock.
 */

import { NPC_CARS, createVehicleInput, type Achievement, type Arena, type Carried, type Seat, type VehicleInput, type VehicleSpawn } from '@buggies/game'
import type { World } from '@buggies/terrain'

import type { GameMember, GameRecord, Racer } from './game-registry.ts'
import type { InputTimeline } from './input-timeline.ts'
import { MemoryPlayerStore, type PlayerStore } from './player-store.ts'
import { INPUT_TIMELINE_TICKS } from './protocol.ts'
import type { Room } from './rooms.ts'
import type { TransportConnection } from './transport.ts'
import type { HelloMessage } from './wire.ts'

/**
 * How many inputs a player may have in hand to send at once, and how many
 * more they get each tick. An honest client sends one a tick, and a burst
 * of a second's worth after a stall, so this is twice what it needs; past
 * it, inputs are dropped on the floor rather than driven.
 */
export const INPUT_ALLOWANCE = INPUT_TIMELINE_TICKS * 2
export const INPUTS_PER_TICK = 2

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

/** Who a connection is: the name it gave, and the nostr key it has proved, with the challenge it was given to prove that by. */
export interface Identity {
  readonly name: string
  /** What it was given to sign with its nostr key. */
  challenge: string
  /** The key, once it has signed, or `null` until it does. */
  pubkey: string | null
}

/** A connection driving a seat in a room, as the server keeps it. */
export interface Player {
  readonly connection: TransportConnection
  readonly identity: Identity
  readonly room: Room
  readonly seat: Seat
  readonly timeline: InputTimeline
  respawnedTick: number
  /** Whether they have had the bananas in full yet: until then, changes would mean nothing to them. */
  told: boolean
  /** How many inputs they may still send just now, and how many they sent past that. */
  allowance: number
  dropped: number
  /** The server tick they were last heard from. */
  heardTick: number
  /** The pass of the game's member this seat belongs to: the same at every portal and after a dropped connection. */
  readonly pass: number
}

/** A connection that has said hello, waiting to be seated in a world, or on nothing yet. */
export interface Handshake {
  readonly connection: TransportConnection
  readonly openedTick: number
  /** The hello of someone waiting for their world to be made, to be seated on it once it is. */
  waiting: HelloMessage | null
}

/** A connection on the start screen or in a game room: a member of a game, or browsing them, and no seat in any world. */
export interface LobbyConnection {
  readonly connection: TransportConnection
  readonly identity: Identity
  /** The game this connection is a member of, or 0 while browsing. */
  game: number
  /** Its member id in that game, or 0 while browsing. */
  member: number
}

/**
 * What a player left a room holding, and when, for the room they come out
 * into; and where, for them to be put back there if they only lost the
 * connection and joined the same room again.
 */
export interface Left {
  readonly carried: Carried
  /** The nostr key they had proved theirs, which comes through with them. */
  readonly pubkey: string | null
  readonly tick: number
  readonly game: number
  readonly world: number
  readonly where: VehicleSpawn
}

/** Everything one server knows, between ticks. */
export interface ServerState {
  readonly sources: GameSources
  readonly events: Partial<GameServerEvents>
  /** How many cars nobody drives each island has, while seats are free for them. */
  readonly npcs: number
  /** What is kept of each nostr key for good: the achievements it has been paid, and the bananas it holds between free drives. */
  readonly store: PlayerStore
  readonly demoOn: boolean
  readonly demoSeed: () => number
  /** The server's own clock, which every game's, race's, handshake's and room's timing is kept in. */
  clock: number
  disposed: boolean
  /** Every game on the server, by id, and the id the next one gets. */
  readonly games: Map<number, GameRecord>
  nextGameId: number
  /** Every room on the server, by the key of the game and world it is. */
  readonly rooms: Map<number, Room>
  /** The worlds of a game being made for someone waiting, made elsewhere while every room goes on. */
  readonly making: Map<number, Promise<Arena>>
  readonly players: Map<number, Player>
  readonly lobbies: Map<number, LobbyConnection>
  readonly handshaking: Map<number, Handshake>
  /** The room each watching connection is watching, without a seat in it. */
  readonly watching: Map<number, Room>
  /** What players left their rooms holding, by their pass, a while. */
  readonly left: Map<number, Left>
  /** The demo race's id while one is on, or 0. */
  demo: number
  /** The world each race is followed in as last listed, so the games list is only pushed when it changes. */
  readonly leaders: Map<number, number>
  /** An input being decoded, a car's at a time. */
  readonly scratchInput: VehicleInput
  /** What a car nobody drives asks for, a seat at a time: each is used before the next is asked. */
  readonly npcCommand: VehicleInput
  /** What a bot of a race asks of its car for this tick, a seat at a time, as `npcCommand` is for the traffic. */
  readonly botCommand: VehicleInput
  /** A tick's games and rooms, gathered once so that closing one of them part way does not cut the walk short. */
  readonly tickGames: GameRecord[]
  readonly tickRooms: Room[]
  /** The racers of the last placing, kept to be gathered again rather than made again. */
  readonly tickRacers: Racer[]
}

/** Every game on the server as the tick finds it, into the tick's own list: a game closed part way does not cut the walk short. */
export function gatherGames(state: ServerState): GameRecord[] {
  const games = state.tickGames
  games.length = 0
  for (const game of state.games.values()) games.push(game)
  return games
}

/** Every room the server has as the tick finds it, into the tick's own list. */
export function gatherRooms(state: ServerState): Room[] {
  const rooms = state.tickRooms
  rooms.length = 0
  for (const room of state.rooms.values()) rooms.push(room)
  return rooms
}

/** The planets a host who does not choose one may draw: a seed, over the whole range one has. */
export const SEED_MOST = 0x0ffffffe

/**
 * A server that knows nothing yet: no game, no room, no connection, and its
 * clock at nothing. What is kept of each player's key is the in-memory store
 * unless a server that keeps it somewhere says otherwise.
 */
export function createServerState(
  sources: GameSources,
  events: Partial<GameServerEvents> = {},
  npcs = NPC_CARS,
  store: PlayerStore = new MemoryPlayerStore(),
  settings: GameServerSettings = {},
): ServerState {
  return {
    sources,
    events,
    npcs,
    store,
    demoOn: settings.demo ?? true,
    demoSeed: settings.demoSeed ?? (() => 1 + Math.floor(Math.random() * SEED_MOST)),
    clock: 0,
    disposed: false,
    games: new Map(),
    nextGameId: 1,
    rooms: new Map(),
    making: new Map(),
    players: new Map(),
    lobbies: new Map(),
    handshaking: new Map(),
    watching: new Map(),
    left: new Map(),
    demo: 0,
    leaders: new Map(),
    scratchInput: createVehicleInput(),
    npcCommand: createVehicleInput(),
    botCommand: createVehicleInput(),
    tickGames: [],
    tickRooms: [],
    tickRacers: [],
  }
}

/** The member of a game that drives with a pass, on whichever world of it, if one does. */
export function playerOfPass(state: ServerState, game: number, pass: number): Player | undefined {
  for (const player of state.players.values()) if (player.pass === pass && player.room.game === game) return player
  return undefined
}

/** The player driving with a pass, on whichever world of whichever game, if one is. */
export function playerByPass(state: ServerState, pass: number): Player | undefined {
  for (const player of state.players.values()) if (player.pass === pass) return player
  return undefined
}

/** The player driving a seat of a room, if a player does rather than a car nobody drives. */
export function playerIn(room: Room, seat: Seat): Player | undefined {
  return room.drivers.get(seat.id)
}

/** The pass of the racer driving a seat of a room: a player's, a bot's, or `null` when nobody is racing in it. */
export function racerIn(room: Room, seat: Seat): number | null {
  return room.racers.get(seat.id) ?? null
}

/** The seats of everyone playing with a key, on whichever world: the same player, at once, in more than one tab. */
export function seatsWith(state: ServerState, pubkey: string): Seat[] {
  const seats: Seat[] = []
  for (const player of state.players.values()) if (player.identity.pubkey === pubkey) seats.push(player.seat)
  return seats
}

/** The member of a game a lobby connection is, if it is in one. */
export function memberOf(state: ServerState, lobby: LobbyConnection): GameMember | undefined {
  return state.games.get(lobby.game)?.members.get(lobby.member)
}

/** How many connections are watching a room without a seat in it. */
export function spectatorCount(state: ServerState): number {
  let count = 0
  for (const room of state.rooms.values()) count += room.spectators.size
  return count
}
