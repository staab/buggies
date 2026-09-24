import * as exact from '@buggies/physics'
import { DISTRICT_CITY } from '../districts.ts'
import type { District, Heightfield, Road, RoadPoint } from '../types.ts'
import { claimedSegments, indexSegments } from './clearance.ts'
import {
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
} from './constants.ts'
import {
  type Vec2,
  centroid,
  distanceToSegment,
  pointInPolygon,
  roadBounds,
  segmentGap,
} from './geometry.ts'
import { limitSweepGrade } from './grades.ts'
import { sampleTerrain } from './sampling.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos: cosine, hypot, sin: sine } = exact

/**
 * City streets: laid out on a grid per city, trimmed where they meet arterials,
 * and pruned when they end up going nowhere.
 */

/**
 * The ground city streets have to leave alone: a band a highway's width clear
 * of every highway and ramp edge, and the whole footprint of each interchange,
 * so no street threads the pockets its ramps enclose against the highway.
 */
export function streetKeepOut(roads: Road[], footprints: Vec2[][]): (x: number, z: number) => boolean {
  const near = indexSegments(
    roads
      .filter((road) => road.width === ROAD_WIDTH || road.width === RAMP_WIDTH)
      .flatMap((road) => claimedSegments(road, (road.width + STREET_WIDTH) / 2 + STREET_CLEARANCE)),
  )

  return (x, z) => {
    for (const footprint of footprints) {
      if (pointInPolygon(x, z, footprint)) return true
    }
    return near(
      x,
      z,
      x,
      z,
      (segment) =>
        distanceToSegment(x, z, segment.ax, segment.az, segment.bx, segment.bz) < segment.reach,
    )
  }
}

/**
 * The frame a city's street grid is laid out in: the centroid of the city's
 * cells, the unit vector of its principal axis, and how far the city reaches
 * along that axis (`u`) and across it (`v`). Streets run at every multiple of
 * `STREET_SPACING` in `u` and in `v`, so the blocks between them are found
 * from the same frame.
 */
export interface CityFrame {
  cx: number
  cz: number
  cos: number
  sin: number
  uMin: number
  uMax: number
  vMin: number
  vMax: number
}

/** The grid frame of a city, or `null` for one too small to have a grid. */
export function cityFrame(
  field: Heightfield,
  districtOf: Uint8Array,
  district: District,
): CityFrame | null {
  const { width, cellSize } = field
  const local: { x: number; z: number }[] = []
  for (let cell = 0; cell < districtOf.length; cell++) {
    if (districtOf[cell] !== DISTRICT_CITY) continue
    const x = ((cell % width) + 0.5) * cellSize
    const z = (((cell / width) | 0) + 0.5) * cellSize
    if (hypot(x - district.cx, z - district.cz) <= district.radius) local.push({ x, z })
  }
  if (local.length < 8) return null

  let cx = 0
  let cz = 0
  for (const point of local) {
    cx += point.x
    cz += point.z
  }
  cx /= local.length
  cz /= local.length

  let sxx = 0
  let szz = 0
  let sxz = 0
  for (const point of local) {
    const dx = point.x - cx
    const dz = point.z - cz
    sxx += dx * dx
    szz += dz * dz
    sxz += dx * dz
  }
  const angle = 0.5 * atan2(2 * sxz, sxx - szz)
  const cos = cosine(angle)
  const sin = sine(angle)

  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (const point of local) {
    const dx = point.x - cx
    const dz = point.z - cz
    const u = dx * cos + dz * sin
    const v = -dx * sin + dz * cos
    uMin = Math.min(uMin, u)
    uMax = Math.max(uMax, u)
    vMin = Math.min(vMin, v)
    vMax = Math.max(vMax, v)
  }
  return { cx, cz, cos, sin, uMin, uMax, vMin, vMax }
}

/**
 * Fill each city with a street grid. The grid is aligned to the city polygon's
 * principal axes, so every street runs edge to edge across the polygon and the
 * cells between them are simple rectangles. Streets follow the ground and are
 * grade-limited like any other road. A grid line is cut wherever it leaves the
 * city, meets water or enters `blocked`, and each surviving run long enough to
 * span a block becomes its own street.
 */
