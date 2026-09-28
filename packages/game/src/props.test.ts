import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, initPhysics, putPropBack, takeSeat, type VehicleInput } from './index.ts'

/** The test islands, laid out as when a seed picked at most eight: the maps these tests were written against. */
const TEST_ISLANDS = { islandsMost: 8 }

let map: TerrainMap
const DRIVE: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }

describe('the props', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(3, TEST_ISLANDS)
  }, 60_000)

  it('stand where the map has them, and come to rest and sleep', () => {
    const arena = createArena(map)
    expect(arena.props.length).toBeGreaterThan(0)
    for (let i = 0; i < 120; i++) advance(arena)
    let asleep = 0
    for (const prop of arena.props) {
      const { x, y, z } = prop.body.translation()
      expect(Math.hypot(x - prop.home.x, z - prop.home.z)).toBeLessThan(4)
      expect(y).toBeGreaterThan(prop.home.bottom - 0.5)
      if (prop.body.isSleeping()) asleep += 1
    }
    expect(asleep).toBeGreaterThan(arena.props.length * 0.6)
    arena.world.free()
  })

  it('a tank driven into a crate sends it flying', () => {
    const arena = createArena(map)
    const crate = arena.props.find((prop) => prop.kind === 'crate')
    expect(crate).toBeDefined()
    const seat = takeSeat(arena, 0, 'tank')
    for (let i = 0; i < 30; i++) advance(arena)
    // Up to speed first, then the crate set down in the road just ahead of the car, which drives on at it.
    for (let i = 0; i < 90; i++) advance(arena, () => DRIVE)
    const { forward, position } = seat.vehicle.frame
    const ahead = 12
    crate!.body.setTranslation({ x: position.x + forward.x * ahead, y: position.y + 0.3, z: position.z + forward.z * ahead }, true)
    crate!.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    const before = { ...crate!.body.translation() }
    for (let i = 0; i < 90; i++) advance(arena, () => DRIVE)
    const after = crate!.body.translation()
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(2)
    arena.world.free()
  })

  it('a prop off the map is put back where it started', () => {
    const arena = createArena(map)
    const prop = arena.props[0]!
    prop.body.setTranslation({ x: prop.home.x, y: -200, z: prop.home.z }, true)
    advance(arena)
    const { x, y, z } = prop.body.translation()
    expect(Math.hypot(x - prop.home.x, z - prop.home.z)).toBeLessThan(0.01)
    expect(y).toBeGreaterThan(prop.home.bottom)
    prop.body.setTranslation({ x: -50, y: prop.home.bottom + 1, z: 10 }, true)
    putPropBack(prop)
    expect(prop.body.translation().x).toBeCloseTo(prop.home.x, 2)
    arena.world.free()
  })
})
