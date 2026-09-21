import { createRng, type Rng } from '@buggies/physics'

import { DISTRICT_CITY } from './districts.ts'
import { RIVER_BANK_LAP } from './rivers.ts'
import type { District, Heightfield, Lake, River, Road, RoadPoint } from './types.ts'

/**
 * How far the carriageway sits above the centreline a road is recorded on.
 * Both the mesh that gets drawn and the surface that gets driven on have to
 * agree about this, or vehicles ride buried in the road or float over it.
 */
export const ROAD_SURFACE = 0.2

/**
 * How far past the carriageway the shoulder reaches as it falls back to the
 * ground. Shared for the same reason: an edge the mesh ramps over and the
 * surface treats as a step is a step vehicles get thrown off.
 */
export const ROAD_SKIRT = 3

/** Road structure codes stored in a road's `structure` array. */
export const ROAD_GRADE = 0
export const ROAD_BRIDGE = 1
export const ROAD_TUNNEL = 2

/** Internal classification of a highway sample before it becomes a structure code. */
const KIND_BRIDGE = 1
const KIND_TUNNEL = 2

/** Highway carriageway width, in world units. */
export const ROAD_WIDTH = 16

/** Control points are strung together with this spacing between samples. */
const SAMPLE_STEP = 6
/** Steepest the finished surface may be, vertical units per horizontal unit. */
export const MAX_ROAD_GRADE = 0.06
/** Ramps are short and may climb more steeply than the highway they serve. */
export const MAX_RAMP_GRADE = 0.15
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

/** One-lane ramp width, in world units. */
export const RAMP_WIDTH = 8
/** Cross road width at an interchange, in world units. */
export const CROSS_WIDTH = 12
/** Distance along the highway between interchanges, in world units. */
const INTERCHANGE_SPACING = 800
/** How far either way a candidate may slide to find dry, water-free ground. */
const INTERCHANGE_SEARCH = 150
/** Most the ground may rise or fall across a crossing before it is rejected. */
const CROSS_RELIEF = 10
/** Distance along the highway from the underpass to each ramp's highway end. */
const RAMP_ALONG = 50
/** Distance along the cross road from the underpass to each ramp's far end. */
const RAMP_REACH = 50
/** Half-length of the cross road either side of the underpass; ends just past the ramps. */
const CROSS_REACH = RAMP_REACH + RAMP_WIDTH / 2 + 2
/** Highway length either side of an underpass drawn as bridge deck. */
const UNDERPASS_SPAN = 30
/**
 * Two interchanges closer than this along the highway would run their ramps and
 * bridge decks into each other, so no two are ever placed within it.
 */
const INTERCHANGE_CLEAR = 2 * (RAMP_ALONG + UNDERPASS_SPAN)
/** The bridge deck clears the cross road by at least this much. */
const UNDERPASS_CLEARANCE = 2.5
/** Most a ramp may drop from the deck to the cross road, so it stays drivable. */
const RAMP_DROP = 7
/**
 * Headroom a site is chosen with. The deck a site is judged against is the one
 * the highway comes to before any crossing has had a say; raising a neighbour
 * for its own underpass can lift this one a little further through the grade
 * limit, and a site picked right on the limit would then fail to be built.
 */
const RAMP_DROP_HEADROOM = 0.5
/** Terrain is cut this far below an at-grade road so the ribbon stays clear. */
const CUT_CLEARANCE = 0.6
/** A cut slope rises this much per horizontal unit away from the road edge. */
const CUT_SLOPE = 0.4
/** Points used to trace each ramp curve. */
const RAMP_SEGMENTS = 24

/** Arterial road width, in world units. */
export const ARTERIAL_WIDTH = 10
/** Arterials climb more than highways but must never feel very steep. */
export const MAX_ARTERIAL_GRADE = 0.08
/** Water steps may rise a little faster than the road, as a bridge approach does. */
export const ARTERIAL_BRIDGE_GRADE = 0.16
/** Bridge deck clears the water by this much. */
const ARTERIAL_BRIDGE_CLEARANCE = 2
/** Spacing of the navigation grid arterials are routed on, in world units. */
const ARTERIAL_GRID = 32
/** How close a road may come before routing treats the cell as blocked. */
const ARTERIAL_HIGHWAY_AVOID = 30
/** Narrower berth for ramps and cross roads, so arterials can leave their ends. */
const ARTERIAL_ACCESS_AVOID = 16
/** Cost weights for the arterial routing search. */
const ARTERIAL_SLOPE_COST = 24
const ARTERIAL_WATER_COST = 8
/** Open sea costs far more than a river, so bridges stay rare. */
const ARTERIAL_SEA_COST = 400
/** Cap on cells a single A* may expand, so a bad map can never hang. */
const ARTERIAL_MAX_EXPANSIONS = 40000
/** Charged per road already occupying a cell, so roads repel each other. */
const ARTERIAL_DENSITY_COST = 50
/** Charged for leaving the lens when a dead-end repair needs a detour. */
const ARTERIAL_LENS_COST = 80
/** Effectively blocks a cell when a route has to be retried around a clash. */
const ARTERIAL_BLOCK_COST = 1e6
/** Spacing of the field nodes the network links, in world units. */
const ARTERIAL_FIELD_SPACING = 300
/** How many nearest neighbours each node links to before loop filling. */
const ARTERIAL_NEIGHBOURS = 2
/** Most arterial roads drawn per map. */
const ARTERIAL_MAX_COUNT = 40
/** Distance between finished arterial samples, in world units. */
const ARTERIAL_STEP = 24
/** Route cells between spline waypoints; larger means longer, smoother curves. */
const ARTERIAL_WAYPOINT_STRIDE = 4
/** Sharpest corner left in a finished arterial, and the fillet used to round it. */
const ARTERIAL_MAX_TURN = (12 * Math.PI) / 180
const ARTERIAL_MIN_RADIUS = 40
/**
 * Two arterials leaving one junction closer together than this run side by side
 * instead of parting, and their carriageways smear into a single blob.
 */
const ARTERIAL_MIN_JUNCTION_ANGLE = Math.PI / 4
/** Within this of its own ends an arterial is joining a junction and may touch it. */
const ARTERIAL_MERGE_REACH = CROSS_REACH
/** A road still turning sharper than this after smoothing is dropped entirely. */
const ARTERIAL_PRUNE_TURN = (30 * Math.PI) / 180
/**
 * Junction alignment is reverted if it leaves a bend sharper than this, over
 * the window turns are judged in: as sharp as a road is allowed to be at all.
 */
const ARTERIAL_JUNCTION_TURN = (30 * Math.PI) / 180
/** Cap on samples in one arterial, so fillets cannot explode the geometry. */
const ARTERIAL_MAX_POINTS = 400
const ARTERIAL_SALT = 0x51a2

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

/** Distance from a point to a segment, in the XZ plane. */
function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax
  const vz = bz - az
  const lengthSq = vx * vx + vz * vz || 1
  const t = Math.min(Math.max(((px - ax) * vx + (pz - az) * vz) / lengthSq, 0), 1)
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
}

/**
 * Distance between two segments in the XZ plane, zero where they cross. Two
 * segments that do not cross are closest at an endpoint of one of them, so the
 * four point-to-segment distances cover every case.
 */
function segmentGap(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segmentsCross(ax, az, bx, bz, cx, cz, dx, dz)) return 0
  return Math.min(
    distanceToSegment(ax, az, cx, cz, dx, dz),
    distanceToSegment(bx, bz, cx, cz, dx, dz),
    distanceToSegment(cx, cz, ax, az, bx, bz),
    distanceToSegment(dx, dz, ax, az, bx, bz),
  )
}

/**
 * Convex hull of a point cloud, counter-clockwise, by monotone chain. Fewer
 * than three points come back unchanged, which `pointInPolygon` reads as empty.
 */
function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points.slice()
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z)
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)

  const half = (source: Vec2[]): Vec2[] => {
    const chain: Vec2[] = []
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) {
        chain.pop()
      }
      chain.push(point)
    }
    chain.pop()
    return chain
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

/** True when a point lies inside a polygon, by ray casting. */
function pointInPolygon(x: number, z: number, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
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
      if (excess <= 1e-6) continue

      const direction = diff > 0 ? 1 : -1
      heights[i] = heights[i]! + (direction * excess) / 2
      heights[next] = heights[next]! - (direction * excess) / 2
      moved = true
    }
    if (!moved) break
  }
}

/** Cumulative arc length from the first point to each point along a polyline. */
function cumulativeLengths(points: Vec2[]): Float32Array {
  const count = points.length
  const cum = new Float32Array(count)
  for (let i = 1; i < count; i++) {
    cum[i] =
      cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z)
  }
  return cum
}

/** Index of the sample nearest a given arc length. */
function indexAtDistance(cum: Float32Array, distance: number): number {
  let best = 0
  let bestGap = Infinity
  for (let i = 0; i < cum.length; i++) {
    const gap = Math.abs(cum[i]! - distance)
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  }
  return best
}

/**
 * Nearest sample to `index` that `permits` and whose crossing sits on dry land
 * clear of water, or `-1` if none is found within `maxOffset`. Interchanges
 * need solid ground under them, so this nudges a candidate off a river or
 * coastline rather than dropping it — and past ground already spoken for,
 * rather than giving up on the first site that happens to be taken.
 */
