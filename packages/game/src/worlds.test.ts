import { uprightRotation, v3 } from '@buggies/physics'
import { generateWorld, heightOver, nearestGridPoint, roofOver, sphereHeight, tangentFrame, upOf, worldId, type World, type WorldKind } from '@buggies/terrain'
import { worldGravity } from '@buggies/vehicle'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, initPhysics, isLost, respawn, takeSeat } from './index.ts'
import { apart } from './test-planet.ts'

const SEED = 7
const KINDS: readonly WorldKind[] = ['mars', 'neptune', 'jupiter', 'venus', 'mercury']
const worlds = new Map<WorldKind, World>()

describe('the worlds past the planet', () => {
  beforeAll(async () => {
    await initPhysics()
    for (const kind of KINDS) worlds.set(kind, generateWorld(worldId(SEED, kind)))
  }, 120_000)

  for (const kind of KINDS) {
    it(`set a car down on ${kind} where it starts, on its wheels and dry, where it drives off`, () => {
      const map = worlds.get(kind)!
      const arena = createArena(map)
      const seat = takeSeat(arena, 0, 'sportsCar')
      for (let i = 0; i < 90; i++) advance(arena)
      expect(seat.vehicle.groundedCount).toBeGreaterThan(0)
      expect(seat.vehicle.wrecked).toBe(false)
      expect(seat.submersion).toBe(0)
      expect(isLost(arena, seat)).toBe(false)
      const at = seat.vehicle.frame.position
      expect(heightOver(map, at) - sphereHeight({ ...map.ground, heights: map.bored }, upOf(at))).toBeLessThan(2)
      expect(heightOver(map, at)).toBeLessThan(roofOver(map, at))
      const start = { ...at }
      for (let i = 0; i < 60 * 2; i++) advance(arena, () => ({ ...NEUTRAL_INPUT, throttle: 1 }))
      expect(apart(seat.vehicle.frame.position, start)).toBeGreaterThan(8)
      expect(isLost(arena, seat)).toBe(false)
      arena.world.free()
    })
  }

  it('pull weakly on Mercury, and no saucers fly where there is no sky', () => {
    const mercury = createArena(worlds.get('mercury')!)
    const mars = createArena(worlds.get('mars')!)
    expect(worldGravity(mercury.world)).toBeLessThan(worldGravity(mars.world))
    expect(mercury.ufos).toHaveLength(0)
    expect(createArena(worlds.get('neptune')!).ufos).toHaveLength(0)
    expect(mars.ufos.length).toBeGreaterThan(0)
  })

  it('hold a car upside down to a cavern roof on Mercury, where it would fall anywhere else', () => {
    const map = worlds.get('mercury')!
    const cavern = map.districts[0]!
    const roof = map.roof[nearestGridPoint(map, cavern.center)]!
    const arena = createArena(map)
    const seat = takeSeat(arena, 0, 'sportsCar')
    // On the roof, wheels up against it, its way up turned down toward the floor.
    const down = { x: -cavern.center.x, y: -cavern.center.y, z: -cavern.center.z }
    const r = map.radius + roof
    const position = v3(cavern.center.x * r, cavern.center.y * r, cavern.center.z * r)
    respawn(seat, { position, up: down, rotation: uprightRotation(down, tangentFrame(cavern.center).east) })
    for (let i = 0; i < 60 * 3; i++) advance(arena)
    expect(seat.vehicle.groundedCount).toBeGreaterThan(1)
    expect(heightOver(map, seat.vehicle.frame.position)).toBeGreaterThan(roof - 3)
    // And it drives along the roof.
    const start = { ...seat.vehicle.frame.position }
    for (let i = 0; i < 60 * 2; i++) advance(arena, () => ({ ...NEUTRAL_INPUT, throttle: 1 }))
    expect(apart(seat.vehicle.frame.position, start)).toBeGreaterThan(8)
    expect(heightOver(map, seat.vehicle.frame.position)).toBeGreaterThan(roof - 12)
    arena.world.free()
  })
})
