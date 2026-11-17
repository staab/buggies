import { generatePlanet, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_GAP_TICKS,
  ACHIEVEMENT_NUMBERS,
  LANDMARKS,
  awardAchievements,
  createAchievementProgress,
} from './achievements.ts'
import { NEUTRAL_INPUT, advance, carriedOf, carryOver, createArena, initPhysics, keyOf, leaveSeat, seatNpc, takeSeat, harm, type Arena, type Seat } from './index.ts'

let map: World

/** The number a feat is paid by, or -1 for none of that title. */
const numberOf = (title: string): number => ACHIEVEMENTS.find((achievement) => achievement.title === title)?.id ?? -1

/**
 * The numbers the feats were paid by before the games played for a count
 * were taken out, at every boundary of the list: each one is kept, so that
 * a player's feats are the ones they earned before.
 */
const NUMBERS: readonly (readonly [string, number])[] = [
  ['First Banana', 0],
  ['King Kong', 11],
  ['Nest Egg', 12],
  ['Road Rage Legend', 24],
  ['Rebel Without a Cause', 25],
  ['Singularity Averted', 36],
  ['Checkered Flag', 37],
  ['Hall of Fame', 44],
  ['Hang Time', 48],
  ['Never Touched Down', 54],
  ['Big Air', 55],
  ['Long Haul Flight', 59],
  ['Rocket Man', 60],
  ['Armed to the Teeth', 69],
  ['Sightseer: Observatory', 70],
  ['Sightseer: Moon lander', 89],
  ['Tourist', 90],
  ['Portal Hopper', 96],
  ['Splashdown', 98],
  ['Sky Is the Limit', 99],
]

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

  it('keep the number each has always been paid by, the numbers of the games played for a count retired', () => {
    // One feat fewer for every number that went with those games.
    expect(ACHIEVEMENT_NUMBERS).toBe(100)
    expect(ACHIEVEMENTS).toHaveLength(97)
    expect(new Set(ACHIEVEMENTS.map((achievement) => achievement.title)).size).toBe(97)
    expect(new Set(ACHIEVEMENTS.map((achievement) => achievement.id)).size).toBe(97)
    for (const [title, id] of NUMBERS) expect(numberOf(title)).toBe(id)
    // Retired, and never handed out again; nothing of those games is left to win.
    for (const id of [45, 46, 47]) expect(ACHIEVEMENTS.some((achievement) => achievement.id === id)).toBe(false)
    for (const title of ['Game On', 'Gamer', 'Overachiever']) expect(numberOf(title)).toBe(-1)
    // A byte for every number there has ever been, the retired ones included.
    expect(createAchievementProgress().earned).toHaveLength(ACHIEVEMENT_NUMBERS)
    ACHIEVEMENTS.forEach((achievement) => {
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
    seat.progress.earned[numberOf('First Banana')] = 0
    seat.progress.earned[numberOf('Bunch')] = 0
    seat.collected = 10
    seat.score = 10
    expect(pay(arena, 1)).toEqual([numberOf('First Banana')])
    expect(seat.score).toBe(12)
    expect(seat.achievements).toBe(1)
    expect(seat.lastAchievement).toBe(numberOf('First Banana'))
    // The next waits out the gap, then comes; neither again after.
    expect(pay(arena, ACHIEVEMENT_GAP_TICKS - 1)).toEqual([])
    expect(pay(arena, ACHIEVEMENT_GAP_TICKS * 3)).toEqual([numberOf('Bunch')])
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
    // The server counts a race won on the progress that rides with the racer, and the feat comes with it.
    seat.progress.racesWon = 1
    seat.progress.earned.fill(1)
    seat.progress.earned[numberOf('Checkered Flag')] = 0
    expect(pay(arena, 1)).toEqual([numberOf('Checkered Flag')])

    seat.progress.earned[numberOf('First Banana')] = 1
    seat.achievements = 2
    const carried = carriedOf(seat)
    leaveSeat(arena, 0)
    const back = takeSeat(arena, 0, 'sportsCar')
    expect(back.progress.racesWon).toBe(0)
    carryOver(back, carried)
    expect(back.progress.racesWon).toBe(1)
    expect(back.progress.portals).toBe(1)
    expect(back.progress.earned[numberOf('First Banana')]).toBe(1)
    expect(back.achievements).toBe(2)
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
