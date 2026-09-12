import type { District, Heightfield, Lake, River, Road, RoadPoint } from './types.ts'

/** Road structure codes stored in a road's `structure` array. */
export const ROAD_GRADE = 0
export const ROAD_BRIDGE = 1
export const ROAD_TUNNEL = 2

/** Highway centreline width, in world units. */
export const ROAD_WIDTH = 8

/** Control points are strung together with this spacing between samples. */
const SAMPLE_STEP = 6
/** Steepest the finished surface may be, vertical units per horizontal unit. */
export const MAX_ROAD_GRADE = 0.06
/** The deck rides this far above the ground on an embankment. */
const DECK_HEIGHT = 3
/** Bridges clear the water surface by this much. */
const BRIDGE_CLEARANCE = 4
/** A surface this far below the ground is a tunnel rather than a shallow cutting. */
const TUNNEL_DEPTH = 1
/** World units around a sample probed for water, wide enough to catch a river ribbon. */
const WATER_PROBE_RADIUS = 3
/** Points on the ring road drawn around a lone city. */
const RING_POINTS = 8
/** A city-loop corner wider than this can be bowed; sharper needs a stadium or offset. */
const BOW_ANGLE = 30
/** How far the run between two cities bows outward, as a fraction of its length. */
const BOW_FRACTION = 0.3
/** The rebuilt loop turns on at least this fraction of the smallest city radius. */
const TURN_RADIUS_FRACTION = 0.8
/** Points used to trace each stadium end. */
const STADIUM_SEGMENTS = 8

interface Vec2 {
  x: number
  z: number
}

/** Average of a list of points. */
function centroid(points: Vec2[]): Vec2 {
  let x = 0
  let z = 0
  for (const point of points) {
    x += point.x
    z += point.z
  }
  return { x: x / points.length, z: z / points.length }
}

/** Bilinear ground height at a world-space point. */
function sampleTerrain(field: Heightfield, x: number, z: number): number {
  const { width, depth, cellSize, heights } = field
  const gx = Math.min(Math.max(x / cellSize, 0), width - 1)
  const gz = Math.min(Math.max(z / cellSize, 0), depth - 1)
  const col = Math.floor(gx)
  const row = Math.floor(gz)
  const col1 = Math.min(col + 1, width - 1)
  const row1 = Math.min(row + 1, depth - 1)
  const tx = gx - col
  const tz = gz - row

  const top = heights[row * width + col]! * (1 - tx) + heights[row * width + col1]! * tx
  const bottom = heights[row1 * width + col]! * (1 - tx) + heights[row1 * width + col1]! * tx
  return top * (1 - tz) + bottom * tz
}

/** Slide a point toward an anchor until it stands on dry land. */
function pullInland(
  x: number,
  z: number,
  anchorX: number,
  anchorZ: number,
  field: Heightfield,
  seaLevel: number,
): Vec2 {
  for (let i = 0; i < 16; i++) {
    if (sampleTerrain(field, x, z) > seaLevel) break
    x += (anchorX - x) * 0.25
    z += (anchorZ - z) * 0.25
  }
  return { x, z }
}

/** Slide any point of a loop that sits in water toward the given anchor. */
function pullAllInland(
  points: Vec2[],
  anchorX: number,
  anchorZ: number,
  field: Heightfield,
  seaLevel: number,
): Vec2[] {
  for (const point of points) {
    if (sampleTerrain(field, point.x, point.z) <= seaLevel) {
      const inland = pullInland(point.x, point.z, anchorX, anchorZ, field, seaLevel)
      point.x = inland.x
      point.z = inland.z
    }
  }
  return points
}

/**
 * Interior angle at `cur`, between the rays to `prev` and `next`, in degrees.
 */
