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

function seat(x = 0, z = 0): GoalSeat {
  return {
    collected: 0,
    kills: 0,
    robotKills: 0,
    goal: null,
    goalsWon: 0,
    score: 0,
    occupied: true,
    vehicle: { wrecked: false, frame: { position: { x, z } } },
  }
}

describe('goals', () => {
  it('counts bananas and wrecks from when the goal is set, not from sitting down', () => {
    const player = seat()
    player.collected = 12
    player.kills = 4
    setGoal(player, { kind: 'score', target: 5, x: 0, z: 0 })
    expect(goalProgress(player, player.goal!)).toBe(0)
    player.collected += 4
    expect(goalMet(player)).toBe(false)
    player.collected += 1
    expect(goalMet(player)).toBe(true)

    setGoal(player, { kind: 'kills', target: 2, x: 0, z: 0 })
    player.kills += 1
    expect(goalProgress(player, player.goal!)).toBe(1)
    expect(goalMet(player)).toBe(false)
    player.kills += 1
    expect(goalMet(player)).toBe(true)
  })

  it('counts robots brought down from when the goal is set', () => {
    const player = seat()
    player.robotKills = 2
    setGoal(player, { kind: 'robots', target: 1, x: 0, z: 0 })
    expect(goalMet(player)).toBe(false)
    player.robotKills += 1
    expect(goalMet(player)).toBe(true)
  })

  it('reaches a spot within its reach, across the ground', () => {
    const player = seat(100, 100)
    setGoal(player, { kind: 'location', target: 0, x: 100 + GOAL_REACH + 5, z: 100 })
    expect(goalProgress(player, player.goal!)).toBeCloseTo(GOAL_REACH + 5, 5)
    expect(goalMet(player)).toBe(false)
    player.vehicle.frame.position.x += 10
    expect(goalMet(player)).toBe(true)
  })

  it('pays a goal reached once, in bananas, and goes back to free play', () => {
    const player = seat()
    const wreck = seat()
    ;(wreck.vehicle as { wrecked: boolean }).wrecked = true
    for (const each of [player, wreck]) setGoal(each, { kind: 'score', target: 1, x: 0, z: 0 })
    player.collected = 1
    wreck.collected = 1
    player.score = 3
    expect(awardGoals([player, wreck])).toEqual([player])
    expect(player.score).toBe(3 + GOAL_PRIZE)
    expect(player.goal).toBeNull()
    expect(player.goalsWon).toBe(1)
    // A wreck reaches nothing until it is back on the road.
    expect(wreck.goal).not.toBeNull()
    expect(awardGoals([player])).toEqual([])
    expect(player.score).toBe(3 + GOAL_PRIZE)
  })

  it('takes only goals that can be played for', () => {
    expect(validGoal({ kind: 'score', target: 10, x: 5, z: 5 }, 1000)).toEqual({ kind: 'score', target: 10, x: 0, z: 0 })
    expect(validGoal({ kind: 'kills', target: 0, x: 0, z: 0 }, 1000)).toBeNull()
    expect(validGoal({ kind: 'kills', target: GOAL_TARGET_MOST + 1, x: 0, z: 0 }, 1000)).toBeNull()
    expect(validGoal({ kind: 'score', target: 2.5, x: 0, z: 0 }, 1000)).toBeNull()
    expect(validGoal({ kind: 'location', target: 7, x: 500, z: 20 }, 1000)).toEqual({ kind: 'location', target: 0, x: 500, z: 20 })
    expect(validGoal({ kind: 'location', target: 0, x: 1200, z: 20 }, 1000)).toBeNull()
    expect(validGoal({ kind: 'location', target: 0, x: Number.NaN, z: 20 }, 1000)).toBeNull()
  })
})
