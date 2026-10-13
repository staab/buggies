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

  /** Follow a path in a car, keeping to the point of it nearest at about the car's own height and steering at a point a little on. */
  function follow(arena: ReturnType<typeof createArena>, seat: ReturnType<typeof takeSeat>, path: readonly Vec3[], seconds: number): number {
    const height = (p: Vec3): number => Math.hypot(p.x, p.y, p.z)
    let at = 0
    for (let i = 0; i < seconds * 60 && at < path.length - 2; i++) {
      const { position, forward, right } = seat.vehicle.frame
      for (let k = at; k < Math.min(at + 30, path.length); k++) {
        if (Math.abs(height(path[k]!) - height(position)) < 4 && between(path[k]!, position) < between(path[at]!, position)) at = k
      }
      const target = path[Math.min(at + 4, path.length - 1)]!
      const toward = v3(target.x - position.x, target.y - position.y, target.z - position.z)
      const steer = Math.atan2(toward.x * right.x + toward.y * right.y + toward.z * right.z, toward.x * forward.x + toward.y * forward.y + toward.z * forward.z)
      advance(arena, () => ({ ...NEUTRAL_INPUT, throttle: seat.vehicle.speed < 8 ? 0.8 : 0, brake: seat.vehicle.speed > 11 ? 0.6 : 0, steer: Math.max(-1, Math.min(1, steer * 2.5)) }))
    }
    return at
  }

  it('drives a car up a screw tower on Venus, round and round to its top, and over the bridge onto its platform', () => {
    const map = worlds.get('venus')!
    // The first ramp's middle line, off its deck: each cross-section's two edges, until the deck jumps to the next ramp.
    const { positions } = map.decks
    const corner = (k: number): Vec3 => v3(positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!)
    const path: Vec3[] = []
    for (let k = 0; k + 7 < positions.length / 3; k += 8) {
      const a = corner(k + 1)
      const b = corner(k + 2)
      const middle = v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
      if (path.length > 0 && between(path.at(-1)!, middle) > 10) break
      path.push(middle)
    }
    const arena = createArena(map, 1)
    // No saucer to carry the car off partway up.
    for (const ufo of arena.ufos) ufo.cooldownTicks = Number.POSITIVE_INFINITY
    const seat = takeSeat(arena, 0, 'sportsCar')
    const start = path[1]!
    const up = upOf(start)
    respawn(seat, { position: v3(start.x + up.x, start.y + up.y, start.z + up.z), up, rotation: uprightRotation(up, v3(path[4]!.x - start.x, path[4]!.y - start.y, path[4]!.z - start.z)) })
    expect(follow(arena, seat, path, 150)).toBeGreaterThanOrEqual(path.length - 2)
    const top = Math.hypot(path.at(-1)!.x, path.at(-1)!.y, path.at(-1)!.z) - map.radius
    expect(heightOver(map, seat.vehicle.frame.position)).toBeGreaterThan(top - 2)
    expect(map.platforms.some((platform) => apart(platform.center, seat.vehicle.frame.position) < platform.radius)).toBe(true)
    arena.world.free()
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