function interiorAngle(prev: Vec2, cur: Vec2, next: Vec2): number {
  const ax = prev.x - cur.x
  const az = prev.z - cur.z
  const bx = next.x - cur.x
  const bz = next.z - cur.z
  const la = Math.hypot(ax, az) || 1
  const lb = Math.hypot(bx, bz) || 1
  const dot = (ax * bx + az * bz) / (la * lb)
  return (Math.acos(Math.min(Math.max(dot, -1), 1)) * 180) / Math.PI
}

/**
 * A rounded stadium along two extreme cities, wide enough to take in the ones
 * between. When the cities are nearly on a line this is the only closed shape
 * that reaches them all without hairpinning at either end.
 */
function stadiumLoop(a: Vec2, b: Vec2, halfWidth: number): Vec2[] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const length = Math.hypot(dx, dz) || 1
  const ux = dx / length
  const uz = dz / length
  const nx = -uz
  const nz = ux
  const points: Vec2[] = []

  for (let k = 0; k <= STADIUM_SEGMENTS; k++) {
    const t = k / STADIUM_SEGMENTS
    points.push({ x: a.x + dx * t + nx * halfWidth, z: a.z + dz * t + nz * halfWidth })
  }
  for (let k = 1; k < STADIUM_SEGMENTS; k++) {
    const angle = (Math.PI * k) / STADIUM_SEGMENTS
    points.push({
      x: b.x + nx * halfWidth * Math.cos(angle) + ux * halfWidth * Math.sin(angle),
      z: b.z + nz * halfWidth * Math.cos(angle) + uz * halfWidth * Math.sin(angle),
    })
  }
  for (let k = 0; k <= STADIUM_SEGMENTS; k++) {
    const t = 1 - k / STADIUM_SEGMENTS
    points.push({ x: a.x + dx * t - nx * halfWidth, z: a.z + dz * t - nz * halfWidth })
  }
  for (let k = 1; k < STADIUM_SEGMENTS; k++) {
    const angle = (Math.PI * k) / STADIUM_SEGMENTS
    points.push({
      x: a.x - nx * halfWidth * Math.cos(angle) - ux * halfWidth * Math.sin(angle),
      z: a.z - nz * halfWidth * Math.cos(angle) - uz * halfWidth * Math.sin(angle),
    })
  }
  return points
}

/**
 * A stadium around the two extreme cities, wide enough to take in the ones
 * between, or `null` if its caps would carry past the end cities.
 */
function stadiumFor(ordered: District[], turnRadius: number): Vec2[] | null {
  let a = ordered[0]!
  let b = ordered[1]!
  let farthest = -1
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const distance = Math.hypot(ordered[i]!.cx - ordered[j]!.cx, ordered[i]!.cz - ordered[j]!.cz)
      if (distance > farthest) {
        farthest = distance
        a = ordered[i]!
        b = ordered[j]!
      }
    }
  }
  const dx = b.cx - a.cx
  const dz = b.cz - a.cz
  const length = Math.hypot(dx, dz) || 1
  const nx = -dz / length
  const nz = dx / length
  let maxOffset = 0
  for (const district of ordered) {
    maxOffset = Math.max(maxOffset, Math.abs((district.cx - a.cx) * nx + (district.cz - a.cz) * nz))
  }
  const halfWidth = Math.max(maxOffset, turnRadius)
  if (halfWidth > Math.min(a.radius, b.radius) * 0.9) return null
  return stadiumLoop({ x: a.cx, z: a.cz }, { x: b.cx, z: b.cz }, halfWidth)
}

/** Districts in angular order around their centroid, so the loop never crosses itself. */
function orderedCities(districts: District[], centerX: number, centerZ: number): District[] {
  return districts.slice().sort((a, b) => {
    const angleA = Math.atan2(a.cz - centerZ, a.cx - centerX)
    const angleB = Math.atan2(b.cz - centerZ, b.cx - centerX)
    return angleA - angleB || a.id - b.id
  })
}

