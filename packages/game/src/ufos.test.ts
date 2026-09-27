import { PLANET_TERRAIN, atHeight, generateTerrain, heightOver, tangentFrame, upOf, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  UFO_COOLDOWN_TICKS,
  UFO_CRUISE,
  UFOS,
  UFO_CARRY_SPEED,
  advance,
  createArena,
  initPhysics,
  takeSeat,
  type Arena,
  type Ufo,
} from './index.ts'
import { ahead, apart, over } from './test-planet.ts'

/** Set a saucer down this far east of a point, at the height it is at. */
function eastOf(arena: Arena, ufo: Ufo, point: { x: number; y: number; z: number }, distance: number): void {
  const height = heightOver(arena.planet, ufo.position)
  const east = ahead(point, tangentFrame(upOf(point)).east, distance)
  atHeight(arena.planet, upOf(east), height, ufo.position)
}


let map: TerrainMap

describe('flying saucers', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, PLANET_TERRAIN)
  }, 60_000)

  it('cruise high over the island, then come down over a car, lift it up the beam and set it down somewhere else', () => {
    const arena = createArena(map)
    expect(arena.ufos).toHaveLength(UFOS)
    const [ufo] = arena.ufos
    const start = { ...ufo!.position }
    expect(heightOver(arena.planet, ufo!.position)).toBeGreaterThan(map.seaLevel + UFO_CRUISE - 1)
    const seat = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 60; i++) advance(arena)
    expect(apart(ufo!.position, start)).toBeGreaterThan(5)
    // Ready to take a car, it goes after this one, and takes it.
    ufo!.cooldownTicks = 0
    eastOf(arena, ufo!, seat.vehicle.frame.position, 60)
    const before = { ...seat.vehicle.frame.position }
    let lifted = -Infinity
    let fastest = 0
    let jump = 0
    let last = { ...before }
    let carried = false
    for (let i = 0; i < 60 * 90 && ufo!.abductions === 0; i++) {
      advance(arena)
      const now = seat.vehicle.frame.position
      if (ufo!.state === 'lift') lifted = Math.max(lifted, over(now, before))
      if (ufo!.state === 'carry') carried = true
      // Carried off under the saucer, never put somewhere else in a blink.
      jump = Math.max(jump, apart(now, last))
      const { linearVelocity } = seat.vehicle.frame
      const up = upOf(now)
      const rise = linearVelocity.x * up.x + linearVelocity.y * up.y + linearVelocity.z * up.z
      fastest = Math.max(fastest, linearVelocity.x ** 2 + linearVelocity.y ** 2 + linearVelocity.z ** 2 - rise * rise)
      last = { ...now }
    }
    expect(ufo!.abductions).toBe(1)
    expect(carried).toBe(true)
    expect(lifted).toBeGreaterThan(2)
    expect(jump).toBeLessThan(UFO_CARRY_SPEED / 60 + 0.5)
    expect(Math.sqrt(fastest)).toBeGreaterThan(UFO_CARRY_SPEED / 2)
    expect(apart(seat.vehicle.frame.position, before)).toBeGreaterThan(50)
    // Let down onto the road, and settled on it a moment later, whole.
    for (let i = 0; i < 120; i++) advance(arena)
    expect(seat.vehicle.wrecked).toBe(false)
    expect(seat.vehicle.groundedCount).toBeGreaterThan(0)
    expect(ufo!.state).toBe('roam')
    expect(ufo!.abductions).toBe(1)
    expect(ufo!.cooldownTicks).toBeGreaterThan(UFO_COOLDOWN_TICKS - 130)
    arena.world.free()
  }, 60_000)

  it('cannot take a car with its shield up', () => {
    const arena = createArena(map)
    const [ufo] = arena.ufos
    const seat = takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    seat.shieldTicks = 60 * 60
    ufo!.cooldownTicks = 0
    eastOf(arena, ufo!, seat.vehicle.frame.position, 20)
    for (let i = 0; i < 60 * 10; i++) {
      advance(arena)
      expect(ufo!.state === 'carry' || ufo!.state === 'lower').toBe(false)
    }
    expect(ufo!.state).toBe('roam')
    arena.world.free()
  }, 60_000)
})