function findDryCrossing(
  field: Heightfield,
  seaLevel: number,
  samples: Vec2[],
  wet: Uint8Array,
  wetAt: (x: number, z: number) => boolean,
  deck: Float32Array,
  cum: Float32Array,
  total: number,
  index: number,
  maxOffset: number,
  permits: (c: number) => boolean,
  strict = true,
): number {
  const count = samples.length
  for (let offset = 0; offset <= maxOffset; offset++) {
    for (const c of [(index + offset) % count, (index - offset + count) % count]) {
      if (!permits(c)) continue
      if (wet[c]) continue
      const frame = frameAt(samples, c)
      const centre = sampleTerrain(field, frame.x, frame.z)
      if (centre <= seaLevel) continue
      const left = sampleTerrain(field, frame.x - frame.nx * CROSS_REACH, frame.z - frame.nz * CROSS_REACH)
      const right = sampleTerrain(field, frame.x + frame.nx * CROSS_REACH, frame.z + frame.nz * CROSS_REACH)
      if (left <= seaLevel || right <= seaLevel) continue
      // The cross road is the ground, so its ends and the ramps' landings
      // cannot stand in a river or a lake any more than in the sea.
      if (
        [-CROSS_REACH, -RAMP_REACH, RAMP_REACH, CROSS_REACH].some((offsetAcross) =>
          wetAt(frame.x + frame.nx * offsetAcross, frame.z + frame.nz * offsetAcross),
        )
      ) {
        continue
      }
      // Keep the crossing fairly level, or the ramps have to descend a valley.
      const nearLeft = sampleTerrain(field, frame.x - frame.nx * RAMP_REACH, frame.z - frame.nz * RAMP_REACH)
      const nearRight = sampleTerrain(field, frame.x + frame.nx * RAMP_REACH, frame.z + frame.nz * RAMP_REACH)
      const high = Math.max(centre, nearLeft, nearRight, left, right)
      const low = Math.min(centre, nearLeft, nearRight, left, right)
      if (high - low > CROSS_RELIEF) continue
      // The deck rides where the grade limit puts it, not where the ground is,
      // so a site in a dip can sit far too high for the ramps to reach the
      // cross road however level the ground across it looks. Judge the drop the
      // ramps would really have to make, against the deck raised just enough to
      // clear the underpass, which is what the finished highway does here.
      if (centre - deck[c]! > TUNNEL_DEPTH) continue
      const cross = crossRoad(field, samples, c)
      const roof = Math.max(deck[c]!, cross.heights[cross.centerIndex]! + UNDERPASS_CLEARANCE)
      const landing = Math.min(
        sampleOpen(cross.heights, -RAMP_REACH),
        sampleOpen(cross.heights, RAMP_REACH),
      )
      // The ramps leave the deck RAMP_ALONG either side of the crossing, where
      // the highway can stand higher than at the crossing itself: judge the
      // drop from the higher of the deck there and the raised deck's descent.
      // A city that has no site good enough is still given its exit, judged
      // at the crossing alone, and its ramps come out steeper for it.
      const attachDeck = strict
        ? Math.max(
            roof - MAX_ROAD_GRADE * RAMP_ALONG,
            deck[indexAtDistance(cum, (cum[c]! - RAMP_ALONG + total) % total)]!,
            deck[indexAtDistance(cum, (cum[c]! + RAMP_ALONG) % total)]!,
          )
        : roof
      if (attachDeck + ROAD_SURFACE - landing > RAMP_DROP - RAMP_DROP_HEADROOM) continue
      return c
    }
  }
  return -1
}

/**
 * Interchange crossings around the highway loop: one serving each city, then
 * periodic ones along the country between them.
 *
 * Cities are served first and from as near their centre as the ground allows,
 * so a city gets its exit before the spacing rule has any say. The periodic pass
 * then skips any candidate standing on a city, which is what holds a city to one
 * and never two. A city whose highway frontage is too steep or too broken to
 * carry a crossing at all goes without: no site there could be driven.
 */
function interchangeCenters(
  field: Heightfield,
  seaLevel: number,
  samples: Vec2[],
  wet: Uint8Array,
  wetAt: (x: number, z: number) => boolean,
  cum: Float32Array,
  total: number,
  districts: District[],
  deck: Float32Array,
): number[] {
  const count = samples.length
  const step = total / count
  const search = Math.max(1, Math.round(INTERCHANGE_SEARCH / step))
  const minGap = Math.round((INTERCHANGE_SPACING * 0.6) / step)
  const centers: number[] = []

  /** Shortest way round the loop from `c` to the nearest crossing already placed. */
  const gapTo = (c: number): number => {
    let gap = Infinity
    for (const other of centers) {
      const apart = Math.abs(other - c)
      gap = Math.min(gap, Math.min(apart, count - apart))
    }
    return gap
  }

  /** The city a crossing at `c` belongs to: whichever centre is nearest it. */
  const nearestCity = (c: number): District | null => {
    let best: District | null = null
    let nearest = Infinity
    for (const district of districts) {
      const distance = Math.hypot(samples[c]!.x - district.cx, samples[c]!.z - district.cz)
      if (distance < nearest) {
        nearest = distance
        best = district
      }
    }
    return best
  }

  /** True when a crossing at `c` stands clear of every city. */
  const rural = (c: number): boolean =>
    districts.every(
      (district) =>
        Math.hypot(samples[c]!.x - district.cx, samples[c]!.z - district.cz) >
        district.radius + district.suburbWidth,
    )

  const touching = Math.max(1, Math.round(INTERCHANGE_CLEAR / step))
  for (const district of districts) {
    let seed = 0
    let nearest = Infinity
    for (let i = 0; i < count; i++) {
      const distance = Math.hypot(samples[i]!.x - district.cx, samples[i]!.z - district.cz)
      if (distance < nearest) {
        nearest = distance
        seed = i
      }
    }
    // Search out as far as the city reaches, then a little further, rather than
    // give up on a city whose own ground will not take a crossing. Ground
    // nearer to another city is that city's to use: without that, a neighbour
    // standing on better land takes the exits and this city is left with none.
    const reach = Math.round((district.radius + district.suburbWidth) / step) + search
    const permits = (candidate: number): boolean =>
      nearestCity(candidate) === district && gapTo(candidate) >= touching
    let c = findDryCrossing(field, seaLevel, samples, wet, wetAt, deck, cum, total, seed, reach, permits)
    if (c < 0) {
      c = findDryCrossing(field, seaLevel, samples, wet, wetAt, deck, cum, total, seed, reach, permits, false)
    }
    if (c >= 0) centers.push(c)
  }

  for (let distance = 0; distance < total; distance += INTERCHANGE_SPACING) {
    const index = indexAtDistance(cum, distance)
    // Every city is served by now, so a periodic exit belongs only in the
    // country between them; one landing on a city would give it a second.
    // A candidate near the end of the loop can slide onto the first one across
    // the wrap, so keep a minimum cyclic gap between crossings.
    const c = findDryCrossing(
      field,
      seaLevel,
      samples,
      wet,
      wetAt,
      deck,
      cum,
      total,
      index,
      search,
      (candidate) => rural(candidate) && gapTo(candidate) >= minGap,
    )
    if (c >= 0) centers.push(c)
  }
  return centers
}

/** Position and unit frame (tangent `d`, normal `n`) at a sample of a closed loop. */
function frameAt(
  points: Vec2[],
  index: number,
): { x: number; z: number; dx: number; dz: number; nx: number; nz: number } {
  const count = points.length
  const point = points[index]!
  const prev = points[(index - 1 + count) % count]!
  const next = points[(index + 1) % count]!
  let dx = next.x - prev.x
  let dz = next.z - prev.z
  const length = Math.hypot(dx, dz) || 1
  dx /= length
  dz /= length
  return { x: point.x, z: point.z, dx, dz, nx: dz, nz: -dx }
}

/** Relax an open profile until no segment exceeds `maxGrade`. */
function limitOpenGrade(heights: Float32Array, points: Vec2[], maxGrade: number): void {
  const count = heights.length
  for (let pass = 0; pass < count * 20; pass++) {
    let moved = false
    for (let i = 0; i + 1 < count; i++) {
      const run = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z)
      const diff = heights[i + 1]! - heights[i]!
      const excess = Math.abs(diff) - maxGrade * run
      if (excess <= 1e-6) continue
      const direction = diff > 0 ? 1 : -1
      heights[i] = heights[i]! + (direction * excess) / 2
      heights[i + 1] = heights[i + 1]! - (direction * excess) / 2
      moved = true
    }
    if (!moved) break
  }
}

/** Linearly interpolate an open road's profile at a signed offset from its centre. */
function sampleOpen(heights: Float32Array, offset: number): number {
  const steps = heights.length - 1
  const position = ((offset + CROSS_REACH) / (2 * CROSS_REACH)) * steps
  const index = Math.min(Math.max(Math.floor(position), 0), steps)
  const next = Math.min(index + 1, steps)
  const fraction = Math.min(Math.max(position - index, 0), 1)
  return heights[index]! * (1 - fraction) + heights[next]! * fraction
}

/** A cross road across an interchange, with its smoothed ground profile. */
interface CrossRoad {
  points: Vec2[]
  heights: Float32Array
  /** Sample at the crossing, where the highway passes overhead. */
  centerIndex: number
}

/** Cross road straight across a crossing, following the ground. */
function crossRoad(field: Heightfield, samples: Vec2[], c: number): CrossRoad {
  const frame = frameAt(samples, c)
  const n = { x: frame.nx, z: frame.nz }
  const steps = Math.max(2, Math.round((CROSS_REACH * 2) / SAMPLE_STEP))
  const points: Vec2[] = []
  const heights = new Float32Array(steps + 1)
  for (let k = 0; k <= steps; k++) {
    const t = -CROSS_REACH + (2 * CROSS_REACH * k) / steps
    const x = frame.x + n.x * t
    const z = frame.z + n.z * t
    points.push({ x, z })
    heights[k] = sampleTerrain(field, x, z)
  }
  limitOpenGrade(heights, points, MAX_ROAD_GRADE)
  return { points, heights, centerIndex: Math.round(steps / 2) }
}

/**
 * Simplified diamond interchanges at the chosen crossings. At each, a cross
 * road passes beneath the highway through an underpass, and four one-lane ramps
 * connect the highway deck down to it, one per quadrant. The highway is drawn
 * as bridge deck across the crossing so the cross road shows through
 * underneath; ramps are added after the cross road so they render on top.
 *
 * Alongside the roads this returns each interchange's footprint: the hull of
 * its four ramps, which is the diamond they enclose together with the highway
 * and the cross road. Nothing else may be built inside it.
 */
