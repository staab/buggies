/**
 * A planet's city streets, laid out on the planet itself. Each city's grid
 * runs on circles about its middle: one set of streets on great circles
 * through a pair of poles off to its sides, the other on the circles that
 * cross them square, a street's spacing apart along the ground at the
 * city's middle. Each street is cut where it leaves the city, meets water
 * or comes too near the highway; trimmed where it runs along an arterial;
 * run on to the roads at its ends; joined to the network where its grid is
 * cut off; and dropped where it is a scrap going nowhere.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { DISTRICT_CITY } from '../districts.ts'
import {
  ARTERIAL_WIDTH,
  MAX_ROAD_GRADE,
  RAMP_WIDTH,
  ROAD_WIDTH,
  STREET_ARTERIAL_ANGLE,
  STREET_ARTERIAL_TOUCH,
  STREET_CLEARANCE,
  STREET_MIN_POINTS,
  STREET_SPACING,
  STREET_STEP,
  STREET_WIDTH,
} from '../roads/constants.ts'
import { limitSweepGradeAlong } from '../roads/grades.ts'
import { STREET_GRID_LEAST } from '../roads/streets.ts'
import { gridPlace, groundIndex, sphereHeight, type GridPlace } from '../sphere.ts'
import { tangentFrame } from '../sphere-heights.ts'
import { groundDirections, groundNeighbors } from '../sphere-water.ts'
import { DRY } from '../water.ts'
import type { WorldDistrict, WorldRoad } from '../world.ts'
import { waterAt, type Planet } from './highway.ts'
import { angleBetween, lift, runs, slerp, unit } from './lines.ts'
import { SegmentIndex, chordWay, nearestOn, onPlaneAt, piecesGap } from './segments.ts'

const { atan2, cos, sin } = exact

/** How far a connector is run from a cut-off grid to the road it joins, how far it may bend from the street it leaves, and how often its way is looked at. */
const CONNECT_REACH = 160
const CONNECT_BEND = (70 * Math.PI) / 180
const CONNECT_LOOK = 6
/** A city's grid is laid out only over as many of its points as this. */
const GRID_LEAST_POINTS = 8

/** A street as it is laid out: its course, its centerline's height at each point, and what each segment is. */
interface Street {
  line: Vec3[]
  heights: number[]
}

/** A city's grid: its middle and its two axes along the ground there, the second its first crossed with the way up, and how far the city reaches along each. */
export interface Grid {
  readonly middle: Vec3
  readonly u: Vec3
  readonly v: Vec3
  readonly uMin: number
  readonly uMax: number
  readonly vMin: number
  readonly vMax: number
}

/** The point of a grid this far along its first axis and its second, along the ground. */
export function gridPoint(grid: Grid, u: number, v: number, radius: number): Vec3 {
  const a = u / radius
  const b = v / radius
  const { middle: m, u: e, v: n } = grid
  const cb = cos(b)
  const ca = cos(a) * cb
  const sa = sin(a) * cb
  const sb = sin(b)
  return unit({ x: m.x * ca + e.x * sa + n.x * sb, y: m.y * ca + e.y * sa + n.y * sb, z: m.z * ca + e.z * sa + n.z * sb })
}

/** Where a way out lies on a grid: along its first axis and its second, along the ground. */
export function onGrid(grid: Grid, p: Vec3, radius: number): { u: number; v: number } {
  const m = p.x * grid.middle.x + p.y * grid.middle.y + p.z * grid.middle.z
  const e = p.x * grid.u.x + p.y * grid.u.y + p.z * grid.u.z
  const n = p.x * grid.v.x + p.y * grid.v.y + p.z * grid.v.z
  return { u: atan2(e, m) * radius, v: atan2(n, Math.sqrt(m * m + e * e)) * radius }
}

/**
 * A city's grid: centered on the middle of its city ground, and turned to
 * its principal axes there, so the streets run edge to edge across it and
 * the blocks between them are simple rectangles. `null` for a city too
 * small to have one.
 */