export function buildCityGrids(
  field: Heightfield,
  seaLevel: number,
  districts: District[],
  districtOf: Uint8Array,
  blocked: (x: number, z: number) => boolean,
  nextId: number,
): Road[] {
  const { width, depth, cellSize } = field

  const inside = (x: number, z: number): boolean => {
    const col = Math.floor(x / cellSize)
    const row = Math.floor(z / cellSize)
    if (col < 0 || col >= width || row < 0 || row >= depth) return false
    return districtOf[row * width + col] === DISTRICT_CITY
  }

  const roads: Road[] = []
  let id = nextId

  const addStreet = (samples: { x: number; z: number }[]): void => {
    if (samples.length < 2) return
    const points: RoadPoint[] = samples.map((point) => ({
      x: point.x,
      y: sampleTerrain(field, point.x, point.z),
      z: point.z,
    }))
    const heights = Float32Array.from(points.map((point) => point.y))
    limitSweepGrade(heights, points, MAX_ROAD_GRADE)
    for (let i = 0; i < points.length; i++) points[i]!.y = heights[i]!
    roads.push({
      id: id++,
      kind: 'street',
      closed: false,
      width: STREET_WIDTH,
      points,
      structure: new Uint8Array(points.length - 1),
    })
  }

  const addRuns = (samples: { x: number; z: number }[]): void => {
    let run: { x: number; z: number }[] = []
    const flush = (): void => {
      if (run.length >= STREET_MIN_POINTS) addStreet(run)
      run = []
    }
    for (const sample of samples) {
      const open =
        inside(sample.x, sample.z) &&
        sampleTerrain(field, sample.x, sample.z) > seaLevel &&
        !blocked(sample.x, sample.z)
      if (open) run.push(sample)
      else flush()
    }
    flush()
  }

  for (const district of districts) {
    const frame = cityFrame(field, districtOf, district)
    if (frame === null) continue
    const { cx, cz, cos, sin, uMin, uMax, vMin, vMax } = frame

    // Streets parallel to the major axis, then parallel to the minor axis, each
    // run spanning the polygon edge to edge.
    // The samples fall on whole steps of the grid, so every crossing of two
    // grid lines is a sample of both streets and they meet there exactly.
    for (let v = Math.ceil(vMin / STREET_SPACING) * STREET_SPACING; v <= vMax; v += STREET_SPACING) {
      const samples: { x: number; z: number }[] = []
      for (let u = Math.ceil(uMin / STREET_STEP) * STREET_STEP; u <= uMax; u += STREET_STEP) {
        samples.push({ x: cx + u * cos - v * sin, z: cz + u * sin + v * cos })
      }
      addRuns(samples)
    }
    for (let u = Math.ceil(uMin / STREET_SPACING) * STREET_SPACING; u <= uMax; u += STREET_SPACING) {
      const samples: { x: number; z: number }[] = []
      for (let v = Math.ceil(vMin / STREET_STEP) * STREET_STEP; v <= vMax; v += STREET_STEP) {
        samples.push({ x: cx + u * cos - v * sin, z: cz + u * sin + v * cos })
      }
      addRuns(samples)
    }
  }

  return roads
}

/**
 * Cut out every stretch where a city street runs alongside an arterial instead
 * of crossing it. Meeting shallower than `STREET_ARTERIAL_ANGLE` the two
 * ribbons overlap along their length and smear into one road, so the street
 * gives way there and whatever is left of it either side carries on as its own
 * street. Runs too short to span a block are dropped outright.
 *
 * Each cut end is walked back up to the last of the ground it can hold rather
 * than to the last whole sample, so the street stops flush against the arterial
 * instead of a street step short of it. That is what keeps the grid attached:
 * the streets running into an arterial are often a city's only way onto the
 * network, and a cut that stopped short would strand everything behind it.
 *
 * This works on finished geometry rather than on the grid as it is laid out,
 * because junction alignment re-smooths arterials afterwards and can walk one
 * into a street that was clear when it was drawn.
 */
