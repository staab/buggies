import { generateTerrain, type TerrainMap } from '@buggies/terrain'
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
} from './index.ts'

/** The test islands, laid out as when a seed picked at most eight: the maps these tests were written against. */
const TEST_ISLANDS = { islandsMost: 8 }

let map: TerrainMap

describe('flying saucers', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { ...TEST_ISLANDS, size: 513 })
  }, 60_000)

  it('cruise high over the island, then come down over a car, lift it up the beam and set it down somewhere else', () => {
    const arena = createArena(map)
    expect(arena.ufos).toHaveLength(UFOS)
    const [ufo] = arena.ufos
    const start = { ...ufo!.position }
    expect(ufo!.position.y).toBeGreaterThan(map.seaLevel + UFO_CRUISE - 1)
    const seat = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 60; i++) advance(arena)
    expect(Math.hypot(ufo!.position.x - start.x, ufo!.position.z - start.z)).toBeGreaterThan(5)
    // Ready to take a car, it goes after this one, and takes it.
    ufo!.cooldownTicks = 0
    ufo!.position.x = seat.vehicle.frame.position.x + 60
    ufo!.position.z = seat.vehicle.frame.position.z
    const before = { ...seat.vehicle.frame.position }
    let lifted = -Infinity
    let fastest = 0
    let jump = 0
    let last = { ...before }
    let carried = false
    for (let i = 0; i < 60 * 90 && ufo!.abductions === 0; i++) {
      advance(arena)
      const now = seat.vehicle.frame.position
      if (ufo!.state === 'lift') lifted = Math.max(lifted, now.y - before.y)
      if (ufo!.state === 'carry') carried = true
      // Carried off under the saucer, never put somewhere else in a blink.
      jump = Math.max(jump, Math.hypot(now.x - last.x, now.z - last.z))
      fastest = Math.max(fastest, seat.vehicle.frame.linearVelocity.x ** 2 + seat.vehicle.frame.linearVelocity.z ** 2)
      last = { ...now }
    }
    expect(ufo!.abductions).toBe(1)
    expect(carried).toBe(true)
    expect(lifted).toBeGreaterThan(2)
    expect(jump).toBeLessThan(UFO_CARRY_SPEED / 60 + 0.5)
    expect(Math.sqrt(fastest)).toBeGreaterThan(UFO_CARRY_SPEED / 2)
    const { x, z } = seat.vehicle.frame.position
    expect(Math.hypot(x - before.x, z - before.z)).toBeGreaterThan(50)
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
    ufo!.position.x = seat.vehicle.frame.position.x + 20
    ufo!.position.z = seat.vehicle.frame.position.z
    for (let i = 0; i < 60 * 10; i++) {
      advance(arena)
      expect(ufo!.state === 'carry' || ufo!.state === 'lower').toBe(false)
    }
    expect(ufo!.state).toBe('roam')
    arena.world.free()
  }, 60_000)
})
