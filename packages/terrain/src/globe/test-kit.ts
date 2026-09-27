/**
 * What the planet's tests ask of a world: where a thing stands and which
 * way it is turned, how high the ground is under it and which district it
 * is in, how near a road comes to it, and a flat view of the few meters
 * about a point, to measure a feature by.
 */

import { qrotate, v3, type Quat, type Vec3 } from '@buggies/physics'

import { gridPlace, groundIndex, sphereHeight } from '../sphere.ts'
import { tangentFrame } from '../sphere-heights.ts'
import type { World, WorldRoad } from '../world.ts'
import { angleBetween, unit } from './lines.ts'
import { nearestOn } from './segments.ts'

/** How high a point stands over the planet's radius. */
export function heightOf(world: World, p: Vec3): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) - world.radius
}

/** How high the ground is under a point. */
export function groundAt(world: World, p: Vec3): number {
  return sphereHeight(world.ground, unit(p))
}

/** The district a point lies in. */
export function districtAt(world: World, p: Vec3): number {
  const place = { face: 0, i: 0, j: 0 }
  gridPlace(world.ground.n, unit(p), place)
  return world.districtOf[groundIndex(world.ground, place.face, Math.round(place.i), Math.round(place.j))]!
}

/** How far apart two points are along the ground. */
export function apart(world: World, a: Vec3, b: Vec3): number {
  return angleBetween(unit(a), unit(b)) * world.radius
}

/** A thing's own x and z, as it is turned. */
export function axes(turn: Quat): { x: Vec3; z: Vec3 } {
  return { x: qrotate(v3(), turn, { x: 1, y: 0, z: 0 }), z: qrotate(v3(), turn, { x: 0, y: 0, z: 1 }) }
}

/** The plane touching the planet at a point, laid out east and south: where another point lies on it. */
export function planeAt(world: World, at: Vec3): (p: Vec3) => { x: number; z: number } {
  const middle = unit(at)
  const { east, north } = tangentFrame(middle)
  return (p) => {
    const d = unit(p)
    const x = (d.x - middle.x) * world.radius
    const y = (d.y - middle.y) * world.radius
    const z = (d.z - middle.z) * world.radius
    return { x: x * east.x + y * east.y + z * east.z, z: -(x * north.x + y * north.y + z * north.z) }
  }
}

/** The corners and middle of a thing's footprint, and the middle of each side, as points on the ground. */
export function footprintSamples(world: World, thing: { at: Vec3; turn: Quat; width: number; depth: number }): Vec3[] {
  const { x, z } = axes(thing.turn)
  const middle = unit(thing.at)
  const out: Vec3[] = []
  for (const su of [-1, 0, 1]) {
    for (const sv of [-1, 0, 1]) {
      const u = (su * thing.width) / 2
      const v = (sv * thing.depth) / 2
      out.push(unit({ x: middle.x * world.radius + x.x * u + z.x * v, y: middle.y * world.radius + x.y * u + z.y * v, z: middle.z * world.radius + x.z * u + z.z * v }))
    }
  }
  return out
}

/** The nearest any of these roads' roadways comes to a point, as a share of its half width: under 1 is on the road. */
export function roadCrowding(world: World, roads: readonly WorldRoad[], p: Vec3): number {
  const at = unit(p)
  let nearest = Infinity
  for (const road of roads) {
    const count = road.points.length
    const half = road.widths[0]! / 2
    for (let i = 0; i < (road.closed ? count : count - 1); i++) {
      const a = unit(road.points[i]!)
      if (angleBetween(a, at) * world.radius > 200) continue
      const { distance } = nearestOn(at, a, unit(road.points[(i + 1) % count]!), world.radius)
      nearest = Math.min(nearest, distance / half)
    }
  }
  return nearest
}
