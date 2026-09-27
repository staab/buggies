import * as exact from '@buggies/physics'
import type { Road } from '../types.ts'
import { isSurfaceRoad } from './beds.ts'
import { ROAD_SKIRT, SEGMENT_CELL, STREET_WIDTH } from './constants.ts'
import type { Vec2 } from './geometry.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { cos: cosine, hypot, sin: sine } = exact

/**
 * What a road claims of the ground, and how far a footprint stands from it.
 */

/** One stretch of road, with the ground either side of it that it claims. */
interface ClaimedSegment {
  ax: number
  az: number
  bx: number
  bz: number
  /** Ground within this distance of the segment belongs to it. */
  reach: number
  /** Unit heading along the segment. */
  dx: number
  dz: number
}

/** Every segment of a road, each claiming `reach` of ground either side. */
export function claimedSegments(road: Road, reach: number): ClaimedSegment[] {
  const points = road.points
  const count = road.closed ? points.length : points.length - 1
  const segments: ClaimedSegment[] = []
  for (let i = 0; i < count; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const length = hypot(b.x - a.x, b.z - a.z) || 1
    segments.push({
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      reach,
      dx: (b.x - a.x) / length,
      dz: (b.z - a.z) / length,
    })
  }
  return segments
}

/**
 * Calls `visit` for every indexed segment that could claim ground inside the
 * box, stopping at the first one `visit` accepts. A segment spanning several
 * cells of the box is offered more than once, which costs a repeated test and
 * nothing else.
 */
type SegmentLookup = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  visit: (segment: ClaimedSegment) => boolean,
) => boolean

/**
 * Bucket segments into a uniform grid by the ground they claim, so a lookup only
 * tests the few that could be in range. A segment goes in every cell its reach
 * can touch, so a box only ever looks in the cells it covers. The roads hold
 * thousands of samples between them, far too many to walk once per street span.
 */
export function indexSegments(segments: ClaimedSegment[]): SegmentLookup {
  const cellOf = (value: number): number => Math.max(0, Math.floor(value / SEGMENT_CELL))
  const key = (col: number, row: number): number => col * 0x10000 + row
  const buckets = new Map<number, ClaimedSegment[]>()
  for (const segment of segments) {
    const minCol = cellOf(Math.min(segment.ax, segment.bx) - segment.reach)
    const maxCol = cellOf(Math.max(segment.ax, segment.bx) + segment.reach)
    const minRow = cellOf(Math.min(segment.az, segment.bz) - segment.reach)
    const maxRow = cellOf(Math.max(segment.az, segment.bz) + segment.reach)
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const bucket = buckets.get(key(col, row))
        if (bucket) bucket.push(segment)
        else buckets.set(key(col, row), [segment])
      }
    }
  }

  return (minX, minZ, maxX, maxZ, visit) => {
    const maxCol = cellOf(maxX)
    const maxRow = cellOf(maxZ)
    for (let row = cellOf(minZ); row <= maxRow; row++) {
      for (let col = cellOf(minX); col <= maxCol; col++) {
        const bucket = buckets.get(key(col, row))
        if (!bucket) continue
        for (const segment of bucket) if (visit(segment)) return true
      }
    }
    return false
  }
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

/**
 * The distance from a segment to a footprint, exactly. In the footprint's
 * own frame it is a box about the origin, and the nearest two points of a
 * segment and a box are an end of the one and a side or corner of the
 * other, unless the segment passes through the box.
 */
function segmentFootprintDistance(footprint: Footprint, segment: ClaimedSegment): number {
  const cos = cosine(footprint.yaw)
  const sin = sine(footprint.yaw)
  const ax = segment.ax - footprint.x
  const az = segment.az - footprint.z
  const bx = segment.bx - footprint.x
  const bz = segment.bz - footprint.z
  const au = ax * cos - az * sin
  const av = ax * sin + az * cos
  const bu = bx * cos - bz * sin
  const bv = bx * sin + bz * cos
  return segmentBoxDistance(footprint.width / 2, footprint.depth / 2, au, av, bu, bv)
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

/**
 * A test of whether a footprint keeps `margin` clear of every road: its
 * roadway, and the embankment a built road carries down beside it. A
 * city street reaches `streetReach` from its centerline: its roadway,
 * or, for the blocks laid out against the old curb, only that far.
 */
export function roadClearance(
  roads: Road[],
  streetReach = STREET_WIDTH / 2,
): (footprint: Footprint, margin: number) => boolean {
  let reachMost = 0
  const segments: ClaimedSegment[] = []
  for (const road of roads) {
    const reach = road.kind === 'street' ? streetReach : road.width / 2 + (isSurfaceRoad(road) ? 0 : ROAD_SKIRT)
    reachMost = Math.max(reachMost, reach)
    segments.push(...claimedSegments(road, reach))
  }
  const near = indexSegments(segments)
  return (footprint, margin) => {
    const half = hypot(footprint.width, footprint.depth) / 2 + margin + reachMost
    return !near(
      footprint.x - half,
      footprint.z - half,
      footprint.x + half,
      footprint.z + half,
      (segment) => segmentFootprintDistance(footprint, segment) < segment.reach + margin,
    )
  }
}
