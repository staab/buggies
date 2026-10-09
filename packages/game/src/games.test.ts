import { describe, expect, it } from 'vitest'

import {
  GAME_PRIZE,
  GAME_REACH,
  GAME_TARGET_MOST,
  NOT_RACING,
  RACE_LAPS_MOST,
  RACE_LEG_LEAST,
  RACE_MARKS_MOST,
  awardGames,
  gameProgress,
  lapOf,
  nextMark,
  raceMarks,
  runRace,
  setGame,
  validGame,
  type GameSeat,
  type Race,
} from './games.ts'

/** The planet these games are played on. */
const RADIUS = 600

/** A seat whose car stands this far round the equator from the planet's +z, in meters along the ground. */
function seat(around = 0): GameSeat {
  return {
    collected: 0,
    kills: 0,
    robotKills: 0,
    game: null,
    gamesWon: 0,
    racePassed: NOT_RACING,
    score: 0,
    occupied: true,
    vehicle: { wrecked: false, frame: { position: onEquator(around) } },
  }
}

/** The point on the equator this far round from +z, along the ground. */
function onEquator(around: number): { x: number; y: number; z: number } {
  return { x: RADIUS * Math.sin(around / RADIUS), y: 0, z: RADIUS * Math.cos(around / RADIUS) }
}

/** The way out through a point on the equator this far round, as a race's mark. */
function markAt(around: number): { x: number; y: number; z: number } {
  const { x, y, z } = onEquator(around)
  return { x: x / RADIUS, y: y / RADIUS, z: z / RADIUS }
}

/** Drive a seat's car to a point on the equator and play a step of a race there. */
function driveTo(player: GameSeat, race: Race, around: number): GameSeat | null {
  Object.assign(player.vehicle.frame.position, onEquator(around))
  return runRace([player], race, RADIUS)
}

/** Whether a seat has reached its count. */
function reached(player: GameSeat): boolean {
  return player.game !== null && gameProgress(player, player.game) >= player.game.target
}