/** City centroid together with the cities in angular order around it. */
function cityOrder(districts: District[]): { ordered: District[]; centerX: number; centerZ: number } {
  const center = centroid(districts.map((district) => ({ x: district.cx, z: district.cz })))
  return { ordered: orderedCities(districts, center.x, center.z), centerX: center.x, centerZ: center.z }
}

/** Smallest interior angle of the ordered city polygon, in degrees. */
function sharpestCorner(ordered: District[]): number {
  let sharpest = Infinity
  for (let i = 0; i < ordered.length; i++) {
    const prev = ordered[(i - 1 + ordered.length) % ordered.length]!
    const cur = ordered[i]!
    const next = ordered[(i + 1) % ordered.length]!
    sharpest = Math.min(
      sharpest,
      interiorAngle({ x: prev.cx, z: prev.cz }, { x: cur.cx, z: cur.cz }, { x: next.cx, z: next.cz }),
    )
  }
  return sharpest
}

/**
 * Bow each control-polygon edge outward, away from the centroid. Turning the
 * straight run into a gentle arc is what lets the spline meet each city at a
 * shallow enough angle to take the corner on a wide radius instead of a spike.
 */
function bowControls(
  control: Vec2[],
  fraction: number,
  field: Heightfield,
  seaLevel: number,
): Vec2[] {
  const center = centroid(control)
  const points: Vec2[] = []
  for (let i = 0; i < control.length; i++) {
    const a = control[i]!
    const b = control[(i + 1) % control.length]!
    points.push({ x: a.x, z: a.z })

    const midX = (a.x + b.x) / 2
    const midZ = (a.z + b.z) / 2
    let outX = midX - center.x
    let outZ = midZ - center.z
    const length = Math.hypot(outX, outZ) || 1
    outX /= length
    outZ /= length
    const bow = Math.hypot(b.x - a.x, b.z - a.z) * fraction
    points.push(pullInland(midX + outX * bow, midZ + outZ * bow, center.x, center.z, field, seaLevel))
  }
  return points
}

/**
 * Area-based inradius estimate; a constant-radius offset stays simple while its
 * radius is below this, and above it the layout is thin enough to need help.
 */
function polygonInradius(points: Vec2[]): number {
  let area = 0
  let perimeter = 0
  const count = points.length
  for (let i = 0; i < count; i++) {
    const a = points[i]!
    const b = points[(i + 1) % count]!
    area += a.x * b.z - b.x * a.z
    perimeter += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return perimeter < 1e-6 ? 0 : Math.abs(area) / perimeter
}

/**
 * A constant-radius offset of the control polygon: every city is wrapped in an
 * arc of the same radius and joined by straight runs. However sharp the layout,
 * the highway then turns on that radius and never doubles back on itself.
 */
function offsetLoop(control: Vec2[], radius: number, step: number): Vec2[] {
  const count = control.length
  const center = centroid(control)

  const normals: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const a = control[i]!
    const b = control[(i + 1) % count]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) {
      normals.push(normals[i - 1] ?? { x: 1, z: 0 })
      continue
    }
    let nx = dz / length
    let nz = -dx / length
    const midX = (a.x + b.x) / 2
    const midZ = (a.z + b.z) / 2
    if (nx * (midX - center.x) + nz * (midZ - center.z) < 0) {
      nx = -nx
      nz = -nz
    }
    normals.push({ x: nx, z: nz })
  }

  const points: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const city = control[i]!
    const incoming = normals[(i - 1 + count) % count]!
    const outgoing = normals[i]!
    const start = { x: city.x + incoming.x * radius, z: city.z + incoming.z * radius }
    const end = { x: city.x + outgoing.x * radius, z: city.z + outgoing.z * radius }
    const startAngle = Math.atan2(start.z - city.z, start.x - city.x)
    let sweep = Math.atan2(end.z - city.z, end.x - city.x) - startAngle
    while (sweep <= -Math.PI) sweep += Math.PI * 2
    while (sweep > Math.PI) sweep -= Math.PI * 2
    const arcSteps = Math.max(1, Math.ceil((Math.abs(sweep) * radius) / step))
    for (let k = 0; k <= arcSteps; k++) {
      const angle = startAngle + sweep * (k / arcSteps)
      points.push({ x: city.x + Math.cos(angle) * radius, z: city.z + Math.sin(angle) * radius })
    }

    const next = control[(i + 1) % count]!
    const nextStart = { x: next.x + outgoing.x * radius, z: next.z + outgoing.z * radius }
    const runX = nextStart.x - end.x
    const runZ = nextStart.z - end.z
    const runSteps = Math.max(1, Math.ceil(Math.hypot(runX, runZ) / step))
    for (let k = 1; k < runSteps; k++) {
      const t = k / runSteps
      points.push({ x: end.x + runX * t, z: end.z + runZ * t })
    }
  }
  return points
}

