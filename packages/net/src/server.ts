/**
 * The game server: what the transport hands a connection to, and the thin
 * wrapper that holds what the server knows — see `server-state` — and puts
 * the parts over it in reach of each other: the lobby and its games, the
 * rooms of their worlds and the seats in them, the race over a game and
 * the bots in it, the demo, what is kept of each player's key, and what the
 * server tells everyone. It steps the whole of that once a tick and answers
 * for the few things a test or a log asks it.
 */

import { NPC_CARS, PLAYABLE_PROFILE_IDS, changeVehicle, respawnNearby } from '@buggies/game'

import { dropLobby, lobbyMessage, openLobby } from './game-lobby.ts'
import type { GameRecord } from './game-registry.ts'
import { MemoryPlayerStore, type PlayerStore } from './player-store.ts'
import { signInPlayer } from './player-records.ts'
import {
  CLIENT_AUTH,
  CLIENT_CHANGE_VEHICLE,
  CLIENT_HELLO,
  CLIENT_INPUT,
  CLIENT_LOBBY,
  PROTOCOL_VERSION,
  REJECT_HANDSHAKE_ORDER,
  REJECT_MALFORMED_MESSAGE,
  REJECT_PROTOCOL_MISMATCH,
  TICKS_PER_SECOND,
} from './protocol.ts'
import { placeAtCheckpoint } from './race.ts'
import { ROOM_CLOSED, arrive, leaveRoom, roomFor as roomOf, type Room } from './rooms.ts'
import {
  createServerState,
  playerByPass,
  spectatorCount,
  type GameServerEvents,
  type GameServerSettings,
  type GameServerStats,
  type GameSources,
  type Player,
  type ServerState,
} from './server-state.ts'
import { reject } from './telling.ts'
import { stepServer } from './tick.ts'
import type { TransportConnection, TransportHandlers } from './transport.ts'
import {
  NO_PASS,
  decodeAuth,
  decodeChangeVehicle,
  decodeHello,
  decodeInput,
  isRespawn,
  messageTypeOf,
} from './wire.ts'

export { ROOM_CLOSED, roomKey, type Room, type RoomBot, type Spectator } from './rooms.ts'
export type { ArenaRequest, GameServerEvents, GameServerSettings, GameServerStats, GameSources } from './server-state.ts'

/** A player asking to be put back more often than this is just held down. */
const RESPAWN_COOLDOWN_TICKS = TICKS_PER_SECOND

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
  private readonly state: ServerState

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
    this.state = createServerState(sources, events, npcs, store, settings)
  }

  tick(): number {
    return this.state.clock
  }

  playerCount(): number {
    return this.state.players.size
  }

  roomCount(): number {
    return this.state.rooms.size
  }

  gameCount(): number {
    return this.state.games.size
  }

  /** A game on the server, by its id. */
  gameFor(id: number): GameRecord | undefined {
    return this.state.games.get(id)
  }

  /** The room of one world of one game, if anyone is on it. */
  roomFor(game: number, world: number): Room | undefined {
    return roomOf(this.state, game, world)
  }

  stats(): GameServerStats {
    const state = this.state
    const stats: GameServerStats = {
      tick: state.clock,
      games: state.games.size,
      rooms: state.rooms.size,
      players: state.players.size,
      spectators: spectatorCount(state),
      lobbyConnections: state.lobbies.size,
      inputsApplied: 0,
      inputsHeld: 0,
      inputsLate: 0,
      inputsAhead: 0,
      inputsDropped: 0,
      snapshotBytes: 0,
    }
    for (const { timeline, dropped } of state.players.values()) {
      stats.inputsApplied += timeline.applied
      stats.inputsHeld += timeline.held
      stats.inputsLate += timeline.late
      stats.inputsAhead += timeline.ahead
      stats.inputsDropped += dropped
    }
    for (const room of state.rooms.values()) stats.snapshotBytes += room.lastSnapshotBytes
    return stats
  }

  /** One fixed step for every game and every room, then a look at every player and every handshake. */
  advance(): void {
    stepServer(this.state)
  }

  dispose(): void {
    const state = this.state
    state.disposed = true
    for (const room of state.rooms.values()) {
      room.arena.world.free()
      for (const spectator of room.spectators.values()) spectator.connection.close(ROOM_CLOSED)
    }
    state.rooms.clear()
    state.players.clear()
    state.lobbies.clear()
    state.watching.clear()
    state.games.clear()
  }

  onOpen = (connection: TransportConnection): void => {
    this.state.handshaking.set(connection.id, { connection, openedTick: this.state.clock, waiting: null })
  }

  onMessage = (connection: TransportConnection, payload: Uint8Array): void => {
    const state = this.state
    if (state.handshaking.has(connection.id)) {
      startConnection(state, connection, payload)
      return
    }
    const lobby = state.lobbies.get(connection.id)
    if (lobby !== undefined) {
      lobbyMessage(state, lobby, payload)
      return
    }
    const player = state.players.get(connection.id)
    if (player === undefined) return
    worldMessage(state, player, payload)
  }

  onClose = (connection: TransportConnection): void => {
    const state = this.state
    state.handshaking.delete(connection.id)
    const lobby = state.lobbies.get(connection.id)
    if (lobby !== undefined) {
      state.lobbies.delete(connection.id)
      dropLobby(state, lobby)
    }
    const player = state.players.get(connection.id)
    if (player !== undefined) leaveRoom(state, player)
    const watching = state.watching.get(connection.id)
    if (watching !== undefined) {
      state.watching.delete(connection.id)
      watching.spectators.delete(connection.id)
    }
  }
}

