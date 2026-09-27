/**
 * A planet's roads on its ground: the ground cut down under every built
 * road so nothing pokes through its deck, and every surface road settled,
 * the ground shaped to it and it to the ground, until the two agree and the
 * road keeps its grade. Everything is worked on the planet's own grid, each
 * grid point judged by how far along the ground it is from a road's
 * centerline.
 */

import type { Vec3 } from '@buggies/physics'

import {
  CUT_CLEARANCE,
  CUT_SLOPE,
  MAX_ARTERIAL_GRADE,
  MAX_CLIMB_GRADE,
  MAX_RAMP_CURVATURE,
  MAX_RAMP_GRADE,
  MAX_ROAD_CURVATURE,
  MAX_ROAD_GRADE,
  RAMP_LANE_REACH,
  RAMP_WIDTH,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  SETTLE_PASSES,
  SURFACE_SHOULDER,
} from '../roads/constants.ts'
import { smoothstep } from '../roads/geometry.ts'
import { limitSweepGradeAlong, limitVerticalCurvatureAlong } from '../roads/grades.ts'
import { gridPlace, groundIndex, sphereHeight, type GridPlace, type SphereGround } from '../sphere.ts'
import type { RoadKind } from '../types.ts'
import type { WorldLot, WorldRoad } from '../world.ts'
import { lift, runs, slerp, unit } from './lines.ts'

/** A road being settled: its course, the height of its centerline over the planet's radius at each point, and what each segment is built as. */
export interface BedRoad {
  readonly id: number
  readonly kind: RoadKind
  readonly closed: boolean
  readonly width: number
  line: Vec3[]
  heights: Float32Array
  structure: Uint8Array
  readonly lot?: WorldLot
}

/** Whether a road is the ground, shaped to it: everything but the highway, which rides its own embankment. */
function isSurface(road: { kind: RoadKind }): boolean {
  return road.kind !== 'highway'
}

/** A built road, to be settled: its centerline's heights, below its surface where it is a deck. */
export function bedOf(road: WorldRoad, radius: number): BedRoad {
  const drop = isSurface(road) ? 0 : ROAD_SURFACE
  return {
    id: road.id,
    kind: road.kind,
    closed: road.closed,
    width: road.widths[0]!,
    line: road.points.map(unit),
    heights: Float32Array.from(road.points, (point) => Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) - radius - drop),
    structure: Uint8Array.from(road.structure),
    ...(road.lot === undefined ? {} : { lot: road.lot }),
  }
}

/** A settled road as the world has it: its surface at each point. */
export function roadOfBed(road: BedRoad, radius: number): WorldRoad {
  const rise = isSurface(road) ? 0 : ROAD_SURFACE
  return {
    id: road.id,
    kind: road.kind,
    closed: road.closed,
    points: road.line.map((direction, i) => lift(direction, radius, road.heights[i]! + rise)),
    widths: new Float32Array(road.line.length).fill(road.width),
    structure: road.structure,
    ...(road.lot === undefined ? {} : { lot: road.lot }),
  }
}

/** The planet's ground, with its grid's neighbors and directions, and a scratch mark for each point. */
export interface Ground {
  readonly ground: SphereGround
  readonly neighbors: Int32Array
  readonly directions: Float64Array
  /** How far apart the grid's points are, about. */
  readonly spacing: number
  readonly marks: Int32Array
  mark: number
}

export function groundOf(ground: SphereGround, neighbors: Int32Array, directions: Float64Array): Ground {
  return { ground, neighbors, directions, spacing: (ground.radius * Math.PI) / 2 / ground.n, marks: new Int32Array(ground.heights.length), mark: 0 }
}

const place: GridPlace = { face: 0, i: 0, j: 0 }

/**
 * Every grid point within `reach` along the ground of a segment between
 * two ways out, with how far along the segment it lies nearest, 0 to 1, and
 * how far from it.
 */
