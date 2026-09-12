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

interface Vec2 {
  x: number
  z: number
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

/**
 * The city anchors, arranged into a simple loop. Cities are visited in angular
 * order so the loop never crosses itself; a chord that would run out to sea
 * gets an inland waypoint, and one or two cities get a ring or an oval so the
 * curve has something to bend around.
 */
function controlPoints(
  districts: District[],
  field: Heightfield,
  seaLevel: number,
): Vec2[] {
  const count = districts.length
  if (count === 0) return []

  let centerX = 0
  let centerZ = 0
  for (const district of districts) {
    centerX += district.cx
    centerZ += district.cz
  }
  centerX /= count
  centerZ /= count

  if (count === 1) {
    const district = districts[0]!
    const radius = Math.max(40, district.radius + district.suburbWidth + 24)
    return Array.from({ length: RING_POINTS }, (_, k) => {
      const angle = (k / RING_POINTS) * Math.PI * 2
      return pullInland(
        district.cx + Math.cos(angle) * radius,
        district.cz + Math.sin(angle) * radius,
        district.cx,
        district.cz,
        field,
        seaLevel,
      )
    })
  }

  const ordered = districts
    .slice()
    .sort((a, b) => {
      const angleA = Math.atan2(a.cz - centerZ, a.cx - centerX)
      const angleB = Math.atan2(b.cz - centerZ, b.cx - centerX)
      return angleA - angleB || a.id - b.id
    })

  if (count === 2) {
    const a = ordered[0]!
    const b = ordered[1]!
    const dx = b.cx - a.cx
    const dz = b.cz - a.cz
    const length = Math.hypot(dx, dz) || 1
    const width = Math.max(length * 0.35, 40)
    const midX = (a.cx + b.cx) / 2
    const midZ = (a.cz + b.cz) / 2
    const normalX = -dz / length
    const normalZ = dx / length
    return [
      { x: a.cx, z: a.cz },
      pullInland(midX + normalX * width, midZ + normalZ * width, centerX, centerZ, field, seaLevel),
      { x: b.cx, z: b.cz },
      pullInland(midX - normalX * width, midZ - normalZ * width, centerX, centerZ, field, seaLevel),
    ]
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
 * no road ends in a dead end. The horizontal route is a smooth spline through
 * the cities; the vertical route is grade-limited, which forces a bridge where
 * it crosses water and a tunnel where it passes beneath a mountain.
 */
export function generateRoads(
  field: Heightfield,
  seaLevel: number,
  districts: District[],
  rivers: River[],
  lakes: Lake[],
): Road[] {
  const controls = controlPoints(districts, field, seaLevel)
  if (controls.length < 3) return []

  const samples = sampleLoop(controls, SAMPLE_STEP)
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
