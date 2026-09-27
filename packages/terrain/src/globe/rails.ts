/**
 * A planet's guardrails: where they run, and the strip of wall each run
 * makes. Rails line both edges of the highway wherever it is out in the
 * open, and both edges of every bridge, so a car that drifts to the edge is
 * turned back rather than dropped off it. They stop for a ramp, which has to
 * leave, and for a tunnel, which has walls of its own.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { RAMP_WIDTH, ROAD_BRIDGE, ROAD_TUNNEL, ROAD_WIDTH } from '../roads/constants.ts'
import type { WorldMesh, WorldRoad } from '../world.ts'
import { angleBetween, unit } from './lines.ts'

const { cos, sin } = exact

/**
 * Top of the rail above the road's centerline, so a little less above its
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

/** One unbroken run of rail: points along a road's edge, on its surface, and which edge it is, 1 on the left and -1 on the right. */
export interface GlobeRailRun {
  readonly road: WorldRoad
  readonly points: Vec3[]
  readonly side: number
}

function heightOf(p: Vec3, radius: number): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) - radius
}

/** A point this far along a way across the ground from another, at the same height. */
function across(p: Vec3, way: Vec3, distance: number): Vec3 {
  const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
  return unitScaled({ x: p.x + way.x * distance, y: p.y + way.y * distance, z: p.z + way.z * distance }, r)
}

function unitScaled(p: Vec3, r: number): Vec3 {
  const length = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) || 1
  return { x: (p.x / length) * r, y: (p.y / length) * r, z: (p.z / length) * r }
}

/** A road's way along the ground at one of its points, and its left, both of unit length. */
export function roadFrameAt(road: WorldRoad, index: number): { ahead: Vec3; left: Vec3 } {
  const { points } = road
  const count = points.length
  const prev = points[road.closed ? (index - 1 + count) % count : Math.max(index - 1, 0)]!
  const next = points[road.closed ? (index + 1) % count : Math.min(index + 1, count - 1)]!
  const up = unit(points[index]!)
  let dx = next.x - prev.x
  let dy = next.y - prev.y
  let dz = next.z - prev.z
  const rise = dx * up.x + dy * up.y + dz * up.z
  dx -= up.x * rise
  dy -= up.y * rise
  dz -= up.z * rise
  const ahead = unit({ x: dx, y: dy, z: dz })
  // Left is the way ahead crossed with the way up.
  const left = { x: ahead.y * up.z - ahead.z * up.y, y: ahead.z * up.x - ahead.x * up.z, z: ahead.x * up.y - ahead.y * up.x }
  return { ahead, left }
}

/** How far a point is from a piece of road along the ground, and which side of it, 1 on its left. */
function beside(p: Vec3, a: Vec3, b: Vec3, radius: number): { distance: number; side: number } {
  const ua = unit(a)
  const ub = unit(b)
  const up = unit(p)
  const vx = (ub.x - ua.x) * radius
  const vy = (ub.y - ua.y) * radius
  const vz = (ub.z - ua.z) * radius
  const wx = (up.x - ua.x) * radius
  const wy = (up.y - ua.y) * radius
  const wz = (up.z - ua.z) * radius
  const t = Math.min(Math.max((wx * vx + wy * vy + wz * vz) / (vx * vx + vy * vy + vz * vz || 1), 0), 1)
  const ox = wx - vx * t
  const oy = wy - vy * t
  const oz = wz - vz * t
  // Left of the piece is its way crossed with the way up.
  const lx = vy * ua.z - vz * ua.y
  const ly = vz * ua.x - vx * ua.z
  const lz = vx * ua.y - vy * ua.x
  return { distance: Math.sqrt(ox * ox + oy * oy + oz * oz), side: Math.sign(wx * lx + wy * ly + wz * lz) || 1 }
}