function eachNearSegment(on: Ground, a: Vec3, b: Vec3, reach: number, visit: (at: number, t: number, distance: number) => void): void {
  const { ground, neighbors, directions, marks, spacing } = on
  const { radius } = ground
  const mark = ++on.mark
  const vx = (b.x - a.x) * radius
  const vy = (b.y - a.y) * radius
  const vz = (b.z - a.z) * radius
  const lengthSq = vx * vx + vy * vy + vz * vz || 1
  gridPlace(ground.n, unit({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), place)
  const start = groundIndex(ground, place.face, Math.round(place.i), Math.round(place.j))
  marks[start] = mark
  const stack = [start]
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    const px = directions[at * 3]! * radius - a.x * radius
    const py = directions[at * 3 + 1]! * radius - a.y * radius
    const pz = directions[at * 3 + 2]! * radius - a.z * radius
    const t = Math.min(Math.max((px * vx + py * vy + pz * vz) / lengthSq, 0), 1)
    const dx = px - vx * t
    const dy = py - vy * t
    const dz = pz - vz * t
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (distance > reach + spacing * 2) continue
    if (distance <= reach) visit(at, t, distance)
    for (let k = 0; k < 8; k++) {
      const next = neighbors[at * 8 + k]!
      if (next < 0 || marks[next] === mark) continue
      marks[next] = mark
      stack.push(next)
    }
  }
}

/** A grid point's offset from a way out, on the planet's radius. */
function offset(on: Ground, at: number, from: Vec3): Vec3 {
  const { directions, ground } = on
  const r = ground.radius
  return { x: (directions[at * 3]! - from.x) * r, y: (directions[at * 3 + 1]! - from.y) * r, z: (directions[at * 3 + 2]! - from.z) * r }
}

/** The way along the ground from one way out toward another, of unit length. */
function wayAlong(from: Vec3, to: Vec3): Vec3 {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const rise = dx * from.x + dy * from.y + dz * from.z
  return unit({ x: dx - from.x * rise, y: dy - from.y * rise, z: dz - from.z * rise })
}

/** Where a road's at-grade run meets a bridge, and which way the deck leaves it. */
interface Shore {
  readonly at: Vec3
  readonly way: Vec3
}

function shoresOf(road: BedRoad): Shore[] {
  const count = road.line.length
  const segments = road.closed ? count : count - 1
  const shores: Shore[] = []
  const structureAt = (i: number): number | undefined => (road.closed ? road.structure[((i % segments) + segments) % segments] : road.structure[i])
  for (let i = 0; i < segments; i++) {
    if (road.structure[i] !== ROAD_BRIDGE) continue
    const a = road.line[i]!
    const b = road.line[(i + 1) % count]!
    if (structureAt(i - 1) === ROAD_GRADE) shores.push({ at: a, way: wayAlong(a, b) })
    if (structureAt(i + 1) === ROAD_GRADE) shores.push({ at: b, way: wayAlong(b, a) })
  }
  return shores
}

/** How far past the nearest shore, along the way its deck leaves, a grid point lies within this reach of one, or `Infinity`. */
function pastShore(on: Ground, shores: readonly Shore[], at: number, within: number): number {
  let past = Infinity
  for (const shore of shores) {
    const d = offset(on, at, shore.at)
    if (d.x * d.x + d.y * d.y + d.z * d.z > within * within) continue
    past = Math.min(past, d.x * shore.way.x + d.y * shore.way.y + d.z * shore.way.z)
  }
  return past
}

/** Whether a grid point within this reach of a shore lies past it, out under the deck. */
function beyondShore(on: Ground, shore: Shore, at: number, within: number): boolean {
  const d = offset(on, at, shore.at)
  if (d.x * d.x + d.y * d.y + d.z * d.z > within * within) return false
  return d.x * shore.way.x + d.y * shore.way.y + d.z * shore.way.z > 0
}

/**
 * Every grid point under a surface road's at-grade roadway. A run ends
 * square at the shore where it meets a bridge: the ground past it is under
 * the deck, and is cut clear of that rather than kept as road.
 */
export function surfaceRoadPoints(on: Ground, roads: readonly BedRoad[]): Uint8Array {
  const points = new Uint8Array(on.ground.heights.length)
  for (const road of roads) {
    const count = road.line.length
    const segments = road.closed ? count : count - 1
    const flat = road.width / 2 + on.spacing
    const shores = shoresOf(road)
    for (let i = 0; i < segments; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      eachNearSegment(on, road.line[i]!, road.line[(i + 1) % count]!, flat, (at) => {
        if (shores.some((shore) => beyondShore(on, shore, at, 2 * flat))) return
        points[at] = 1
      })
    }
  }
  return points
}

/** Every grid point under a built road's roadway, whatever it is built as. */
function builtRoadPoints(on: Ground, roads: readonly BedRoad[]): Uint8Array {
  const points = new Uint8Array(on.ground.heights.length)
  for (const road of roads) {
    const count = road.line.length
    const segments = road.closed ? count : count - 1
    for (let i = 0; i < segments; i++) eachNearSegment(on, road.line[i]!, road.line[(i + 1) % count]!, road.width / 2, (at) => (points[at] = 1))
  }
  return points
}