describe('games', () => {
  it('counts bananas and wrecks from when the game is set, not from sitting down', () => {
    const player = seat()
    player.collected = 12
    player.kills = 4
    setGame(player, { kind: 'score', target: 5 }, 0)
    expect(gameProgress(player, player.game!)).toBe(0)
    player.collected += 4
    expect(reached(player)).toBe(false)
    player.collected += 1
    expect(reached(player)).toBe(true)

    setGame(player, { kind: 'kills', target: 2 }, 0)
    player.kills += 1
    expect(gameProgress(player, player.game!)).toBe(1)
    expect(reached(player)).toBe(false)
    player.kills += 1
    expect(reached(player)).toBe(true)
  })

  it('counts robots brought down from when the game is set', () => {
    const player = seat()
    player.robotKills = 2
    setGame(player, { kind: 'robots', target: 1 }, 0)
    expect(reached(player)).toBe(false)
    player.robotKills += 1
    expect(reached(player)).toBe(true)
  })

  it('pays a count reached once, in bananas, and goes back to free play', () => {
    const player = seat()
    const wreck = seat()
    ;(wreck.vehicle as { wrecked: boolean }).wrecked = true
    for (const each of [player, wreck]) setGame(each, { kind: 'score', target: 1 }, 0)
    player.collected = 1
    wreck.collected = 1
    player.score = 3
    expect(awardGames([player, wreck])).toEqual([player])
    expect(player.score).toBe(3 + GAME_PRIZE)
    expect(player.game).toBeNull()
    expect(player.gamesWon).toBe(1)
    // A wreck wins nothing until it is back on the road.
    expect(wreck.game).not.toBeNull()
    expect(awardGames([player])).toEqual([])
    expect(player.score).toBe(3 + GAME_PRIZE)
  })

  it('races through every checkpoint in order to the finish, from the start', () => {
    const player = seat(300)
    const race: Race = { course: [markAt(300), markAt(600), markAt(900), markAt(1200)], laps: 1, starter: 0, startTick: 0 }
    // Not in the race, nothing is passed.
    expect(driveTo(player, race, 600)).toBeNull()
    expect(player.racePassed).toBe(NOT_RACING)

    // Put on the start, as a race starting does: the first checkpoint is next.
    player.racePassed = 1
    // Skipping it for the second gets nowhere.
    expect(driveTo(player, race, 900)).toBeNull()
    expect(player.racePassed).toBe(1)
    expect(driveTo(player, race, 600 + GAME_REACH - 1)).toBeNull()
    expect(player.racePassed).toBe(2)
    expect(driveTo(player, race, 900)).toBeNull()
    expect(player.racePassed).toBe(3)

    // A wreck passes nothing, even sat on the finish.
    ;(player.vehicle as { wrecked: boolean }).wrecked = true
    expect(driveTo(player, race, 1200)).toBeNull()
    ;(player.vehicle as { wrecked: boolean }).wrecked = false
    expect(driveTo(player, race, 1200)).toBe(player)
    expect(player.score).toBe(GAME_PRIZE)
    expect(player.gamesWon).toBe(1)
  })

  it('runs a circuit from the finish back round by the start, and wins it only over the finish on the last lap', () => {
    const player = seat(300)
    const race: Race = { course: [markAt(300), markAt(600), markAt(900)], laps: 2, starter: 0, startTick: 0 }
    expect(raceMarks(race)).toBe(6)
    player.racePassed = 1
    expect(lapOf(player, race)).toBe(1)
    expect(driveTo(player, race, 600)).toBeNull()
    // Over the finish on the first lap is not the end: the start is next.
    expect(driveTo(player, race, 900)).toBeNull()
    expect(nextMark(player, race)).toEqual(race.course[0])
    expect(lapOf(player, race)).toBe(2)
    // The checkpoint before the start again gets nowhere.
    expect(driveTo(player, race, 600)).toBeNull()
    expect(player.racePassed).toBe(3)
    expect(driveTo(player, race, 300)).toBeNull()
    expect(driveTo(player, race, 600)).toBeNull()
    expect(lapOf(player, race)).toBe(2)
    expect(driveTo(player, race, 900)).toBe(player)
    expect(player.gamesWon).toBe(1)
  })

  it('takes only counts that can be played for', () => {
    expect(validGame({ kind: 'score', target: 10, course: [markAt(0)] }, RADIUS)).toEqual({ kind: 'score', target: 10, course: [] })
    expect(validGame({ kind: 'kills', target: 0, course: [] }, RADIUS)).toBeNull()
    expect(validGame({ kind: 'kills', target: GAME_TARGET_MOST + 1, course: [] }, RADIUS)).toBeNull()
    expect(validGame({ kind: 'score', target: 2.5, course: [] }, RADIUS)).toBeNull()
  })

  it('takes only races with a start, a checkpoint or more and a finish, each leg long enough', () => {
    const scaled = [{ x: 0, y: 0, z: 2 }, markAt(300), { x: 3 * markAt(600).x, y: 0, z: 3 * markAt(600).z }]
    const taken = validGame({ kind: 'race', target: 7, course: scaled }, RADIUS)!
    expect(taken.target).toBe(7)
    expect(taken.course[0]).toEqual({ x: 0, y: 0, z: 1 })
    expect(Math.hypot(taken.course[2]!.x, taken.course[2]!.y, taken.course[2]!.z)).toBeCloseTo(1, 9)

    // A race is run once round or more, up to a few laps.
    const course = [markAt(0), markAt(300), markAt(600)]
    expect(validGame({ kind: 'race', target: RACE_LAPS_MOST, course }, RADIUS)).not.toBeNull()
    expect(validGame({ kind: 'race', target: 0, course }, RADIUS)).toBeNull()
    expect(validGame({ kind: 'race', target: RACE_LAPS_MOST + 1, course }, RADIUS)).toBeNull()
    expect(validGame({ kind: 'race', target: 1.5, course }, RADIUS)).toBeNull()

    // A start and a finish alone are no race.
    expect(validGame({ kind: 'race', target: 1, course: [markAt(0), markAt(300)] }, RADIUS)).toBeNull()
    // Nor is one whose marks crowd each other.
    expect(validGame({ kind: 'race', target: 1, course: [markAt(0), markAt(300), markAt(300 + RACE_LEG_LEAST - 1)] }, RADIUS)).toBeNull()
    // A loop back to the start is a race.
    expect(validGame({ kind: 'race', target: 1, course: [markAt(0), markAt(300), markAt(600), markAt(0)] }, RADIUS)).not.toBeNull()
    const long = Array.from({ length: RACE_MARKS_MOST + 1 }, (_, k) => markAt((k % 2) * 300))
    expect(validGame({ kind: 'race', target: 1, course: long }, RADIUS)).toBeNull()
    expect(validGame({ kind: 'race', target: 1, course: [markAt(0), { x: 0, y: 0, z: 0 }, markAt(600)] }, RADIUS)).toBeNull()
    expect(validGame({ kind: 'race', target: 1, course: [markAt(0), { x: Number.NaN, y: 0, z: 1 }, markAt(600)] }, RADIUS)).toBeNull()
  })
})
