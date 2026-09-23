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
    if (Math.hypot(x - district.cx, z - district.cz) <= district.radius) local.push({ x, z })
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
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

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
    for (let v = Math.ceil(vMin / STREET_SPACING) * STREET_SPACING; v <= vMax; v += STREET_SPACING) {
      const samples: { x: number; z: number }[] = []
      for (let u = uMin; u <= uMax; u += STREET_STEP) {
        samples.push({ x: cx + u * cos - v * sin, z: cz + u * sin + v * cos })
      }
      addRuns(samples)
    }
    for (let u = Math.ceil(uMin / STREET_SPACING) * STREET_SPACING; u <= uMax; u += STREET_SPACING) {
      const samples: { x: number; z: number }[] = []
      for (let v = vMin; v <= vMax; v += STREET_STEP) {
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
  const square = Math.cos(STREET_ARTERIAL_ANGLE)

  /**
   * True where the span `a`-`b` would overlap an arterial it meets too shallowly.
   * The span is tested whole, not sampled along: an arterial can graze between
   * two samples, and the sliver of smear that leaves is exactly what this is for.
   */
  const clashes = (ax: number, az: number, bx: number, bz: number): boolean => {
    const length = Math.hypot(bx - ax, bz - az) || 1
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

  const stranded = new Set(streets.filter((_, index) => !linked.has(find(index))))
  return roads.filter((road) => !stranded.has(road))
}
