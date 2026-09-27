import { generateTerrain, sampleHeight, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, initPhysics, isLost, respawn, takeSeat, type Arena, type Seat } from './index.ts'

/** The test islands, laid out as when a seed picked at most eight: the maps these tests were written against. */
const TEST_ISLANDS = { islandsMost: 8 }

let map: TerrainMap

/** Somewhere out at sea, deep, with open water all around. */
function openSea(island: TerrainMap): { x: number; z: number } {
  const extent = island.size * island.cellSize
  for (let x = 60; x < extent - 60; x += 20) {
    for (let z = 60; z < extent - 60; z += 20) {
      let open = true
      for (let dx = -60; dx <= 60 && open; dx += 20) {
        for (let dz = -60; dz <= 60 && open; dz += 20) open = sampleHeight(island.heightfield, x + dx, z + dz) < island.seaLevel - 6
      }
      if (open) return { x, z }
    }
  }
  throw new Error('no open sea')
}

function putToSea(arena: Arena, seat: Seat): void {
  const { x, z } = openSea(arena.map)
  respawn(seat, { position: { x, y: arena.map.seaLevel + 1, z }, yaw: 0 })
}

describe('the amphibian', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { ...TEST_ISLANDS, size: 513 })
  }, 60_000)

  it('floats at sea, is driven along the water by its throttle, and is never taken for lost there, where a car sinks', () => {
    const arena = createArena(map)
    const boat = takeSeat(arena, 0, 'amphibian')
    const car = takeSeat(arena, 1, 'sportsCar')
    advance(arena)
    putToSea(arena, boat)
    putToSea(arena, car)
    car.vehicle.body.setTranslation({ ...car.vehicle.frame.position, x: car.vehicle.frame.position.x + 30 }, true)
    for (let i = 0; i < 60 * 4; i++) advance(arena)
    // Afloat: riding high in the water, upright, and not lost.
    expect(boat.vehicle.frame.position.y).toBeGreaterThan(map.seaLevel - 0.5)
    expect(boat.vehicle.frame.position.y).toBeLessThan(map.seaLevel + 1.5)
    expect(boat.vehicle.frame.up.y).toBeGreaterThan(0.95)
    expect(isLost(arena, boat)).toBe(false)
    expect(isLost(arena, car)).toBe(true)
    // Under way on the water.
    const start = { ...boat.vehicle.frame.position }
    for (let i = 0; i < 60 * 5; i++) advance(arena, (seat) => (seat === boat ? { ...NEUTRAL_INPUT, throttle: 1 } : NEUTRAL_INPUT))
    expect(Math.hypot(boat.vehicle.frame.position.x - start.x, boat.vehicle.frame.position.z - start.z)).toBeGreaterThan(25)
    // And turned by its steering, briskly: a good way round in a second and a half.
    const heading = Math.atan2(boat.vehicle.frame.forward.x, boat.vehicle.frame.forward.z)
    for (let i = 0; i < 90; i++) advance(arena, (seat) => (seat === boat ? { ...NEUTRAL_INPUT, throttle: 1, steer: 1 } : NEUTRAL_INPUT))
    const turned = Math.atan2(boat.vehicle.frame.forward.x, boat.vehicle.frame.forward.z)
    expect(Math.abs(Math.atan2(Math.sin(turned - heading), Math.cos(turned - heading)))).toBeGreaterThan(1.2)
    expect(boat.vehicle.frame.up.y).toBeGreaterThan(0.9)
    arena.world.free()
  })

  it('burns the car ahead with its own laser while its key is held', () => {
    const arena = createArena(map)
    const boat = takeSeat(arena, 0, 'amphibian')
    const car = takeSeat(arena, 1, 'sportsCar')
    advance(arena)
    const { position, forward } = boat.vehicle.frame
    respawn(car, { position: { x: position.x + forward.x * 20, y: position.y + 0.5, z: position.z + forward.z * 20 }, yaw: 0 })
    for (let i = 0; i < 20; i++) advance(arena)
    for (let i = 0; i < 60; i++) advance(arena, (seat) => (seat === boat ? { ...NEUTRAL_INPUT, ability: true } : NEUTRAL_INPUT))
    expect(car.vehicle.damage).toBeGreaterThan(0)
    expect(arena.shots.some((shot) => shot.owner === boat.id && shot.kind === 'laser')).toBe(true)
    arena.world.free()
  })
})
