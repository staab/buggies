import * as exact from '@buggies/physics'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

/**
 * Plain 2D geometry the road stages share: segments, polygons, distances along
 * a road, and the frame of a road at a point.
 */

export interface Vec2 {
  x: number
  z: number
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

