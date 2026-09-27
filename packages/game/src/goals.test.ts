import { describe, expect, it } from 'vitest'

import {
  GOAL_PRIZE,
  GOAL_REACH,
  GOAL_TARGET_MOST,
  awardGoals,
  goalMet,
  goalProgress,
  setGoal,
  validGoal,
  type GoalSeat,
} from './goals.ts'

/** The planet these goals are played on. */
const RADIUS = 600

/** A seat whose car stands this far round the equator from the planet's +z, in meters along the ground. */
function seat(around = 0): GoalSeat {
  return {
    collected: 0,
    kills: 0,
    robotKills: 0,
    goal: null,
    goalsWon: 0,
    score: 0,
    occupied: true,
    vehicle: { wrecked: false, frame: { position: onEquator(around) } },
  }
}

/** The point on the equator this far round from +z, along the ground. */
function onEquator(around: number): { x: number; y: number; z: number } {
  return { x: RADIUS * Math.sin(around / RADIUS), y: 0, z: RADIUS * Math.cos(around / RADIUS) }
}

/** The way out through a point on the equator this far round, as a goal's spot. */
function spotAt(around: number): { x: number; y: number; z: number } {
  const { x, y, z } = onEquator(around)
  return { x: x / RADIUS, y: y / RADIUS, z: z / RADIUS }
}

describe('goals', () => {
  it('counts bananas and wrecks from when the goal is set, not from sitting down', () => {
    const player = seat()
    player.collected = 12
    player.kills = 4
    setGoal(player, { kind: 'score', target: 5, x: 0, y: 0, z: 0 })
    expect(goalProgress(player, player.goal!, RADIUS)).toBe(0)
    player.collected += 4
    expect(goalMet(player, RADIUS)).toBe(false)
    player.collected += 1
    expect(goalMet(player, RADIUS)).toBe(true)

    setGoal(player, { kind: 'kills', target: 2, x: 0, y: 0, z: 0 })
    player.kills += 1
    expect(goalProgress(player, player.goal!, RADIUS)).toBe(1)
    expect(goalMet(player, RADIUS)).toBe(false)
    player.kills += 1
    expect(goalMet(player, RADIUS)).toBe(true)
  })

  it('counts robots brought down from when the goal is set', () => {
    const player = seat()
    player.robotKills = 2
    setGoal(player, { kind: 'robots', target: 1, x: 0, y: 0, z: 0 })
    expect(goalMet(player, RADIUS)).toBe(false)
    player.robotKills += 1
    expect(goalMet(player, RADIUS)).toBe(true)
  })

  it('reaches a spot within its reach, across the ground', () => {
    const player = seat(100)
    setGoal(player, { kind: 'location', target: 0, ...spotAt(100 + GOAL_REACH + 5) })
    expect(goalProgress(player, player.goal!, RADIUS)).toBeCloseTo(GOAL_REACH + 5, 5)
    expect(goalMet(player, RADIUS)).toBe(false)
    Object.assign(player.vehicle.frame.position, onEquator(110))
    expect(goalMet(player, RADIUS)).toBe(true)
  })

  it('pays a goal reached once, in bananas, and goes back to free play', () => {
    const player = seat()
    const wreck = seat()
    ;(wreck.vehicle as { wrecked: boolean }).wrecked = true
    for (const each of [player, wreck]) setGoal(each, { kind: 'score', target: 1, x: 0, y: 0, z: 0 })
    player.collected = 1
    wreck.collected = 1
    player.score = 3
    expect(awardGoals([player, wreck], RADIUS)).toEqual([player])
    expect(player.score).toBe(3 + GOAL_PRIZE)
    expect(player.goal).toBeNull()
    expect(player.goalsWon).toBe(1)
    // A wreck reaches nothing until it is back on the road.
    expect(wreck.goal).not.toBeNull()
    expect(awardGoals([player], RADIUS)).toEqual([])
    expect(player.score).toBe(3 + GOAL_PRIZE)
  })

  it('takes only goals that can be played for', () => {
    expect(validGoal({ kind: 'score', target: 10, x: 5, y: 1, z: 5 })).toEqual({ kind: 'score', target: 10, x: 0, y: 0, z: 0 })
    expect(validGoal({ kind: 'kills', target: 0, x: 0, y: 0, z: 0 })).toBeNull()
    expect(validGoal({ kind: 'kills', target: GOAL_TARGET_MOST + 1, x: 0, y: 0, z: 0 })).toBeNull()
    expect(validGoal({ kind: 'score', target: 2.5, x: 0, y: 0, z: 0 })).toBeNull()
    // A spot is a way out from the middle, made of unit length.
    expect(validGoal({ kind: 'location', target: 7, x: 0, y: 3, z: 4 })).toEqual({ kind: 'location', target: 0, x: 0, y: 0.6, z: 0.8 })
    expect(validGoal({ kind: 'location', target: 0, x: 0, y: 0, z: 0 })).toBeNull()
    expect(validGoal({ kind: 'location', target: 0, x: Number.NaN, y: 0, z: 20 })).toBeNull()
  })
})
