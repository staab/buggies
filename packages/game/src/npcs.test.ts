import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  DURABILITY,
  NPC_FRAGILITY,
  advance,
  createArena,
  createVehicleInput,
  harm,
  initPhysics,
  npcInput,
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
    const car = takeSeat(arena, 0, 'smallCar')
    advance(arena)
    harm(npc, 0.3)
    harm(car, 0.3)
    expect(car.vehicle.damage).toBeCloseTo(0.3 / DURABILITY, 5)
    expect(npc.vehicle.damage).toBeCloseTo((0.3 * NPC_FRAGILITY) / DURABILITY, 5)
    arena.world.free()
  })
})
