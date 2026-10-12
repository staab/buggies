/**
 * The roads of the worlds past the planet, which have no highway, no
 * interchanges and no streets: routed over the ground or run straight
 * across it from one place to another, and then settled into the ground or
 * the ground stamped flat under them, as each world wants.
 */

import type { Vec3 } from '@buggies/physics'

import { ARTERIAL_MIN_RADIUS, ROAD_GRADE, SAMPLE_STEP } from '../roads/constants.ts'
import { limitSweepGradeAlong } from '../roads/grades.ts'
import { smoothstep } from '../noise.ts'
import { sphereHeight } from '../sphere.ts'
import type { RoadKind } from '../types.ts'
import type { WorldRoad } from '../world.ts'
import { bedOf, groundOf, roadOfBed, settleSurfaceRoads } from '../globe/beds.ts'
import { angleBetween, easeTurns, lift, resample, runs, smooth, unit } from '../globe/lines.ts'
import { buildNav, navDirection, navPoint, route, type Nav } from '../globe/nav.ts'
import { eachPointNear, type Land } from '../globe/placing.ts'
import { nearestOn } from '../globe/segments.ts'

/** How much a step's climb counts against it, over its length, when a road is routed. */
const SLOPE_COST = 40
/** How many steps a route may look at before it is given up. */
const ROUTE_MOST = 400_000

/** The routing grid over a world's land. */
export function navOf(land: Land): Nav {
  return buildNav(land.ground, land.water, land.seaLevel)
}

/**
 * A way over the ground from one way out to another that climbs no
 * steeper than `steepest`, keeping out of wherever `barred` says, eased
 * into a line that turns no tighter than an arterial; or nothing where
 * there is none.
 */
export function routeLine(nav: Nav, from: Vec3, to: Vec3, steepest: number, barred: (p: Vec3) => boolean = () => false): Vec3[] | null {
  const start = navPoint(nav, from)
  const goal = navPoint(nav, to)
  const way = route(
    nav,
    start,
    goal,
    (a, b, run) => {
      const grade = Math.abs(nav.ground[b]! - nav.ground[a]!) / run
      if (grade > steepest) return Infinity
      if (b !== goal && barred(navDirection(nav, b))) return Infinity
      return run + grade * SLOPE_COST * run
    },
    null,
    ROUTE_MOST,
  )
  if (way === null) return null
  const line = way.map((at) => navDirection(nav, at))
  line[0] = from
  line[line.length - 1] = to
  const radius = nav.grid.radius
  const course = smooth(resample(line, SAMPLE_STEP * 3, radius, false), 6, false)
  return resample(easeTurns(course, ARTERIAL_MIN_RADIUS, radius, false, 300), SAMPLE_STEP, radius, false)
}

/** A road along a line on the ground, at grade all the way: on the ground under it, held to this grade, or at the heights given. */
export function roadAlong(id: number, kind: RoadKind, line: readonly Vec3[], width: number, land: Land, steepest: number, heights?: Float32Array): WorldRoad {
  const { radius } = land
  const levels = heights ?? Float32Array.from(line, (p) => sphereHeight(land.ground, p))
  if (heights === undefined) limitSweepGradeAlong(levels, runs(line, radius, false), steepest)
  return {
    id,
    kind,
    closed: false,
    points: line.map((p, i) => lift(p, radius, levels[i]!)),
    widths: new Float32Array(line.length).fill(width),
    structure: new Uint8Array(line.length - 1).fill(ROAD_GRADE),
  }
}

/** Settle surface roads into the ground, the ground shaped to them and they seated on it, as a planet's are. */
export function settleRoads(land: Land, roads: readonly WorldRoad[]): WorldRoad[] {
  const on = groundOf(land.ground, land.neighbors, land.directions)
  const beds = roads.map((road) => bedOf(road, land.radius))
  settleSurfaceRoads(on, beds, [])
  return beds.map((road) => roadOfBed(road, land.radius))
}

/**
 * Stamp the ground flat under a road: level with it across its roadway,
 * and eased back into the ground as it was over `shoulder` beyond, so the
 * road runs flat however the ground rolls about it.
 */
export function stampRoad(land: Land, road: WorldRoad, shoulder: number): void {
  const { ground, radius } = land
  const half = road.widths[0]! / 2
  const best = new Map<number, number>()
  const levelOf = new Map<number, number>()
  const original = ground.heights
  for (let i = 0; i + 1 < road.points.length; i++) {
    const a = road.points[i]!
    const b = road.points[i + 1]!
    const ua = unit(a)
    const ub = unit(b)
    const ha = heightOf(a, radius)
    const hb = heightOf(b, radius)
    const middle = unit({ x: ua.x + ub.x, y: ua.y + ub.y, z: ua.z + ub.z })
    const reach = (angleBetween(ua, ub) * radius) / 2 + half + shoulder
    eachPointNear(land, middle, reach, (at, p) => {
      const { t, distance } = nearestOn(p, ua, ub, radius)
      if (distance > half + shoulder || distance >= (best.get(at) ?? Infinity)) return
      best.set(at, distance)
      levelOf.set(at, ha + (hb - ha) * t)
    })
  }
  for (const [at, distance] of best) {
    const level = levelOf.get(at)!
    const share = 1 - smoothstep(half + 1, half + Math.max(shoulder, 2), distance)
    original[at] = original[at]! + (level - original[at]!) * share
  }
}

function heightOf(p: Vec3, radius: number): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) - radius
}

/** Whether two roads would run into each other anywhere but within `ends` of their own ends. */
export function roadsMeet(a: readonly Vec3[], b: readonly Vec3[], gap: number, ends: number, radius: number): boolean {
  const near = (p: Vec3, line: readonly Vec3[]): boolean => angleBetween(p, line[0]!) * radius < ends || angleBetween(p, line.at(-1)!) * radius < ends
  for (const p of a) {
    if (near(p, a)) continue
    for (const q of b) {
      if (near(q, b)) continue
      if (angleBetween(p, q) * radius < gap) return true
    }
  }
  return false
}
