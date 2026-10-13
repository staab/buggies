import { uprightRotation, v3, type Vec3 } from '@buggies/physics'
import { TUBE_SIDES, generateWorld, heightOver, nearestGridPoint, roofOver, sphereHeight, tangentFrame, upOf, worldId, type World, type WorldKind } from '@buggies/terrain'
import { worldGravity } from '@buggies/vehicle'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, initPhysics, isLost, respawn, takeSeat } from './index.ts'
import { apart, between } from './test-planet.ts'

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

  it("drives a car out of a cavern on Mercury, through a tunnel's mouth and on down the tube, never thrown or stopped", () => {
    const map = worlds.get('mercury')!
    const tube = map.tubes[0]!
    const ringOf = (ring: number): Vec3 => {
      // The bottom of a ring of the tube: a quarter turn short of the way round, under its middle.
      const k = (ring * TUBE_SIDES + (TUBE_SIDES * 3) / 4) * 3
      return v3(tube.positions[k]!, tube.positions[k + 1]!, tube.positions[k + 2]!)
    }
    const mouth = ringOf(0)
    const inward = ringOf(1)
    const way = v3(inward.x - mouth.x, inward.y - mouth.y, inward.z - mouth.z)
    // A car's length back out in the cavern, on its floor, facing in.
    const length = Math.hypot(way.x, way.y, way.z)
    const back = upOf(v3(mouth.x - (way.x / length) * 12, mouth.y - (way.y / length) * 12, mouth.z - (way.z / length) * 12))
    const start = v3(back.x * (map.radius + sphereHeight(map.ground, back)), back.y * (map.radius + sphereHeight(map.ground, back)), back.z * (map.radius + sphereHeight(map.ground, back)))
    const arena = createArena(map)
    const seat = takeSeat(arena, 0, 'sportsCar')
    respawn(seat, { position: start, up: back, rotation: uprightRotation(back, way) })
    for (let i = 0; i < 30; i++) advance(arena)
    let grounded = 0
    for (let i = 0; i < 60 * 3; i++) {
      advance(arena, () => ({ ...NEUTRAL_INPUT, throttle: 0.7 }))
      if (seat.vehicle.groundedCount >= 2) grounded++
    }
    // Well down the tube: past its mouth, and along its line.
    const deep = ringOf(Math.min(12, tube.positions.length / 3 / TUBE_SIDES - 1))
    expect(apart(seat.vehicle.frame.position, mouth)).toBeGreaterThan(20)
    expect(apart(seat.vehicle.frame.position, deep)).toBeLessThan(apart(seat.vehicle.frame.position, mouth))
    expect(seat.vehicle.wrecked).toBe(false)
    expect(isLost(arena, seat)).toBe(false)
    expect(grounded).toBeGreaterThan(60 * 3 * 0.9)
    arena.world.free()
  })

  it("drives a car along a cavern's ceiling on Mercury into a tunnel, inside its tube, never over it where it is hidden", () => {
    const map = worlds.get('mercury')!
    const tube = map.tubes[0]!
    const rings = tube.positions.length / 3 / TUBE_SIDES
    const corner = (ring: number, side: number): Vec3 => {
      const k = (ring * TUBE_SIDES + side) * 3
      return v3(tube.positions[k]!, tube.positions[k + 1]!, tube.positions[k + 2]!)
    }
    // A ring's middle: halfway from its floor to its roof, a quarter turn round from its side either way.
    const middleOf = (ring: number): Vec3 => {
      const top = corner(ring, TUBE_SIDES / 4)
      const bottom = corner(ring, (TUBE_SIDES * 3) / 4)
      return v3((top.x + bottom.x) / 2, (top.y + bottom.y) / 2, (top.z + bottom.z) / 2)
    }
    // How far out of a ring's middle toward its wall a point is: under 1 inside the tube.
    const outOf = (ring: number, p: Vec3): number => {
      const middle = middleOf(ring)
      const offset = (to: Vec3): Vec3 => v3(to.x - middle.x, to.y - middle.y, to.z - middle.z)
      const side = offset(corner(ring, 0))
      const top = offset(corner(ring, TUBE_SIDES / 4))
      const d = offset(p)
      const share = (axis: Vec3): number => (d.x * axis.x + d.y * axis.y + d.z * axis.z) / (axis.x * axis.x + axis.y * axis.y + axis.z * axis.z)
      return Math.hypot(share(side), share(top))
    }
    const mouth = middleOf(0)
    const inward = middleOf(1)
    const way = upOf(v3(inward.x - mouth.x, inward.y - mouth.y, inward.z - mouth.z))
    const across = upOf(v3(way.y * mouth.z - way.z * mouth.y, way.z * mouth.x - way.x * mouth.z, way.x * mouth.y - way.y * mouth.x))
    for (const aside of [0, 9]) {
      // Back in the cavern, under its ceiling and off to one side, wheels up against it, facing the mouth.
      const out = upOf(v3(mouth.x - way.x * 22 + across.x * aside, mouth.y - way.y * 22 + across.y * aside, mouth.z - way.z * 22 + across.z * aside))
      const r = map.radius + roofOver(map, out) - 0.55
      const down = { x: -out.x, y: -out.y, z: -out.z }
      const arena = createArena(map)
      const seat = takeSeat(arena, 0, 'sportsCar')
      respawn(seat, { position: v3(out.x * r, out.y * r, out.z * r), up: down, rotation: uprightRotation(down, way) })
      let deepest = 0
      for (let i = 0; i < 60 * 8; i++) {
        advance(arena, () => ({ ...NEUTRAL_INPUT, throttle: i < 30 ? 0 : 0.6 }))
        // Past where its mouth flares, the car is never farther from the tube's middle than its wall.
        const p = seat.vehicle.frame.position
        const ring = Array.from({ length: rings }, (_, k) => k).reduce((best, k) => (between(p, middleOf(k)) < between(p, middleOf(best)) ? k : best))
        if (ring < 8 || ring > rings - 9 || between(p, middleOf(ring)) > 30) continue
        deepest = Math.max(deepest, ring)
        expect(outOf(ring, p), `${aside} m aside, ${i} ticks in`).toBeLessThan(1)
      }
      expect(deepest, `${aside} m aside`).toBeGreaterThan(8)
      arena.world.free()
    }
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
