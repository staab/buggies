import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  DURABILITY,
  MACHINE_TOUGHNESS,
  ROBOT_TARGET,
  ROCKET_DAMAGE,
  UFO_CRUISE,
  UFO_TARGET,
  advance,
  createArena,
  initPhysics,
  takeSeat,
  type Arena,
} from './index.ts'

let map: TerrainMap

/** A rocket of this seat's set going right past a machine, after it. */
function rocketAt(arena: Arena, target: number, at: { x: number; y: number; z: number }): void {
  arena.rockets.push({
    id: 1,
    owner: 0,
    target,
    position: { x: at.x - 2, y: at.y, z: at.z },
    velocity: { x: 30, y: 0, z: 0 },
    bornTick: arena.tick,
    power: 1,
  })
}

describe('the robots and the saucers', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { size: 513 })
  }, 60_000)

  it('a robot takes a rocket as a car ten times tougher would, and once brought down comes back whole on another arterial', () => {
    const arena = createArena(map)
    takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    const [robot] = arena.robots
    rocketAt(arena, ROBOT_TARGET + robot!.id, { x: robot!.position.x, y: robot!.position.y + 3, z: robot!.position.z })
    advance(arena)
    expect(arena.rockets).toHaveLength(0)
    expect(robot!.damage).toBeCloseTo(ROCKET_DAMAGE / MACHINE_TOUGHNESS / DURABILITY, 5)
    expect(robot!.deaths).toBe(0)

    robot!.damage = 1 - 1e-6
    const before = { ...robot!.position }
    rocketAt(arena, ROBOT_TARGET + robot!.id, { x: robot!.position.x, y: robot!.position.y + 3, z: robot!.position.z })
    advance(arena)
    expect(robot!.deaths).toBe(1)
    expect(robot!.damage).toBe(0)
    expect(Math.hypot(robot!.position.x - before.x, robot!.position.z - before.z)).toBeGreaterThan(20)
    expect(arena.map.roads[robot!.road]!.kind).toBe('arterial')
    const body = robot!.body.translation()
    expect(Math.hypot(body.x - robot!.position.x, body.z - robot!.position.z)).toBeLessThan(0.5)
    arena.world.free()
  })

  it('a saucer takes a rocket the same, and once brought down comes back whole high over somewhere else', () => {
    const arena = createArena(map)
    takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    const [ufo] = arena.ufos
    rocketAt(arena, UFO_TARGET + ufo!.id, ufo!.position)
    advance(arena)
    expect(ufo!.damage).toBeCloseTo(ROCKET_DAMAGE / MACHINE_TOUGHNESS / DURABILITY, 5)

    ufo!.damage = 1 - 1e-6
    const before = { ...ufo!.position }
    rocketAt(arena, UFO_TARGET + ufo!.id, ufo!.position)
    advance(arena)
    expect(ufo!.deaths).toBe(1)
    expect(ufo!.damage).toBe(0)
    expect(ufo!.state).toBe('roam')
    expect(Math.hypot(ufo!.position.x - before.x, ufo!.position.z - before.z)).toBeGreaterThan(20)
    expect(ufo!.position.y).toBeGreaterThan(map.seaLevel + UFO_CRUISE - 1)
    arena.world.free()
  })
})