/**
 * The city anchors, arranged into a simple loop. Cities are visited in angular
 * order so the loop never crosses itself; a chord that would run out to sea
 * gets an inland waypoint, and one or two cities get a ring or a capsule so the
 * curve has something to bend around.
 */
function controlPoints(
  districts: District[],
  field: Heightfield,
  seaLevel: number,
): Vec2[] {
  const count = districts.length
  if (count === 0) return []
  const { ordered, centerX, centerZ } = cityOrder(districts)

  if (count === 1) {
    const district = ordered[0]!
    const radius = Math.max(40, district.radius + district.suburbWidth + 24)
    const ring = Array.from({ length: RING_POINTS }, (_, k) => {
      const angle = (k / RING_POINTS) * Math.PI * 2
      return { x: district.cx + Math.cos(angle) * radius, z: district.cz + Math.sin(angle) * radius }
    })
    return pullAllInland(ring, district.cx, district.cz, field, seaLevel)
  }

  if (count === 2) {
    const a = ordered[0]!
    const b = ordered[1]!
    const length = Math.hypot(b.cx - a.cx, b.cz - a.cz) || 1
    const turnRadius = Math.min(...districts.map((district) => district.radius)) * TURN_RADIUS_FRACTION
    const width = Math.min(Math.max(length * 0.35, turnRadius), Math.min(a.radius, b.radius) * 0.9)
    const loop = stadiumLoop({ x: a.cx, z: a.cz }, { x: b.cx, z: b.cz }, width)
    return pullAllInland(loop, centerX, centerZ, field, seaLevel)
  }

  const controls: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const a = ordered[i]!
    controls.push({ x: a.cx, z: a.cz })

    const b = ordered[(i + 1) % count]!
    const midX = (a.cx + b.cx) / 2
    const midZ = (a.cz + b.cz) / 2
    // Only a sea crossing is worth detouring around; rivers are bridged.
    if (sampleTerrain(field, midX, midZ) <= seaLevel) {
      controls.push(pullInland(midX, midZ, centerX, centerZ, field, seaLevel))
    }
  }
  return controls
}

/**
 * Build the horizontal highway route. Cities are joined by a spline whose runs
 * bow outward, so each city is met at a shallow angle and every corner takes a
 * wide radius. A sharper layout cannot be bowed into a simple loop: a narrow one
 * gets a stadium around its two extreme cities, and a fat one a tight
 * constant-radius offset that never doubles back on itself.
 */
function routeLoop(districts: District[], field: Heightfield, seaLevel: number): Vec2[] {
  const controls = controlPoints(districts, field, seaLevel)
  if (controls.length < 3) return []
  if (districts.length < 3) return sampleLoop(controls, SAMPLE_STEP)

  const { ordered, centerX, centerZ } = cityOrder(districts)
  const turnRadius = Math.min(...districts.map((district) => district.radius)) * TURN_RADIUS_FRACTION

  if (sharpestCorner(ordered) >= BOW_ANGLE) {
    return sampleLoop(bowControls(controls, BOW_FRACTION, field, seaLevel), SAMPLE_STEP)
  }

  const stadium = stadiumFor(ordered, turnRadius)
  if (stadium) return sampleLoop(pullAllInland(stadium, centerX, centerZ, field, seaLevel), SAMPLE_STEP)

  const inradius = polygonInradius(ordered.map((district) => ({ x: district.cx, z: district.cz })))
  return offsetLoop(controls, Math.min(turnRadius, inradius * 0.9), SAMPLE_STEP)
}

