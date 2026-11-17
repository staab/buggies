/**
 * The rules of a race, over a game and the rooms of its course: the
 * countdown once every racer is on the grid, the gates passed in order, the
 * line the first home crosses, the placing, and the grace the rest are
 * given. A race is a game's, not a room's: a racer's progress carries from
 * world to world, and a room is only where it is by now.
 */

import { COUNTDOWN_TICKS, FINISH_GRACE_TICKS, botSetBack, checkpointSpawn, respawn, type Seat } from '@buggies/game'
import { groundDistance } from '@buggies/terrain'

import { callRaceOver, overAtOf, placeRacers, stepGame, type GameRecord } from './game-registry.ts'
import { closeGame } from './game-lobby.ts'
import { NO_TICK } from './protocol.ts'
import { roomFor, type Room } from './rooms.ts'
import { racerIn, type ServerState } from './server-state.ts'
import { noteLeader, pushGame, pushGames, pushStandings } from './telling.ts'

/**
 * One step of a game's life: the countdown, the race's end, and the game's
 * delete. The lobby hears of each change of status, and of the countdown
 * starting, when the cars on the grid are held until it ends.
 */
export function tendGame(state: ServerState, game: GameRecord): void {
  const first = game.course?.legs[0]
  const effect = stepGame(game, state.clock, first !== undefined && everyoneSeated(state, game, first.world))
  if (effect.countdown) {
    if (first !== undefined) {
      const room = roomFor(state, game.id, first.world)
      if (room !== undefined) room.arena.holdUntil = room.arena.tick + COUNTDOWN_TICKS
    }
    state.events.onGameStarted?.(game)
    pushGame(game)
  }
  if (effect.started) {
    pushGame(game)
    pushGames(state)
  }
  if (effect.finished) {
    // A demo's standings stand where it was: the next demo is a new one, with a seed of its own.
    if (game.id === state.demo) state.demo = 0
    state.events.onGameFinished?.(game)
    pushGame(game)
    pushGames(state)
    pushStandings(state, game)
  }
  if (effect.closed) closeGame(state, game)
}

/** Whether every racer of a race is seated, and driving, in the world its first leg runs on: a bot as soon as it is on the grid. */
function everyoneSeated(state: ServerState, game: GameRecord, world: number): boolean {
  if (game.racers.size === 0) return false
  const room = roomFor(state, game.id, world)
  if (room === undefined) return false
  // On the grid means driving there: a page still making the world after taking its seat sends no input yet, and would miss the countdown.
  let seated = 0
  for (const [id, pass] of room.racers) {
    if (!game.racers.has(pass)) continue
    const driver = room.drivers.get(id)
    if (driver !== undefined && driver.timeline.receivedTick === NO_TICK) continue
    seated += 1
  }
  return seated === game.racers.size
}

/**
 * The gates of a race: each racer that drives through its next one passes
 * it, in order, and a wreck passes nothing. Past the last gate of the
 * last world is the finish line, and the first over it wins; the race is
 * called over a grace after that, or as soon as every racer is home. The
 * lobby hears of the leader's world as it changes, for whoever watches it.
 */
export function stepRace(state: ServerState, game: GameRecord): void {
  const course = game.course
  if (course === null) return
  for (const room of state.rooms.values()) {
    if (room.game !== game.id) continue
    const leg = course.legs[room.leg]
    if (leg === undefined) continue
    const last = room.leg === course.legs.length - 1
    for (const seat of room.arena.seats) {
      if (!seat.occupied) continue
      const key = racerIn(room, seat)
      if (key === null) continue
      const racer = game.racers.get(key)
      if (racer === undefined || racer.leg !== room.leg || racer.finishedAt !== 0) continue
      const { vehicle } = seat
      // A wreck passes nothing until it is put back.
      if (vehicle.wrecked) continue
      const gate = leg.checkpoints[racer.checkpoint]
      if (gate === undefined || groundDistance(vehicle.frame.position, gate.at) > gate.radius) continue
      racer.checkpoint += 1
      // The last gate of the last world is the line: the race is done for this one.
      if (!last || racer.checkpoint < leg.checkpoints.length) continue
      racer.finishedAt = state.clock
      seat.progress.racesWon += 1
      seat.racesWon = (seat.racesWon + 1) & 0xff
    }
  }
  placeRacers(game, state.tickRacers)
  noteLeader(state, game)
  if (overAtOf(game) !== NO_TICK) return
  let first = 0
  let finished = 0
  for (const racer of game.racers.values()) {
    if (racer.finishedAt === 0) continue
    finished += 1
    first = first === 0 ? racer.finishedAt : Math.min(first, racer.finishedAt)
  }
  if (finished === 0) return
  // Everyone home is the race over at once; otherwise the rest are given a grace from the winner's finish.
  if (finished === game.racers.size || state.clock - first >= FINISH_GRACE_TICKS) callRaceOver(game, state.clock)
}

/**
 * A car put back in a race goes where its racer's last gate was, facing the
 * next; `false` in free drive. A bot put back has nothing counted against it
 * there either.
 */
export function placeAtCheckpoint(state: ServerState, room: Room, seat: Seat): boolean {
  if (room.mode !== 'race') return false
  const game = state.games.get(room.game)
  if (game === undefined || game.course === null) return false
  const pass = racerIn(room, seat)
  if (pass === null) return false
  const racer = game.racers.get(pass)
  if (racer === undefined) return false
  const bot = room.bots.get(seat.id)?.bot
  if (bot !== null && bot !== undefined) botSetBack(bot, bot.along)
  respawn(seat, checkpointSpawn(game.course, room.arena.planet, racer.leg, racer.checkpoint, racer.grid))
  return true
}
