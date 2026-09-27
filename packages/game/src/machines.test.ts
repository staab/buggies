import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BOMB_DAMAGE,
  MACHINE_TOUGHNESS,
  NEUTRAL_INPUT,
  PLOW_TICKS,
  arm,
  respawn,
  seatNpc,
  ROBOT_TARGET,
  SPIDER_BELLY,
  SPIDER_BODY,
  SPIDER_BOMB_TICKS,
  SPIDER_SPEED,
  SPIDER_TARGET,
  ROCKET_DAMAGE,
  UFO_CRUISE,
  UFO_TARGET,
  advance,
  createArena,
  initPhysics,
  takeSeat,
  type Arena,
  type LooseKind,
  type Seat,
} from './index.ts'

/** The test islands, laid out as when a seed picked at most eight: the maps these tests were written against. */
const TEST_ISLANDS = { islandsMost: 8 }

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
    map = generateTerrain(11, { ...TEST_ISLANDS, size: 513 })
  }, 60_000)

  it('a robot takes a rocket as a car ten times tougher would, and once brought down comes back whole on another arterial', () => {
    const arena = createArena(map)
    takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    const [robot] = arena.robots
    rocketAt(arena, ROBOT_TARGET + robot!.id, { x: robot!.position.x, y: robot!.position.y + 3, z: robot!.position.z })
    advance(arena)
    expect(arena.rockets).toHaveLength(0)
    expect(robot!.damage).toBeCloseTo(ROCKET_DAMAGE / MACHINE_TOUGHNESS, 5)
    expect(robot!.deaths).toBe(0)

    robot!.damage = 1 - 1e-6
    const before = { ...robot!.position }
    rocketAt(arena, ROBOT_TARGET + robot!.id, { x: robot!.position.x, y: robot!.position.y + 3, z: robot!.position.z })
    advance(arena)
    expect(robot!.deaths).toBe(1)
    expect(robot!.damage).toBe(0)
    expect(arena.seats[0]!.robotKills).toBe(1)
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
    expect(ufo!.damage).toBeCloseTo(ROCKET_DAMAGE / MACHINE_TOUGHNESS, 5)

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

  /** A car set down on a robot's road this far from it, facing it. */
  function facing(arena: Arena, seat: Seat, away: number): void {
    const [robot] = arena.robots
    const road = arena.map.roads[robot!.road]!
    const near = road.points.find((point) => Math.abs(Math.hypot(point.x - robot!.position.x, point.z - robot!.position.z) - away) < 2)!
    const yaw = Math.atan2(-(robot!.position.x - near.x), -(robot!.position.z - near.z))
    respawn(seat, { position: { x: near.x, y: near.y + 1, z: near.z }, yaw })
  }

  for (const weapon of ['machineGun', 'laser'] as const) {
    it(`a robot takes the ${weapon}`, () => {
      const arena = createArena(map)
      const seat = takeSeat(arena, 0, 'smallCar')
      advance(arena)
      facing(arena, seat, 25)
      for (let i = 0; i < 20; i++) advance(arena)
      arm(seat, weapon)
      for (let i = 0; i < 60; i++) advance(arena, (one) => (one === seat ? { ...NEUTRAL_INPUT, fire: true } : NEUTRAL_INPUT))
      expect(arena.robots[0]!.damage).toBeGreaterThan(0)
      arena.world.free()
    })
  }

  it('a robot is battered by a ram plow driven into it', () => {
    const arena = createArena(map)
    const seat = takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    facing(arena, seat, 40)
    seat.plowTicks = PLOW_TICKS
    // Steered at the robot all the way, as it rolls on.
    const [robot] = arena.robots
    const chase = (): typeof NEUTRAL_INPUT => {
      const { position, right } = seat.vehicle.frame
      const across = (robot!.position.x - position.x) * right.x + (robot!.position.z - position.z) * right.z
      return { ...NEUTRAL_INPUT, throttle: 1, steer: Math.max(Math.min(across * 0.3, 1), -1) }
    }
    for (let i = 0; i < 60 * 4 && robot!.damage === 0; i++) advance(arena, (one) => (one === seat ? chase() : NEUTRAL_INPUT))
    for (let i = 0; i < 30; i++) advance(arena, (one) => (one === seat ? chase() : NEUTRAL_INPUT))
    expect(robot!.damage).toBeGreaterThan(0.05)
    arena.world.free()
  })

  for (const kind of ['bomb', 'mine'] as LooseKind[]) {
    it(`a robot sets off a ${kind} it rolls onto and takes the blast, and so does a car nobody drives`, () => {
      const arena = createArena(map)
      takeSeat(arena, 0, 'sportsCar')
      const npc = seatNpc(arena, 7)!
      advance(arena)
      const [robot] = arena.robots
      for (const at of [robot!.position, npc.vehicle.frame.position]) {
        arena.loose.push({ id: arena.looseNext++, kind, owner: 0, power: 1, from: { ...at }, position: { ...at }, bornTick: arena.tick - 1000 })
      }
      const before = npc.vehicle.damage
      advance(arena)
      expect(arena.loose.filter((loose) => loose.kind === kind)).toHaveLength(0)
      expect(robot!.damage).toBeCloseTo(BOMB_DAMAGE / MACHINE_TOUGHNESS, 5)
      expect(npc.vehicle.damage).toBeGreaterThan(before)
      arena.world.free()
    })
  }
})