function buildInterchanges(
  samples: Vec2[],
  profile: Float32Array,
  crossings: { index: number; cross: CrossRoad }[],
  bridgeSteps: number,
  structure: Uint8Array,
  nextId: number,
): { roads: Road[]; footprints: Vec2[][] } {
  const count = samples.length
  const cum = cumulativeLengths(samples)
  const total =
    cum[count - 1]! +
    Math.hypot(samples[0]!.x - samples[count - 1]!.x, samples[0]!.z - samples[count - 1]!.z)
  const roads: Road[] = []
  const footprints: Vec2[][] = []
  let id = nextId

  for (const { index: c, cross } of crossings) {
    const frame = frameAt(samples, c)
    const n = { x: frame.nx, z: frame.nz }
    const arms: Vec2[] = []

    for (let j = -bridgeSteps; j <= bridgeSteps; j++) {
      structure[(c + j + count) % count] = ROAD_BRIDGE
    }

    const crossPoints = cross.points
    const crossHeights = cross.heights

    roads.push({
      id: id++,
      kind: 'cross',
      closed: false,
      width: CROSS_WIDTH,
      points: crossPoints.map((point, k) => ({ x: point.x, y: crossHeights[k]!, z: point.z })),
      structure: new Uint8Array(Math.max(0, crossPoints.length - 1)),
    })

    // Four ramps, one per diamond arm. Each leaves the highway edge heading
    // with traffic toward the crossing, sweeps out and down, and arrives at the
    // cross road at a right angle. The two arms on a side mirror each other and
    // land at the same corner.
    for (const sn of [1, -1]) {
      const mergeOffset = sn * RAMP_REACH
      const centerX = frame.x + n.x * mergeOffset
      const centerZ = frame.z + n.z * mergeOffset
      // Stop at the near edge of the cross road, not its centreline, so the
      // ramp does not pave over the far carriageway.
      const mergeY = sampleOpen(crossHeights, mergeOffset)
      for (const sd of [1, -1]) {
        const edgeOffset = sd * (CROSS_WIDTH / 2)
        const mergeX = centerX + frame.dx * edgeOffset
        const mergeZ = centerZ + frame.dz * edgeOffset
        const attach = indexAtDistance(cum, (cum[c]! + sd * RAMP_ALONG + total) % total)
        const start = frameAt(samples, attach)
        const startX = start.x + start.nx * sn * (ROAD_WIDTH / 2)
        const startZ = start.z + start.nz * sn * (ROAD_WIDTH / 2)
        const startY = profile[attach]!

        const reach = Math.hypot(mergeX - startX, mergeZ - startZ)
        const handle = reach * 0.45
        // Depart toward the crossing and arrive toward it, so the ramp sweeps
        // down in one smooth motion and ends perpendicular to the cross road.
        const p1x = startX - sd * start.dx * handle
        const p1z = startZ - sd * start.dz * handle
        const p2x = mergeX + sd * frame.dx * handle
        const p2z = mergeZ + sd * frame.dz * handle

        // Linear fall from the deck to the cross road so the ramp always
        // reaches it; a grade limit here would strand the tip above the road.
        // The ramp is the ground: it leaves the highway's own surface, which
        // rides ROAD_SURFACE above its centreline, and lands on the cross road.
        const topY = startY + ROAD_SURFACE
        const points: Vec2[] = []
        const heights = new Float32Array(RAMP_SEGMENTS + 1)
        for (let k = 0; k <= RAMP_SEGMENTS; k++) {
          const t = k / RAMP_SEGMENTS
          const u = 1 - t
          points.push({
            x: u * u * u * startX + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * mergeX,
            z: u * u * u * startZ + 3 * u * u * t * p1z + 3 * u * t * t * p2z + t * t * t * mergeZ,
          })
          heights[k] = topY + (mergeY - topY) * t
        }

        roads.push({
          id: id++,
          kind: 'ramp',
          closed: false,
          width: RAMP_WIDTH,
          points: points.map((point, k) => ({ x: point.x, y: heights[k]!, z: point.z })),
          structure: new Uint8Array(Math.max(0, points.length - 1)),
        })
        arms.push(...points)
      }
    }

    footprints.push(convexHull(arms))
  }

  return { roads, footprints }
}

/**
 * Roads that are the ground, shaped to them and painted on, rather than built
 * over it: everything but the highway, which rides its own embankment.
 */
export function isSurfaceRoad(road: Road): boolean {
  return road.kind !== 'highway'
}

/** How far above a road's recorded centreline its drivable surface sits. */
export function roadLift(road: Road): number {
  return isSurfaceRoad(road) ? 0 : ROAD_SURFACE
}

/** The ground is shaped to a surface road over this much beyond its carriageway. */
export const SURFACE_SHOULDER = 9

/**
 * Cut the ground down under every at-grade built road so rising terrain never
 * pokes through the ribbon, just as river channels are carved so the water is
 * not covered. The bed is interpolated along each segment, so a road that
 * climbs or falls is followed exactly. Only cuts are made, never fills, so
 * embankments and bridges keep their profile.
 */
function carveRoadBeds(field: Heightfield, roads: Road[], keep: Uint8Array): void {
  const { width, depth, cellSize, heights } = field
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const flat = road.width / 2 + cellSize
    const reach = flat + cellSize * 5

    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const vx = b.x - a.x
      const vz = b.z - a.z
      const lengthSq = vx * vx + vz * vz || 1

      const minCol = Math.max(Math.floor((Math.min(a.x, b.x) - reach) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((Math.max(a.x, b.x) + reach) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((Math.min(a.z, b.z) - reach) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((Math.max(a.z, b.z) + reach) / cellSize), depth - 1)

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const x = col * cellSize
          const z = row * cellSize
          const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
          const distance = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t))
          if (distance > reach) continue
          const cell = row * width + col
          if (keep[cell] === 1) continue
          const bed = a.y + (b.y - a.y) * t
          const target = bed - CUT_CLEARANCE + Math.max(0, distance - flat) * CUT_SLOPE
          if (heights[cell]! > target) heights[cell] = target
        }
      }
    }
  }
}

/**
 * The cells a surface road's carriageway lies over. The highway's bed must
 * not be cut into them where it passes close, as it does where a ramp leaves
 * it: that ground is a road, and a cut across it is a trench across a road.
 */
function surfaceRoadCells(field: Heightfield, roads: Road[]): Uint8Array {
  const { width, depth, cellSize } = field
  const cells = new Uint8Array(width * depth)
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const flat = road.width / 2 + cellSize
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const vx = b.x - a.x
      const vz = b.z - a.z
      const lengthSq = vx * vx + vz * vz || 1
      const minCol = Math.max(Math.floor((Math.min(a.x, b.x) - flat) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((Math.max(a.x, b.x) + flat) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((Math.min(a.z, b.z) - flat) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((Math.max(a.z, b.z) + flat) / cellSize), depth - 1)
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const x = col * cellSize
          const z = row * cellSize
          const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
          if (Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)) <= flat) cells[row * width + col] = 1
        }
      }
    }
  }
  return cells
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Shape the ground to every surface road. Across the carriageway the ground is
 * the road's own profile, cut or filled to reach it; the shoulders blend back
 * to the land beside it. Roads only compete with each other within their
 * carriageways: where two cross, their profiles are averaged over the
 * overlap, so a crossing is one level rather than a step from one deck to
 * another, but a road's shoulder never reshapes the road beside it. Bridges
 * are left alone: there is water under them, and a deck is built over it.
 */
function stampRoadBeds(field: Heightfield, roads: Road[]): void {
  const { width, depth, cellSize, heights } = field
  const original = Float32Array.from(heights)
  const roadWeightSum = new Float32Array(width * depth)
  const bedSum = new Float32Array(width * depth)
  const landWeightMax = new Float32Array(width * depth)
  // Within one road only its nearest stretch counts, or a tight bend would
  // blend the height of the road coming in with the road going out.
  const nearest = new Float32Array(width * depth).fill(Infinity)
  const nearestBed = new Float32Array(width * depth)
  const touched: number[] = []

  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const half = road.width / 2
    const flat = half + cellSize
    const reach = flat + SURFACE_SHOULDER

    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const vx = b.x - a.x
      const vz = b.z - a.z
      const lengthSq = vx * vx + vz * vz || 1

      const minCol = Math.max(Math.floor((Math.min(a.x, b.x) - reach) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((Math.max(a.x, b.x) + reach) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((Math.min(a.z, b.z) - reach) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((Math.max(a.z, b.z) + reach) / cellSize), depth - 1)

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const x = col * cellSize
          const z = row * cellSize
          const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
          const distance = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t))
          if (distance > reach) continue
          const cell = row * width + col
          if (distance >= nearest[cell]!) continue
          if (nearest[cell] === Infinity) touched.push(cell)
          nearest[cell] = distance
          nearestBed[cell] = a.y + (b.y - a.y) * t
        }
      }
    }

    for (const cell of touched) {
      const distance = nearest[cell]!
      // A road's say over the ground beside it fades out over the shoulder;
      // its say against another road ends at its own carriageway. The small
      // share kept beyond that only decides whose profile a lone shoulder
      // takes, never a contest with a carriageway.
      const land = 1 - smoothstep(flat, reach, distance)
      const contest = 1 - smoothstep(half, flat + cellSize, distance) + land * 0.01
      roadWeightSum[cell] = roadWeightSum[cell]! + contest
      bedSum[cell] = bedSum[cell]! + contest * nearestBed[cell]!
      if (land > landWeightMax[cell]!) landWeightMax[cell] = land
      nearest[cell] = Infinity
    }
    touched.length = 0
  }

  for (let cell = 0; cell < heights.length; cell++) {
    const weight = landWeightMax[cell]!
    if (weight <= 0) continue
    const bed = bedSum[cell]! / roadWeightSum[cell]!
    heights[cell] = original[cell]! + (bed - original[cell]!) * weight
  }
}

/**
 * Lay a surface road's samples out evenly, no further apart than the ground's
 * own cells. Streets and arterials are sampled far more coarsely than that,
 * and fillets far more finely; once the road is the ground, its grade is the
 * ground's grade, and that is only worth reading at the ground's resolution.
 * A new segment takes the structure of the old one its middle lies in.
 */
function resampleSurfaceRoad(road: Road, spacing: number): void {
  const { points, structure } = road
  if (road.closed || points.length < 2) return
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  const total = cumulative[cumulative.length - 1]!
  const steps = Math.max(1, Math.ceil(total / spacing))

  const at = (distance: number): { point: RoadPoint; segment: number } => {
    let i = 1
    while (i < cumulative.length - 1 && cumulative[i]! < distance) i++
    const a = points[i - 1]!
    const b = points[i]!
    const span = cumulative[i]! - cumulative[i - 1]! || 1
    const t = Math.min(Math.max((distance - cumulative[i - 1]!) / span, 0), 1)
    return {
      point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
      segment: i - 1,
    }
  }

  const resampled: RoadPoint[] = []
  const codes: number[] = []
  for (let k = 0; k <= steps; k++) {
    const distance = (total * k) / steps
    resampled.push(k === 0 ? points[0]! : k === steps ? points[points.length - 1]! : at(distance).point)
    if (k < steps) codes.push(structure[at((total * (k + 0.5)) / steps).segment]!)
  }
  road.points = resampled
  road.structure = Uint8Array.from(codes)
}

