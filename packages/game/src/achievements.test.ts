import { generatePlanet, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { ACHIEVEMENTS, ACHIEVEMENT_GAP_TICKS, LANDMARKS, awardAchievements } from './achievements.ts'
import { NEUTRAL_INPUT, advance, carriedOf, carryOver, createArena, initPhysics, keyOf, leaveSeat, playRace, seatNpc, takeSeat, harm, type Arena, type Seat } from './index.ts'

let map: World

const titled = (title: string): number => ACHIEVEMENTS.findIndex((achievement) => achievement.title === title)

/** Pay out feats over this many ticks, the arena's clock running on as it does. */
function pay(arena: Arena, ticks: number): number[] {
  const paid: number[] = []
  for (let i = 0; i < ticks; i++) {
    for (const { achievement } of awardAchievements(arena)) paid.push(achievement.id)
    ;(arena as { tick: number }).tick += 1
  }
  return paid
}

describe('achievements', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(11)
  }, 60_000)

  it('are a hundred, each its own, each paying something and putting on a show', () => {
    expect(ACHIEVEMENTS).toHaveLength(100)
    expect(new Set(ACHIEVEMENTS.map((achievement) => achievement.title)).size).toBe(100)
    ACHIEVEMENTS.forEach((achievement, id) => {
      expect(achievement.id).toBe(id)
      expect(achievement.reward).toBeGreaterThan(0)
      expect(achievement.icon).not.toBe('')
      expect(achievement.description).not.toBe('')
    })
  })

  it('pay each feat once, its bananas added, one at a time with a gap between', () => {
    const arena = createArena(map, 2)
    const seat = takeSeat(arena, 0, 'sportsCar')
    // Every feat but the first two already had, whatever else the car happens to have done where it stands.
    seat.progress.earned.fill(1)
    seat.progress.earned[titled('First Banana')] = 0
    seat.progress.earned[titled('Bunch')] = 0
    seat.collected = 10
    seat.score = 10
    expect(pay(arena, 1)).toEqual([titled('First Banana')])
    expect(seat.score).toBe(12)
    expect(seat.achievements).toBe(1)
    expect(seat.lastAchievement).toBe(titled('First Banana'))
    // The next waits out the gap, then comes; neither again after.
    expect(pay(arena, ACHIEVEMENT_GAP_TICKS - 1)).toEqual([])
    expect(pay(arena, ACHIEVEMENT_GAP_TICKS * 3)).toEqual([titled('Bunch')])
    expect(seat.score).toBe(17)
    expect(seat.achievements).toBe(2)
    arena.world.free()
  })

  it('count a landmark driven up to, a weapon used and a car wrecked', () => {
    const arena = createArena(map, 2)
    const seat = takeSeat(arena, 0, 'sportsCar')
    const lighthouse = map.buildings.find((building) => building.kind === 'lighthouse')!
    seat.vehicle.body.setTranslation(lighthouse.at, true)
    seat.vehicle.frame.position.x = lighthouse.at.x
    seat.vehicle.frame.position.y = lighthouse.at.y
    seat.vehicle.frame.position.z = lighthouse.at.z
    ;(arena as { tick: number }).tick = 0
    awardAchievements(arena)
    expect(seat.progress.landmarks & (1 << LANDMARKS.findIndex((landmark) => landmark.kind === 'lighthouse'))).not.toBe(0)

    seat.score = 20
    for (let i = 0; i < 3; i++) advance(arena, (one) => (one === seat ? { ...NEUTRAL_INPUT, weapon: keyOf('rocket'), fire: true } : NEUTRAL_INPUT))
    expect(seat.progress.weaponsTried).toBe(1 << (keyOf('rocket') - 1))

    const other = takeSeat(arena, 1, 'sportsCar')
    harm(other, 10, seat)
    expect(seat.progress.carsWrecked).toBe(1)
    expect(seat.kills).toBe(1)
    arena.world.free()
  })

  it('count a race won, and are carried through a portal, which counts too', () => {
    const arena = createArena(map, 2)
    const seat = takeSeat(arena, 0, 'sportsCar')
    const at = seat.vehicle.frame.position
    arena.race = { course: [{ ...at }, { ...at }, { ...at }], laps: 1, starter: 0, startTick: 0 }
    seat.racePassed = 1
    // The finish is where the car is: over it, it wins.
    playRace(arena)
    playRace(arena)
    expect(seat.progress.racesWon).toBe(1)
    seat.progress.earned[titled('First Banana')] = 1
    seat.achievements = 1

    const carried = carriedOf(seat)
    leaveSeat(arena, 0)
    const back = takeSeat(arena, 0, 'sportsCar')
    expect(back.progress.racesWon).toBe(0)
    carryOver(back, carried)
    expect(back.progress.racesWon).toBe(1)
    expect(back.progress.portals).toBe(1)
    expect(back.progress.earned[titled('First Banana')]).toBe(1)
    expect(back.achievements).toBe(1)
    arena.world.free()
  })

  it('are nothing to a car nobody drives', () => {
    const arena = createArena(map, 2)
    const npc: Seat | null = seatNpc(arena, 0)
    expect(npc).not.toBeNull()
    npc!.collected = 100
    expect(pay(arena, 1)).toEqual([])
    expect(npc!.achievements).toBe(0)
    arena.world.free()
  })
})
