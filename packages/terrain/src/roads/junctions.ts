import type { Road, RoadPoint } from '../types.ts'
import { sharpestTurn } from './arterials.ts'
import {
  ARTERIAL_JUNCTION_TURN,
  ARTERIAL_MIN_JUNCTION_ANGLE,
  CROSS_WIDTH,
  MAX_ARTERIAL_GRADE,
  MAX_ROAD_GRADE,
} from './constants.ts'
import { leavingDirection, segmentsCross } from './geometry.ts'
import { limitSweepGrade } from './grades.ts'

/**
 * Where roads meet: ends turned and smoothed so that junctions are square and
 * not too sharp.
 */

interface RoadEnd {
  road: Road
  start: boolean
}

/** The node point at a road end. */
function endPoint(end: RoadEnd): RoadPoint {
  const points = end.road.points
  return end.start ? points[0]! : points[points.length - 1]!
}

/** Unit direction leading away from the node into the road. */
function endDirection(end: RoadEnd): { x: number; z: number } {
  return leavingDirection(end.road.points, end.start)
}

/** Bend the first few samples of a road end so it leaves along `(tx, tz)`. */
function rotateEnd(end: RoadEnd, tx: number, tz: number): void {
  const points = end.road.points
  const node = endPoint(end)
  const current = endDirection(end)
  const angle = Math.atan2(current.x * tz - current.z * tx, current.x * tx + current.z * tz)
  const reach = Math.min(2, points.length - 1)
  for (let k = 1; k <= reach; k++) {
    const weight = 0.5 * (1 + Math.cos((Math.PI * (k - 1)) / reach))
    const index = end.start ? k : points.length - 1 - k
    const point = points[index]!
    const dx = point.x - node.x
    const dz = point.z - node.z
    const cos = Math.cos(angle * weight)
    const sin = Math.sin(angle * weight)
    point.x = node.x + dx * cos - dz * sin
    point.z = node.z + dx * sin + dz * cos
  }
}

/** Chaikin corner cutting on a road's points, keeping the endpoints. */
function smoothRoad(points: RoadPoint[], passes: number): void {
  for (let pass = 0; pass < passes && points.length >= 3; pass++) {
    const next: RoadPoint[] = [points[0]!]
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, z: a.z * 0.75 + b.z * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, z: a.z * 0.25 + b.z * 0.75 })
    }
    next.push(points[points.length - 1]!)
    points.length = 0
    points.push(...next)
  }
}

/** True when `road` properly crosses any other road. */
function crossesAny(road: Road, roads: Road[]): boolean {
  for (const other of roads) {
    if (other === road || other.kind === 'street') continue
    for (let i = 0; i + 1 < road.points.length; i++) {
      const a = road.points[i]!
      const b = road.points[i + 1]!
      for (let j = 0; j + 1 < other.points.length; j++) {
        const c = other.points[j]!
        const d = other.points[j + 1]!
        if (segmentsCross(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z)) return true
      }
    }
  }
  return false
}

/**
 * Make roads meet cleanly at their junctions. At each shared node the incident
 * ends are paired off and bent so each pair leaves in exactly opposite
 * directions — a 180 degree meeting — which removes the abrupt kinks where two
 * or three roads come together. An odd end is left as the branch. Each changed
 * road is re-smoothed, resampled and re-graded, and reverted if it would then
 * cross a road or keep a sharp bend.
 */