/** A run with a flare at whichever ends are asked for, angled off the road on the run's own side. */
function flared(points: Vec3[], side: number, atStart: boolean, atEnd: boolean): Vec3[] {
  if (points.length < 2) return points
  const flare = (from: Vec3, toward: Vec3): Vec3 => {
    // On past `from`, away from `toward`, and out from the road on the run's side.
    const up = unit(from)
    let dx = from.x - toward.x
    let dy = from.y - toward.y
    let dz = from.z - toward.z
    const rise = dx * up.x + dy * up.y + dz * up.z
    const away = unit({ x: dx - up.x * rise, y: dy - up.y * rise, z: dz - up.z * rise })
    // The road's left, going the way the run goes at this end, is the way it leaves crossed with up; at its start the run comes the other way.
    const left = { x: away.y * up.z - away.z * up.y, y: away.z * up.x - away.x * up.z, z: away.x * up.y - away.y * up.x }
    const out = (from === points[0] ? -1 : 1) * side
    dx = away.x * RAIL_FLARE * cos(RAIL_FLARE_ANGLE) + left.x * out * RAIL_FLARE * sin(RAIL_FLARE_ANGLE)
    dy = away.y * RAIL_FLARE * cos(RAIL_FLARE_ANGLE) + left.y * out * RAIL_FLARE * sin(RAIL_FLARE_ANGLE)
    dz = away.z * RAIL_FLARE * cos(RAIL_FLARE_ANGLE) + left.z * out * RAIL_FLARE * sin(RAIL_FLARE_ANGLE)
    return unitScaled({ x: from.x + dx, y: from.y + dy, z: from.z + dz }, Math.sqrt(from.x * from.x + from.y * from.y + from.z * from.z))
  }
  return [...(atStart ? [flare(points[0]!, points[1]!)] : []), ...points, ...(atEnd ? [flare(points.at(-1)!, points.at(-2)!)] : [])]
}

/** Every run of guardrail on a planet. */
export function globeRailRuns(roads: readonly WorldRoad[], radius: number): GlobeRailRun[] {
  // A ramp's mouth is its whole first stretch, from under the deck's edge until its lane has pulled clear of the deck.
  const highwayPoints = roads.filter((road) => road.kind === 'highway').flatMap((road) => road.points.map(unit))
  const against = ROAD_WIDTH / 2 + RAMP_WIDTH / 2 + 1
  const mouths = roads
    .filter((road) => road.kind === 'ramp')
    .flatMap((road) => {
      const along: Vec3[] = []
      for (const point of road.points) {
        const here = unit(point)
        let nearest = Infinity
        for (const other of highwayPoints) nearest = Math.min(nearest, angleBetween(other, here) * radius)
        if (nearest > against) break
        along.push(point)
      }
      return along
    })
  // Where a surface road ends on another, and which way it leaves it: a bridge's rail stands back from the mouth.
  const junctions = roads
    .filter((road) => road.kind !== 'highway' && !road.closed && road.points.length > 1)
    .flatMap((road) =>
      [road.points, [...road.points].reverse()].map((points) => {
        const end = points[0]!
        const width = road.widths[0]!
        const away = points.find((point) => angleBetween(unit(point), unit(end)) * radius > width) ?? points.at(-1)!
        return { road, end, away, reach: width / 2 + RAIL_FLARE + 2 }
      }),
    )
  const runs: GlobeRailRun[] = []
  for (const road of roads) {
    const count = road.points.length
    const segments = road.closed ? count : count - 1
    const half = road.widths[0]! / 2
    const surface = road.kind !== 'highway'
    const bridged = surface && road.structure.includes(ROAD_BRIDGE)
    const joining = !bridged
      ? []
      : junctions.filter((junction) => {
          if (junction.road === road) return false
          for (let i = 0; i < segments; i++) {
            if (beside(junction.end, road.points[i]!, road.points[(i + 1) % count]!, radius).distance <= half + 1) return true
          }
          return false
        })
    const railed = (segment: number, side: number): boolean => {
      const structure = road.structure[segment]!
      if (structure === ROAD_TUNNEL) return false
      const a = road.points[segment]!
      const b = road.points[(segment + 1) % count]!
      if (surface) {
        return (
          structure === ROAD_BRIDGE &&
          !joining.some((junction) => beside(junction.away, a, b, radius).side === side && beside(junction.end, a, b, radius).distance <= junction.reach)
        )
      }
      return !mouths.some((mouth) => {
        const at = beside(mouth, a, b, radius)
        return at.side === side && at.distance <= half + RAMP_MOUTH
      })
    }
    for (const side of [1, -1]) {
      const edge = (index: number): Vec3 => across(road.points[index]!, roadFrameAt(road, index).left, side * half)
      // A loop is walked from a break in its rail, so no run is cut in two where its points begin; one railed all round is a ring.
      let first = 0
      if (road.closed) {
        while (first < segments && railed(first, side)) first++
        if (first === segments) {
          const ring: Vec3[] = []
          for (let i = 0; i <= segments; i++) ring.push(edge(i % count))
          runs.push({ road, points: ring, side })
          continue
        }
      }
      let run: Vec3[] | null = null
      let fromStart = false
      for (let step = 0; step < segments; step++) {
        const i = (first + step) % segments
        if (!railed(i, side)) {
          if (run !== null) runs.push({ road, points: flared(run, side, !fromStart, true), side })
          run = null
          continue
        }
        if (run === null) {
          run = [edge(i)]
          fromStart = i === 0 && !road.closed
        }
        run.push(edge((i + 1) % count))
      }
      if (run !== null) runs.push({ road, points: flared(run, side, !fromStart, road.closed), side })
    }
  }
  return runs
}