/**
 * Where the highway's cut must not rise into a wall again: beside each
 * ramp's lane as it runs out from under the deck, out to the lane's
 * shoulder, where a wall would stand proud of the deck the lane leaves.
 */
export function rampLanePoints(on: Ground, roads: readonly BedRoad[]): Uint8Array {
  const points = new Uint8Array(on.ground.heights.length)
  const reach = RAMP_WIDTH / 2 + SURFACE_SHOULDER
  for (const road of roads) {
    if (road.kind !== 'ramp') continue
    const lengths = runs(road.line, on.ground.radius, false)
    let traveled = 0
    for (let i = 0; i + 1 < road.line.length && traveled < RAMP_LANE_REACH; i++) {
      eachNearSegment(on, road.line[i]!, road.line[i + 1]!, reach, (at) => (points[at] = 1))
      traveled += lengths[i]!
    }
  }
  return points
}

/**
 * Cut the ground down under every segment of these roads `carved` takes,
 * so rising ground never pokes through the ribbon. Only cuts are made, never
 * fills; within one road only the nearest stretch cuts a point, and points
 * in `keep` are left alone. The cut's wall rises again beyond the roadway,
 * but where `wallHeld` is marked.
 */
export function carveRoadBeds(
  on: Ground,
  roads: readonly BedRoad[],
  keep: Uint8Array,
  carved: (structure: number) => boolean = (structure) => structure !== ROAD_TUNNEL,
  wallHeld: Uint8Array | null = null,
): void {
  const { heights } = on.ground
  const nearest = new Float32Array(heights.length).fill(Infinity)
  const cut = new Float32Array(heights.length)
  const touched: number[] = []
  for (const road of roads) {
    const count = road.line.length
    const segments = road.closed ? count : count - 1
    const flat = road.width / 2 + on.spacing
    const reach = flat + on.spacing * 5
    // At a surface road's shore the ground is only let fall away from under the deck over the next few points.
    const shores = isSurface(road) ? shoresOf(road) : []
    for (let i = 0; i < segments; i++) {
      if (!carved(road.structure[i]!)) continue
      const ha = road.heights[i]!
      const hb = road.heights[(i + 1) % count]!
      eachNearSegment(on, road.line[i]!, road.line[(i + 1) % count]!, reach, (at, t, distance) => {
        if (keep[at] === 1 || distance >= nearest[at]!) return
        if (nearest[at] === Infinity) touched.push(at)
        nearest[at] = distance
        const clearance = CUT_CLEARANCE * smoothstep(0, 2 * on.spacing, pastShore(on, shores, at, 2 * flat))
        const wall = wallHeld !== null && wallHeld[at] ? 0 : Math.max(0, distance - flat) * CUT_SLOPE
        cut[at] = ha + (hb - ha) * t - clearance + wall
      })
    }
    for (const at of touched) {
      if (heights[at]! > cut[at]!) heights[at] = cut[at]!
      nearest[at] = Infinity
    }
    touched.length = 0
  }
}

/** A ramp's mouth: where it starts, the way it leaves, and the deck's own grade there, along that way. */
interface Mouth {
  readonly at: Vec3
  readonly way: Vec3
  readonly grade: number
}

function mouthOf(road: BedRoad, built: readonly BedRoad[], radius: number): Mouth | null {
  if (road.kind !== 'ramp' || road.line.length < 2) return null
  const first = road.line[0]!
  const way = wayAlong(first, road.line[1]!)
  let grade = 0
  let best = Infinity
  for (const deck of built) {
    if (deck.kind !== 'highway') continue
    const count = deck.line.length
    for (let i = 0; i < count; i++) {
      const point = deck.line[i]!
      const dx = point.x - first.x
      const dy = point.y - first.y
      const dz = point.z - first.z
      const distance = dx * dx + dy * dy + dz * dz
      if (distance >= best) continue
      best = distance
      const before = deck.closed ? (i - 1 + count) % count : Math.max(i - 1, 0)
      const after = deck.closed ? (i + 1) % count : Math.min(i + 1, count - 1)
      const prev = deck.line[before]!
      const next = deck.line[after]!
      const sx = (next.x - prev.x) * radius
      const sy = (next.y - prev.y) * radius
      const sz = (next.z - prev.z) * radius
      const run = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
      grade = ((deck.heights[after]! - deck.heights[before]!) / run) * ((sx * way.x + sy * way.y + sz * way.z) / run)
    }
  }
  return { at: first, way, grade }
}