/**
 * Hold a run of samples to a grade. One sweep from each end holds every
 * sample within the limit of the one before it, and the profile kept is the
 * mean of the two: itself within the limit, and leaving either end where it
 * was unless the two are further apart than the run can join at that grade,
 * in which case each gives up half the difference rather than one all of it.
 */
function limitRunGrade(points: RoadPoint[], from: number, to: number, maxGrade: number): void {
  const forward = points.slice(from, to + 1).map((point) => point.y)
  const backward = forward.slice()
  const step = (i: number, j: number): number =>
    maxGrade * Math.hypot(points[from + i]!.x - points[from + j]!.x, points[from + i]!.z - points[from + j]!.z)
  for (let i = 1; i < forward.length; i++) {
    const delta = step(i, i - 1)
    forward[i] = Math.min(Math.max(forward[i]!, forward[i - 1]! - delta), forward[i - 1]! + delta)
  }
  for (let i = backward.length - 2; i >= 0; i--) {
    const delta = step(i, i + 1)
    backward[i] = Math.min(Math.max(backward[i]!, backward[i + 1]! - delta), backward[i + 1]! + delta)
  }
  for (let i = 0; i < forward.length; i++) points[from + i]!.y = (forward[i]! + backward[i]!) / 2
}

/** The grade a surface road of this kind is held to. */
function surfaceGradeLimit(road: Road): number {
  if (road.kind === 'ramp') return MAX_RAMP_GRADE
  return road.kind === 'arterial' ? MAX_ARTERIAL_GRADE : MAX_ROAD_GRADE
}

/** Hold every at-grade run of a road to its limit, leaving bridges as they are. */
function limitSurfaceRoadGrade(road: Road): void {
  const { points, structure } = road
  let start = 0
  for (let i = 0; i <= structure.length; i++) {
    const atGrade = i < structure.length && structure[i] === ROAD_GRADE
    if (atGrade) continue
    if (i > start) limitRunGrade(points, start, i, surfaceGradeLimit(road))
    start = i + 1
  }
}

/**
 * Put every surface road's samples on the ground now shaped to them, so the
 * road as recorded is the road as driven: where two roads were averaged
 * across a crossing, both now say the height the ground actually has there.
 * A sample on a bridge keeps its deck.
 */
function seatSurfaceRoads(field: Heightfield, roads: Road[]): void {
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (let i = 0; i < count; i++) {
      const before = i > 0 ? road.structure[i - 1] : road.closed ? road.structure[count - 1] : ROAD_GRADE
      const after = i < segmentCount ? road.structure[i] : ROAD_GRADE
      if (before !== ROAD_GRADE || after !== ROAD_GRADE) continue
      const point = road.points[i]!
      point.y = sampleTerrain(field, point.x, point.z)
    }
  }
}

interface ArterialNode {
  x: number
  z: number
  y: number
  /** Cross road this node belongs to, shared by its two ends; -1 for field nodes. */
  cross: number
}

interface PathPoint {
  x: number
  y: number
  z: number
  wet: boolean
}

interface NavGrid {
  cell: number
  cols: number
  rows: number
  height: Float32Array
  wet: Uint8Array
  sea: Uint8Array
  charged: Uint8Array
}

/** Grid of terrain arterials route over, with highways charged extra to avoid. */
function buildNavGrid(
  field: Heightfield,
  seaLevel: number,
  surfaceAt: (x: number, z: number) => { wet: boolean; level: number },
  existing: Road[],
): NavGrid {
  const cell = ARTERIAL_GRID
  const cols = Math.ceil((field.width * field.cellSize) / cell)
  const rows = Math.ceil((field.depth * field.cellSize) / cell)
  const count = cols * rows
  const height = new Float32Array(count)
  const wet = new Uint8Array(count)
  const sea = new Uint8Array(count)
  const charged = new Uint8Array(count)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col + 0.5) * cell
      const z = (row + 0.5) * cell
      const ground = sampleTerrain(field, x, z)
      const water = surfaceAt(x, z)
      const index = row * cols + col
      sea[index] = ground <= seaLevel ? 1 : 0
      wet[index] = water.wet ? 1 : 0
      height[index] = water.wet ? Math.max(water.level + ARTERIAL_BRIDGE_CLEARANCE, ground) : ground
    }
  }

  const mark = (x: number, z: number, radius: number): void => {
    const minCol = Math.max(Math.floor((x - radius) / cell), 0)
    const maxCol = Math.min(Math.ceil((x + radius) / cell), cols - 1)
    const minRow = Math.max(Math.floor((z - radius) / cell), 0)
    const maxRow = Math.min(Math.ceil((z + radius) / cell), rows - 1)
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (Math.hypot((col + 0.5) * cell - x, (row + 0.5) * cell - z) > radius) continue
        charged[row * cols + col] = 1
      }
    }
  }

  // Every existing road is blocked, so the router goes around highways, ramps
  // and cross roads rather than crossing them. The highway keeps a wide berth;
  // ramps and cross roads a narrow one, so an arterial can still leave the cross
  // road end it starts from.
  for (const road of existing) {
    const radius = road.closed ? ARTERIAL_HIGHWAY_AVOID : ARTERIAL_ACCESS_AVOID
    for (const point of road.points) mark(point.x, point.z, radius)
  }

  return { cell, cols, rows, height, wet, sea, charged }
}

/** Grid cell containing a world point. */
function cellAt(grid: NavGrid, x: number, z: number): number {
  const col = Math.min(Math.max(Math.floor(x / grid.cell), 0), grid.cols - 1)
  const row = Math.min(Math.max(Math.floor(z / grid.cell), 0), grid.rows - 1)
  return row * grid.cols + col
}

/**
 * Nearest anchor for every nav cell, a grid Voronoi diagram. An edge routed
 * between two anchors is confined to their two cells (the lens), so different
 * edges cannot wander into each other's ground.
 */
function labelAnchors(grid: NavGrid, nodes: ArterialNode[]): Int16Array {
  const count = grid.cols * grid.rows
  const label = new Int16Array(count).fill(-1)
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = (col + 0.5) * grid.cell
      const z = (row + 0.5) * grid.cell
      let best = -1
      let bestDistance = Infinity
      for (let n = 0; n < nodes.length; n++) {
        const distance = Math.hypot(nodes[n]!.x - x, nodes[n]!.z - z)
        if (distance < bestDistance) {
          bestDistance = distance
          best = n
        }
      }
      label[row * grid.cols + col] = best
    }
  }
  return label
}

/**
 * Anchor pairs whose Voronoi cells share a border. This is the planar dual of
 * the grid Voronoi diagram, i.e. a Delaunay-like adjacency, so connecting two
 * such anchors cannot cut across a third.
 */
function voronoiAdjacency(grid: NavGrid, label: Int16Array, nodeCount: number): [number, number][] {
  const { cols, rows } = grid
  const seen = new Set<number>()
  const pairs: [number, number][] = []
  const record = (a: number, b: number): void => {
    if (a < 0 || b < 0 || a === b) return
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    const key = low * nodeCount + high
    if (seen.has(key)) return
    seen.add(key)
    pairs.push([low, high])
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const here = label[row * cols + col]!
      if (col + 1 < cols) record(here, label[row * cols + col + 1]!)
      if (row + 1 < rows) record(here, label[(row + 1) * cols + col]!)
    }
  }
  return pairs
}

/** Reusable A* scratch, so repeated routes do not churn the heap. */
interface SearchBuffers {
  gScore: Float32Array
  cameFrom: Int32Array
  closed: Uint8Array
  priority: Float32Array
  open: number[]
}

/**
 * A* across the nav grid, returning every cell from start to goal. Moves that
 * would break the grade limit are refused, water costs extra (bridges), highway
 * cells are blocked so a route only crosses at an interchange, leaving the
 * edge's Voronoi lens costs extra, and cells already carrying a road repel.
 */