/**
 * Every run of rail as one mesh: a barrier standing on the deck along each
 * edge, with a face toward the road, a top, and a face at the edge, each
 * wound to look out of the barrier, and capped at its ends.
 */
export function globeRailMesh(runs: readonly GlobeRailRun[], radius: number): WorldMesh {
  const positions: number[] = []
  const indices: number[] = []
  const lifted = (p: Vec3, rise: number): Vec3 => unitScaled(p, radius + heightOf(p, radius) + rise)
  for (const run of runs) {
    const { points, side } = run
    const base = positions.length / 3
    const mirrored = side > 0
    const quad = (a: number, b: number, c: number, d: number): void => {
      if (mirrored) indices.push(a, c, b, b, c, d)
      else indices.push(a, b, c, b, d, c)
    }
    for (const [i, point] of points.entries()) {
      // In toward the road: its right on the left edge, its left on the right.
      const prev = points[i - 1] ?? point
      const next = points[i + 1] ?? point
      const up = unit(point)
      let dx = next.x - prev.x
      let dy = next.y - prev.y
      let dz = next.z - prev.z
      const rise = dx * up.x + dy * up.y + dz * up.z
      const ahead = unit({ x: dx - up.x * rise, y: dy - up.y * rise, z: dz - up.z * rise })
      dx = (ahead.y * up.z - ahead.z * up.y) * -side
      dy = (ahead.z * up.x - ahead.x * up.z) * -side
      dz = (ahead.x * up.y - ahead.y * up.x) * -side
      const inner = across(point, { x: dx, y: dy, z: dz }, RAIL_THICKNESS)
      for (const corner of [lifted(point, RAIL_BASE), lifted(point, RAIL_HEIGHT), lifted(inner, RAIL_HEIGHT), lifted(inner, RAIL_BASE)]) positions.push(corner.x, corner.y, corner.z)
    }
    for (let i = 0; i + 1 < points.length; i++) {
      const here = base + i * 4
      const next = here + 4
      quad(here, here + 1, next, next + 1)
      quad(here + 1, here + 2, next + 1, next + 2)
      quad(here + 2, here + 3, next + 2, next + 3)
    }
    const first = base
    const last = base + (points.length - 1) * 4
    quad(first, first + 3, first + 1, first + 2)
    quad(last, last + 1, last + 3, last + 2)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
