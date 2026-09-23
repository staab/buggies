import * as exact from '@buggies/physics'
import type { District, Heightfield } from '../types.ts'
import {
  BOW_ANGLE,
  BOW_FRACTION,
  RING_POINTS,
  SAMPLE_STEP,
  STADIUM_SEGMENTS,
  TURN_RADIUS_FRACTION,
} from './constants.ts'
import { type Vec2, centroid, interiorAngle, polygonInradius } from './geometry.ts'
import { pullAllInland, pullInland, sampleTerrain } from './sampling.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos, hypot, sin } = exact

/**
 * The highway: one loop round the island's cities, shaped as a stadium or bowed
 * round the coast, and sampled into a smooth run of points.
 */

/**
 * A rounded stadium along two extreme cities, wide enough to take in the ones
 * between. When the cities are nearly on a line this is the only closed shape
 * that reaches them all without hairpinning at either end.
 */
function stadiumLoop(a: Vec2, b: Vec2, halfWidth: number): Vec2[] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const length = hypot(dx, dz) || 1
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
      x: b.x + nx * halfWidth * cos(angle) + ux * halfWidth * sin(angle),
      z: b.z + nz * halfWidth * cos(angle) + uz * halfWidth * sin(angle),
    })
  }
  for (let k = 0; k <= STADIUM_SEGMENTS; k++) {
    const t = 1 - k / STADIUM_SEGMENTS
    points.push({ x: a.x + dx * t - nx * halfWidth, z: a.z + dz * t - nz * halfWidth })
  }
  for (let k = 1; k < STADIUM_SEGMENTS; k++) {
    const angle = (Math.PI * k) / STADIUM_SEGMENTS
    points.push({
      x: a.x - nx * halfWidth * cos(angle) - ux * halfWidth * sin(angle),
      z: a.z - nz * halfWidth * cos(angle) - uz * halfWidth * sin(angle),
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
      const distance = hypot(ordered[i]!.cx - ordered[j]!.cx, ordered[i]!.cz - ordered[j]!.cz)
      if (distance > farthest) {
        farthest = distance
        a = ordered[i]!
        b = ordered[j]!
      }
    }
  }
  const dx = b.cx - a.cx
  const dz = b.cz - a.cz
  const length = hypot(dx, dz) || 1
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
    const angleA = atan2(a.cz - centerZ, a.cx - centerX)
    const angleB = atan2(b.cz - centerZ, b.cx - centerX)
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
    const length = hypot(outX, outZ) || 1
    outX /= length
    outZ /= length
    const bow = hypot(b.x - a.x, b.z - a.z) * fraction
    points.push(pullInland(midX + outX * bow, midZ + outZ * bow, center.x, center.z, field, seaLevel))
  }
  return points
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
    const length = hypot(dx, dz)
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
    const startAngle = atan2(start.z - city.z, start.x - city.x)
    let sweep = atan2(end.z - city.z, end.x - city.x) - startAngle
    while (sweep <= -Math.PI) sweep += Math.PI * 2
    while (sweep > Math.PI) sweep -= Math.PI * 2
    const arcSteps = Math.max(1, Math.ceil((Math.abs(sweep) * radius) / step))
    for (let k = 0; k <= arcSteps; k++) {
      const angle = startAngle + sweep * (k / arcSteps)
      points.push({ x: city.x + cos(angle) * radius, z: city.z + sin(angle) * radius })
    }

    const next = control[(i + 1) % count]!
    const nextStart = { x: next.x + outgoing.x * radius, z: next.z + outgoing.z * radius }
    const runX = nextStart.x - end.x
    const runZ = nextStart.z - end.z
    const runSteps = Math.max(1, Math.ceil(hypot(runX, runZ) / step))
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
      return { x: district.cx + cos(angle) * radius, z: district.cz + sin(angle) * radius }
    })
    return pullAllInland(ring, district.cx, district.cz, field, seaLevel)
  }

  if (count === 2) {
    const a = ordered[0]!
    const b = ordered[1]!
    const length = hypot(b.cx - a.cx, b.cz - a.cz) || 1
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
export function routeLoop(districts: District[], field: Heightfield, seaLevel: number): Vec2[] {
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

    const d1 = Math.max(hypot(p1.x - p0.x, p1.z - p0.z), 1e-3) ** alpha
    const d2 = Math.max(hypot(p2.x - p1.x, p2.z - p1.z), 1e-3) ** alpha
    const d3 = Math.max(hypot(p3.x - p2.x, p3.z - p2.z), 1e-3) ** alpha
    const t0 = 0
    const t1 = t0 + d1
    const t2 = t1 + d2
    const t3 = t2 + d3
    const span = Math.max(t2 - t1, 1e-6)
    const steps = Math.max(2, Math.round(hypot(p2.x - p1.x, p2.z - p1.z) / step))

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