function routeCells(
  grid: NavGrid,
  buffers: SearchBuffers,
  start: number,
  goal: number,
  label: Int16Array,
  density: Float32Array,
  block: Float32Array,
  strict: boolean,
  anchorA: number,
  anchorB: number,
): number[] | null {
  const { cell, cols, rows, height, wet, sea, charged } = grid
  const { gScore, cameFrom, closed, priority, open } = buffers
  gScore.fill(Infinity)
  cameFrom.fill(-1)
  closed.fill(0)
  priority.fill(Infinity)
  open.length = 0

  const push = (index: number): void => {
    open.push(index)
    let child = open.length - 1
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (priority[open[parent]!]! <= priority[open[child]!]!) break
      const swap = open[parent]!
      open[parent] = open[child]!
      open[child] = swap
      child = parent
    }
  }
  const pop = (): number => {
    const top = open[0]!
    const last = open.pop()!
    if (open.length > 0) {
      open[0] = last
      let parent = 0
      for (;;) {
        const left = parent * 2 + 1
        const right = left + 1
        if (left >= open.length) break
        let smallest = left
        if (right < open.length && priority[open[right]!]! < priority[open[left]!]!) smallest = right
        if (priority[open[parent]!]! <= priority[open[smallest]!]!) break
        const swap = open[parent]!
        open[parent] = open[smallest]!
        open[smallest] = swap
        parent = smallest
      }
    }
    return top
  }

  const heuristic = (index: number): number =>
    Math.hypot((index % cols) - (goal % cols), ((index / cols) | 0) - ((goal / cols) | 0)) * cell

  gScore[start] = 0
  priority[start] = heuristic(start)
  push(start)

  let expanded = 0
  while (open.length > 0) {
    if (++expanded > ARTERIAL_MAX_EXPANSIONS) return null
    const current = pop()
    if (current === goal) {
      const path: number[] = []
      for (let at = current; at !== -1; at = cameFrom[at]!) path.push(at)
      return path.reverse()
    }
    if (closed[current]) continue
    closed[current] = 1

    const col = current % cols
    const row = (current / cols) | 0
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue
        const ncol = col + dx
        const nrow = row + dz
        if (ncol < 0 || ncol >= cols || nrow < 0 || nrow >= rows) continue
        const next = nrow * cols + ncol
        if (closed[next]) continue

        const run = Math.hypot(dx, dz) * cell
        const grade = Math.abs(height[next]! - height[current]!) / run
        const wetMove = wet[current] === 1 || wet[next] === 1
        if (grade > (wetMove ? ARTERIAL_BRIDGE_GRADE : MAX_ARTERIAL_GRADE)) continue
        // Highway cells are blocked outright; the only way across is the cleared
        // corridor at an interchange, so arterials cannot cut through.
        if (charged[next] === 1 && next !== goal) continue

        let cost = run + grade * ARTERIAL_SLOPE_COST
        if (wetMove) {
          // Rivers and lakes are bridged; open sea is avoided strongly.
          cost += sea[current] === 1 || sea[next] === 1 ? ARTERIAL_SEA_COST : ARTERIAL_WATER_COST
        }
        let tag = label[next]!
        // The exact start and goal cells are always allowed, even if another
        // anchor is marginally nearer.
        if (next === start || next === goal) tag = anchorA
        // Stay inside the union of the two anchors' Voronoi cells: a road may
        // never wander into a third cell, so it cannot collide with another.
        // Dead-end repairs may bow outside the lens for a cost.
        if (tag !== anchorA && tag !== anchorB) {
          if (strict) continue
          cost += ARTERIAL_LENS_COST
        }
        cost += density[next]! * ARTERIAL_DENSITY_COST + block[next]! * ARTERIAL_BLOCK_COST

        const tentative = gScore[current]! + cost
        if (tentative >= gScore[next]!) continue
        gScore[next] = tentative
        cameFrom[next] = current
        priority[next] = tentative + heuristic(next)
        push(next)
      }
    }
  }

  return null
}

/**
 * Round every corner sharper than `maxTurn` to a fillet of about `minRadius`.
 * Each sharp vertex is replaced by a quadratic Bezier that is tangent to the
 * segments either side, so a switchback becomes a hairpin instead of a spike.
 * The fillet is trimmed inside the corner, so it never leaves the original
 * path's footprint.
 */
function roundCorners(points: PathPoint[], minRadius: number, maxTurn: number): PathPoint[] {
  const count = points.length
  if (count < 3) return points
  const result: PathPoint[] = [points[0]!]

  for (let i = 1; i < count - 1; i++) {
    if (result.length >= ARTERIAL_MAX_POINTS) {
      for (let k = i; k < count - 1; k++) result.push(points[k]!)
      result.push(points[count - 1]!)
      return result
    }
    const a = points[i - 1]!
    const b = points[i]!
    const c = points[i + 1]!
    const inX = b.x - a.x
    const inZ = b.z - a.z
    const outX = c.x - b.x
    const outZ = c.z - b.z
    const inLength = Math.hypot(inX, inZ)
    const outLength = Math.hypot(outX, outZ)
    if (inLength < 1e-6 || outLength < 1e-6) {
      result.push(b)
      continue
    }

    const inDx = inX / inLength
    const inDz = inZ / inLength
    const outDx = outX / outLength
    const outDz = outZ / outLength
    const turn = Math.acos(Math.min(Math.max(inDx * outDx + inDz * outDz, -1), 1))
    if (turn <= maxTurn) {
      result.push(b)
      continue
    }

    const trim = Math.min(minRadius * Math.tan(turn / 2), inLength * 0.5, outLength * 0.5)
    const startX = b.x - inDx * trim
    const startY = b.y - ((b.y - a.y) / inLength) * trim
    const startZ = b.z - inDz * trim
    const endX = b.x + outDx * trim
    const endY = b.y + ((c.y - b.y) / outLength) * trim
    const endZ = b.z + outDz * trim
    const steps = Math.max(
      4,
      Math.ceil((trim * turn) / ARTERIAL_STEP),
      Math.ceil(turn / maxTurn),
    )
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const u = 1 - t
      result.push({
        x: u * u * startX + 2 * u * t * b.x + t * t * endX,
        y: u * u * startY + 2 * u * t * b.y + t * t * endY,
        z: u * u * startZ + 2 * u * t * b.z + t * t * endZ,
        wet: b.wet,
      })
    }
  }

  result.push(points[count - 1]!)
  return result
}

/**
 * Enforce a grade limit in one pass from each end and average the two feasible
 * profiles. That is O(n) rather than relaxation, and averaging keeps the result
 * close to the original heights (and so to both road ends).
 */
function limitSweepGrade(heights: Float32Array, points: Vec2[], maxGrade: number): void {
  const count = heights.length
  if (count < 2) return
  const forward = Float32Array.from(heights)
  const backward = Float32Array.from(heights)
  for (let i = 1; i < count; i++) {
    const maxDelta = maxGrade * Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z)
    const high = forward[i - 1]! + maxDelta
    const low = forward[i - 1]! - maxDelta
    if (forward[i]! > high) forward[i] = high
    else if (forward[i]! < low) forward[i] = low
  }
  for (let i = count - 2; i >= 0; i--) {
    const maxDelta = maxGrade * Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z)
    const high = backward[i + 1]! + maxDelta
    const low = backward[i + 1]! - maxDelta
    if (backward[i]! > high) backward[i] = high
    else if (backward[i]! < low) backward[i] = low
  }
  for (let i = 0; i < count; i++) heights[i] = (forward[i]! + backward[i]!) / 2
}

/** Drop samples closer together than `minDistance`, keeping the endpoints. */
function dedupePath(points: PathPoint[], minDistance: number): PathPoint[] {
  if (points.length < 2) return points
  const result: PathPoint[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!
    const last = result[result.length - 1]!
    if (Math.hypot(point.x - last.x, point.z - last.z) < minDistance) {
      if (i === points.length - 1) result[result.length - 1] = point
      continue
    }
    result.push(point)
  }
  // The tail replacement above can leave a stub; drop it so no segment is tiny.
  while (result.length >= 2 && Math.hypot(
    result[result.length - 1]!.x - result[result.length - 2]!.x,
    result[result.length - 1]!.z - result[result.length - 2]!.z,
  ) < minDistance) {
    result.splice(result.length - 2, 1)
  }
  while (result.length >= 2 && Math.hypot(
    result[1]!.x - result[0]!.x,
    result[1]!.z - result[0]!.z,
  ) < minDistance) {
    result.splice(1, 1)
  }
  return result
}



/** Keep every `stride`-th point (and the ends) as spline waypoints. */
function decimatePath(points: PathPoint[], stride: number): PathPoint[] {
  if (points.length <= 2) return points
  const result: PathPoint[] = [points[0]!]
  for (let i = stride; i < points.length - 1; i += stride) result.push(points[i]!)
  result.push(points[points.length - 1]!)
  return result
}

/**
 * Sample an open centripetal Catmull-Rom spline through the waypoints at a
 * fixed spacing. Running a spline through decimated grid cells turns the A*
 * staircase into long, gradual curves in one pass.
 */
function sampleOpenSpline(points: PathPoint[], step: number): PathPoint[] {
  const count = points.length
  if (count < 3) return points
  const alpha = 0.5
  const result: PathPoint[] = []

  for (let i = 0; i < count - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(i + 2, count - 1)]!

    const d1 = Math.max(Math.hypot(p1.x - p0.x, p1.z - p0.z), 1e-3) ** alpha
    const d2 = Math.max(Math.hypot(p2.x - p1.x, p2.z - p1.z), 1e-3) ** alpha
    const d3 = Math.max(Math.hypot(p3.x - p2.x, p3.z - p2.z), 1e-3) ** alpha
    const t1 = d1
    const t2 = t1 + d2
    const t3 = t2 + d3
    const span = Math.max(t2 - t1, 1e-6)
    const steps = Math.max(1, Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step))

    for (let k = 0; k < steps; k++) {
      const t = t1 + (k / steps) * span
      const a1x = ((t1 - t) / (t1 - 0)) * p0.x + ((t - 0) / (t1 - 0)) * p1.x
      const a1y = ((t1 - t) / (t1 - 0)) * p0.y + ((t - 0) / (t1 - 0)) * p1.y
      const a1z = ((t1 - t) / (t1 - 0)) * p0.z + ((t - 0) / (t1 - 0)) * p1.z
      const a2x = ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x
      const a2y = ((t2 - t) / (t2 - t1)) * p1.y + ((t - t1) / (t2 - t1)) * p2.y
      const a2z = ((t2 - t) / (t2 - t1)) * p1.z + ((t - t1) / (t2 - t1)) * p2.z
      const a3x = ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x
      const a3y = ((t3 - t) / (t3 - t2)) * p2.y + ((t - t2) / (t3 - t2)) * p3.y
      const a3z = ((t3 - t) / (t3 - t2)) * p2.z + ((t - t2) / (t3 - t2)) * p3.z
      const b1x = ((t2 - t) / (t2 - 0)) * a1x + ((t - 0) / (t2 - 0)) * a2x
      const b1y = ((t2 - t) / (t2 - 0)) * a1y + ((t - 0) / (t2 - 0)) * a2y
      const b1z = ((t2 - t) / (t2 - 0)) * a1z + ((t - 0) / (t2 - 0)) * a2z
      const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x
      const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y
      const b2z = ((t3 - t) / (t3 - t1)) * a2z + ((t - t1) / (t3 - t1)) * a3z

      result.push({
        x: ((t2 - t) / span) * b1x + ((t - t1) / span) * b2x,
        y: ((t2 - t) / span) * b1y + ((t - t1) / span) * b2y,
        z: ((t2 - t) / span) * b1z + ((t - t1) / span) * b2z,
        wet: p1.wet || p2.wet,
      })
    }
  }

  result.push(points[count - 1]!)
  return result
}

