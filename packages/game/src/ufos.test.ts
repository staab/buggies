import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  UFO_COOLDOWN_TICKS,
  UFO_CRUISE,
  UFOS,
  abduct,
  advance,
  createArena,
  initPhysics,
  takeSeat,
} from './index.ts'

let map: TerrainMap

describe('flying saucers', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { size: 513 })
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
    let taken = false
    for (let i = 0; i < 60 * 30 && !taken; i++) {
      advance(arena)
      if (ufo!.state === 'lift') lifted = Math.max(lifted, seat.vehicle.frame.position.y - before.y)
      taken = abduct(arena).includes(seat)
    }
    expect(taken).toBe(true)
    expect(lifted).toBeGreaterThan(2)
    const { x, z } = seat.vehicle.frame.position
    expect(Math.hypot(x - before.x, z - before.z)).toBeGreaterThan(50)
    expect(ufo!.state).toBe('roam')
    expect(ufo!.abductions).toBe(1)
    expect(ufo!.cooldownTicks).toBeGreaterThan(UFO_COOLDOWN_TICKS - 5)
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
      expect(abduct(arena)).toHaveLength(0)
    }
    expect(ufo!.state).toBe('roam')
    arena.world.free()
  }, 60_000)
})
