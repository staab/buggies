import { DRY, generateTerrain, sampleHeight, waterLevelAt, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  arm,
  BANANA_REACH,
  NEUTRAL_INPUT,
  PICKUP_HEIGHT,
  PICKUP_RESPAWN_TICKS,
  PICKUP_SLOTS,
  SPILL_FAR,
  SPILL_FLIGHT_TICKS,
  SPILL_LIFE_TICKS,
  SPILL_MOST,
  SPILL_NEAR,
  advance,
  createArena,
  initPhysics,
  wreckVehicle,
  pickupOut,
  pickupSpot,
  respawn,
  looseOut,
  takeSeat,
  type Arena,
  type Loose,
} from './index.ts'

let map: TerrainMap

describe('pickups', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { size: 513 })
  }, 60_000)

  it('are put out over the map, above dry land or a road, the same every time', () => {
    const arena = createArena(map)
    expect(arena.pickups).toHaveLength(PICKUP_SLOTS)
    const extent = map.size * map.cellSize
    let onRoads = 0
    let moved = 0
    for (const [slot, pickup] of arena.pickups.entries()) {
      const { x, y, z } = pickup.position
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(extent)
      expect(z).toBeGreaterThan(0)
      expect(z).toBeLessThan(extent)
      // Floating over the ground, or over a road that may be above it.
      const ground = sampleHeight(map.heightfield, x, z)
      expect(y).toBeGreaterThanOrEqual(ground + PICKUP_HEIGHT - 0.5)
      const water = waterLevelAt(map.heightfield, arena.water, x, z)
      if (water !== DRY) expect(y).toBeGreaterThan(water + 1)
      if (Math.abs(y - ground - PICKUP_HEIGHT) > 0.5) onRoads++
      expect(pickupOut(pickup, 0)).toBe(true)
      // Worked out again, it is where it was; the slot's next is elsewhere.
      const again = pickupSpot(map, arena.water, slot, 0)
      expect(again).toEqual(pickup.position)
      const next = pickupSpot(map, arena.water, slot, 1)
      if (Math.hypot(next.x - x, next.z - z) > 5) moved++
    }
    // Some are up on decks; most are on the ground or on roads at grade.
    expect(onRoads).toBeLessThan(PICKUP_SLOTS / 2)
    // All but the odd coincidence of a slot's next pickup is well away from its first.
    expect(moved).toBeGreaterThan(PICKUP_SLOTS - 4)
    arena.world.free()
  })

  function driveOnto(arena: Arena, slot: number): ReturnType<typeof takeSeat> {
    const seat = takeSeat(arena, 0, 'sportsCar')
    const { position } = arena.pickups[slot]!
    // On the ground under the pickup, rolling, and armed already, so the
    // banana it takes is kept and counted rather than spent on a weapon.
    arm(seat, 'rocket')
    respawn(seat, { position: { x: position.x, y: position.y - PICKUP_HEIGHT, z: position.z }, yaw: 0 })
    return seat
  }

  it('bananas are taken by a vehicle that reaches them, for a point, and turn up elsewhere later', () => {
    const arena = createArena(map)
    const seat = driveOnto(arena, 3)
    const before = { ...arena.pickups[3]!.position }
    for (let i = 0; i < 30; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    expect(seat.vehicle.wrecked).toBe(false)
    const banana = arena.pickups[3]!
    expect(banana.generation).toBe(1)
    // Gone for a while, then out again somewhere else.
    expect(pickupOut(banana, arena.tick)).toBe(false)
    expect(banana.spawnTick).toBeGreaterThan(arena.tick)
    expect(banana.spawnTick - arena.tick).toBeLessThanOrEqual(PICKUP_RESPAWN_TICKS)
    expect(pickupOut(banana, banana.spawnTick)).toBe(true)
    expect(Math.hypot(banana.position.x - before.x, banana.position.z - before.z)).toBeGreaterThan(1)
    // The one taken is not taken again, and the rest were out of reach.
    for (let i = 0; i < 30; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    arena.world.free()
  })

  it('spill from a car blown up, flying out to land about the wreck for anyone to take', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    const b = takeSeat(arena, 1, 'sportsCar')
    a.score = 5
    wreckVehicle(a.vehicle, a.tuning)
    const wreck = { ...a.vehicle.frame.position }
    advance(arena, () => NEUTRAL_INPUT)
    expect(a.score).toBe(0)
    expect(arena.loose).toHaveLength(5)
    // Numbered as they come.
    expect(arena.loose.map((loose) => loose.id)).toEqual([0, 1, 2, 3, 4])
    for (const loose of arena.loose) {
      expect(loose.from.x).toBeCloseTo(wreck.x, 1)
      const flung = Math.hypot(loose.position.x - wreck.x, loose.position.z - wreck.z)
      expect(flung).toBeGreaterThanOrEqual(SPILL_NEAR - 0.5)
      expect(flung).toBeLessThanOrEqual(SPILL_FAR + 0.5)
      expect(loose.position.y).toBeCloseTo(
        sampleHeight(map.heightfield, loose.position.x, loose.position.z) + PICKUP_HEIGHT,
        3,
      )
      expect(looseOut(loose, arena.tick)).toBe(false)
      expect(looseOut(loose, loose.bornTick + SPILL_FLIGHT_TICKS)).toBe(true)
    }
    // Nothing more spills as the wreck lies there.
    advance(arena, () => NEUTRAL_INPUT)
    expect(arena.loose).toHaveLength(5)

    // Once one has landed, someone driving onto it takes it, and it is gone:
    // the one lying furthest from the others, so that it is the only one taken.
    const apart = (banana: Loose): number =>
      Math.min(
        ...arena.loose
          .filter((other) => other !== banana)
          .map((other) => Math.hypot(other.position.x - banana.position.x, other.position.z - banana.position.z)),
      )
    const target = arena.loose.reduce((best, banana) => (apart(banana) > apart(best) ? banana : best))
    expect(apart(target)).toBeGreaterThan(BANANA_REACH + 1)
    arm(b, 'rocket')
    respawn(b, { position: { x: target.position.x, y: target.position.y - PICKUP_HEIGHT, z: target.position.z }, yaw: 0 })
    for (let i = 0; i < 10; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(b.score).toBe(0)
    for (let i = 0; i < SPILL_FLIGHT_TICKS; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(b.score).toBe(1)
    expect(arena.loose).toHaveLength(4)
    expect(arena.loose.includes(target)).toBe(false)

    // The rest fade in time.
    arena.tick = arena.loose[0]!.bornTick + SPILL_LIFE_TICKS
    advance(arena, () => NEUTRAL_INPUT)
    expect(arena.loose).toHaveLength(0)

    // Only so many come out of one blast.
    a.score = SPILL_MOST + 10
    advance(arena, () => NEUTRAL_INPUT)
    expect(arena.loose).toHaveLength(SPILL_MOST)
    expect(arena.loose[0]!.id).toBe(5)
    arena.world.free()
  })

  it('are not taken by a wreck, and a score goes with the seat', () => {
    const arena = createArena(map)
    const seat = driveOnto(arena, 5)
    seat.vehicle.wrecked = true
    for (let i = 0; i < 10; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(0)
    expect(arena.pickups[5]!.generation).toBe(0)
    // Back on its wheels, and armed again, since a wreck is disarmed: the banana is taken and kept.
    seat.vehicle.wrecked = false
    arm(seat, 'rocket')
    for (let i = 0; i < 10; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    // Sitting down afresh starts from nothing.
    takeSeat(arena, 0, 'tank')
    expect(seat.score).toBe(0)
    arena.world.free()
  })
})
