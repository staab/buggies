import { DRY, generateTerrain, sampleHeight, waterLevelAt, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BANANA_HEIGHT,
  BANANA_RESPAWN_TICKS,
  BANANA_SLOTS,
  NEUTRAL_INPUT,
  advance,
  bananaOut,
  bananaSpot,
  createArena,
  initPhysics,
  respawn,
  takeSeat,
  type Arena,
} from './index.ts'

let map: TerrainMap

describe('bananas', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { size: 513 })
  }, 60_000)

  it('are put out over the map, above dry land or a road, the same every time', () => {
    const arena = createArena(map)
    expect(arena.bananas).toHaveLength(BANANA_SLOTS)
    const extent = map.size * map.cellSize
    let onRoads = 0
    let moved = 0
    for (const [slot, banana] of arena.bananas.entries()) {
      const { x, y, z } = banana.position
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(extent)
      expect(z).toBeGreaterThan(0)
      expect(z).toBeLessThan(extent)
      // Floating over the ground, or over a road that may be above it.
      const ground = sampleHeight(map.heightfield, x, z)
      expect(y).toBeGreaterThanOrEqual(ground + BANANA_HEIGHT - 0.5)
      const water = waterLevelAt(map.heightfield, arena.water, x, z)
      if (water !== DRY) expect(y).toBeGreaterThan(water + 1)
      if (Math.abs(y - ground - BANANA_HEIGHT) > 0.5) onRoads++
      expect(bananaOut(banana, 0)).toBe(true)
      // Worked out again, it is where it was; the slot's next is elsewhere.
      const again = bananaSpot(map, arena.water, slot, 0)
      expect(again).toEqual(banana.position)
      const next = bananaSpot(map, arena.water, slot, 1)
      if (Math.hypot(next.x - x, next.z - z) > 5) moved++
    }
    // Some are up on decks; most are on the ground or on roads at grade.
    expect(onRoads).toBeLessThan(BANANA_SLOTS / 2)
    // All but the odd coincidence of a slot's next banana is well away from its first.
    expect(moved).toBeGreaterThan(BANANA_SLOTS - 4)
    arena.world.free()
  })

  function driveOnto(arena: Arena, slot: number): ReturnType<typeof takeSeat> {
    const seat = takeSeat(arena, 0, 'sportsCar')
    const { position } = arena.bananas[slot]!
    // On the ground under the banana, rolling.
    respawn(seat, { position: { x: position.x, y: position.y - BANANA_HEIGHT, z: position.z }, yaw: 0 })
    return seat
  }

  it('are taken by a vehicle that reaches them, for a point, and turn up elsewhere later', () => {
    const arena = createArena(map)
    const seat = driveOnto(arena, 3)
    const before = { ...arena.bananas[3]!.position }
    for (let i = 0; i < 30; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    const banana = arena.bananas[3]!
    expect(banana.generation).toBe(1)
    // Gone for a while, then out again somewhere else.
    expect(bananaOut(banana, arena.tick)).toBe(false)
    expect(banana.spawnTick).toBeGreaterThan(arena.tick)
    expect(banana.spawnTick - arena.tick).toBeLessThanOrEqual(BANANA_RESPAWN_TICKS)
    expect(bananaOut(banana, banana.spawnTick)).toBe(true)
    expect(Math.hypot(banana.position.x - before.x, banana.position.z - before.z)).toBeGreaterThan(1)
    // The one taken is not taken again, and the rest were out of reach.
    for (let i = 0; i < 30; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    arena.world.free()
  })

  it('are not taken by a wreck, and a score goes with the seat', () => {
    const arena = createArena(map)
    const seat = driveOnto(arena, 5)
    seat.vehicle.wrecked = true
    for (let i = 0; i < 10; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(0)
    expect(arena.bananas[5]!.generation).toBe(0)
    seat.vehicle.wrecked = false
    for (let i = 0; i < 10; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    // Sitting down afresh starts from nothing.
    takeSeat(arena, 0, 'tank')
    expect(seat.score).toBe(0)
    arena.world.free()
  })
})
