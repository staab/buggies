import * as exact from '@buggies/physics'
import type { Road, RoadPoint } from '../types.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { acos, hypot } = exact

/**
 * Plain 2D geometry the road stages share: segments, polygons, distances along
 * a road, and the frame of a road at a point.
 */

export interface Vec2 {
  x: number
  z: number
}

/** Average of a list of points. */
export function centroid(points: Vec2[]): Vec2 {
  let x = 0
  let z = 0
  for (const point of points) {
    x += point.x
    z += point.z
  }
  return { x: x / points.length, z: z / points.length }
}

/** Distance from a point to a segment, in the XZ plane. */
export function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax
  const vz = bz - az
  const lengthSq = vx * vx + vz * vz || 1
  const t = Math.min(Math.max(((px - ax) * vx + (pz - az) * vz) / lengthSq, 0), 1)
  return hypot(px - (ax + vx * t), pz - (az + vz * t))
}

/**
 * Distance between two segments in the XZ plane, zero where they cross. Two
 * segments that do not cross are closest at an endpoint of one of them, so the
 * four point-to-segment distances cover every case.
 */
export function segmentGap(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segmentsCross(ax, az, bx, bz, cx, cz, dx, dz)) return 0
  return Math.min(
    distanceToSegment(ax, az, cx, cz, dx, dz),
    distanceToSegment(bx, bz, cx, cz, dx, dz),
    distanceToSegment(cx, cz, ax, az, bx, bz),
    distanceToSegment(dx, dz, ax, az, bx, bz),
  )
}

/**
 * Convex hull of a point cloud, counter-clockwise, by monotone chain. Fewer
 * than three points come back unchanged, which `pointInPolygon` reads as empty.
 */
export function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points.slice()
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z)
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)

  const half = (source: Vec2[]): Vec2[] => {
    const chain: Vec2[] = []
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) {
        chain.pop()
      }
      chain.push(point)
    }
    chain.pop()
    return chain
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

/** True when a point lies inside a polygon, by ray casting. */
export function pointInPolygon(x: number, z: number, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

/**
 * Interior angle at `cur`, between the rays to `prev` and `next`, in degrees.
 */
export function interiorAngle(prev: Vec2, cur: Vec2, next: Vec2): number {
  const ax = prev.x - cur.x
  const az = prev.z - cur.z
  const bx = next.x - cur.x
  const bz = next.z - cur.z
  const la = hypot(ax, az) || 1
  const lb = hypot(bx, bz) || 1
  const dot = (ax * bx + az * bz) / (la * lb)
  return (acos(Math.min(Math.max(dot, -1), 1)) * 180) / Math.PI
}

/**
 * Area-based inradius estimate; a constant-radius offset stays simple while its
 * radius is below this, and above it the layout is thin enough to need help.
 */
export function polygonInradius(points: Vec2[]): number {
  let area = 0
  let perimeter = 0
  const count = points.length
  for (let i = 0; i < count; i++) {
    const a = points[i]!
    const b = points[(i + 1) % count]!
    area += a.x * b.z - b.x * a.z
    perimeter += hypot(b.x - a.x, b.z - a.z)
  }
  return perimeter < 1e-6 ? 0 : Math.abs(area) / perimeter
}

/** Cumulative arc length from the first point to each point along a polyline. */
export function cumulativeLengths(points: Vec2[]): Float32Array {
  const count = points.length
  const cum = new Float32Array(count)
  for (let i = 1; i < count; i++) {
    cum[i] =
      cum[i - 1]! + hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z)
  }
  return cum
}

/** Index of the sample nearest a given arc length. */
export function indexAtDistance(cum: Float32Array, distance: number): number {
  let best = 0
  let bestGap = Infinity
  for (let i = 0; i < cum.length; i++) {
    const gap = Math.abs(cum[i]! - distance)
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  }
  return best
}

/** Position and unit frame (tangent `d`, normal `n`) at a sample of a closed loop. */
export function frameAt(
  points: Vec2[],
  index: number,
): { x: number; z: number; dx: number; dz: number; nx: number; nz: number } {
  const count = points.length
  const point = points[index]!
  const prev = points[(index - 1 + count) % count]!
  const next = points[(index + 1) % count]!
  let dx = next.x - prev.x
  let dz = next.z - prev.z
  const length = hypot(dx, dz) || 1
  dx /= length
  dz /= length
  return { x: point.x, z: point.z, dx, dz, nx: dz, nz: -dx }
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** True when two open segments properly cross at an interior point. */
export function segmentsCross(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx)
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Axis-aligned bounds of a road's centreline, grown by `margin`. */
export function roadBounds(road: Road, margin: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of road.points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin }
}

/** Unit direction a polyline leaves one of its ends by. */
export function leavingDirection(points: RoadPoint[], fromStart: boolean): { x: number; z: number } {
  const a = fromStart ? points[0]! : points[points.length - 1]!
  const b = fromStart ? points[1]! : points[points.length - 2]!
  const dx = b.x - a.x
  const dz = b.z - a.z
  const length = hypot(dx, dz) || 1
  return { x: dx / length, z: dz / length }
}