export function trimStreetsAlongArterials(roads: Road[], nextId: number): Road[] {
  const arterials = roads.filter((road) => road.kind === 'arterial')
  if (arterials.length === 0) return roads

  const near = indexSegments(
    arterials.flatMap((road) => claimedSegments(road, STREET_ARTERIAL_TOUCH)),
  )
  const square = cosine(STREET_ARTERIAL_ANGLE)

  /**
   * True where the span `a`-`b` would overlap an arterial it meets too shallowly.
   * The span is tested whole, not sampled along: an arterial can graze between
   * two samples, and the sliver of smear that leaves is exactly what this is for.
   */
  const clashes = (ax: number, az: number, bx: number, bz: number): boolean => {
    const length = hypot(bx - ax, bz - az) || 1
    const dx = (bx - ax) / length
    const dz = (bz - az) / length
    return near(
      Math.min(ax, bx) - STREET_ARTERIAL_TOUCH,
      Math.min(az, bz) - STREET_ARTERIAL_TOUCH,
      Math.max(ax, bx) + STREET_ARTERIAL_TOUCH,
      Math.max(az, bz) + STREET_ARTERIAL_TOUCH,
      (segment) =>
        Math.abs(segment.dx * dx + segment.dz * dz) > square &&
        segmentGap(ax, az, bx, bz, segment.ax, segment.az, segment.bx, segment.bz) < segment.reach,
    )
  }

  /**
   * The point furthest from `from` toward `to` that the street can still reach
   * without the span it adds overlapping an arterial, or `null` when there is no
   * room to give at all. Found by bisection on the same whole-span test, so what
   * is drawn is exactly what was checked.
   */
  const advance = (from: RoadPoint, to: RoadPoint): RoadPoint | null => {
    let clearT = 0
    let blockedT = 1
    for (let step = 0; step < 8; step++) {
      const t = (clearT + blockedT) / 2
      if (clashes(from.x, from.z, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) {
        blockedT = t
      } else {
        clearT = t
      }
    }
    if (clearT < 1e-3) return null
    return {
      x: from.x + (to.x - from.x) * clearT,
      y: from.y + (to.y - from.y) * clearT,
      z: from.z + (to.z - from.z) * clearT,
    }
  }

  let id = nextId
  const trimmed: Road[] = []

  for (const road of roads) {
    if (road.kind !== 'street') {
      trimmed.push(road)
      continue
    }

    // A span that clashes takes both its ends with it, so a run is a stretch of
    // samples with nothing but clear spans between them.
    const points = road.points
    const clear = points.map(() => true)
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      if (clashes(a.x, a.z, b.x, b.z)) {
        clear[i] = false
        clear[i + 1] = false
      }
    }

    if (clear.every(Boolean)) {
      trimmed.push(road)
      continue
    }

    for (let start = 0; start < points.length; ) {
      if (!clear[start]) {
        start++
        continue
      }
      let end = start
      while (end + 1 < points.length && clear[end + 1]) end++
      if (end - start + 1 >= STREET_MIN_POINTS) {
        const run = points.slice(start, end + 1)
        const structure: number[] = []
        for (let i = start; i < end; i++) structure.push(road.structure[i]!)
        const head = start > 0 ? advance(points[start]!, points[start - 1]!) : null
        if (head) {
          run.unshift(head)
          structure.unshift(road.structure[start - 1]!)
        }
        const tail = end + 1 < points.length ? advance(points[end]!, points[end + 1]!) : null
        if (tail) {
          run.push(tail)
          structure.push(road.structure[end]!)
        }
        trimmed.push({
          id: id++,
          kind: 'street',
          closed: false,
          width: STREET_WIDTH,
          points: run,
          structure: Uint8Array.from(structure),
        })
      }
      start = end + 1
    }
  }
  return trimmed
}

/**
 * True when two roads meet: their carriageways cross, or their centrelines come
 * within half a carriageway of each other.
 */
function roadsMeet(a: Road, b: Road): boolean {
  const tolerance = (a.width + b.width) / 2
  const boundsA = roadBounds(a, tolerance)
  const boundsB = roadBounds(b, 0)
  if (
    boundsA.maxX < boundsB.minX ||
    boundsB.maxX < boundsA.minX ||
    boundsA.maxZ < boundsB.minZ ||
    boundsB.maxZ < boundsA.minZ
  ) {
    return false
  }

  const segmentsOf = (road: Road): number =>
    road.closed ? road.points.length : road.points.length - 1
  for (let i = 0; i < segmentsOf(a); i++) {
    const p = a.points[i]!
    const q = a.points[(i + 1) % a.points.length]!
    for (let j = 0; j < segmentsOf(b); j++) {
      const r = b.points[j]!
      const s = b.points[(j + 1) % b.points.length]!
      if (Math.min(p.x, q.x) - tolerance > Math.max(r.x, s.x)) continue
      if (Math.min(r.x, s.x) - tolerance > Math.max(p.x, q.x)) continue
      if (Math.min(p.z, q.z) - tolerance > Math.max(r.z, s.z)) continue
      if (Math.min(r.z, s.z) - tolerance > Math.max(p.z, q.z)) continue
      if (segmentGap(p.x, p.z, q.x, q.z, r.x, r.z, s.x, s.z) <= tolerance) return true
    }
  }
  return false
}

