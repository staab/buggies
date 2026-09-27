import type { Vec3 } from '@buggies/physics'
import { PLANET_TERRAIN, generateTerrain, tangentFrame, upOf, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BANANA_SLOTS,
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
  spawnHere,
  takeSeat,
} from './index.ts'
import { apart, between, lifted } from './test-planet.ts'


let map: TerrainMap

/** How far a point is from the nearest point of any arterial. */
function offArterials(island: TerrainMap, at: Vec3): number {
  let nearest = Infinity
  for (const road of island.world!.roads) {
    if (road.kind !== 'arterial') continue
    for (const point of road.points) nearest = Math.min(nearest, between(point, at))
  }
  return nearest
}

describe('cars nobody drives', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, PLANET_TERRAIN)
  }, 60_000)

  it('drive slowly along the arterials, staying on the road', () => {
    const arena = createArena(map)
    const seat = seatNpc(arena, 7)!
    expect(seat).not.toBeNull()
    expect(seat.npc).toBe(true)
    // The saucer takes whatever car it finds, one nobody drives too: kept out of it here.
    for (const ufo of arena.ufos) ufo.cooldownTicks = Number.POSITIVE_INFINITY
    const start = { ...seat.vehicle.frame.position }
    expect(offArterials(map, start)).toBeLessThan(3)
    const input = createVehicleInput()
    let fastest = 0
    let wandered = 0
    for (let i = 0; i < 60 * 30; i++) {
      advance(arena, (driven) => (driven === seat ? npcInput(arena, seat, input) : input))
      fastest = Math.max(fastest, seat.vehicle.speed)
      if (offArterials(map, seat.vehicle.frame.position) > 10) wandered++
    }
    expect(apart(seat.vehicle.frame.position, start)).toBeGreaterThan(50)
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
      respawn(npc, spawnHere(lifted(position, -PICKUP_HEIGHT), tangentFrame(upOf(position)).east))
      for (let i = 0; i < 10; i++) advance(arena)
      expect(pickupOut(arena.pickups[slot]!, arena.tick)).toBe(true)
    }
    expect(npc.score).toBe(0)
    expect(npc.weapon).toBe('none')
    expect(npc.vehicle.damage).toBeGreaterThanOrEqual(0.5)
    arena.world.free()
  })
})