function cityGrid(planet: Planet, city: WorldDistrict, cityPoints: readonly Vec3[]): Grid | null {
  const { radius } = planet.ground
  if (cityPoints.length < GRID_LEAST_POINTS) return null
  const { east, north } = tangentFrame(city.center)
  const flat = cityPoints.map((p) => {
    const across = { x: p.x - city.center.x, y: p.y - city.center.y, z: p.z - city.center.z }
    return { x: (across.x * east.x + across.y * east.y + across.z * east.z) * radius, z: (across.x * north.x + across.y * north.y + across.z * north.z) * radius }
  })
  let cx = 0
  let cz = 0
  for (const p of flat) {
    cx += p.x
    cz += p.z
  }
  cx /= flat.length
  cz /= flat.length
  let sxx = 0
  let szz = 0
  let sxz = 0
  for (const p of flat) {
    sxx += (p.x - cx) * (p.x - cx)
    szz += (p.z - cz) * (p.z - cz)
    sxz += (p.x - cx) * (p.z - cz)
  }
  const angle = 0.5 * atan2(2 * sxz, sxx - szz)
  const middle = unit({
    x: city.center.x * radius + east.x * cx + north.x * cz,
    y: city.center.y * radius + east.y * cx + north.y * cz,
    z: city.center.z * radius + east.z * cx + north.z * cz,
  })
  const frame = tangentFrame(middle)
  const c = cos(angle)
  const s = sin(angle)
  const u = { x: frame.east.x * c + frame.north.x * s, y: frame.east.y * c + frame.north.y * s, z: frame.east.z * c + frame.north.z * s }
  const v = { x: u.y * middle.z - u.z * middle.y, y: u.z * middle.x - u.x * middle.z, z: u.x * middle.y - u.y * middle.x }
  const grid = { middle, u, v, uMin: Infinity, uMax: -Infinity, vMin: Infinity, vMax: -Infinity }
  for (const p of cityPoints) {
    const at = onGrid(grid, p, radius)
    grid.uMin = Math.min(grid.uMin, at.u)
    grid.uMax = Math.max(grid.uMax, at.u)
    grid.vMin = Math.min(grid.vMin, at.v)
    grid.vMax = Math.max(grid.vMax, at.v)
  }
  return grid
}

/** The grid points of the planet's ground in a city: its own district's, within its reach of its middle. */
function cityPointsOf(planet: Planet, districtOf: Uint8Array, neighbors: Int32Array, directions: Float64Array, city: WorldDistrict): Vec3[] {
  const { ground } = planet
  const place: GridPlace = { face: 0, i: 0, j: 0 }
  gridPlace(ground.n, city.center, place)
  const start = groundIndex(ground, place.face, Math.round(place.i), Math.round(place.j))
  const seen = new Set([start])
  const stack = [start]
  const points: Vec3[] = []
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    const p = { x: directions[at * 3]!, y: directions[at * 3 + 1]!, z: directions[at * 3 + 2]! }
    if (angleBetween(p, city.center) * ground.radius > city.radius) continue
    if (districtOf[at] === DISTRICT_CITY) points.push(p)
    for (let k = 0; k < 8; k++) {
      const next = neighbors[at * 8 + k]!
      if (next < 0 || seen.has(next)) continue
      seen.add(next)
      stack.push(next)
    }
  }
  return points
}

/** Whether a point is in the planet's own district grid as a city. */
function inCity(planet: Planet, districtOf: Uint8Array, p: Vec3): boolean {
  const place: GridPlace = { face: 0, i: 0, j: 0 }
  gridPlace(planet.ground.n, p, place)
  return districtOf[groundIndex(planet.ground, place.face, Math.round(place.i), Math.round(place.j))] === DISTRICT_CITY
}