/**
 * Drop every street no one can drive to. Grid lines are laid out blind to each
 * other and then cut around water and the interchanges, which can strand a run
 * with nothing to join it to; a street survives only if some chain of streets
 * leads from it to an arterial, a cross road or the highway itself.
 */
export function pruneStrandedStreets(roads: Road[]): Road[] {
  const streets = roads.filter((road) => road.kind === 'street')
  if (streets.length === 0) return roads

  // Union-find over the streets alone; every other road is the one network they
  // all have to reach, so linking those to each other would tell us nothing.
  const parent = streets.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!
    return index
  }
  const linked = new Set<number>()
  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) {
      if (roadsMeet(streets[i]!, streets[j]!)) parent[find(i)] = find(j)
    }
  }
  for (let i = 0; i < streets.length; i++) {
    for (const other of roads) {
      if (other.kind === 'street') continue
      if (roadsMeet(streets[i]!, other)) {
        linked.add(find(i))
        break
      }
    }
  }

  // A grid of streets is kept even where nothing reaches it: a city with its
  // streets is a city, and a car gets to them over the grass. What goes is a
  // scrap too small to be a grid, a stub or two with neither a grid nor a
  // road to belong to.
  const sizes = new Map<number, number>()
  for (let i = 0; i < streets.length; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1)
  const stranded = new Set(
    streets.filter((_, index) => !linked.has(find(index)) && (sizes.get(find(index)) ?? 0) < STREET_GRID_LEAST),
  )
  return roads.filter((road) => !stranded.has(road))
}

/** A grid of streets on its own is kept from this many streets up; fewer is a scrap. */
export const STREET_GRID_LEAST = 4

/** How far a connector is run from a cut-off grid to the road it joins. */
const CONNECT_REACH = 160
/** How far a connector may bend away from the street it leaves. */
const CONNECT_BEND = (70 * Math.PI) / 180
/** The way is looked at this often for water, the highway's keep-out and other roads. */
const CONNECT_LOOK = 6

/** One straight piece of an arterial or cross road, with its heights, for a street to run to. */
interface Span {
  ax: number
  az: number
  bx: number
  bz: number
  ay: number
  by: number
  /** Unit direction along it. */
  dx: number
  dz: number
}

/** The spans of the roads a street may be run to, in a grid of cells for looking up by a box. */
class Spans {
  readonly spans: Span[] = []
  private readonly cells = new Map<string, number[]>()
  private readonly cell = 48

  constructor(roads: Road[]) {
    for (const road of roads) {
      const count = road.points.length
      const segmentCount = road.closed ? count : count - 1
      for (let i = 0; i < segmentCount; i++) {
        const a = road.points[i]!
        const b = road.points[(i + 1) % count]!
        const length = hypot(b.x - a.x, b.z - a.z) || 1
        const index = this.spans.length
        this.spans.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ay: a.y, by: b.y, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length })
        for (let cx = Math.floor(Math.min(a.x, b.x) / this.cell); cx <= Math.floor(Math.max(a.x, b.x) / this.cell); cx++) {
          for (let cz = Math.floor(Math.min(a.z, b.z) / this.cell); cz <= Math.floor(Math.max(a.z, b.z) / this.cell); cz++) {
            const key = `${cx}:${cz}`
            const held = this.cells.get(key)
            if (held === undefined) this.cells.set(key, [index])
            else held.push(index)
          }
        }
      }
    }
  }

  /** Every span with any of it in the cells the box touches, each once. */
  within(minX: number, minZ: number, maxX: number, maxZ: number): Span[] {
    const found = new Set<number>()
    for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
      for (let cz = Math.floor(minZ / this.cell); cz <= Math.floor(maxZ / this.cell); cz++) {
        for (const index of this.cells.get(`${cx}:${cz}`) ?? []) found.add(index)
      }
    }
    return [...found].sort((a, b) => a - b).map((index) => this.spans[index]!)
  }

  /** The spans within `reach` of a point. */
  near(x: number, z: number, reach: number): Span[] {
    return this.within(x - reach, z - reach, x + reach, z + reach).filter(
      (span) => distanceToSegment(x, z, span.ax, span.az, span.bx, span.bz) <= reach,
    )
  }
}

/**
 * Whether a street run from `from` to `to` would smear along one of the
 * roads: anywhere along it, a span of one within touching distance that
 * runs shallower than square to it. The road it is run to is fine where
 * it is square, and so are that road's neighbouring spans while they stay
 * square; a bend that turns shallow beside the street is not.
 */
