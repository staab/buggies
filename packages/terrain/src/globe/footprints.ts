/**
 * Rectangles on a plane: whether two overlap or come within a gap of it,
 * and how far a segment passes from one. A spot on a planet is asked these
 * in its own frame, of whatever near it is brought into that frame.
 */

import * as exact from '@buggies/physics'

const { cos: cosine, hypot, sin: sine } = exact

interface Vec2 {
  x: number
  z: number
}

/** A rectangle on the ground, turned by `yaw` about its center: `width` runs along its local X, `depth` along its local Z. */
export interface Footprint {
  x: number
  z: number
  yaw: number
  width: number
  depth: number
}

/** The four corners of a footprint. */
export function footprintCorners(footprint: Footprint): Vec2[] {
  const cos = cosine(footprint.yaw)
  const sin = sine(footprint.yaw)
  const corners: Vec2[] = []
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      const u = (su * footprint.width) / 2
      const v = (sv * footprint.depth) / 2
      corners.push({ x: footprint.x + u * cos + v * sin, z: footprint.z - u * sin + v * cos })
    }
  }
  return corners
}

/** Whether two footprints overlap in plan, or come within `gap` of it: the separating axis test. */
export function footprintsOverlap(a: Footprint, b: Footprint, gap = 0): boolean {
  const cornersA = footprintCorners(a)
  const cornersB = footprintCorners(b)
  for (const footprint of [a, b]) {
    const cos = cosine(footprint.yaw)
    const sin = sine(footprint.yaw)
    for (const axis of [
      { x: cos, z: -sin },
      { x: sin, z: cos },
    ]) {
      const span = (corners: Vec2[]): [number, number] => {
        let low = Infinity
        let high = -Infinity
        for (const corner of corners) {
          const value = corner.x * axis.x + corner.z * axis.z
          low = Math.min(low, value)
          high = Math.max(high, value)
        }
        return [low, high]
      }
      const [lowA, highA] = span(cornersA)
      const [lowB, highB] = span(cornersB)
      if (highA + gap <= lowB || highB + gap <= lowA) return false
    }
  }
  return true
}

/** Distance from a point to a box of these half sizes about the origin, zero inside it. */
function boxDistance(halfU: number, halfV: number, u: number, v: number): number {
  return hypot(Math.max(Math.abs(u) - halfU, 0), Math.max(Math.abs(v) - halfV, 0))
}

/** Distance from a point to the segment from one point to another. */
function pointSegmentDistance(pu: number, pv: number, au: number, av: number, bu: number, bv: number): number {
  const du = bu - au
  const dv = bv - av
  const t = Math.min(Math.max(((pu - au) * du + (pv - av) * dv) / (du * du + dv * dv || 1), 0), 1)
  return hypot(pu - au - du * t, pv - av - dv * t)
}

/** Where a segment enters and leaves one slab of a box, narrowing the span of it inside every slab so far; `false` if none is left. */
function clipSlab(span: { enter: number; leave: number }, from: number, delta: number, half: number): boolean {
  if (Math.abs(delta) < 1e-12) return Math.abs(from) <= half
  const a = (-half - from) / delta
  const b = (half - from) / delta
  span.enter = Math.max(span.enter, Math.min(a, b))
  span.leave = Math.min(span.leave, Math.max(a, b))
  return span.enter <= span.leave
}

const slab = { enter: 0, leave: 1 }

/** Whether the segment from one point to another passes through a box of these half sizes about the origin: the slab test. */
function crossesBox(halfU: number, halfV: number, au: number, av: number, bu: number, bv: number): boolean {
  slab.enter = 0
  slab.leave = 1
  return clipSlab(slab, au, bu - au, halfU) && clipSlab(slab, av, bv - av, halfV)
}

/** The distance from the segment between two points to a box of these half sizes about the origin, exactly. */
export function segmentBoxDistance(halfU: number, halfV: number, au: number, av: number, bu: number, bv: number): number {
  if (crossesBox(halfU, halfV, au, av, bu, bv)) return 0
  return Math.min(
    boxDistance(halfU, halfV, au, av),
    boxDistance(halfU, halfV, bu, bv),
    pointSegmentDistance(-halfU, -halfV, au, av, bu, bv),
    pointSegmentDistance(-halfU, halfV, au, av, bu, bv),
    pointSegmentDistance(halfU, -halfV, au, av, bu, bv),
    pointSegmentDistance(halfU, halfV, au, av, bu, bv),
  )
}
