import { vdistance, vdot, type Vec3 } from '@buggies/physics'
import { generateMoon, generatePlanet, tangentFrame, upOf, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BOMB_DAMAGE,
  METEOR_DAMAGE,
  METEOR_EVERY_TICKS,
  METEOR_FALL_TICKS,
  METEOR_RANGE,
  advance,
  createArena,
  initPhysics,
  meteorAt,
  takeSeat,
} from './index.ts'
import { METEOR_HEIGHT, METEOR_SCATTER } from './meteors.ts'
import { ahead, apart, lifted } from './test-planet.ts'

describe('the meteors', () => {
  let moon: World
  let planet: World
  beforeAll(async () => {
    await initPhysics()
    moon = generateMoon(3)
    planet = generatePlanet(3)
  }, 120_000)

  it('come down near someone driving on the moon, every so often, and never on a planet or of a mirror', () => {
    for (const [world, mirror, falling] of [[moon, false, 1], [moon, true, 0], [planet, false, 0]] as const) {
      const arena = createArena(world)
      arena.mirror = mirror
      const seat = takeSeat(arena, 0, 'sportsCar')
      advance(arena)
      expect(arena.meteors).toHaveLength(falling)
      const meteor = arena.meteors[0]
      if (meteor !== undefined) {
        expect(apart(meteor.to, seat.vehicle.frame.position)).toBeLessThan(METEOR_SCATTER + 5)
        expect(vdistance(meteor.from, meteor.to)).toBeGreaterThan(METEOR_HEIGHT)
        // Halfway down, it is halfway along its line.
        const middle = meteorAt(meteor, meteor.bornTick + METEOR_FALL_TICKS / 2, { x: 0, y: 0, z: 0 })
        expect(vdistance(middle, meteor.to)).toBeCloseTo(vdistance(meteor.from, meteor.to) / 2, 3)
      }
      arena.world.free()
    }
  }, 60_000)

  it('blow up where they land, leaving a car out of reach alone, and hurting and throwing one at the middle', () => {
    const arena = createArena(moon)
    const seat = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 30; i++) advance(arena)
    const land = (to: Vec3): void => {
      arena.meteors.length = 0
      arena.meteors.push({ id: 1, from: lifted(to, METEOR_HEIGHT), to, bornTick: arena.tick - METEOR_FALL_TICKS + 1 })
      advance(arena)
      expect(arena.meteors).toHaveLength(0)
    }
    const at = seat.vehicle.frame.position
    land(ahead(at, tangentFrame(upOf(at)).east, METEOR_RANGE + 5))
    expect(seat.vehicle.damage).toBe(0)
    land({ ...at })
    // Half again what a bomb does to it: a third of a sports car's life is a bomb's.
    expect(seat.vehicle.damage).toBeCloseTo(METEOR_DAMAGE / BOMB_DAMAGE / 3, 2)
    const v = seat.vehicle.body.linvel()
    expect(vdot({ x: v.x, y: v.y, z: v.z }, upOf(seat.vehicle.frame.position))).toBeGreaterThan(3)
    // The next one is a while off.
    expect(METEOR_EVERY_TICKS).toBeGreaterThan(METEOR_FALL_TICKS)
    arena.world.free()
  }, 60_000)
})
