import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, initPhysics, putPropBack, takeSeat, type VehicleInput } from './index.ts'

let map: TerrainMap
const DRIVE: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }

describe('the props', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(3)
  }, 60_000)

  it('stand where the map has them, and come to rest and sleep', () => {
    const arena = createArena(map)
    expect(arena.props.length).toBeGreaterThan(10)
    for (let i = 0; i < 120; i++) advance(arena)
    let asleep = 0
    for (const prop of arena.props) {
      const { x, y, z } = prop.body.translation()
      // A bale may roll a little way down its field, a cone slide a little on a cambered road.
      expect(Math.hypot(x - prop.home.x, z - prop.home.z)).toBeLessThan(4)
      expect(y).toBeGreaterThan(prop.home.bottom - 0.5)
      if (prop.body.isSleeping()) asleep += 1
    }
    expect(asleep).toBeGreaterThan(arena.props.length * 0.6)
    arena.world.free()
  })

  it('a car driven into a cone sends it flying', () => {
    const arena = createArena(map)
    const cone = arena.props.find((prop) => prop.kind === 'cone')
    expect(cone).toBeDefined()
    const seat = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 30; i++) advance(arena)
    // The cone set down in the road a little way ahead of the car, which then drives at it.
    const { forward, position } = seat.vehicle.frame
    const ahead = 12
    cone!.body.setTranslation({ x: position.x + forward.x * ahead, y: position.y + 0.5, z: position.z + forward.z * ahead }, true)
    cone!.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    for (let i = 0; i < 20; i++) advance(arena)
    const before = { ...cone!.body.translation() }
    for (let i = 0; i < 180; i++) advance(arena, () => DRIVE)
    const after = cone!.body.translation()
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(2)
    arena.world.free()
  })

  it('a cone knocked onto its side comes to rest rather than rolling in circles', () => {
    for (const spin of [{ x: 0, y: 4, z: 6 }, { x: 3, y: 0, z: -5 }, { x: -6, y: 2, z: 0 }, { x: 0, y: -8, z: 2 }]) {
      const arena = createArena(map)
      const cone = arena.props.find((prop) => prop.kind === 'cone')!
      const { home } = cone
      // Laid on its side a little above where it stood, and set spinning.
      cone.body.setTranslation({ x: home.x, y: home.bottom + 0.6, z: home.z }, true)
      cone.body.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }, true)
      cone.body.setAngvel(spin, true)
      for (let i = 0; i < 60 * 5 && !cone.body.isSleeping(); i++) advance(arena)
      expect(cone.body.isSleeping()).toBe(true)
      arena.world.free()
    }
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