export function alignJunctions(roads: Road[]): void {
  const ends: RoadEnd[] = []
  for (const road of roads) {
    if (road.closed || road.points.length < 2 || road.kind === 'street') continue
    ends.push({ road, start: true })
    ends.push({ road, start: false })
  }

  const changed = new Set<Road>()
  const originals = new Map<Road, RoadPoint[]>()
  for (const road of roads) {
    if (road.closed || road.points.length < 2) continue
    originals.set(road, road.points.map((point) => ({ ...point })))
  }
  const used = new Array<boolean>(ends.length).fill(false)
  for (let i = 0; i < ends.length; i++) {
    if (used[i]) continue
    const cluster = [i]
    used[i] = true
    const origin = endPoint(ends[i]!)
    for (let j = i + 1; j < ends.length; j++) {
      if (used[j]) continue
      const point = endPoint(ends[j]!)
      if (Math.hypot(point.x - origin.x, point.z - origin.z) < 1.5) {
        cluster.push(j)
        used[j] = true
      }
    }
    if (cluster.length < 2) continue

    const directions = cluster.map((index) => endDirection(ends[index]!))
    // Work out where every end would point before moving any of them, so the
    // junction can be judged as a whole.
    const planned = directions.map((direction) => ({ ...direction }))
    const pairs: { ia: number; ib: number; axisX: number; axisZ: number }[] = []
    const remaining = cluster.map((_, index) => index)
    while (remaining.length >= 2) {
      let bestA = 0
      let bestB = 1
      let bestDot = Infinity
      for (let a = 0; a < remaining.length; a++) {
        for (let b = a + 1; b < remaining.length; b++) {
          const da = directions[remaining[a]!]!
          const db = directions[remaining[b]!]!
          const dot = da.x * db.x + da.z * db.z
          if (dot < bestDot) {
            bestDot = dot
            bestA = a
            bestB = b
          }
        }
      }
      const ia = remaining[bestA]!
      const ib = remaining[bestB]!
      const da = directions[ia]!
      const db = directions[ib]!
      // A cross road is interchange geometry, with ramps landing on it where
      // it was laid: it is never bent, so a road meeting its end takes its
      // heading instead of the two meeting halfway.
      const fixedA = ends[cluster[ia]!]!.road.kind === 'cross'
      const fixedB = ends[cluster[ib]!]!.road.kind === 'cross'
      let axisX = fixedA ? da.x : fixedB ? -db.x : da.x - db.x
      let axisZ = fixedA ? da.z : fixedB ? -db.z : da.z - db.z
      const axis = Math.hypot(axisX, axisZ) || 1
      axisX /= axis
      axisZ /= axis
      pairs.push({ ia, ib, axisX, axisZ })
      planned[ia] = { x: axisX, z: axisZ }
      planned[ib] = { x: -axisX, z: -axisZ }
      remaining.splice(bestB, 1)
      remaining.splice(bestA, 1)
    }

    // Straightening a pair swings both ends round, which can bring one of them
    // alongside a third road left at the node. A kink is better than two roads
    // leaving together, so a junction that would end up that way is left alone.
    let crowded = false
    for (let a = 0; a < planned.length && !crowded; a++) {
      for (let b = a + 1; b < planned.length; b++) {
        const dot = planned[a]!.x * planned[b]!.x + planned[a]!.z * planned[b]!.z
        if (Math.acos(Math.min(Math.max(dot, -1), 1)) < ARTERIAL_MIN_JUNCTION_ANGLE) {
          crowded = true
          break
        }
      }
    }
    if (crowded) continue

    for (const { ia, ib, axisX, axisZ } of pairs) {
      for (const [index, sign] of [
        [ia, 1],
        [ib, -1],
      ] as const) {
        const end = ends[cluster[index]!]!
        if (end.road.kind === 'cross') continue
        rotateEnd(end, axisX * sign, axisZ * sign)
        changed.add(end.road)
      }
    }
  }

  for (const road of changed) {
    const original = originals.get(road)!
    const originalStructure = road.structure
    smoothRoad(road.points, 4)
    const heights = Float32Array.from(road.points.map((point) => point.y))
    limitSweepGrade(heights, road.points, road.width === CROSS_WIDTH ? MAX_ROAD_GRADE : MAX_ARTERIAL_GRADE)
    for (let i = 0; i < road.points.length; i++) road.points[i]!.y = heights[i]!
    if (crossesAny(road, roads) || sharpestTurn(road.points) > ARTERIAL_JUNCTION_TURN) {
      road.points.length = 0
      road.points.push(...original)
      continue
    }
    // Smoothing changed the sample count, so rebuild the per-segment structure
    // by matching each new sample to the nearest original one.
    const structure = new Uint8Array(road.points.length - 1)
    for (let i = 0; i < structure.length; i++) {
      let best = 0
      let bestDistance = Infinity
      for (let j = 0; j < original.length; j++) {
        const distance = Math.hypot(road.points[i]!.x - original[j]!.x, road.points[i]!.z - original[j]!.z)
        if (distance < bestDistance) {
          bestDistance = distance
          best = j
        }
      }
      structure[i] = originalStructure[Math.min(best, originalStructure.length - 1)]!
    }
    road.structure = structure
  }
}