describe('the spider', () => {
  // A full-size island, as the game plays on: a small one is all cities to a spider.
  let island: TerrainMap
  beforeAll(async () => {
    await initPhysics()
    island = generateTerrain(3, TEST_ISLANDS)
  }, 120_000)

  it('a spider strides across the island and lets a bomb fall every thirty seconds, but not in a mirror', () => {
    for (const mirror of [false, true]) {
      const arena = createArena(island)
      arena.mirror = mirror
      takeSeat(arena, 0, 'sportsCar')
      const [spider] = arena.spiders
      const start = { ...spider!.position }
      for (let i = 0; i < SPIDER_BOMB_TICKS + 5; i++) advance(arena)
      const walked = Math.hypot(spider!.position.x - start.x, spider!.position.z - start.z)
      expect(walked).toBeGreaterThan(SPIDER_SPEED * 5)
      expect(walked).toBeLessThanOrEqual((SPIDER_SPEED * SPIDER_BOMB_TICKS) / 60 + 1)
      const bombs = arena.loose.filter((loose) => loose.kind === 'bomb')
      expect(bombs).toHaveLength(mirror ? 0 : 1)
      arena.world.free()
    }
  }, 60_000)

  it('a spider takes a rocket as the robots do, and once brought down comes back whole somewhere else', () => {
    const arena = createArena(island)
    takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    const [spider] = arena.spiders
    const middle = { x: spider!.position.x, y: spider!.position.y + SPIDER_BELLY + SPIDER_BODY.halfHeight, z: spider!.position.z }
    rocketAt(arena, SPIDER_TARGET + spider!.id, middle)
    advance(arena)
    expect(spider!.damage).toBeCloseTo(ROCKET_DAMAGE / MACHINE_TOUGHNESS, 5)
    spider!.damage = 1 - 1e-6
    const before = { ...spider!.position }
    rocketAt(arena, SPIDER_TARGET + spider!.id, { x: spider!.position.x, y: spider!.position.y + SPIDER_BELLY + SPIDER_BODY.halfHeight, z: spider!.position.z })
    advance(arena)
    expect(spider!.deaths).toBe(1)
    expect(spider!.damage).toBe(0)
    expect(Math.hypot(spider!.position.x - before.x, spider!.position.z - before.z)).toBeGreaterThan(20)
    arena.world.free()
  }, 60_000)

  it('a spider keeps out of the cities', () => {
    const arena = createArena(island)
    const [spider] = arena.spiders
    expect(island.districts.length).toBeGreaterThan(0)
    let nearest = Infinity
    for (let i = 0; i < 60 * 60 * 10; i++) {
      advance(arena)
      if (i % 30 !== 0) continue
      for (const city of island.districts) {
        nearest = Math.min(nearest, Math.hypot(spider!.position.x - city.cx, spider!.position.z - city.cz) - city.radius - city.suburbWidth)
      }
    }
    expect(nearest).toBeGreaterThan(0)
    arena.world.free()
  }, 120_000)
})