/** Node set: both ends of every cross road, plus an even grid of inland sites. */
function buildArterialNodes(
  field: Heightfield,
  seaLevel: number,
  crossRoads: Road[],
  rng: Rng,
  wetAt: (x: number, z: number) => boolean,
): ArterialNode[] {
  const nodes: ArterialNode[] = []
  crossRoads.forEach((cross, id) => {
    nodes.push({ x: cross.points[0]!.x, z: cross.points[0]!.z, y: cross.points[0]!.y, cross: id })
    const end = cross.points[cross.points.length - 1]!
    nodes.push({ x: end.x, z: end.z, y: end.y, cross: id })
  })

  const worldX = field.width * field.cellSize
  const worldZ = field.depth * field.cellSize
  for (let gz = ARTERIAL_FIELD_SPACING / 2; gz < worldZ; gz += ARTERIAL_FIELD_SPACING) {
    for (let gx = ARTERIAL_FIELD_SPACING / 2; gx < worldX; gx += ARTERIAL_FIELD_SPACING) {
      const x = gx + (rng() - 0.5) * ARTERIAL_FIELD_SPACING * 0.35
      const z = gz + (rng() - 0.5) * ARTERIAL_FIELD_SPACING * 0.35
      const ground = sampleTerrain(field, x, z)
      if (ground <= seaLevel || wetAt(x, z)) continue
      if (nodes.some((node) => Math.hypot(node.x - x, node.z - z) < ARTERIAL_FIELD_SPACING * 0.45)) continue
      nodes.push({ x, z, y: ground, cross: -1 })
    }
  }
  return nodes
}

/**
 * An even mesh over the nodes, built only from Voronoi-adjacent anchors, so the
 * straight edges never cross (they are a Delaunay-like planar graph). Each node
 * links to its nearest neighbours first, then is lifted to at least two links so
 * nothing dead-ends, then the remaining components are joined and spare links
 * close extra loops.
 */
function buildArterialEdges(nodes: ArterialNode[], adjacency: [number, number][]): [number, number][] {
  const count = nodes.length
  const pairs: { a: number; b: number; d: number }[] = []
  for (const [a, b] of adjacency) {
    if (nodes[a]!.cross >= 0 && nodes[a]!.cross === nodes[b]!.cross) continue
    pairs.push({ a, b, d: Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.z - nodes[b]!.z) })
  }
  pairs.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b)

  const touching: number[][] = nodes.map(() => [])
  for (let i = 0; i < pairs.length; i++) {
    touching[pairs[i]!.a]!.push(i)
    touching[pairs[i]!.b]!.push(i)
  }

  const edges: [number, number][] = []
  const degree = new Array<number>(count).fill(0)
  const used = new Set<number>()
  const add = (index: number): void => {
    if (index < 0 || used.has(index) || edges.length >= ARTERIAL_MAX_COUNT) return
    const pair = pairs[index]!
    used.add(index)
    edges.push([pair.a, pair.b])
    degree[pair.a]!++
    degree[pair.b]!++
  }

  // Even local coverage.
  for (let i = 0; i < count; i++) {
    for (const index of touching[i]!.slice(0, ARTERIAL_NEIGHBOURS)) add(index)
  }
  // No dead ends: every node reaches degree two.
  for (let i = 0; i < count; i++) {
    for (const index of touching[i]!) {
      if (degree[i]! >= 2) break
      add(index)
    }
  }
  // Join anything still separate.
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (start: number): number => {
    let root = start
    while (parent[root]! !== root) root = parent[root]!
    let walk = start
    while (parent[walk]! !== root) {
      const next = parent[walk]!
      parent[walk] = root
      walk = next
    }
    return root
  }
  for (const [a, b] of edges) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < pairs.length && edges.length < ARTERIAL_MAX_COUNT; i++) {
    const pair = pairs[i]!
    const ra = find(pair.a)
    const rb = find(pair.b)
    if (ra === rb) continue
    parent[ra] = rb
    add(i)
  }
  // Spare shortest links close loops.
  for (let i = 0; i < pairs.length && edges.length < ARTERIAL_MAX_COUNT; i++) add(i)

  return edges
}

/** Nearest node to `index` that has not been tried yet, or `-1`. */
function nearestUntried(nodes: ArterialNode[], index: number, tried: Set<number>): number {
  let best = -1
  let bestDistance = Infinity
  for (let j = 0; j < nodes.length; j++) {
    if (j === index) continue
    if (nodes[index]!.cross >= 0 && nodes[index]!.cross === nodes[j]!.cross) continue
    const key = index < j ? index * nodes.length + j : j * nodes.length + index
    if (tried.has(key)) continue
    const distance = Math.hypot(nodes[index]!.x - nodes[j]!.x, nodes[index]!.z - nodes[j]!.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = j
    }
  }
  return best
}

/** True when two open segments properly cross at an interior point. */
function segmentsCross(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx)
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * True when a would-be arterial runs into a road already built: it crosses one,
 * or its carriageway laps over one. Testing only for a crossing lets an arterial
 * lie along a highway without ever cutting across it, which reads as the two
 * roads merged into one.
 *
 * Its own two ends are exempt within `mergeReach`, since an arterial starts and
 * finishes on a cross road and has to reach the carriageway to join it. The
 * highway itself is never exempt: an arterial reaches the highway network
 * through an interchange's cross road, so it has no business touching the
 * carriageway anywhere.
 */
function clashesWithBuilt(points: RoadPoint[], roads: Road[], mergeReach: number): boolean {
  const head = points[0]!
  const tail = points[points.length - 1]!
  // Both roads carry hundreds of samples, so reject whole roads, then whole
  // segments, on their bounds before measuring anything.
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }
  const near: Road[] = []
  for (const road of roads) {
    const reach = (ARTERIAL_WIDTH + road.width) / 2
    const theirs = roadBounds(road, reach)
    if (maxX < theirs.minX || theirs.maxX < minX || maxZ < theirs.minZ || theirs.maxZ < minZ) {
      continue
    }
    near.push(road)
  }
  if (near.length === 0) return false

  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const midX = (a.x + b.x) / 2
    const midZ = (a.z + b.z) / 2
    const merging =
      Math.hypot(midX - head.x, midZ - head.z) < mergeReach ||
      Math.hypot(midX - tail.x, midZ - tail.z) < mergeReach
    for (const road of near) {
      const count = road.closed ? road.points.length : road.points.length - 1
      const clear = merging && !road.closed ? 0 : (ARTERIAL_WIDTH + road.width) / 2
      const margin = Math.max(clear, 0)
      for (let j = 0; j < count; j++) {
        const c = road.points[j]!
        const d = road.points[(j + 1) % road.points.length]!
        if (Math.min(a.x, b.x) - margin > Math.max(c.x, d.x)) continue
        if (Math.min(c.x, d.x) - margin > Math.max(a.x, b.x)) continue
        if (Math.min(a.z, b.z) - margin > Math.max(c.z, d.z)) continue
        if (Math.min(c.z, d.z) - margin > Math.max(a.z, b.z)) continue
        if (segmentsCross(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z)) return true
        if (clear > 0 && segmentGap(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z) < clear) return true
      }
    }
  }
  return false
}

/** Nearest node to `index` not in `exclude`, or `-1`. */
function nearestNode(nodes: ArterialNode[], index: number, exclude?: Set<number>): number {
  let best = -1
  let bestDistance = Infinity
  for (let j = 0; j < nodes.length; j++) {
    if (j === index || exclude?.has(j)) continue
    if (nodes[index]!.cross >= 0 && nodes[index]!.cross === nodes[j]!.cross) continue
    const distance = Math.hypot(nodes[index]!.x - nodes[j]!.x, nodes[index]!.z - nodes[j]!.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = j
    }
  }
  return best
}

/** Turn is judged between samples at least this far apart, so dense fillet samples cannot hide a hairpin. */
const TURN_WINDOW = 3

/**
 * Sharpest heading change (radians) anywhere along a finished polyline,
 * between headings taken over at least TURN_WINDOW of road either side.
 */
function sharpestTurn(points: RoadPoint[]): number {
  const marks: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const last = points[marks[marks.length - 1]!]!
    if (Math.hypot(points[i]!.x - last.x, points[i]!.z - last.z) >= TURN_WINDOW) marks.push(i)
  }
  if (marks.length < 3) return 0
  let sharpest = 0
  for (let k = 1; k + 1 < marks.length; k++) {
    const a = points[marks[k - 1]!]!
    const b = points[marks[k]!]!
    const c = points[marks[k + 1]!]!
    const inX = b.x - a.x
    const inZ = b.z - a.z
    const outX = c.x - b.x
    const outZ = c.z - b.z
    const inLength = Math.hypot(inX, inZ)
    const outLength = Math.hypot(outX, outZ)
    if (inLength < 1e-6 || outLength < 1e-6) continue
    const dot = (inX * outX + inZ * outZ) / (inLength * outLength)
    sharpest = Math.max(sharpest, Math.acos(Math.min(Math.max(dot, -1), 1)))
  }
  return sharpest
}

/**
 * Arterial network built as a graph: the nodes are the cross road ends plus an
 * even grid of inland sites, and the edges are routed as smooth splines by A*
 * over a terrain grid. Nearby nodes link first for even coverage, every node is
 * lifted to at least two roads so nothing dead-ends, then spare links close
 * loops. Highway cells are impassable, so arterials only meet the highway at an
 * interchange, and the grade limit keeps every climb gradual. Deterministic.
 */
