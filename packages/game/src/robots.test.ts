import { generatePlanet, tangentFrame, upOf, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  DURABILITY,
  NO_TARGET,
  ROBOT_BEAM_TICKS,
  ROBOT_DAMAGE,
  ROBOT_SPEED,
  ROBOTS,
  ROBOT_SIZE,
  advance,
  createArena,
  initPhysics,
  respawn,
  robotEyes,
  spawnHere,
  takeSeat,
} from './index.ts'
import { apart, between, lifted, over } from './test-planet.ts'


let map: World

describe('robots', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(11)
  }, 60_000)

  it('roll slowly along the arterials, turning off at the junctions', () => {
    const arena = createArena(map)
    expect(arena.robots).toHaveLength(ROBOTS)
    const [robot] = arena.robots
    const start = { ...robot!.position }
    const roads = new Set<number>([robot!.road])
    for (let i = 0; i < 60 * 60; i++) {
      advance(arena)
      roads.add(robot!.road)
      // Always on an arterial, its feet on the road.
      const road = arena.planet.roads[robot!.road]!
      expect(road.kind).toBe('arterial')
      const nearest = Math.min(...road.points.map((point) => between(point, robot!.position)))
      expect(nearest).toBeLessThan(5)
    }
    // A minute on, it has come no further than it could at its speed, and has turned onto other roads.
    expect(apart(robot!.position, start)).toBeLessThanOrEqual(ROBOT_SPEED * 60 + 1)
    expect(roads.size).toBeGreaterThan(1)
    // Its body goes with it, standing up from its feet, for the cars to hit.
    expect(between(robot!.body.translation(), lifted(robot!.position, ROBOT_SIZE.halfHeight))).toBeLessThan(0.5)
    arena.world.free()
  }, 60_000)

  it('burn the nearest car their eyes can see with a laser beam, then charge before burning again', () => {
    const arena = createArena(map)
    const seat = takeSeat(arena, 0, 'sportsCar')
    const [robot] = arena.robots
    advance(arena)
    // Put the car on the robot's road a little way ahead of it.
    const road = arena.planet.roads[robot!.road]!
    const near = road.points.find((point) => {
      const away = apart(point, robot!.position)
      return away > 20 && away < 30
    })
    expect(near).toBeDefined()
    respawn(seat, spawnHere(lifted(near!, 1), tangentFrame(upOf(near!)).east))
    let burned = 0
    for (let i = 0; i < ROBOT_BEAM_TICKS * 2; i++) {
      advance(arena)
      const beam = arena.shots.find((shot) => shot.owner === NO_TARGET && shot.kind === 'laser')
      if (beam !== undefined && beam.hit === seat.id) burned++
    }
    expect(burned).toBeGreaterThan(ROBOT_BEAM_TICKS / 2)
    expect(seat.vehicle.damage).toBeGreaterThanOrEqual((burned * ROBOT_DAMAGE) / DURABILITY - 1e-6)
    // The beam goes out, and the eyes take a while to charge.
    expect(robot!.beamTicks).toBe(0)
    expect(robot!.cooldownTicks).toBeGreaterThan(0)
    const eyes = robotEyes({ x: 0, y: 0, z: 0 }, robot!)
    expect(over(eyes, robot!.position)).toBeGreaterThan(4)
    arena.world.free()
  }, 60_000)
})
