/**
 * Guardrails: where they run, and the strip of wall each run makes. Rails line
 * both edges of the highway wherever it is out in the open, and both edges of
 * every bridge, so a car that drifts to the edge is turned back rather than
 * dropped off it. They stop for a ramp, which has to leave, and for a tunnel,
 * which has walls of its own.
 */

import * as exact from '@buggies/physics'
import { RAMP_WIDTH, ROAD_BRIDGE, ROAD_TUNNEL, isSurfaceRoad, roadLift } from './roads.ts'
import type { Road, RoadPoint } from './types.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { cos, hypot, sin } = exact

/**
 * Top of the rail above the road's centreline, so a little less above its
 * surface: well over the floor of the tallest car, which otherwise rides up
 * onto the rail where it comes to straddle the rail line.
 */
export const RAIL_HEIGHT = 1.2
/** The rail is a solid barrier from this height above the road surface up: none, so it meets the deck. */
export const RAIL_BASE = 0
/** How thick the barrier is, standing on the deck inside its edge. */
export const RAIL_THICKNESS = 0.4
/**
 * Every run ends in a flare, angled away from the road over this length: a
 * car sliding along the rail runs off the end of it, and one coming the
 * other way is gathered back in, where a square end would stop it dead. At a
 * tunnel the flare has to reach right into the wall, end and all, or a car
 * scraping along the wall meets the end square on as it leaves.
 */
export const RAIL_FLARE = 8
/** Shallow, so a car that meets a flare at speed is turned rather than stopped. */
const RAIL_FLARE_ANGLE = (15 * Math.PI) / 180
/** How far either side of a ramp's mouth the highway's rail stands back, flare included. */
const RAMP_MOUTH = RAMP_WIDTH / 2 + RAIL_FLARE + 2

/**
 * One unbroken run of rail: points along a road's edge, on the road surface,
 * and which edge it is, so the barrier can stand inside it.
 */
export interface RailRun {
  road: Road
  points: RoadPoint[]
  /** 1 on the road's left edge, -1 on its right. */
  side: number
  /** Whether the first and last points are flares, angled away from the road. */
  flaredStart: boolean
  flaredEnd: boolean
}

interface Frame {
  nx: number
  nz: number
}

/** Unit normal to a road at one of its samples, pointing to its left. */
function frameAt(road: Road, index: number): Frame {
  const { points } = road
  const count = points.length
  // Both neighbours are within the road, wrapped round a loop or held at an end.
  const prev = points[road.closed ? (index - 1 + count) % count : Math.max(index - 1, 0)]!
  const next = points[road.closed ? (index + 1) % count : Math.min(index + 1, count - 1)]!
  const dx = next.x - prev.x
  const dz = next.z - prev.z
  const length = hypot(dx, dz) || 1
  return { nx: -dz / length, nz: dx / length }
}

/** Distance from a point to a segment in plan, and which side of it the point is on. */
function beside(
  px: number,
  pz: number,
  a: RoadPoint,
  b: RoadPoint,
): { distance: number; side: number } {
  const vx = b.x - a.x
  const vz = b.z - a.z
  const lengthSq = vx * vx + vz * vz || 1
  const t = Math.min(Math.max(((px - a.x) * vx + (pz - a.z) * vz) / lengthSq, 0), 1)
  const distance = hypot(px - (a.x + vx * t), pz - (a.z + vz * t))
  const side = Math.sign(vx * (pz - a.z) - vz * (px - a.x)) || 1
  return { distance, side }
}

/**
 * A run with a flare added at whichever ends are asked for, angled away from
 * the road. A run that begins or ends with its road has no traffic coming
 * along the rail from beyond, and no flare there.
 */
function flared(points: RoadPoint[], side: number, atStart: boolean, atEnd: boolean): RoadPoint[] {
  const first = points[0]
  const second = points[1]
  const last = points.at(-1)
  const beforeLast = points.at(-2)
  if (first === undefined || second === undefined || last === undefined || beforeLast === undefined) return points
  const flare = (from: RoadPoint, toward: RoadPoint, atStart: boolean): RoadPoint => {
    // Past `from`, away from `toward` along the run; and away from the road
    // across it, which is the run's own side of its direction of travel.
    const dx = from.x - toward.x
    const dz = from.z - toward.z
    const length = hypot(dx, dz) || 1
    const ax = dx / length
    const az = dz / length
    const runX = atStart ? -ax : ax
    const runZ = atStart ? -az : az
    const outX = -runZ * side
    const outZ = runX * side
    const along = RAIL_FLARE * cos(RAIL_FLARE_ANGLE)
    const out = RAIL_FLARE * sin(RAIL_FLARE_ANGLE)
    return { x: from.x + ax * along + outX * out, y: from.y, z: from.z + az * along + outZ * out }
  }
  return [...(atStart ? [flare(first, second, true)] : []), ...points, ...(atEnd ? [flare(last, beforeLast, false)] : [])]
}

