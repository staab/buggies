import * as exact from '@buggies/physics'
import { footprintCorners, type Footprint } from './roads.ts'
import type { Road } from './types.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

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
  // Each ramp's group is another ramp's index, so every step of the walk lands within the ramps.
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
  for (const [i, a] of bounds.entries()) {
    for (const [j, b] of bounds.entries()) {
      if (j <= i) continue
      const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0)
      const gapZ = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0)
      if (hypot(gapX, gapZ) <= INTERCHANGE_REACH) group[find(i)] = find(j)
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
  /** Whether a chain's last two points and the next fail to turn left, so the middle one is off the hull. */
  const bends = (chain: Point[], point: Point): boolean => {
    const a = chain.at(-2)
    const b = chain.at(-1)
    return a !== undefined && b !== undefined && cross(a, b, point) <= 0
  }
  const lower: Point[] = []
  for (const point of sorted) {
    while (bends(lower, point)) lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (const point of sorted.reverse()) {
    while (bends(upper, point)) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/** Whether a point lies inside a polygon, by casting a ray. */
export function insidePolygon(polygon: Point[], x: number, z: number): boolean {
  let inside = false
  // Each edge runs from the point before to this one, the first's from the last.
  let b = polygon.at(-1)
  if (b === undefined) return false
  for (const a of polygon) {
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
    b = a
  }
  return inside
}

/**
 * Whether a footprint reaches into any interchange: by its center, its
 * corners and the middle of each side, which is enough for anything smaller
 * than an interchange.
 */
export function meetsInterchange(zones: Point[][], footprint: Footprint): boolean {
  if (zones.length === 0) return false
  const corners = footprintCorners(footprint)
  const samples: Point[] = [{ x: footprint.x, z: footprint.z }, ...corners]
  for (const [i, a] of corners.entries()) {
    for (const b of corners.slice(i + 1)) samples.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })
  }
  return zones.some((zone) => samples.some((sample) => insidePolygon(zone, sample.x, sample.z)))
}