/** Whether a point lies inside a ring of points about it, on the plane touching the planet at its first. */
function insideRing(ring: readonly Vec3[], p: Vec3, radius: number): boolean {
  const plane = onPlaneAt(unit(ring[0]!), tangentFrame(unit(ring[0]!)).east, radius)
  const flat = ring.map((point) => plane(unit(point)))
  const { x, z } = plane(p)
  let inside = false
  for (let i = 0, j = flat.length - 1; i < flat.length; j = i++) {
    const a = flat[i]!
    const b = flat[j]!
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

/**
 * Lay out and settle the streets of every city of a planet. `roads` are
 * the roads already built, which the streets meet and keep clear of;
 * `footprints` are the ground each interchange takes, which they keep off.
 */
export function buildGlobeStreets(
  planet: Planet,
  districtOf: Uint8Array,
  roads: readonly WorldRoad[],
  footprints: readonly Vec3[][],
  firstId: number,
): { streets: WorldRoad[]; grids: (Grid | null)[] } {
  const { ground, seaLevel } = planet
  const { radius } = ground
  const neighbors = groundNeighbors(ground)
  const directions = groundDirections(ground)

  // The highway and its ramps keep streets a highway's width off, and the interchanges keep them out altogether.
  const keep = new SegmentIndex<number>(radius)
  const targets = new SegmentIndex<{ heights: [number, number] }>(radius)
  const arterials = new SegmentIndex<number>(radius)
  const heightOf = (point: Vec3): number => Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) - radius
  for (const road of roads) {
    const count = road.points.length
    const segments = road.closed ? count : count - 1
    const line = road.points.map(unit)
    for (let i = 0; i < segments; i++) {
      const a = line[i]!
      const b = line[(i + 1) % count]!
      const width = road.widths[0]!
      if (width === ROAD_WIDTH || width === RAMP_WIDTH) keep.add(a, b, (width + STREET_WIDTH) / 2 + STREET_CLEARANCE)
      if (road.kind === 'arterial' || road.kind === 'cross') targets.add(a, b, { heights: [heightOf(road.points[i]!), heightOf(road.points[(i + 1) % count]!)] })
      if (road.kind === 'arterial') arterials.add(a, b, 0)
    }
  }
  const hulls = footprints.map((hull) => ({ hull, middle: unit(hull[0]!) }))
  const blocked = (p: Vec3): boolean => {
    for (const { hull, middle } of hulls) if (angleBetween(middle, p) * radius < 400 && insideRing(hull, p, radius)) return true
    return keep.around(p, ROAD_WIDTH + STREET_CLEARANCE).some((segment) => nearestOn(p, segment.a, segment.b, radius).distance < segment.data)
  }
  const wetAt = (p: Vec3): boolean => waterAt(planet, p) !== DRY || sphereHeight(ground, p) <= seaLevel

  // Each city's grid, cut into runs wherever it leaves the city, meets water or is blocked.
  let streets: Street[] = []
  const addRun = (run: Vec3[]): void => {
    if (run.length < STREET_MIN_POINTS) return
    const heights = Float32Array.from(run, (p) => sphereHeight(ground, p))
    limitSweepGradeAlong(heights, runs(run, radius, false), MAX_ROAD_GRADE)
    streets.push({ line: run, heights: Array.from(heights) })
  }
  const addRuns = (samples: Vec3[]): void => {
    let run: Vec3[] = []
    for (const p of samples) {
      if (inCity(planet, districtOf, p) && sphereHeight(ground, p) > seaLevel && !blocked(p)) run.push(p)
      else {
        addRun(run)
        run = []
      }
    }
    addRun(run)
  }
  const grids = planet.districts.map((city) => cityGrid(planet, city, cityPointsOf(planet, districtOf, neighbors, directions, city)))
  for (const grid of grids) {
    if (grid === null) continue
    // The samples fall on whole steps of the grid, so every crossing of two streets is a sample of both and they meet there exactly.
    for (let v = Math.ceil(grid.vMin / STREET_SPACING) * STREET_SPACING; v <= grid.vMax; v += STREET_SPACING) {
      const samples: Vec3[] = []
      for (let u = Math.ceil(grid.uMin / STREET_STEP) * STREET_STEP; u <= grid.uMax; u += STREET_STEP) samples.push(gridPoint(grid, u, v, radius))
      addRuns(samples)
    }
    for (let u = Math.ceil(grid.uMin / STREET_SPACING) * STREET_SPACING; u <= grid.uMax; u += STREET_SPACING) {
      const samples: Vec3[] = []
      for (let v = Math.ceil(grid.vMin / STREET_STEP) * STREET_STEP; v <= grid.vMax; v += STREET_STEP) samples.push(gridPoint(grid, u, v, radius))
      addRuns(samples)
    }
  }

  streets = trimAlongArterials(streets, arterials, radius)
  for (const street of streets) joinToRoads(street, targets, blocked, radius)
  streets.push(...connectGrids(streets, targets, blocked, wetAt, planet))
  streets = pruneStranded(streets, roads, radius)
  const built = streets.map((street, index): WorldRoad => ({
    id: firstId + index,
    kind: 'street',
    closed: false,
    points: street.line.map((p, i) => lift(p, radius, street.heights[i]!)),
    widths: new Float32Array(street.line.length).fill(STREET_WIDTH),
    structure: new Uint8Array(street.line.length - 1),
  }))
  return { streets: built, grids }
}

/** The way a grid's first axis runs along the ground at a point of it, of unit length. */
export function gridAxis(grid: Grid, u: number, v: number, radius: number): Vec3 {
  const way = chordWay(gridPoint(grid, u - 0.5, v, radius), gridPoint(grid, u + 0.5, v, radius))
  const at = gridPoint(grid, u, v, radius)
  const rise = way.x * at.x + way.y * at.y + way.z * at.z
  return unit({ x: way.x - at.x * rise, y: way.y - at.y * rise, z: way.z - at.z * rise })
}

/** Whether a piece of street between two points would overlap an arterial it meets shallower than square. */
function clashes(arterials: SegmentIndex<number>, a: Vec3, b: Vec3, radius: number): boolean {
  const way = chordWay(a, b)
  const square = cos(STREET_ARTERIAL_ANGLE)
  const middle = unit({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
  const reach = angleBetween(a, b) * radius + STREET_ARTERIAL_TOUCH
  for (const segment of arterials.around(middle, reach)) {
    const along = Math.abs(segment.way.x * way.x + segment.way.y * way.y + segment.way.z * way.z)
    if (along > square && piecesGap(a, b, segment.a, segment.b, radius) < STREET_ARTERIAL_TOUCH) return true
  }
  return false
}

/**
 * Cut out every stretch where a street runs alongside an arterial instead
 * of crossing it: the two would smear into one road. Whatever is left
 * either side carries on as its own street, its cut ends walked on up to
 * the last of the ground they can hold, and what is too short to span a
 * block is dropped.
 */
function trimAlongArterials(streets: readonly Street[], arterials: SegmentIndex<number>, radius: number): Street[] {
  const advance = (from: Vec3, fromHeight: number, to: Vec3, toHeight: number): { p: Vec3; height: number } | null => {
    let clearT = 0
    let blockedT = 1
    for (let step = 0; step < 8; step++) {
      const t = (clearT + blockedT) / 2
      if (clashes(arterials, from, slerp(from, to, t), radius)) blockedT = t
      else clearT = t
    }
    if (clearT < 1e-3) return null
    return { p: slerp(from, to, clearT), height: fromHeight + (toHeight - fromHeight) * clearT }
  }
  const trimmed: Street[] = []
  for (const street of streets) {
    const { line, heights } = street
    const clear = line.map(() => true)
    for (let i = 0; i + 1 < line.length; i++) {
      if (!clashes(arterials, line[i]!, line[i + 1]!, radius)) continue
      clear[i] = false
      clear[i + 1] = false
    }
    if (clear.every(Boolean)) {
      trimmed.push(street)
      continue
    }
    for (let start = 0; start < line.length; ) {
      if (!clear[start]) {
        start++
        continue
      }
      let end = start
      while (end + 1 < line.length && clear[end + 1]) end++
      if (end - start + 1 >= STREET_MIN_POINTS) {
        const run = { line: line.slice(start, end + 1), heights: heights.slice(start, end + 1) }
        const head = start > 0 ? advance(line[start]!, heights[start]!, line[start - 1]!, heights[start - 1]!) : null
        if (head) {
          run.line.unshift(head.p)
          run.heights.unshift(head.height)
        }
        const tail = end + 1 < line.length ? advance(line[end]!, heights[end]!, line[end + 1]!, heights[end + 1]!) : null
        if (tail) {
          run.line.push(tail.p)
          run.heights.push(tail.height)
        }
        trimmed.push(run)
      }
      start = end + 1
    }
  }
  return trimmed
}

/** Whether a street run from one point to another would smear along one of the roads it may meet: pass beside a piece of one shallower than square. */
function smearsAlong(targets: SegmentIndex<unknown>, from: Vec3, to: Vec3, radius: number): boolean {
  const length = angleBetween(from, to) * radius
  if (length === 0) return false
  const way = chordWay(from, to)
  const square = cos(STREET_ARTERIAL_ANGLE)
  for (let s = 0; ; s = Math.min(s + CONNECT_LOOK, length)) {
    const p = slerp(from, to, s / length)
    for (const segment of targets.near(p, STREET_ARTERIAL_TOUCH + 1)) {
      if (Math.abs(segment.way.x * way.x + segment.way.y * way.y + segment.way.z * way.z) > square) return true
    }
    if (s >= length) return false
  }
}

/**
 * Run a street's ends on to the arterial or cross road each is heading
 * into, where one lies within a step or so beyond it, to meet it at its
 * centerline and its height in a flush tee. Nothing is done where the way
 * there is blocked, too steep, or would smear along a road.
 */
function joinToRoads(street: Street, targets: SegmentIndex<{ heights: [number, number] }>, blocked: (p: Vec3) => boolean, radius: number): void {
  const reach = STREET_STEP + STREET_ARTERIAL_TOUCH
  for (const atStart of [true, false]) {
    const count = street.line.length
    const end = street.line[atStart ? 0 : count - 1]!
    const before = street.line[atStart ? 1 : count - 2]!
    const height = street.heights[atStart ? 0 : count - 1]!
    // On the plane touching the planet at the end, the street runs out along its first axis.
    const plane = onPlaneAt(end, chordWay(before, end), radius)
    let best: { p: Vec3; height: number; along: number } | null = null
    for (const segment of targets.around(end, reach)) {
      const a = plane(segment.a)
      const b = plane(segment.b)
      if (Math.abs(b.z - a.z) < 1e-9) continue
      // Where the line from the end, straight on, crosses the piece.
      const t = a.z / (a.z - b.z)
      if (t < 0 || t > 1) continue
      const along = a.x + (b.x - a.x) * t
      if (along <= 0 || along >= (best?.along ?? reach)) continue
      best = { p: slerp(segment.a, segment.b, t), height: segment.data.heights[0] + (segment.data.heights[1] - segment.data.heights[0]) * t, along }
    }
    if (best === null || smearsAlong(targets, end, best.p, radius)) continue
    if (Math.abs(best.height - height) > best.along * MAX_ROAD_GRADE * 2) continue
    let clear = !blocked(best.p)
    for (let s = 3; s < best.along && clear; s += 3) clear = !blocked(slerp(end, best.p, s / best.along))
    if (!clear) continue
    if (atStart) {
      street.line.unshift(best.p)
      street.heights.unshift(best.height)
    } else {
      street.line.push(best.p)
      street.heights.push(best.height)
    }
  }
}

/** Whether two streets meet: their centerlines come within a roadway of each other. */
function meet(a: readonly Vec3[], b: readonly Vec3[], radius: number): boolean {
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      if (angleBetween(a[i]!, b[j]!) * radius > STREET_SPACING * 2) continue
      if (piecesGap(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!, radius) <= STREET_WIDTH) return true
    }
  }
  return false
}

/** Which streets meet, as groups, each named by one of its streets. */
function groupsOf(streets: readonly Street[], radius: number): (index: number) => number {
  const parent = streets.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!
    return index
  }
  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) {
      if (angleBetween(streets[i]!.line[0]!, streets[j]!.line[0]!) * radius > 1200) continue
      if (meet(streets[i]!.line, streets[j]!.line, radius)) parent[find(i)] = find(j)
    }
  }
  return find
}

