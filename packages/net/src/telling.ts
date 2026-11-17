/**
 * What the server tells everyone, and when: the start screen its games, a
 * room its game as it stands, a race's connections its standings, a world's
 * who is on it, and everyone in it where everything in it is. Each message
 * is encoded once a send, however many connections are to have it.
 */

import type { Seat, VehicleInput } from '@buggies/game'

import { gameSummary, gameView, leaderWorld, startsAtOf, type GameRecord } from './game-registry.ts'
import { NO_TICK, rejectLabel } from './protocol.ts'
import { gatherSnapshot, rememberTold } from './room-snapshot.ts'
import type { Room } from './rooms.ts'
import { playerIn, racerIn, type ServerState } from './server-state.ts'
import type { TransportConnection } from './transport.ts'
import {
  HELD,
  encodeGame,
  encodeGames,
  encodeLobby,
  encodeReject,
  encodeSnapshot,
  encodeStandings,
  withAck,
  type GameSummary,
  type RaceRacerView,
  type RaceView,
} from './wire.ts'

/** Every game on the server, as the start screen lists them. */
export function gamesListed(state: ServerState): GameSummary[] {
  const listed: GameSummary[] = []
  for (const game of state.games.values()) listed.push(gameSummary(game))
  return listed
}

/** The games on the server, to one connection: a room's start screen, or one that has left its game. */
export function sendGames(state: ServerState, connection: TransportConnection): void {
  connection.send(encodeGames(gamesListed(state)))
}

/** The games on the server, to every start screen that is browsing them. */
export function pushGames(state: ServerState): void {
  if (state.lobbies.size === 0) return
  const encoded = encodeGames(gamesListed(state))
  for (const lobby of state.lobbies.values()) lobby.connection.send(encoded)
}

/** One game as its room sees it, to each of its members on their own connection. */
export function pushGame(game: GameRecord): void {
  for (const member of game.members.values()) member.connection.send(encodeGame(gameView(game, member.id), member.id, member.drivePass))
}

/** How a race finished, to its room's connections and to everyone in its worlds, watchers included. */
export function pushStandings(state: ServerState, game: GameRecord): void {
  const encoded = encodeStandings(game.standings)
  for (const lobby of state.lobbies.values()) if (lobby.game === game.id) lobby.connection.send(encoded)
  for (const room of state.rooms.values()) {
    if (room.game !== game.id) continue
    for (const player of room.players.values()) player.connection.send(encoded)
    for (const spectator of room.spectators.values()) spectator.connection.send(encoded)
  }
}

/** Who is on the island, by name, to everyone on it: the bots seated there among them. */
export function broadcastLobby(room: Room): void {
  if (room.players.size === 0) return
  const players = [...room.players.values()].map((player) => ({ seat: player.seat.id, name: player.identity.name }))
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
export function broadcastSnapshot(state: ServerState, room: Room): void {
  if (room.players.size === 0 && room.spectators.size === 0) return
  const { arena, snapshots } = room
  const race = raceViewOf(state, room)
  // A player's car is told with the input it was last stepped with; a car nobody drives, with what its
  // driver last asked of it; anything else, with none. Never the scratch buffer, which holds whatever
  // input any player sent last: told with that, every car nobody drives would honk when a player did.
  const appliedInputOf = (seat: Seat): VehicleInput => playerIn(room, seat)?.timeline.appliedInput ?? seat.vehicle.command
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
export function raceViewOf(state: ServerState, room: Room): RaceView | null {
  const game = state.games.get(room.game)
  if (game === undefined || game.course === null) return null
  if (game.course.legs[room.leg] === undefined) return null
  const racers: RaceRacerView[] = []
  for (const seat of room.arena.seats) {
    if (!seat.occupied) continue
    const key = racerIn(room, seat)
    if (key === null) continue
    const racer = game.racers.get(key)
    if (racer === undefined) continue
    racers.push({ seat: seat.id, place: racer.place, checkpoint: racer.checkpoint, finished: racer.finishedAt !== 0 })
  }
  const begins = startsAtOf(game)
  return {
    world: room.leg + 1,
    ofWorlds: game.course.legs.length,
    // Held while the racers are still being seated, then negative through the 3-2-1, then the time since driving began.
    elapsed: begins === NO_TICK ? HELD : state.clock - begins,
    over: game.phase.kind === 'finished',
    racing: game.racers.size,
    racers,
  }
}

/** The world a race is followed in, which the games list only says again when it changes. */
export function noteLeader(state: ServerState, game: GameRecord): void {
  const leader = leaderWorld(game)
  if (state.leaders.get(game.id) === leader) return
  state.leaders.set(game.id, leader)
  pushGames(state)
}

/** Refuse a connection and let it go, with the reason its page is to show. */
export function reject(state: ServerState, connection: TransportConnection, reason: number): void {
  state.handshaking.delete(connection.id)
  connection.send(encodeReject({ reason }))
  connection.close(rejectLabel(reason))
  state.events.onRejected?.(connection.id, rejectLabel(reason))
}