/**
 * Shape the ground to every surface road. Across the roadway the ground is
 * the road's own profile; the shoulders blend back to the land beside it.
 * Where two roadways overlap their profiles are averaged, but a road's
 * shoulder never reshapes the road beside it. Bridges are left alone, and
 * points in `keepOff` are never touched.
 */
function stampRoadBeds(on: Ground, roads: readonly BedRoad[], keepOff: Uint8Array, built: readonly BedRoad[]): void {
  const { heights, radius } = on.ground
  const original = Float32Array.from(heights)
  const count = heights.length
  const roadWeightSum = new Float32Array(count)
  const bedSum = new Float32Array(count)
  const landWeightMax = new Float32Array(count)
  const nearest = new Float32Array(count).fill(Infinity)
  const nearestBed = new Float32Array(count)
  const touched: number[] = []
  for (const road of roads) {
    const points = road.line.length
    const segments = road.closed ? points : points - 1
    const half = road.width / 2
    const flat = half + on.spacing
    const reach = flat + SURFACE_SHOULDER
    const mouth = mouthOf(road, built, radius)
    for (let i = 0; i < segments; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const ha = road.heights[i]!
      const hb = road.heights[(i + 1) % points]!
      eachNearSegment(on, road.line[i]!, road.line[(i + 1) % points]!, reach, (at, t, distance) => {
        // Behind a ramp's mouth only its first stretch has any say, carrying the deck's grade on behind it.
        let behind = 0
        if (mouth !== null) {
          const d = offset(on, at, mouth.at)
          behind = d.x * mouth.way.x + d.y * mouth.way.y + d.z * mouth.way.z
        }
        if (behind < 0 && i > 0) return
        if (distance >= nearest[at]!) return
        if (nearest[at] === Infinity) touched.push(at)
        nearest[at] = distance
        nearestBed[at] = behind < 0 && mouth !== null ? ha + mouth.grade * behind : ha + (hb - ha) * t
      })
    }
    for (const at of touched) {
      const distance = nearest[at]!
      const land = 1 - smoothstep(flat, reach, distance)
      const contest = 1 - smoothstep(half, flat + on.spacing, distance) + land * 0.01
      roadWeightSum[at] = roadWeightSum[at]! + contest
      bedSum[at] = bedSum[at]! + contest * nearestBed[at]!
      if (land > landWeightMax[at]!) landWeightMax[at] = land
      nearest[at] = Infinity
    }
    touched.length = 0
  }
  for (let at = 0; at < count; at++) {
    const weight = landWeightMax[at]!
    if (weight <= 0 || keepOff[at]) continue
    const bed = bedSum[at]! / roadWeightSum[at]!
    heights[at] = original[at]! + (bed - original[at]!) * weight
  }
}

/** Lay a surface road's points out evenly, no further apart than this; a new segment takes the structure of the old one its middle lies in. */
function resampleSurfaceRoad(road: BedRoad, spacing: number, radius: number): void {
  const { line, heights, structure } = road
  if (road.closed || line.length < 2) return
  const lengths = runs(line, radius, false)
  const cumulative = [0]
  for (let i = 1; i < line.length; i++) cumulative.push(cumulative[i - 1]! + lengths[i - 1]!)
  const total = cumulative[cumulative.length - 1]!
  const steps = Math.max(1, Math.ceil(total / spacing))
  const at = (distance: number): { segment: number; t: number } => {
    let i = 1
    while (i < cumulative.length - 1 && cumulative[i]! < distance) i++
    const span = cumulative[i]! - cumulative[i - 1]! || 1
    return { segment: i - 1, t: Math.min(Math.max((distance - cumulative[i - 1]!) / span, 0), 1) }
  }
  const nextLine: Vec3[] = []
  const nextHeights = new Float32Array(steps + 1)
  const codes = new Uint8Array(steps)
  for (let k = 0; k <= steps; k++) {
    if (k === 0 || k === steps) {
      const end = k === 0 ? 0 : line.length - 1
      nextLine.push(line[end]!)
      nextHeights[k] = heights[end]!
    } else {
      const { segment, t } = at((total * k) / steps)
      nextLine.push(slerp(line[segment]!, line[segment + 1]!, t))
      nextHeights[k] = heights[segment]! + (heights[segment + 1]! - heights[segment]!) * t
    }
    if (k < steps) codes[k] = structure[at((total * (k + 0.5)) / steps).segment]!
  }
  road.line = nextLine
  road.heights = nextHeights
  road.structure = codes
}

