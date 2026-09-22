import { sampleHeight } from './heightfield.ts'
import type { Heightfield, Sidewalk } from './types.ts'

/** How far a sidewalk stands above the street. */
export const KERB_HEIGHT = 0.15
/** How far its faces run down into the ground, so no gap shows where the ground dips. */
const KERB_FOOTING = 0.4
/** How far apart, along a side, the slab follows the ground. */
const SIDEWALK_STEP = 1.5

export interface SidewalkMesh {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * Every sidewalk as one mesh, drawn and driven on: a slab top a kerb above
 * the ground, a kerb face at the street and a face at the inner edge. Each
 * side of a ring is one strip from corner to corner, so the four meet at the
 * corners without overlapping; a side the ring goes without is left out.
 */
export function sidewalkMesh(field: Heightfield, sidewalks: Sidewalk[]): SidewalkMesh {
  const positions: number[] = []
  const indices: number[] = []
  const push = (x: number, y: number, z: number): number => {
    positions.push(x, y, z)
    return positions.length / 3 - 1
  }
  // A quad wound so its normal points along `outward`.
  const quad = (a: number, b: number, c: number, d: number, outward: [number, number, number]): void => {
    const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!
    const bx = positions[b * 3]!, by = positions[b * 3 + 1]!, bz = positions[b * 3 + 2]!
    const cx = positions[c * 3]!, cy = positions[c * 3 + 1]!, cz = positions[c * 3 + 2]!
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] >= 0) indices.push(a, b, c, b, d, c)
    else indices.push(a, c, b, b, c, d)
  }
  for (const walk of sidewalks) {
    const cos = Math.cos(walk.yaw)
    const sin = Math.sin(walk.yaw)
    const place = (u: number, v: number): { x: number; z: number } => ({
      x: walk.x + u * cos - v * sin,
      z: walk.z + u * sin + v * cos,
    })
    const outer = walk.half
    const inner = walk.half - walk.band
    // The ring's corners in block coordinates, round in order.
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
      // Each station's slab height is a kerb over the highest ground near it:
      // across the band and half a step either way along it, so the slab
      // never sinks into a rise between stations, and the stations share
      // their vertices so the slab runs smoothly rather than in steps.
      const stations: number[][] = []
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
          for (const across of [1, (1 + scale) / 2, scale]) {
            const at = place(su * across, sv * across)
            high = Math.max(high, sampleHeight(field, at.x, at.z))
          }
        }
        const top = high + KERB_HEIGHT
        stations.push([
          push(o.x, top, o.z),
          push(i.x, top, i.z),
          push(o.x, sampleHeight(field, o.x, o.z) - KERB_FOOTING, o.z),
          push(i.x, sampleHeight(field, i.x, i.z) - KERB_FOOTING, i.z),
        ])
      }
      const mid = place(((u0 + u1) / 2) * (1 + scale) * 0.5, ((v0 + v1) / 2) * (1 + scale) * 0.5)
      const out: [number, number, number] = [mid.x - walk.x, 0, mid.z - walk.z]
      for (let k = 0; k + 1 < stations.length; k++) {
        const [ot, it, ob, ib] = stations[k]! as [number, number, number, number]
        const [ot2, it2, ob2, ib2] = stations[k + 1]! as [number, number, number, number]
        quad(ot, it, ot2, it2, [0, 1, 0])
        quad(ot, ot2, ob, ob2, out)
        quad(it, it2, ib, ib2, [-out[0], 0, -out[2]])
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