function finished(road: Road, points: RoadPoint[], side: number, atStart: boolean, atEnd: boolean): RailRun {
  return { road, points: flared(points, side, atStart, atEnd), side, flaredStart: atStart, flaredEnd: atEnd }
}

/** Every run of guardrail on the map. */
export function railRuns(roads: Road[]): RailRun[] {
  const mouths = roads.filter((road) => road.kind === 'ramp').flatMap((road) => road.points.slice(0, 1))
  const runs: RailRun[] = []

  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const half = road.width / 2
    const lift = roadLift(road)

    // A segment, its structure and its two points are all within the road:
    // segments are counted from its points, and the last of a loop ends at
    // the first. An edge is taken at one of those points.
    const railed = (segment: number, side: number): boolean => {
      const structure = road.structure[segment]!
      if (structure === ROAD_TUNNEL) return false
      if (isSurfaceRoad(road)) return structure === ROAD_BRIDGE
      const a = road.points[segment]!
      const b = road.points[(segment + 1) % count]!
      return !mouths.some((mouth) => {
        const at = beside(mouth.x, mouth.z, a, b)
        return at.side === side && at.distance <= half + RAMP_MOUTH
      })
    }

    for (const side of [1, -1]) {
      let run: RoadPoint[] | null = null
      let runFromRoadStart = false
      const edge = (index: number): RoadPoint => {
        const point = road.points[index]!
        const { nx, nz } = frameAt(road, index)
        return { x: point.x + nx * side * half, y: point.y + lift, z: point.z + nz * side * half }
      }
      // A loop is walked from a break in its rail, so no run is cut in two
      // where the road's samples happen to begin, with a flare crossing a
      // flare at the join. A loop railed all the way round is one ring.
      let first = 0
      if (road.closed) {
        while (first < segmentCount && railed(first, side)) first++
        if (first === segmentCount) {
          const ring: RoadPoint[] = []
          for (let i = 0; i <= segmentCount; i++) ring.push(edge(i % count))
          runs.push({ road, points: ring, side, flaredStart: false, flaredEnd: false })
          continue
        }
      }
      for (let step = 0; step < segmentCount; step++) {
        const i = (first + step) % segmentCount
        if (!railed(i, side)) {
          if (run !== null) runs.push(finished(road, run, side, !runFromRoadStart, true))
          run = null
          continue
        }
        if (run === null) {
          run = [edge(i)]
          runFromRoadStart = i === 0 && !road.closed
        }
        run.push(edge((i + 1) % count))
      }
      if (run !== null) runs.push(finished(road, run, side, !runFromRoadStart, road.closed))
    }
  }
  return runs
}

/** Unit direction from a run's edge line in toward the road, at one of its points. */
function inward(run: RailRun, index: number, point: RoadPoint): { x: number; z: number } {
  const { points, side } = run
  const prev = points[index - 1] ?? point
  const next = points[index + 1] ?? point
  const dx = next.x - prev.x
  const dz = next.z - prev.z
  const length = hypot(dx, dz) || 1
  // The road's left is (-dz, dx); its right edge's inside is that way, its left edge's the reverse.
  return { x: (-dz / length) * -side, z: (dx / length) * -side }
}

export interface RailMesh {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * Every run of rail as one mesh, drawn and driven against: a barrier standing
 * on the deck along each edge, with a face toward the road, a top, and a face
 * at the edge. Every face is wound to look out of the barrier, so a collider
 * can treat it as a solid and smooth over the seams between its facets.
 */
export function railMesh(runs: RailRun[]): RailMesh {
  const positions: number[] = []
  const indices: number[] = []
  for (const run of runs) {
    const { points } = run
    const base = positions.length / 3
    // The corners are laid out by the run's inward direction, which mirrors
    // between the two edges of a road, and so does the winding.
    const mirrored = run.side > 0
    const quad = (a: number, b: number, c: number, d: number): void => {
      if (mirrored) indices.push(a, c, b, b, c, d)
      else indices.push(a, b, c, b, d, c)
    }
    // Four corners per point: outer bottom, outer top, inner top, inner bottom.
    for (const [i, point] of points.entries()) {
      const { x: inX, z: inZ } = inward(run, i, point)
      const bottom = point.y + RAIL_BASE
      const top = point.y + RAIL_HEIGHT
      positions.push(
        point.x, bottom, point.z,
        point.x, top, point.z,
        point.x + inX * RAIL_THICKNESS, top, point.z + inZ * RAIL_THICKNESS,
        point.x + inX * RAIL_THICKNESS, bottom, point.z + inZ * RAIL_THICKNESS,
      )
    }
    for (let i = 0; i + 1 < points.length; i++) {
      const here = base + i * 4
      const next = here + 4
      quad(here, here + 1, next, next + 1)
      quad(here + 1, here + 2, next + 1, next + 2)
      quad(here + 2, here + 3, next + 2, next + 3)
    }
    // Capped at each end, so a run's end is a block's end and not a hollow.
    const first = base
    const last = base + (points.length - 1) * 4
    quad(first, first + 3, first + 1, first + 2)
    quad(last, last + 1, last + 3, last + 2)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