function surfaceGradeLimit(road: BedRoad): number {
  if (road.kind === 'ramp') return MAX_RAMP_GRADE
  if (road.kind === 'climb') return MAX_CLIMB_GRADE
  return road.kind === 'arterial' ? MAX_ARTERIAL_GRADE : MAX_ROAD_GRADE
}

/** Hold a road to its grade from end to end, and ease the crests and sags of every at-grade run to its curvature limit. */
function limitSurfaceRoadGrade(road: BedRoad, radius: number): void {
  const { heights, structure } = road
  const lengths = runs(road.line, radius, false)
  limitSweepGradeAlong(heights, lengths, surfaceGradeLimit(road))
  const curvature = road.kind === 'ramp' ? MAX_RAMP_CURVATURE : MAX_ROAD_CURVATURE
  let start = 0
  for (let i = 0; i <= structure.length; i++) {
    if (i < structure.length && structure[i] === ROAD_GRADE) continue
    if (i > start) {
      const run = heights.subarray(start, i + 1)
      limitVerticalCurvatureAlong(run, lengths.subarray(start, i + 1), curvature, false)
    }
    start = i + 1
  }
}

/**
 * Hold every bridge of a settled road up to the shores it leaves from: at
 * least the straight line from one shore to the other, and from either
 * falling no faster than the road's grade.
 */
function holdBridgeDecks(road: BedRoad, radius: number): void {
  const { heights, structure } = road
  if (road.closed) return
  const grade = surfaceGradeLimit(road)
  const lengths = runs(road.line, radius, false)
  let start = 0
  for (let i = 0; i <= structure.length; i++) {
    if (i < structure.length && structure[i] === ROAD_BRIDGE) continue
    if (i > start) {
      let length = 0
      for (let k = start; k < i; k++) length += lengths[k]!
      let along = 0
      for (let k = start + 1; k < i; k++) {
        along += lengths[k - 1]!
        const chord = heights[start]! + (heights[i]! - heights[start]!) * (along / (length || 1))
        heights[k] = Math.max(heights[k]!, chord)
      }
      for (let k = start + 1; k < i; k++) heights[k] = Math.max(heights[k]!, heights[k - 1]! - grade * lengths[k - 1]!)
      for (let k = i - 1; k > start; k--) heights[k] = Math.max(heights[k]!, heights[k + 1]! - grade * lengths[k]!)
    }
    start = i + 1
  }
}

/** Put every surface road's points on the ground now shaped to them, but for points out on a bridge. */
function seatSurfaceRoads(ground: SphereGround, roads: readonly BedRoad[]): void {
  for (const road of roads) {
    const count = road.line.length
    const segments = road.closed ? count : count - 1
    for (let i = 0; i < count; i++) {
      const before = i > 0 ? road.structure[i - 1] : road.closed ? road.structure[count - 1] : ROAD_GRADE
      const after = i < segments ? road.structure[i] : ROAD_GRADE
      if (before === ROAD_BRIDGE && after === ROAD_BRIDGE) continue
      road.heights[i] = sphereHeight(ground, road.line[i]!)
    }
  }
}

/**
 * Settle the surface roads: laid out at the grid's own spacing, then the
 * ground stamped to them and they seated on it, over and over, each time
 * held to their grades and their bridges to their shores.
 */
export function settleSurfaceRoads(on: Ground, roads: readonly BedRoad[], built: readonly BedRoad[]): void {
  const { ground } = on
  for (const road of roads) resampleSurfaceRoad(road, on.spacing, ground.radius)
  // The ground under a deck stays as it was cut, but where a surface road runs under it.
  const keepOff = builtRoadPoints(on, built)
  const roadways = surfaceRoadPoints(on, roads)
  for (let at = 0; at < keepOff.length; at++) if (roadways[at]) keepOff[at] = 0
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    stampRoadBeds(on, roads, keepOff, built)
    seatSurfaceRoads(ground, roads)
    for (const road of roads) {
      holdBridgeDecks(road, ground.radius)
      limitSurfaceRoadGrade(road, ground.radius)
    }
  }
  stampRoadBeds(on, roads, keepOff, built)
  seatSurfaceRoads(ground, roads)
  for (const road of roads) holdBridgeDecks(road, ground.radius)
}
