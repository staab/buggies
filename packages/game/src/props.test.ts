import { generatePlanet, type World } from '@buggies/terrain'
import type { Vec3 } from '@buggies/physics'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, initPhysics, putPropBack, takeSeat, type VehicleInput } from './index.ts'


let map: World
const DRIVE: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }

/** The way up at a point: away from the planet's middle. */
function upOf(point: Vec3): Vec3 {
  const length = Math.hypot(point.x, point.y, point.z)
  return { x: point.x / length, y: point.y / length, z: point.z / length }
}

/** A point this far up from another. */
function lifted(point: Vec3, rise: number): Vec3 {
  const up = upOf(point)
  return { x: point.x + up.x * rise, y: point.y + up.y * rise, z: point.z + up.z * rise }
}

/** How far apart two points are along the ground, leaving out how much higher one stands. */
function apart(a: Vec3, b: Vec3): number {
  const up = upOf(b)
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  const rise = dx * up.x + dy * up.y + dz * up.z
  return Math.hypot(dx - up.x * rise, dy - up.y * rise, dz - up.z * rise)
}

/** How high a point stands over another, along the way up there. */
function over(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x, a.y, a.z) - Math.hypot(b.x, b.y, b.z)
}

describe('the props', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(3)
  }, 60_000)

  it('stand where the map has them, and come to rest and sleep', () => {
    const arena = createArena(map)
    expect(arena.props.length).toBeGreaterThan(10)
    for (let i = 0; i < 120; i++) advance(arena)
    let asleep = 0
    for (const prop of arena.props) {
      const at = prop.body.translation()
      // A barrel may roll a little way down a slope.
      expect(apart(at, prop.home.at)).toBeLessThan(4)
      expect(over(at, prop.home.at)).toBeGreaterThan(-0.5)
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
    // Up to speed first, then the crate dropped at the height of the hull just ahead of the car, which drives on
    // into it before it lands: the tank rides high on its tracks, and something small on the road fits under it.
    for (let i = 0; i < 90; i++) advance(arena, () => DRIVE)
    const { forward, position } = seat.vehicle.frame
    const ahead = 5
    crate!.body.setTranslation(lifted({ x: position.x + forward.x * ahead, y: position.y + forward.y * ahead, z: position.z + forward.z * ahead }, 0.3), true)
    crate!.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    const before = { ...crate!.body.translation() }
    for (let i = 0; i < 90; i++) advance(arena, () => DRIVE)
    expect(apart(crate!.body.translation(), before)).toBeGreaterThan(2)
    arena.world.free()
  })

  it('a prop sunk out of reach is put back where it started', () => {
    const arena = createArena(map)
    const prop = arena.props[0]!
    // Sunk far into the planet, under the sea floor.
    prop.body.setTranslation(lifted(prop.home.at, -200), true)
    advance(arena)
    expect(apart(prop.body.translation(), prop.home.at)).toBeLessThan(0.01)
    expect(over(prop.body.translation(), prop.home.at)).toBeGreaterThan(0)
    prop.body.setTranslation(lifted(prop.home.at, 30), true)
    putPropBack(prop)
    expect(over(prop.body.translation(), prop.home.at)).toBeLessThan(1)
    arena.world.free()
  })
})
