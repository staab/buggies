/**
 * The solids built on a planet's ground from what stands on it: each
 * kicker's facets, the curbed sidewalks round the city blocks, and the
 * paths round the parks the interchanges enclose.
 */

import { qrotate, v3, type Vec3 } from '@buggies/physics'

import { parkLoop } from '../interchanges.ts'
import { rampFacets } from '../ramps.ts'
import { CURB_HEIGHT } from '../sidewalks.ts'
import { sphereHeight, type SphereGround } from '../sphere.ts'
import { tangentFrame } from '../sphere-heights.ts'
import type { WorldMesh, WorldRamp, WorldSidewalk } from '../world.ts'
import { fromFrame, toFrame } from './frame.ts'
import { along, lift, unit } from './lines.ts'
import { spotFrame } from './placing.ts'

/** How far a sidewalk's faces run down into the ground, so no gap shows where the ground dips. */
const CURB_FOOTING = 0.4
/** How far apart, along a side, the slab follows the ground. */
const SIDEWALK_STEP = 1.5

/** A thing's own axes, as it stands: its x, and its z. */
function axesOf(turn: WorldRamp['turn']): { x: Vec3; z: Vec3 } {
  return { x: qrotate(v3(), turn, { x: 1, y: 0, z: 0 }), z: qrotate(v3(), turn, { x: 0, y: 0, z: 1 }) }
}

/** Each kicker's facets, foot to lip, as the eight corners of a solid: the facet's top across the kicker's width, and a meter under its foot. */
export function kickerSolids(ramps: readonly WorldRamp[], radius: number): Float32Array[] {
  return ramps.flatMap((ramp) => {
    const foot = unit(ramp.at)
    const bottom = Math.sqrt(ramp.at.x * ramp.at.x + ramp.at.y * ramp.at.y + ramp.at.z * ramp.at.z) - radius
    const { x, z } = axesOf(ramp.turn)
    const facets = rampFacets({ x: 0, z: 0, dx: 0, dz: 1, width: ramp.width, length: ramp.length, bottom, top: bottom + ramp.rise, ...(ramp.straight ? { straight: true } : {}) })
    const under = bottom - 1
    const corner = (distance: number, side: number, height: number): Vec3 => lift(along(along(foot, z, distance, radius), x, side * (ramp.width / 2), radius), radius, height)
    return facets.slice(1).map((b, i) => {
      const a = facets[i]!
      const points = [
        corner(a.along, -1, a.height),
        corner(a.along, 1, a.height),
        corner(b.along, -1, b.height),
        corner(b.along, 1, b.height),
        corner(a.along, -1, under),
        corner(a.along, 1, under),
        corner(b.along, -1, under),
        corner(b.along, 1, under),
      ]
      return Float32Array.from(points.flatMap((p) => [p.x, p.y, p.z]))
    })
  })
}

/**
 * Every sidewalk as one mesh, drawn and driven on: a slab top a curb above
 * the ground, a curb face at the street and a face at the inner edge. Each
 * side of a ring is one strip from corner to corner, so the four meet at
 * the corners without overlapping; a side the ring goes without is left out.
 */
export function curbSolids(ground: SphereGround, sidewalks: readonly WorldSidewalk[]): WorldMesh {
  const { radius } = ground
  const positions: number[] = []
  const indices: number[] = []
  const push = (p: Vec3): number => {
    positions.push(p.x, p.y, p.z)
    return positions.length / 3 - 1
  }
  // A quad wound so its normal points along `outward`.
  const quad = (a: number, b: number, c: number, d: number, outward: Vec3): void => {
    const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!
    const ux = positions[b * 3]! - ax, uy = positions[b * 3 + 1]! - ay, uz = positions[b * 3 + 2]! - az
    const vx = positions[c * 3]! - ax, vy = positions[c * 3 + 1]! - ay, vz = positions[c * 3 + 2]! - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    if (nx * outward.x + ny * outward.y + nz * outward.z >= 0) indices.push(a, b, c, b, d, c)
    else indices.push(a, c, b, b, c, d)
  }
  for (const walk of sidewalks) {
    const middle = unit(walk.at)
    const frame = spotFrame(middle, axesOf(walk.turn).x, radius)
    const place = (u: number, v: number): Vec3 => fromFrame(frame, u, v)
    const heightAt = (p: Vec3): number => sphereHeight(ground, p)
    const outer = walk.half
    const inner = walk.half - walk.band
    const corners: [number, number][] = [
      [outer, outer],
      [-outer, outer],
      [-outer, -outer],
      [outer, -outer],
    ]
    for (let side = 0; side < 4; side++) {
      if (!walk.sides[side]) continue
      const [u0, v0] = corners[side]!
      const [u1, v1] = corners[(side + 1) % 4]!
      const scale = inner / outer
      const steps = Math.max(1, Math.ceil((2 * outer) / SIDEWALK_STEP))
      // Each station's slab is a curb over the highest ground near it, across the band and half a step either way along it.
      const stations: [number, number, number, number][] = []
      const reach = (2 * outer) / steps / 2
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        const ou = u0 + (u1 - u0) * t
        const ov = v0 + (v1 - v0) * t
        const o = place(ou, ov)
        const i = place(ou * scale, ov * scale)
        let high = -Infinity
        for (const dt of [-reach / (2 * outer), 0, reach / (2 * outer)]) {
          const su = u0 + (u1 - u0) * (t + dt)
          const sv = v0 + (v1 - v0) * (t + dt)
          for (const across of [1, (1 + scale) / 2, scale]) high = Math.max(high, heightAt(place(su * across, sv * across)))
        }
        const top = high + CURB_HEIGHT
        stations.push([push(lift(o, radius, top)), push(lift(i, radius, top)), push(lift(o, radius, heightAt(o) - CURB_FOOTING)), push(lift(i, radius, heightAt(i) - CURB_FOOTING))])
      }
      const mid = place(((u0 + u1) / 2) * (1 + scale) * 0.5, ((v0 + v1) / 2) * (1 + scale) * 0.5)
      const out = { x: mid.x - middle.x, y: mid.y - middle.y, z: mid.z - middle.z }
      for (const [k, [ot, it, ob, ib]] of stations.entries()) {
        const after = stations[k + 1]
        if (after === undefined) break
        const [ot2, it2, ob2, ib2] = after
        quad(ot, it, ot2, it2, middle)
        quad(ot, ot2, ob, ob2, out)
        quad(it, it2, ib, ib2, { x: -out.x, y: -out.y, z: -out.z })
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** The gravel path round the park each interchange encloses: a loop part way out to the ring's edge, on the ground. */
export function parkPaths(ground: SphereGround, rings: readonly Vec3[][]): Vec3[][] {
  const { radius } = ground
  return rings.flatMap((ring) => {
    const middle = unit(ring.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y, z: sum.z + p.z }), { x: 0, y: 0, z: 0 }))
    const frame = spotFrame(middle, tangentFrame(middle).east, radius)
    const loop = parkLoop(ring.map((p) => toFrame(frame, p)))
    if (loop.length === 0) return []
    return [
      loop.map((p) => {
        const direction = fromFrame(frame, p.x, p.z)
        return lift(direction, radius, sphereHeight(ground, direction))
      }),
    ]
  })
}
