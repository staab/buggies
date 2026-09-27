import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BANANA_SLOTS,
  DURABILITY,
  NPC_FRAGILITY,
  PICKUP_HEIGHT,
  advance,
  createArena,
  createVehicleInput,
  harm,
  initPhysics,
  npcInput,
  pickupOut,
  respawn,
  seatNpc,
  takeSeat,
} from './index.ts'

let map: TerrainMap

/** How far a point is from the nearest point of any arterial. */
function offArterials(island: TerrainMap, x: number, z: number): number {
  let nearest = Infinity
  for (const road of island.roads) {
    if (road.kind !== 'arterial') continue
    for (const point of road.points) nearest = Math.min(nearest, Math.hypot(point.x - x, point.z - z))
  }
  return nearest
}

describe('cars nobody drives', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { size: 513 })
  }, 60_000)

  it('drive slowly along the arterials, staying on the road', () => {
    const arena = createArena(map)
    const seat = seatNpc(arena, 7)!
    expect(seat).not.toBeNull()
    expect(seat.npc).toBe(true)
    const start = { ...seat.vehicle.frame.position }
    expect(offArterials(map, start.x, start.z)).toBeLessThan(3)
    const input = createVehicleInput()
    let fastest = 0
    let wandered = 0
    for (let i = 0; i < 60 * 30; i++) {
      advance(arena, (driven) => (driven === seat ? npcInput(arena, seat, input) : input))
      fastest = Math.max(fastest, seat.vehicle.speed)
      const { x, z } = seat.vehicle.frame.position
      if (offArterials(map, x, z) > 10) wandered++
    }
    const { x, z } = seat.vehicle.frame.position
    expect(Math.hypot(x - start.x, z - start.z)).toBeGreaterThan(50)
    expect(fastest).toBeLessThan(18)
    expect(wandered).toBeLessThan(60 * 3)
    expect(seat.vehicle.wrecked).toBe(false)
    arena.world.free()
  }, 60_000)

  it('are fragile: a weapon takes three times as much of one as of another car', () => {
    const arena = createArena(map)
    const npc = seatNpc(arena, 7)!
    const car = takeSeat(arena, 0, npc.profile)
    advance(arena)
    harm(npc, 0.3)
    harm(car, 0.3)
    expect(npc.vehicle.damage / car.vehicle.damage).toBeCloseTo(NPC_FRAGILITY, 5)
    expect(car.vehicle.damage).toBeGreaterThan(0)
    arena.world.free()
  })

  it('take no bananas and no health packs, and carry no weapons', () => {
    const arena = createArena(map)
    const npc = seatNpc(arena, 7)!
    advance(arena)
    npc.vehicle.damage = 0.5
    for (const slot of [3, BANANA_SLOTS + 3]) {
      const { position } = arena.pickups[slot]!
      respawn(npc, { position: { x: position.x, y: position.y - PICKUP_HEIGHT, z: position.z }, yaw: 0 })
      for (let i = 0; i < 10; i++) advance(arena)
      expect(pickupOut(arena.pickups[slot]!, arena.tick)).toBe(true)
    }
    expect(npc.score).toBe(0)
    expect(npc.weapon).toBe('none')
    expect(npc.vehicle.damage).toBeGreaterThanOrEqual(0.5)
    arena.world.free()
  })
})