/**
 * Sample a closed centripetal Catmull-Rom spline through the control points.
 * Centripetal parameterisation keeps the curve from looping back on itself
 * where control points are unevenly spaced, so curves stay gradual.
 */
function sampleLoop(control: Vec2[], step: number): Vec2[] {
  const count = control.length
  const alpha = 0.5
  const points: Vec2[] = []

  for (let i = 0; i < count; i++) {
    const p0 = control[(i - 1 + count) % count]!
    const p1 = control[i]!
    const p2 = control[(i + 1) % count]!
    const p3 = control[(i + 2) % count]!

    const d1 = Math.max(Math.hypot(p1.x - p0.x, p1.z - p0.z), 1e-3) ** alpha
    const d2 = Math.max(Math.hypot(p2.x - p1.x, p2.z - p1.z), 1e-3) ** alpha
    const d3 = Math.max(Math.hypot(p3.x - p2.x, p3.z - p2.z), 1e-3) ** alpha
    const t0 = 0
    const t1 = t0 + d1
    const t2 = t1 + d2
    const t3 = t2 + d3
    const span = Math.max(t2 - t1, 1e-6)
    const steps = Math.max(2, Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step))

    for (let k = 0; k < steps; k++) {
      const t = t1 + (k / steps) * span
      const a1x = ((t1 - t) / (t1 - t0)) * p0.x + ((t - t0) / (t1 - t0)) * p1.x
      const a1z = ((t1 - t) / (t1 - t0)) * p0.z + ((t - t0) / (t1 - t0)) * p1.z
      const a2x = ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x
      const a2z = ((t2 - t) / (t2 - t1)) * p1.z + ((t - t1) / (t2 - t1)) * p2.z
      const a3x = ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x
      const a3z = ((t3 - t) / (t3 - t2)) * p2.z + ((t - t2) / (t3 - t2)) * p3.z
      const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x
      const b1z = ((t2 - t) / (t2 - t0)) * a1z + ((t - t0) / (t2 - t0)) * a2z
      const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x
      const b2z = ((t3 - t) / (t3 - t1)) * a2z + ((t - t1) / (t3 - t1)) * a3z

      points.push({
        x: ((t2 - t) / span) * b1x + ((t - t1) / span) * b2x,
        z: ((t2 - t) / span) * b1z + ((t - t1) / span) * b2z,
      })
    }
  }

  return points
}

/**
 * Relax a height profile until no segment exceeds `maxGrade`, while staying as
 * close to the target as possible. Peaks are cut and dips filled symmetrically,
 * which is what carves a gradual line through a mountain instead of climbing
 * straight over it.
 */
function limitGrade(heights: Float32Array, points: Vec2[], maxGrade: number): void {
  const count = heights.length
  const maxDelta = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    maxDelta[i] = maxGrade * Math.hypot(points[next]!.x - points[i]!.x, points[next]!.z - points[i]!.z)
  }

  const cap = count * 50 + 50
  for (let iteration = 0; iteration < cap; iteration++) {
    let moved = false
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count
      const diff = heights[next]! - heights[i]!
      const excess = Math.abs(diff) - maxDelta[i]!
      if (excess <= 1e-4) continue

      const direction = diff > 0 ? 1 : -1
      heights[i] = heights[i]! + (direction * excess) / 2
      heights[next] = heights[next]! - (direction * excess) / 2
      moved = true
    }
    if (!moved) break
  }
}