function smearsAlong(spans: Spans, from: RoadPoint, to: RoadPoint): boolean {
  const length = hypot(to.x - from.x, to.z - from.z)
  if (length === 0) return false
  const dx = (to.x - from.x) / length
  const dz = (to.z - from.z) / length
  const square = cosine(STREET_ARTERIAL_ANGLE)
  for (let s = 0; ; s = Math.min(s + CONNECT_LOOK, length)) {
    const x = from.x + dx * s
    const z = from.z + dz * s
    for (const span of spans.near(x, z, STREET_ARTERIAL_TOUCH + 1)) {
      if (Math.abs(span.dx * dx + span.dz * dz) > square) return true
    }
    if (s >= length) return false
  }
}

/**
 * A street from each cut-off grid to the nearest arterial or cross road,
 * so every grid a road can be run to is on the network. From each end of
 * each street of the grid, the nearest point of every such road is tried,
 * closest first: the way there must not bend back too far from the street
 * it leaves, must meet the road square enough not to smear along it, must
 * keep out of the water and the highway's keep-out, and must not cut across
 * another such road on the way. The first way found is laid as a street.
 */
export function connectStreetGrids(
  roads: Road[],
  field: Heightfield,
  wetAt: (x: number, z: number) => boolean,
  blocked: (x: number, z: number) => boolean,
  nextId: number,
): Road[] {
  const streets = roads.filter((road) => road.kind === 'street')
  const targets = roads.filter((road) => road.kind === 'arterial' || road.kind === 'cross')
  const connectors: Road[] = []
  if (streets.length === 0 || targets.length === 0) return connectors

  const parent = streets.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!
    return index
  }
  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) {
      if (roadsMeet(streets[i]!, streets[j]!)) parent[find(i)] = find(j)
    }
  }
  const linked = new Set<number>()
  for (let i = 0; i < streets.length; i++) {
    if (targets.some((target) => roadsMeet(streets[i]!, target))) linked.add(find(i))
  }

  const spans = new Spans(targets)
  const bend = cosine(CONNECT_BEND)

  interface Way {
    from: RoadPoint
    to: RoadPoint
    length: number
  }
  /** The nearest road point a street end can be run to, if any. */
  const wayFrom = (end: RoadPoint, before: RoadPoint): Way | null => {
    const outLength = hypot(end.x - before.x, end.z - before.z) || 1
    const outX = (end.x - before.x) / outLength
    const outZ = (end.z - before.z) / outLength
    let best: Way | null = null
    const box = CONNECT_REACH
    for (const span of spans.within(end.x - box, end.z - box, end.x + box, end.z + box)) {
      const ex = span.bx - span.ax
      const ez = span.bz - span.az
      const lengthSq = ex * ex + ez * ez || 1
      const t = Math.min(Math.max(((end.x - span.ax) * ex + (end.z - span.az) * ez) / lengthSq, 0), 1)
      const px = span.ax + ex * t
      const pz = span.az + ez * t
      const length = hypot(px - end.x, pz - end.z)
      if (length < STREET_STEP || length > CONNECT_REACH || (best !== null && length >= best.length)) continue
      const dx = (px - end.x) / length
      const dz = (pz - end.z) / length
      if (dx * outX + dz * outZ < bend) continue
      const to: RoadPoint = { x: px, y: span.ay + (span.by - span.ay) * t, z: pz }
      // The joint is not in the highway's keep-out, as a cross road is on
      // into its interchange, and nothing along the way smears.
      if (blocked(px, pz) || wetAt(px, pz) || smearsAlong(spans, end, to)) continue
      // The way there, looked at every few metres: dry, out of the keep-out,
      // and clear of every such road but the one it joins, up to the join.
      let clear = true
      for (let s = CONNECT_LOOK; s < length - 1 && clear; s += CONNECT_LOOK) {
        const x = end.x + dx * s
        const z = end.z + dz * s
        if (wetAt(x, z) || blocked(x, z)) clear = false
        else if (s < length - STREET_ARTERIAL_TOUCH - 1 && spans.near(x, z, STREET_ARTERIAL_TOUCH).length > 0) clear = false
      }
      if (!clear) continue
      best = { from: end, to, length }
    }
    return best
  }

  let id = nextId
  const done = new Set<number>()
  for (let i = 0; i < streets.length; i++) {
    const root = find(i)
    if (linked.has(root) || done.has(root)) continue
    done.add(root)
    let best: Way | null = null
    for (let j = 0; j < streets.length; j++) {
      if (find(j) !== root) continue
      const points = streets[j]!.points
      if (points.length < 2) continue
      for (const [end, before] of [
        [points[0]!, points[1]!],
        [points[points.length - 1]!, points[points.length - 2]!],
      ] as const) {
        const way = wayFrom(end, before)
        if (way !== null && (best === null || way.length < best.length)) best = way
      }
    }
    if (best === null) continue
    const steps = Math.max(1, Math.round(best.length / STREET_STEP))
    const points: RoadPoint[] = []
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const x = best.from.x + (best.to.x - best.from.x) * t
      const z = best.from.z + (best.to.z - best.from.z) * t
      points.push({ x, y: sampleTerrain(field, x, z), z })
    }
    points[0]!.y = best.from.y
    points[steps]!.y = best.to.y
    const heights = Float32Array.from(points.map((point) => point.y))
    limitSweepGrade(heights, points, MAX_ROAD_GRADE)
    for (let k = 0; k <= steps; k++) points[k]!.y = heights[k]!
    connectors.push({
      id: id++,
      kind: 'street',
      closed: false,
      width: STREET_WIDTH,
      points,
      structure: new Uint8Array(steps),
    })
  }
  return connectors
}

