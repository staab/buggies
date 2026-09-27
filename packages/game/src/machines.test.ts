import { vdot, type Vec3 } from '@buggies/physics'
import { PLANET_TERRAIN, atHeight, generateTerrain, heightOver, tangentFrame, upOf, type TerrainMap } from '@buggies/terrain'
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
  spawnHere,
  takeSeat,
  type Arena,
  type LooseKind,
  type Seat,
} from './index.ts'
import { ahead, apart, lifted } from './test-planet.ts'


let map: TerrainMap

/** A rocket of this seat's set going right past a machine, after it: coming from two meters west of it, eastward. */
function rocketAt(arena: Arena, target: number, at: Vec3): void {
  const { east } = tangentFrame(upOf(at))
  arena.rockets.push({
    id: 1,
    owner: 0,
    target,
    position: ahead(at, east, -2),
    velocity: { x: east.x * 30, y: east.y * 30, z: east.z * 30 },
    bornTick: arena.tick,
    power: 1,
  })
}

describe('the robots and the saucers', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, PLANET_TERRAIN)
  }, 60_000)

  it('a robot takes a rocket as a car ten times tougher would, and once brought down comes back whole on another arterial', () => {
    const arena = createArena(map)
    takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    const [robot] = arena.robots
    rocketAt(arena, ROBOT_TARGET + robot!.id, lifted(robot!.position, 3))
    advance(arena)
    expect(arena.rockets).toHaveLength(0)
    expect(robot!.damage).toBeCloseTo(ROCKET_DAMAGE / MACHINE_TOUGHNESS, 5)
    expect(robot!.deaths).toBe(0)

    robot!.damage = 1 - 1e-6
    const before = { ...robot!.position }
    rocketAt(arena, ROBOT_TARGET + robot!.id, lifted(robot!.position, 3))
    advance(arena)
    expect(robot!.deaths).toBe(1)
    expect(robot!.damage).toBe(0)
    expect(arena.seats[0]!.robotKills).toBe(1)
    expect(apart(robot!.position, before)).toBeGreaterThan(20)
    expect(arena.planet.roads[robot!.road]!.kind).toBe('arterial')
    expect(apart(robot!.body.translation(), robot!.position)).toBeLessThan(0.5)
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
    expect(apart(ufo!.position, before)).toBeGreaterThan(20)
    expect(heightOver(arena.planet, ufo!.position)).toBeGreaterThan(map.seaLevel + UFO_CRUISE - 1)
    arena.world.free()
  })

  /** A car set down on a robot's road this far from it, facing it. */
  function facing(arena: Arena, seat: Seat, away: number): void {
    const [robot] = arena.robots
    const road = arena.planet.roads[robot!.road]!
    const near = road.points.find((point) => Math.abs(apart(point, robot!.position) - away) < 2)!
    respawn(seat, spawnHere(lifted(near, 1), { x: robot!.position.x - near.x, y: robot!.position.y - near.y, z: robot!.position.z - near.z }))
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
      const across = vdot({ x: robot!.position.x - position.x, y: robot!.position.y - position.y, z: robot!.position.z - position.z }, right)
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
    island = generateTerrain(3, PLANET_TERRAIN)
  }, 120_000)

  it('a spider strides across the island and lets a bomb fall every thirty seconds, but not in a mirror', () => {
    for (const mirror of [false, true]) {
      const arena = createArena(island)
      arena.mirror = mirror
      takeSeat(arena, 0, 'sportsCar')
      const [spider] = arena.spiders
      const start = { ...spider!.position }
      for (let i = 0; i < SPIDER_BOMB_TICKS + 5; i++) advance(arena)
      const walked = apart(spider!.position, start)
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
    rocketAt(arena, SPIDER_TARGET + spider!.id, lifted(spider!.position, SPIDER_BELLY + SPIDER_BODY.halfHeight))
    advance(arena)
    expect(spider!.damage).toBeCloseTo(ROCKET_DAMAGE / MACHINE_TOUGHNESS, 5)
    spider!.damage = 1 - 1e-6
    const before = { ...spider!.position }
    rocketAt(arena, SPIDER_TARGET + spider!.id, lifted(spider!.position, SPIDER_BELLY + SPIDER_BODY.halfHeight))
    advance(arena)
    expect(spider!.deaths).toBe(1)
    expect(spider!.damage).toBe(0)
    expect(apart(spider!.position, before)).toBeGreaterThan(20)
    arena.world.free()
  }, 60_000)

  it('a spider keeps out of the cities', () => {
    const arena = createArena(island)
    const [spider] = arena.spiders
    const { districts } = arena.planet
    expect(districts.length).toBeGreaterThan(0)
    let nearest = Infinity
    for (let i = 0; i < 60 * 60 * 10; i++) {
      advance(arena)
      if (i % 30 !== 0) continue
      for (const city of districts) {
        nearest = Math.min(nearest, apart(spider!.position, atHeight(arena.planet, city.center, 0)) - city.radius - city.suburbWidth)
      }
    }
    expect(nearest).toBeGreaterThan(0)
    arena.world.free()
  }, 120_000)
})