function buildArterials(
  field: Heightfield,
  seaLevel: number,
  crossRoads: Road[],
  existing: Road[],
  surfaceAt: (x: number, z: number) => { wet: boolean; level: number },
  seed: number,
  nextId: number,
): Road[] {
  const rng: Rng = createRng(seed)
  const nodes = buildArterialNodes(field, seaLevel, crossRoads, rng, (x, z) => surfaceAt(x, z).wet)
  if (nodes.length < 2) return []
  const grid = buildNavGrid(field, seaLevel, surfaceAt, existing)
  const label = labelAnchors(grid, nodes)
  const adjacency = voronoiAdjacency(grid, label, nodes.length)
  const edges = buildArterialEdges(nodes, adjacency)
  const density = new Float32Array(grid.cols * grid.rows)
  const block = new Float32Array(grid.cols * grid.rows)
  const buffers: SearchBuffers = {
    gScore: new Float32Array(grid.cols * grid.rows),
    cameFrom: new Int32Array(grid.cols * grid.rows),
    closed: new Uint8Array(grid.cols * grid.rows),
    priority: new Float32Array(grid.cols * grid.rows),
    open: [],
  }
  // Everything already on the map is an obstacle: an arterial may meet a road
  // at a shared endpoint, but must never cross one.
  const obstacles: Road[] = [...existing]
  const roads: Road[] = []
  const endpoints: [number, number][] = []
  const degree = new Array<number>(nodes.length).fill(0)
  const tried = new Set<number>()
  let id = nextId

  const buildRoad = (a: number, b: number, relaxed = false): boolean => {
    const start = nodes[a]!
    const goal = nodes[b]!

    const makeRoad = (cells: number[]): { points: RoadPoint[]; structure: Uint8Array } | null => {
      const raw: PathPoint[] = cells.map((index) => {
        const col = index % grid.cols
        const row = (index / grid.cols) | 0
        return {
          x: (col + 0.5) * grid.cell,
          y: grid.height[index]!,
          z: (row + 0.5) * grid.cell,
          wet: grid.wet[index] === 1,
        }
      })
      // Pin the real ends so the arterial meets the cross road exactly.
      raw[0] = { x: start.x, y: start.y, z: start.z, wet: raw[0]!.wet }
      raw[raw.length - 1] = { x: goal.x, y: goal.y, z: goal.z, wet: raw[raw.length - 1]!.wet }
      let path = dedupePath(sampleOpenSpline(decimatePath(raw, ARTERIAL_WAYPOINT_STRIDE), ARTERIAL_STEP), 2)
      path = roundCorners(path, ARTERIAL_MIN_RADIUS, ARTERIAL_MAX_TURN)
      path = roundCorners(path, ARTERIAL_MIN_RADIUS, ARTERIAL_MAX_TURN)
      path = dedupePath(path, 0.05)
      if (path.length < 2) return null

      // The spline and the corner fillets move the path in plan while carrying
      // the nav grid's coarse cell heights along with them, so by here `y` is a
      // smoothed average of ground the road no longer runs over: it sails
      // across a dip instead of dropping through it. Take the height from the
      // ground under the finished path, the way a city street does, so the two
      // sit at the same level where they meet. Only the pinned ends keep their
      // height, since those have to meet the cross road where it stands.
      const heights = Float32Array.from(
        path.map((point, index) => {
          if (index === 0 || index === path.length - 1) return point.y
          const ground = sampleTerrain(field, point.x, point.z)
          const water = surfaceAt(point.x, point.z)
          return water.wet ? Math.max(water.level + ARTERIAL_BRIDGE_CLEARANCE, ground) : ground
        }),
      )
      limitSweepGrade(heights, path, MAX_ARTERIAL_GRADE)

      const structure = new Uint8Array(path.length - 1)
      const points: RoadPoint[] = path.map((point, index) => ({
        x: point.x,
        y: heights[index]!,
        z: point.z,
      }))
      for (let i = 0; i < structure.length; i++) {
        const wet =
          surfaceAt(points[i]!.x, points[i]!.z).wet || surfaceAt(points[i + 1]!.x, points[i + 1]!.z).wet
        structure[i] = wet ? ROAD_BRIDGE : ROAD_GRADE
      }
      return { points, structure }
    }

    /**
     * True when this road would leave `node` too close to the heading of one
     * already joined there. Two arterials parting at a sliver of an angle run
     * along each other rather than making a junction anyone can read.
     */
    const sharpAt = (node: number, points: RoadPoint[], fromStart: boolean): boolean => {
      const heading = leavingDirection(points, fromStart)
      for (let k = 0; k < roads.length; k++) {
        const [from, to] = endpoints[k]!
        if (from !== node && to !== node) continue
        const other = leavingDirection(roads[k]!.points, from === node)
        const apart = Math.acos(
          Math.min(Math.max(heading.x * other.x + heading.z * other.z, -1), 1),
        )
        if (apart < ARTERIAL_MIN_JUNCTION_ANGLE) return true
      }
      return false
    }

    const unusable = (candidate: { points: RoadPoint[] }): boolean =>
      clashesWithBuilt(candidate.points, obstacles, ARTERIAL_MERGE_REACH) ||
      sharpAt(a, candidate.points, true) ||
      sharpAt(b, candidate.points, false)

    const startCell = cellAt(grid, start.x, start.z)
    const goalCell = cellAt(grid, goal.x, goal.z)
    let cells = routeCells(grid, buffers, startCell, goalCell, label, density, block, !relaxed, a, b)
    if (cells === null) return false
    let road = makeRoad(cells)
    if (road === null) return false

    // A route that runs into a road already on the map is retried with those
    // cells blocked, so arterials merge into junctions instead of colliding.
    const touched: number[] = []
    for (let attempt = 0; attempt < 4 && road !== null && unusable(road); attempt++) {
      for (const index of cells) {
        if (block[index] === 0) touched.push(index)
        block[index] = 1
      }
      const retry = routeCells(grid, buffers, startCell, goalCell, label, density, block, !relaxed, a, b)
      if (retry === null) {
        road = null
        break
      }
      cells = retry
      road = makeRoad(cells)
    }
    for (const index of touched) block[index] = 0
    if (road === null || unusable(road)) return false

    for (const index of cells) density[index] = density[index]! + 1
    const built: Road = {
      id: id++,
      kind: 'arterial',
      closed: false,
      width: ARTERIAL_WIDTH,
      points: road.points,
      structure: road.structure,
    }
    roads.push(built)
    obstacles.push(built)
    endpoints.push([a, b])
    degree[a]!++
    degree[b]!++
    return true
  }

  for (const [a, b] of edges) {
    tried.add(a < b ? a * nodes.length + b : b * nodes.length + a)
    buildRoad(a, b)
  }

  // Any node the router left with fewer than two roads gets another, where the
  // terrain allows. Whatever is still a dead end is pruned below.
  for (let i = 0; i < nodes.length && roads.length < ARTERIAL_MAX_COUNT * 2; i++) {
    let attempts = 0
    while (degree[i]! < 2 && attempts < 12) {
      const j = nearestUntried(nodes, i, tried)
      if (j < 0) break
      attempts++
      tried.add(i < j ? i * nodes.length + j : j * nodes.length + i)
      buildRoad(i, j, true)
    }
  }

  // Prune dangling branches, and any road whose smoothing left a sharp knot,
  // until every remaining road joins two others and runs clean. What is left is
  // a network of loops, so there are no dead ends and no stray spikes.
  const alive = new Array<boolean>(roads.length).fill(true)
  for (;;) {
    const join = new Array<number>(nodes.length).fill(0)
    for (let i = 0; i < roads.length; i++) {
      if (!alive[i]) continue
      join[endpoints[i]![0]]!++
      join[endpoints[i]![1]]!++
    }
    let pruned = false
    for (let i = 0; i < roads.length; i++) {
      if (!alive[i]) continue
      const [a, b] = endpoints[i]!
      // A leaf at a cross road end is fine: the cross road is its second link.
      const leafA = join[a] === 1 && nodes[a]!.cross < 0
      const leafB = join[b] === 1 && nodes[b]!.cross < 0
      if (leafA || leafB || sharpestTurn(roads[i]!.points) > ARTERIAL_PRUNE_TURN) {
        alive[i] = false
        pruned = true
      }
    }
    if (!pruned) break
  }
  return roads.filter((_, index) => alive[index]!)
}

/** City street width, in world units. */
export const STREET_WIDTH = 6
/** Spacing between city streets and the step along them, in world units. */
const STREET_SPACING = 48
const STREET_STEP = 12
/** Clear ground kept between a street and the edge of a highway or ramp. */
const STREET_CLEARANCE = ROAD_WIDTH
/** A street has to span a block to be worth drawing, so runs are this long. */
const STREET_MIN_POINTS = Math.round(STREET_SPACING / STREET_STEP) + 1
/**
 * A street that runs into an arterial shallower than this does not read as a
 * junction: the two ribbons overlap along their length and smear into a single
 * road. Anything squarer than this is a normal crossing and is left alone.
 */
const STREET_ARTERIAL_ANGLE = Math.PI / 4
/**
 * How close a street may come to an arterial's centreline: any nearer and the
 * two carriageways overlap, which is the smear itself. Trimming back to exactly
 * here leaves the street touching the arterial, so a shallow meeting still
 * reads — and still counts — as a junction onto it.
 */
const STREET_ARTERIAL_TOUCH = (ARTERIAL_WIDTH + STREET_WIDTH) / 2
/** Cell size of the grid road segments are bucketed into, in world units. */
const SEGMENT_CELL = 32

/** One stretch of road, with the ground either side of it that it claims. */
interface ClaimedSegment {
  ax: number
  az: number
  bx: number
  bz: number
  /** Ground within this distance of the segment belongs to it. */
  reach: number
  /** Unit heading along the segment. */
  dx: number
  dz: number
}

/** Every segment of a road, each claiming `reach` of ground either side. */
function claimedSegments(road: Road, reach: number): ClaimedSegment[] {
  const points = road.points
  const count = road.closed ? points.length : points.length - 1
  const segments: ClaimedSegment[] = []
  for (let i = 0; i < count; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
    segments.push({
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      reach,
      dx: (b.x - a.x) / length,
      dz: (b.z - a.z) / length,
    })
  }
  return segments
}

/**
 * Calls `visit` for every indexed segment that could claim ground inside the
 * box, stopping at the first one `visit` accepts. A segment spanning several
 * cells of the box is offered more than once, which costs a repeated test and
 * nothing else.
 */
type SegmentLookup = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  visit: (segment: ClaimedSegment) => boolean,
) => boolean

/**
 * Bucket segments into a uniform grid by the ground they claim, so a lookup only
 * tests the few that could be in range. A segment goes in every cell its reach
 * can touch, so a box only ever looks in the cells it covers. The roads hold
 * thousands of samples between them, far too many to walk once per street span.
 */
