import { footprintCorners, type Footprint } from './roads.ts'
import type { Road } from './types.ts'

interface Point {
  x: number
  z: number
}

/** Ramps this close to one another, in plan, serve the same interchange. */
const INTERCHANGE_REACH = 90

/**
 * The ground of the interchanges: for each, the hull of everything its ramps
 * cover, which takes in the wedges between the ramps and the highway and
 * the stretch of cross road they join. Nothing is built or paved there.
 */
export function interchangeZones(roads: Road[]): Point[][] {
  const ramps = roads.filter((road) => road.kind === 'ramp')
  const group = ramps.map((_, i) => i)
  const find = (i: number): number => {
    while (group[i] !== i) {
      group[i] = group[group[i]!]!
      i = group[i]!
    }
    return i
  }
  const bounds = ramps.map((ramp) => {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const point of ramp.points) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minZ = Math.min(minZ, point.z)
      maxZ = Math.max(maxZ, point.z)
    }
    return { minX, maxX, minZ, maxZ }
  })
  for (let i = 0; i < ramps.length; i++) {
    for (let j = i + 1; j < ramps.length; j++) {
      const a = bounds[i]!
      const b = bounds[j]!
      const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0)
      const gapZ = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0)
      if (Math.hypot(gapX, gapZ) <= INTERCHANGE_REACH) group[find(i)] = find(j)
    }
  }
  const members = new Map<number, Point[]>()
  for (const [i, ramp] of ramps.entries()) {
    const key = find(i)
    const points = members.get(key) ?? []
    for (const point of ramp.points) points.push({ x: point.x, z: point.z })
    members.set(key, points)
  }
  return [...members.values()].map(convexHull).filter((hull) => hull.length >= 3)
}

/** The convex hull of some points, counter-clockwise, by the monotone chain. */
function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  if (sorted.length < 3) return sorted
  const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
  const lower: Point[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/** Whether a point lies inside a polygon, by casting a ray. */
export function insidePolygon(polygon: Point[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

/**
 * Whether a footprint reaches into any interchange: by its centre, its
 * corners and the middle of each side, which is enough for anything smaller
 * than an interchange.
 */
export function meetsInterchange(zones: Point[][], footprint: Footprint): boolean {
  if (zones.length === 0) return false
  const corners = footprintCorners(footprint)
  const samples: Point[] = [{ x: footprint.x, z: footprint.z }, ...corners]
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const a = corners[i]!
      const b = corners[j]!
      samples.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })
    }
  }
  return zones.some((zone) => samples.some((sample) => insidePolygon(zone, sample.x, sample.z)))
}