/**
 * Build the highway network: a single closed loop that visits every city, so
 * no road ends in a dead end. The horizontal route is shaped by `routeLoop`;
 * the vertical route is grade-limited, which forces a bridge where it crosses
 * water and a tunnel where it passes beneath a mountain.
 */
export function generateRoads(
  field: Heightfield,
  seaLevel: number,
  districts: District[],
  rivers: River[],
  lakes: Lake[],
): Road[] {
  const samples = routeLoop(districts, field, seaLevel)
  const count = samples.length
  if (count < 3) return []

  const { width, depth, cellSize } = field
  const riverLevels = new Map<number, number>()
  for (const river of rivers) {
    for (const point of river.points) {
      const col = Math.min(Math.max(Math.round(point.x / cellSize), 0), width - 1)
      const row = Math.min(Math.max(Math.round(point.z / cellSize), 0), depth - 1)
      riverLevels.set(row * width + col, point.y)
    }
  }
  const lakeLevels = new Map<number, number>()
  for (const lake of lakes) {
    for (const cell of lake.cells) lakeLevels.set(cell, lake.level)
  }

  /** Water surface at a point, or its ground height when it is dry. */
  const surfaceAt = (x: number, z: number): { wet: boolean; level: number } => {
    const centerCol = Math.round(x / cellSize)
    const centerRow = Math.round(z / cellSize)
    const probe = Math.max(1, Math.round(WATER_PROBE_RADIUS / cellSize))
    let level = 0
    let nearest = Infinity
    for (let dz = -probe; dz <= probe; dz++) {
      for (let dx = -probe; dx <= probe; dx++) {
        const col = centerCol + dx
        const row = centerRow + dz
        if (col < 0 || col >= width || row < 0 || row >= depth) continue
        const found = lakeLevels.get(row * width + col) ?? riverLevels.get(row * width + col)
        if (found === undefined) continue
        const distance = dx * dx + dz * dz
        if (distance < nearest) {
          nearest = distance
          level = found
        }
      }
    }
    if (nearest < Infinity) return { wet: true, level }

    const ground = sampleTerrain(field, x, z)
    return ground <= seaLevel ? { wet: true, level: seaLevel } : { wet: false, level: ground }
  }

  const ground = new Float32Array(count)
  const wet = new Uint8Array(count)
  const surface = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const point = samples[i]!
    ground[i] = sampleTerrain(field, point.x, point.z)
    const water = surfaceAt(point.x, point.z)
    wet[i] = water.wet ? 1 : 0
    surface[i] = water.level
  }

  // Aim for an elevated deck over dry land or one clearing the water, then let
  // the grade limit decide how close it can get.
  const profile = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    profile[i] = wet[i]
      ? Math.max(surface[i]! + BRIDGE_CLEARANCE, ground[i]! + DECK_HEIGHT)
      : ground[i]! + DECK_HEIGHT
  }

  limitGrade(profile, samples, MAX_ROAD_GRADE)

  // A sample that stayed near its water is a bridge deck; one the grade limit
  // pushed deep beneath the bed is a tunnel, even with a river overhead.
  const KIND_BRIDGE = 1
  const KIND_TUNNEL = 2
  const kind = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const buried = ground[i]! - profile[i]! > TUNNEL_DEPTH
    if (wet[i]) kind[i] = buried && profile[i]! < surface[i]! ? KIND_TUNNEL : KIND_BRIDGE
    else if (buried) kind[i] = KIND_TUNNEL
  }

  const structure = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    if (kind[i] === KIND_BRIDGE || kind[next] === KIND_BRIDGE) structure[i] = ROAD_BRIDGE
    else if (kind[i] === KIND_TUNNEL || kind[next] === KIND_TUNNEL) structure[i] = ROAD_TUNNEL
    else structure[i] = ROAD_GRADE
  }

  const points: RoadPoint[] = samples.map((point, i) => ({ x: point.x, y: profile[i]!, z: point.z }))
  return [{ id: 0, closed: true, points, structure }]
}