function indexSegments(segments: ClaimedSegment[]): SegmentLookup {
  const cellOf = (value: number): number => Math.max(0, Math.floor(value / SEGMENT_CELL))
  const key = (col: number, row: number): number => col * 0x10000 + row
  const buckets = new Map<number, ClaimedSegment[]>()
  for (const segment of segments) {
    const minCol = cellOf(Math.min(segment.ax, segment.bx) - segment.reach)
    const maxCol = cellOf(Math.max(segment.ax, segment.bx) + segment.reach)
    const minRow = cellOf(Math.min(segment.az, segment.bz) - segment.reach)
    const maxRow = cellOf(Math.max(segment.az, segment.bz) + segment.reach)
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const bucket = buckets.get(key(col, row))
        if (bucket) bucket.push(segment)
        else buckets.set(key(col, row), [segment])
      }
    }
  }

  return (minX, minZ, maxX, maxZ, visit) => {
    const maxCol = cellOf(maxX)
    const maxRow = cellOf(maxZ)
    for (let row = cellOf(minZ); row <= maxRow; row++) {
      for (let col = cellOf(minX); col <= maxCol; col++) {
        const bucket = buckets.get(key(col, row))
        if (!bucket) continue
        for (const segment of bucket) if (visit(segment)) return true
      }
    }
    return false
  }
}

/**
 * The ground city streets have to leave alone: a band a highway's width clear
 * of every highway and ramp edge, and the whole footprint of each interchange,
 * so no street threads the pockets its ramps enclose against the highway.
 */
function streetKeepOut(roads: Road[], footprints: Vec2[][]): (x: number, z: number) => boolean {
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
 * Fill each city with a street grid. The grid is aligned to the city polygon's
 * principal axes, so every street runs edge to edge across the polygon and the
 * cells between them are simple rectangles. Streets follow the ground and are
 * grade-limited like any other road. A grid line is cut wherever it leaves the
 * city, meets water or enters `blocked`, and each surviving run long enough to
 * span a block becomes its own street.
 */
function buildCityGrids(
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

  // Every city cell, once; then each district takes the ones inside its radius.
  const cityCells: { x: number; z: number }[] = []
  for (let cell = 0; cell < districtOf.length; cell++) {
    if (districtOf[cell] !== DISTRICT_CITY) continue
    const col = cell % width
    const row = (cell / width) | 0
    cityCells.push({ x: (col + 0.5) * cellSize, z: (row + 0.5) * cellSize })
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
    const local = cityCells.filter(
      (point) => Math.hypot(point.x - district.cx, point.z - district.cz) <= district.radius,
    )
    if (local.length < 8) continue

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
function trimStreetsAlongArterials(roads: Road[], nextId: number): Road[] {
  const arterials = roads.filter((road) => road.width === ARTERIAL_WIDTH)
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
    if (road.width !== STREET_WIDTH) {
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

/** Axis-aligned bounds of a road's centreline, grown by `margin`. */
function roadBounds(road: Road, margin: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of road.points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin }
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
function pruneStrandedStreets(roads: Road[]): Road[] {
  const streets = roads.filter((road) => road.width === STREET_WIDTH)
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
      if (other.width === STREET_WIDTH) continue
      if (roadsMeet(streets[i]!, other)) {
        linked.add(find(i))
        break
      }
    }
  }

  const stranded = new Set(streets.filter((_, index) => !linked.has(find(index))))
  return roads.filter((road) => !stranded.has(road))
}

interface RoadEnd {
  road: Road
  start: boolean
}

/** The node point at a road end. */
function endPoint(end: RoadEnd): RoadPoint {
  const points = end.road.points
  return end.start ? points[0]! : points[points.length - 1]!
}

/** Unit direction a polyline leaves one of its ends by. */
function leavingDirection(points: RoadPoint[], fromStart: boolean): { x: number; z: number } {
  const a = fromStart ? points[0]! : points[points.length - 1]!
  const b = fromStart ? points[1]! : points[points.length - 2]!
  const dx = b.x - a.x
  const dz = b.z - a.z
  const length = Math.hypot(dx, dz) || 1
  return { x: dx / length, z: dz / length }
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
    if (other === road || other.width === STREET_WIDTH) continue
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
function alignJunctions(roads: Road[]): void {
  const ends: RoadEnd[] = []
  for (const road of roads) {
    if (road.closed || road.points.length < 2 || road.width === STREET_WIDTH) continue
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

/**
 * Make the ground and the surface roads agree. The ground is shaped to the
 * roads, the roads are read back off it, and their grade limits are imposed
 * again: where two roads cross at different heights the ground takes the mean,
 * and the limit then spreads the difference back along each road instead of
 * leaving it as a step. Twice round is enough for the two to settle.
 */
function settleSurfaceRoads(field: Heightfield, roads: Road[]): void {
  for (const road of roads) resampleSurfaceRoad(road, field.cellSize)
  for (let pass = 0; pass < 2; pass++) {
    stampRoadBeds(field, roads)
    seatSurfaceRoads(field, roads)
    for (const road of roads) limitSurfaceRoadGrade(road)
  }
  stampRoadBeds(field, roads)
  seatSurfaceRoads(field, roads)
}

/**
 * Build the highway network: a single closed loop that visits every city, so
 * no road ends in a dead end. The horizontal route is shaped by `routeLoop`;
 * the vertical route is grade-limited, which forces a bridge where it crosses
 * water and a tunnel where it passes beneath a mountain. Interchanges branch
 * off the finished loop as open cross roads and ramps.
 */
export function generateRoads(
  field: Heightfield,
  seaLevel: number,
  districts: District[],
  rivers: River[],
  lakes: Lake[],
  seed = 0,
  districtOf?: Uint8Array,
): Road[] {
  const samples = routeLoop(districts, field, seaLevel)
  const count = samples.length
  if (count < 3) return []

  const { width, depth, cellSize } = field
  // Every cell the water is drawn over, at the highest level drawn there. A
  // sample's own cell is not enough: a road can cross a wide river far from any
  // centreline cell and read the ground as dry, and a deck built to clear one
  // sample can still finish under the sample beside it.
  const riverLevels = new Map<number, number>()
  for (const river of rivers) {
    for (const point of river.points) {
      const reach = (point.width / 2) * (1 + RIVER_BANK_LAP)
      const minCol = Math.max(Math.floor((point.x - reach) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((point.x + reach) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((point.z - reach) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((point.z + reach) / cellSize), depth - 1)
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (Math.hypot(col * cellSize - point.x, row * cellSize - point.z) > reach) continue
          const cell = row * width + col
          const known = riverLevels.get(cell)
          if (known === undefined || point.y > known) riverLevels.set(cell, point.y)
        }
      }
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

  const cum = cumulativeLengths(samples)
  const total =
    cum[count - 1]! +
    Math.hypot(samples[0]!.x - samples[count - 1]!.x, samples[0]!.z - samples[count - 1]!.z)
  // What the deck comes to before any crossing has had a say. Sites are judged
  // against this rather than against the raw aim above, which ignores the grade
  // limit and so says nothing about how high the highway really stands.
  const deck = Float32Array.from(profile)
  limitGrade(deck, samples, MAX_ROAD_GRADE)
  const crossings = interchangeCenters(
    field,
    seaLevel,
    samples,
    wet,
    (x, z) => surfaceAt(x, z).wet,
    cum,
    total,
    districts,
    deck,
  ).map((c) => ({ index: c, cross: crossRoad(field, samples, c) }))

  // Raise the deck over each crossing until it clears the cross road below;
  // the grade limit spreads each lift into approach ramps. Crossings where the
  // two constraints cannot both hold are dropped after a final grade pass.
  const bridgeSteps = Math.max(1, Math.round(UNDERPASS_SPAN / (total / count)))
  for (let pass = 0; pass < 20; pass++) {
    let raised = false
    for (const { index: c, cross } of crossings) {
      const required = cross.heights[cross.centerIndex]! + UNDERPASS_CLEARANCE
      for (let j = -bridgeSteps; j <= bridgeSteps; j++) {
        const k = (c + j + count) % count
        if (profile[k]! < required) {
          profile[k] = required
          raised = true
        }
      }
    }
    if (!raised) break
    limitGrade(profile, samples, MAX_ROAD_GRADE)
  }
  limitGrade(profile, samples, MAX_ROAD_GRADE)

  // A sample that stayed near its water is a bridge deck; one the grade limit
  // pushed deep beneath the bed is a tunnel, even with a river overhead.
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

  const built = crossings.filter(({ index, cross }) => {
    if (kind[index] === KIND_TUNNEL) return false
    if (profile[index]! - cross.heights[cross.centerIndex]! < UNDERPASS_CLEARANCE - 0.5) return false
    // A ramp lands ROAD_SURFACE below the cross road's centreline, on its ground.
    const drop =
      profile[index]! +
      ROAD_SURFACE -
      Math.min(sampleOpen(cross.heights, -RAMP_REACH), sampleOpen(cross.heights, RAMP_REACH))
    return drop <= RAMP_DROP
  })
  const points: RoadPoint[] = samples.map((point, i) => ({ x: point.x, y: profile[i]!, z: point.z }))
  const highway: Road = { id: 0, kind: 'highway', closed: true, width: ROAD_WIDTH, points, structure }
  const { roads: access, footprints } = buildInterchanges(
    samples,
    profile,
    built,
    bridgeSteps,
    structure,
    1,
  )
  const crossRoads = access.filter((road) => road.width === CROSS_WIDTH)
  const arterials = buildArterials(
    field,
    seaLevel,
    crossRoads,
    [highway, ...access],
    surfaceAt,
    (seed ^ ARTERIAL_SALT) >>> 0,
    access.length + 1,
  )
  // Arterials are numbered before pruning, so their count is not their last id.
  const nextId = Math.max(...arterials.map((road) => road.id), access.length) + 1
  const streets = districtOf
    ? buildCityGrids(
        field,
        seaLevel,
        districts,
        districtOf,
        streetKeepOut([highway, ...access], footprints),
        nextId,
      )
    : []
  const network = [highway, ...access, ...arterials, ...streets]
  alignJunctions(network)
  // Junction alignment moves roads, so only once every road is where it will
  // finally be drawn is it worth asking what a street runs into and reaches.
  const roads = pruneStrandedStreets(
    trimStreetsAlongArterials(network, nextId + streets.length),
  )
  // The highway cuts its bed first, clear of any ground a surface road is;
  // the surface roads are then settled into the ground.
  const painted = roads.filter(isSurfaceRoad)
  carveRoadBeds(field, roads.filter((road) => !isSurfaceRoad(road)), surfaceRoadCells(field, painted))
  settleSurfaceRoads(field, painted)
  return roads
}