/**
 * A street from each cut-off grid to the nearest arterial or cross road:
 * from the end of one of its streets, bending no further than a street may
 * from the one it leaves, meeting the road square, and keeping off the
 * water, the highway and every other such road on the way.
 */
function connectGrids(
  streets: readonly Street[],
  targets: SegmentIndex<{ heights: [number, number] }>,
  blocked: (p: Vec3) => boolean,
  wetAt: (p: Vec3) => boolean,
  planet: Planet,
): Street[] {
  const { ground } = planet
  const { radius } = ground
  if (streets.length === 0 || targets.segments.length === 0) return []
  const find = groupsOf(streets, radius)
  const linked = new Set<number>()
  for (const [i, street] of streets.entries()) if (meetsAny(street.line, targets, () => ARTERIAL_WIDTH, radius)) linked.add(find(i))
  const bend = cos(CONNECT_BEND)

  interface Way {
    from: Vec3
    fromHeight: number
    to: Vec3
    toHeight: number
    length: number
  }
  const wayFrom = (end: Vec3, before: Vec3, fromHeight: number): Way | null => {
    const out = chordWay(before, end)
    let best: Way | null = null
    for (const segment of targets.around(end, CONNECT_REACH)) {
      const { t, distance: length } = nearestOn(end, segment.a, segment.b, radius)
      if (length < STREET_STEP || length > CONNECT_REACH || (best !== null && length >= best.length)) continue
      const to = slerp(segment.a, segment.b, t)
      const way = chordWay(end, to)
      if (way.x * out.x + way.y * out.y + way.z * out.z < bend) continue
      if (blocked(to) || wetAt(to) || smearsAlong(targets, end, to, radius)) continue
      let clear = true
      for (let s = CONNECT_LOOK; s < length - 1 && clear; s += CONNECT_LOOK) {
        const p = slerp(end, to, s / length)
        if (wetAt(p) || blocked(p)) clear = false
        else if (s < length - STREET_ARTERIAL_TOUCH - 1 && targets.near(p, STREET_ARTERIAL_TOUCH).length > 0) clear = false
      }
      if (!clear) continue
      const toHeight = segment.data.heights[0] + (segment.data.heights[1] - segment.data.heights[0]) * t
      best = { from: end, fromHeight, to, toHeight, length }
    }
    return best
  }

  const connectors: Street[] = []
  const done = new Set<number>()
  for (let i = 0; i < streets.length; i++) {
    const root = find(i)
    if (linked.has(root) || done.has(root)) continue
    done.add(root)
    let best: Way | null = null
    for (let j = 0; j < streets.length; j++) {
      if (find(j) !== root) continue
      const { line, heights } = streets[j]!
      if (line.length < 2) continue
      for (const [end, before, height] of [
        [line[0]!, line[1]!, heights[0]!],
        [line.at(-1)!, line.at(-2)!, heights.at(-1)!],
      ] as const) {
        const way = wayFrom(end, before, height)
        if (way !== null && (best === null || way.length < best.length)) best = way
      }
    }
    if (best === null) continue
    const steps = Math.max(1, Math.round(best.length / STREET_STEP))
    const line: Vec3[] = []
    for (let k = 0; k <= steps; k++) line.push(slerp(best.from, best.to, k / steps))
    const heights = Float32Array.from(line, (p) => sphereHeight(ground, p))
    heights[0] = best.fromHeight
    heights[steps] = best.toHeight
    limitSweepGradeAlong(heights, runs(line, radius, false), MAX_ROAD_GRADE)
    connectors.push({ line, heights: Array.from(heights) })
  }
  return connectors
}

