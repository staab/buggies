/**
 * Guardrails: where they run, and the strip of wall each run makes. Rails line
 * both edges of the highway wherever it is out in the open, and both edges of
 * every bridge, so a car that drifts to the edge is turned back rather than
 * dropped off it. They stop for a ramp, which has to leave, and for a tunnel,
 * which has walls of its own.
 */

import { RAMP_WIDTH, ROAD_BRIDGE, ROAD_TUNNEL, isSurfaceRoad, roadLift } from './roads.ts'
import type { Road, RoadPoint } from './types.ts'

/** Top of the rail above the road surface. */
export const RAIL_HEIGHT = 0.9
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
export const RAIL_FLARE = 6
const RAIL_FLARE_ANGLE = (25 * Math.PI) / 180
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

/** Unit normal to a road at a sample, pointing to its left. */
function frameAt(road: Road, index: number): Frame {
  const { points } = road
  const count = points.length
  const prev = points[road.closed ? (index - 1 + count) % count : Math.max(index - 1, 0)]!
  const next = points[road.closed ? (index + 1) % count : Math.min(index + 1, count - 1)]!
  const dx = next.x - prev.x
  const dz = next.z - prev.z
  const length = Math.hypot(dx, dz) || 1
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
  const distance = Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t))
  const side = Math.sign(vx * (pz - a.z) - vz * (px - a.x)) || 1
  return { distance, side }
}

/**
 * A run with a flare added at whichever ends are asked for, angled away from
 * the road. A run that begins or ends with its road has no traffic coming
 * along the rail from beyond, and no flare there.
 */
function flared(points: RoadPoint[], side: number, atStart: boolean, atEnd: boolean): RoadPoint[] {
  if (points.length < 2) return points
  const flare = (from: RoadPoint, toward: RoadPoint, atStart: boolean): RoadPoint => {
    // Past `from`, away from `toward` along the run; and away from the road
    // across it, which is the run's own side of its direction of travel.
    const dx = from.x - toward.x
    const dz = from.z - toward.z
    const length = Math.hypot(dx, dz) || 1
    const ax = dx / length
    const az = dz / length
    const runX = atStart ? -ax : ax
    const runZ = atStart ? -az : az
    const outX = -runZ * side
    const outZ = runX * side
    const along = RAIL_FLARE * Math.cos(RAIL_FLARE_ANGLE)
    const out = RAIL_FLARE * Math.sin(RAIL_FLARE_ANGLE)
    return { x: from.x + ax * along + outX * out, y: from.y, z: from.z + az * along + outZ * out }
  }
  return [
    ...(atStart ? [flare(points[0]!, points[1]!, true)] : []),
    ...points,
    ...(atEnd ? [flare(points[points.length - 1]!, points[points.length - 2]!, false)] : []),
  ]
}

function finished(road: Road, points: RoadPoint[], side: number, atStart: boolean, atEnd: boolean): RailRun {
  return { road, points: flared(points, side, atStart, atEnd), side, flaredStart: atStart, flaredEnd: atEnd }
}

/** Every run of guardrail on the map. */
export function railRuns(roads: Road[]): RailRun[] {
  const mouths = roads.filter((road) => road.kind === 'ramp').map((road) => road.points[0]!)
  const runs: RailRun[] = []

  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const half = road.width / 2
    const lift = roadLift(road)

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
      for (let i = 0; i < segmentCount; i++) {
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
function inward(run: RailRun, index: number): { x: number; z: number } {
  const { points, side } = run
  const prev = points[Math.max(index - 1, 0)]!
  const next = points[Math.min(index + 1, points.length - 1)]!
  const dx = next.x - prev.x
  const dz = next.z - prev.z
  const length = Math.hypot(dx, dz) || 1
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
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!
      const { x: inX, z: inZ } = inward(run, i)
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