/** What a connection is, decided by its first message: a lobby connection, or a seat in a world. */
function startConnection(state: ServerState, connection: TransportConnection, payload: Uint8Array): void {
  if (messageTypeOf(payload) === CLIENT_LOBBY) {
    openLobby(state, connection, payload)
    return
  }
  if (messageTypeOf(payload) !== CLIENT_HELLO) {
    reject(state, connection, REJECT_HANDSHAKE_ORDER)
    return
  }
  const hello = decodeHello(payload)
  if (hello === null || (hello.profile !== null && !PLAYABLE_PROFILE_IDS.includes(hello.profile))) {
    reject(state, connection, REJECT_MALFORMED_MESSAGE)
    return
  }
  if (hello.protocolVersion !== PROTOCOL_VERSION) {
    reject(state, connection, REJECT_PROTOCOL_MISMATCH)
    return
  }
  const handshake = state.handshaking.get(connection.id)
  // Asked twice while their world is made: the first is enough.
  if (handshake === undefined || handshake.waiting !== null) return
  // Back with the pass of a seat still taken: the old connection is lost but not closed, so let it go and take up where it left off.
  const stale = hello.pass === NO_PASS ? undefined : playerByPass(state, hello.pass)
  if (stale !== undefined) {
    leaveRoom(state, stale, stale.room.game === hello.game && stale.room.world === hello.seed)
    stale.connection.close('joined again')
  }
  arrive(state, connection, hello)
}

/** What a connection in a world says: its key, its car back or another, and the input for a tick. */
function worldMessage(state: ServerState, player: Player, payload: Uint8Array): void {
  const { arena } = player.room
  player.heardTick = state.clock

  if (messageTypeOf(payload) === CLIENT_AUTH) {
    signInPlayer(state, player, decodeAuth(payload))
    return
  }

  if (isRespawn(payload)) {
    if (arena.tick - player.respawnedTick < RESPAWN_COOLDOWN_TICKS) return
    player.respawnedTick = arena.tick
    if (!placeAtCheckpoint(state, player.room, player.seat)) respawnNearby(arena, player.seat)
    state.events.onRespawned?.(player.seat, 'asked')
    return
  }

  if (messageTypeOf(payload) === CLIENT_CHANGE_VEHICLE) {
    const profile = decodeChangeVehicle(payload)
    if (profile === null || !PLAYABLE_PROFILE_IDS.includes(profile)) {
      reject(state, player.connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    // A change puts the car back on the road, so it waits out a respawn's cooldown too.
    if (profile === player.seat.profile || arena.tick - player.respawnedTick < RESPAWN_COOLDOWN_TICKS) return
    player.respawnedTick = arena.tick
    changeVehicle(arena, player.seat, profile)
    state.events.onChangedVehicle?.(player.seat)
    return
  }

  if (messageTypeOf(payload) !== CLIENT_INPUT) {
    reject(state, player.connection, REJECT_MALFORMED_MESSAGE)
    return
  }
  if (player.allowance <= 0) {
    player.dropped += 1
    return
  }
  player.allowance -= 1
  const tick = decodeInput(payload, state.scratchInput)
  if (tick === null) {
    reject(state, player.connection, REJECT_MALFORMED_MESSAGE)
    return
  }
  player.timeline.record(tick, state.scratchInput)
}
