import type { Vec3 } from '@buggies/physics'
import { generatePlanet, upOf, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  GAME_PRIZE,
  NOT_RACING,
  RACE_LEG_LEAST,
  RACE_TICKS_MOST,
  createArena,
  endRace,
  initPhysics,
  playRace,
  respawn,
  seatNpc,
  spawnHere,
  startRace,
  takeSeat,
} from './index.ts'
import { apart } from './test-planet.ts'

let map: World

/** A course along the island's roads: each mark a little more than a leg on from the one before. */
function courseOn(island: World, marks: number): Vec3[] {
  const road = island.roads.filter((each) => each.kind === 'highway').sort((a, b) => b.points.length - a.points.length)[0]!
  const course: Vec3[] = [upOf(road.points[0]!)]
  let last = road.points[0]!
  for (const point of road.points) {
    if (course.length === marks) break
    if (apart(point, last) < RACE_LEG_LEAST + 20) continue
    course.push(upOf(point))
    last = point
  }
  expect(course).toHaveLength(marks)
  return course
}

/** Where a mark is on the ground. */
function onMark(island: World, mark: Vec3): Vec3 {
  return island.roads
    .flatMap((road) => road.points)
    .reduce((best, point) => (apart(point, upOf(mark)) < apart(best, upOf(mark)) ? point : best))
}

describe('races', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(11)
  }, 60_000)

  it('put everyone driving on a grid at the start, and the first over the finish wins', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    const b = takeSeat(arena, 1, 'sportsCar')
    const npc = seatNpc(arena, 7)!
    const traffic = { ...npc.vehicle.frame.position }
    const course = courseOn(map, 3)
    const start = onMark(map, course[0]!)

    expect(startRace(arena, course, a)).toEqual([a, b])
    expect(arena.race).toMatchObject({ starter: a.id, startTick: arena.tick })
    for (const racer of [a, b]) {
      expect(apart(racer.vehicle.frame.position, start)).toBeLessThan(30)
      expect(racer.racePassed).toBe(1)
    }
    // Side by side or one behind the other, never on top of each other.
    expect(apart(a.vehicle.frame.position, b.vehicle.frame.position)).toBeGreaterThan(2)
    expect(npc.racePassed).toBe(NOT_RACING)
    expect(apart(npc.vehicle.frame.position, traffic)).toBeLessThan(1)

    const put = (racer: typeof a, at: Vec3): void => respawn(racer, spawnHere(at, { x: 1, y: 0, z: 0 }))
    // The finish before the checkpoint is nothing.
    put(b, onMark(map, course[2]!))
    expect(playRace(arena)).toBeNull()
    expect(b.racePassed).toBe(1)
    put(b, onMark(map, course[1]!))
    expect(playRace(arena)).toBeNull()
    expect(b.racePassed).toBe(2)
    put(b, onMark(map, course[2]!))
    const score = b.score
    expect(playRace(arena)).toEqual({ winner: b })
    expect(b.score).toBe(score + GAME_PRIZE)
    expect(arena.race).toBeNull()
    expect([a.racePassed, b.racePassed]).toEqual([NOT_RACING, NOT_RACING])
    arena.world.free()
  })

  it('are called off when nobody finishes in time, or when called off', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    const course = courseOn(map, 3)
    startRace(arena, course, a)
    arena.tick += RACE_TICKS_MOST - 1
    expect(playRace(arena)).toBeNull()
    arena.tick += 1
    expect(playRace(arena)).toEqual({ winner: null })
    expect(arena.race).toBeNull()
    expect(a.racePassed).toBe(NOT_RACING)

    startRace(arena, course, a)
    endRace(arena)
    expect(arena.race).toBeNull()
    expect(playRace(arena)).toBeNull()
    arena.world.free()
  })
})
