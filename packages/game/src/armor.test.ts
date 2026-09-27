import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { DURABILITY, ROCKET_DAMAGE, advance, createArena, harm, initPhysics, takeSeat } from './index.ts'

/** The test islands, laid out as when a seed picked at most eight: the maps these tests were written against. */
const TEST_ISLANDS = { islandsMost: 8 }

let map: TerrainMap

describe('armor', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { ...TEST_ISLANDS, size: 513 })
  }, 60_000)

  it('a tougher car takes less of a rocket: the tank least, the sports car the whole of it, the go-kart the most', () => {
    const arena = createArena(map)
    const tank = takeSeat(arena, 0, 'tank')
    const sports = takeSeat(arena, 1, 'sportsCar')
    const kart = takeSeat(arena, 2, 'goKart')
    advance(arena)
    for (const seat of [tank, sports, kart]) {
      seat.vehicle.damage = 0
      harm(seat, ROCKET_DAMAGE)
    }
    expect(sports.vehicle.damage).toBeCloseTo(ROCKET_DAMAGE / DURABILITY, 5)
    expect(tank.vehicle.damage).toBeLessThan(sports.vehicle.damage / 2)
    expect(kart.vehicle.damage).toBeGreaterThan(sports.vehicle.damage)
    arena.world.free()
  })

  it("a client's mirror takes the damage but leaves the wreck to the server's word", () => {
    const arena = createArena(map)
    arena.mirror = true
    const seat = takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    seat.vehicle.damage = 0.99
    harm(seat, ROCKET_DAMAGE)
    advance(arena)
    expect(seat.vehicle.damage).toBe(1)
    expect(seat.vehicle.wrecked).toBe(false)
    arena.world.free()
  })
})