/**
 * Drop every scrap of street no one can drive to: a group too small to be
 * a grid that meets no road but streets. A grid on its own is kept, and a
 * car gets to it over the grass.
 */
function pruneStranded(streets: readonly Street[], roads: readonly WorldRoad[], radius: number): Street[] {
  const others = new SegmentIndex<number>(radius)
  for (const road of roads) {
    const line = road.points.map(unit)
    const count = line.length
    for (let i = 0; i < (road.closed ? count : count - 1); i++) others.add(line[i]!, line[(i + 1) % count]!, road.widths[0]!)
  }
  const find = groupsOf(streets, radius)
  const linked = new Set<number>()
  for (const [i, street] of streets.entries()) if (meetsAny(street.line, others, (width) => width, radius)) linked.add(find(i))
  const sizes = new Map<number, number>()
  for (let i = 0; i < streets.length; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1)
  return streets.filter((_, i) => linked.has(find(i)) || (sizes.get(find(i)) ?? 0) >= STREET_GRID_LEAST)
}

/** Whether a street's centerline comes within half of both roadways of any of these roads, each piece as wide as `widthOf` says. */
function meetsAny<T>(line: readonly Vec3[], roads: SegmentIndex<T>, widthOf: (data: T) => number, radius: number): boolean {
  for (let i = 0; i + 1 < line.length; i++) {
    const middle = unit({ x: line[i]!.x + line[i + 1]!.x, y: line[i]!.y + line[i + 1]!.y, z: line[i]!.z + line[i + 1]!.z })
    for (const segment of roads.around(middle, angleBetween(line[i]!, line[i + 1]!) * radius + ROAD_WIDTH)) {
      if (piecesGap(line[i]!, line[i + 1]!, segment.a, segment.b, radius) <= (STREET_WIDTH + widthOf(segment.data)) / 2) return true
    }
  }
  return false
}