/**
 * Run each street's ends on to the arterial or cross road it is heading
 * into, where one lies within a step or so beyond the end: a street laid
 * to the edge of its city otherwise stops a few metres short of the road
 * along that edge, meeting it on paper and not on the ground. The end is
 * carried to the road's centreline, at the road's own height, so the two
 * join in a flush tee. Nothing is done where the way there is in the
 * highway's keep-out, under water, too steep, or would smear along a road.
 */
export function joinStreetsToRoads(roads: Road[], blocked: (x: number, z: number) => boolean): void {
  const targets = roads.filter((road) => road.kind === 'arterial' || road.kind === 'cross')
  if (targets.length === 0) return
  const reach = STREET_STEP + STREET_ARTERIAL_TOUCH
  const spans = new Spans(targets)

  /** Where a ray from `from` along `dx, dz` first crosses a road's centreline within reach, and the road's height there. */
  const hit = (from: RoadPoint, dx: number, dz: number): RoadPoint | null => {
    let best: RoadPoint | null = null
    let bestAlong = reach
    for (const span of spans.within(from.x - reach, from.z - reach, from.x + reach, from.z + reach)) {
      const ex = span.bx - span.ax
      const ez = span.bz - span.az
      const cross = dx * ez - dz * ex
      if (Math.abs(cross) < 1e-6) continue
      const rx = span.ax - from.x
      const rz = span.az - from.z
      const along = (rx * ez - rz * ex) / cross
      const at = (rx * dz - rz * dx) / cross
      if (along <= 0 || along >= bestAlong || at < 0 || at > 1) continue
      bestAlong = along
      best = { x: from.x + dx * along, y: span.ay + (span.by - span.ay) * at, z: from.z + dz * along }
    }
    return best
  }

  for (const road of roads) {
    if (road.kind !== 'street' || road.points.length < 2) continue
    for (const atStart of [true, false]) {
      const end = road.points[atStart ? 0 : road.points.length - 1]!
      const before = road.points[atStart ? 1 : road.points.length - 2]!
      const length = hypot(end.x - before.x, end.z - before.z) || 1
      const dx = (end.x - before.x) / length
      const dz = (end.z - before.z) / length
      const joint = hit(end, dx, dz)
      if (joint === null || smearsAlong(spans, end, joint)) continue
      const run = hypot(joint.x - end.x, joint.z - end.z)
      if (Math.abs(joint.y - end.y) > run * MAX_ROAD_GRADE * 2) continue
      // Every few metres of the way there is looked at, the joint itself
      // included: a cross road runs on into its interchange, where no
      // street may go.
      let clear = !blocked(joint.x, joint.z)
      for (let s = 3; s < run && clear; s += 3) {
        const x = end.x + (joint.x - end.x) * (s / run)
        const z = end.z + (joint.z - end.z) * (s / run)
        if (blocked(x, z)) clear = false
      }
      if (!clear) continue
      const structure = new Uint8Array(road.structure.length + 1)
      if (atStart) {
        road.points.unshift(joint)
        structure.set(road.structure, 1)
      } else {
        road.points.push(joint)
        structure.set(road.structure, 0)
      }
      road.structure = structure
    }
  }
}
