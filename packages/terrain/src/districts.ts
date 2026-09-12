import { createRng, randomRange, type Rng } from '@buggies/physics'

import type { District, Heightfield } from './types.ts'

/** Per-cell district codes stored in `districtOf`. */
export const DISTRICT_COUNTRY = 0
export const DISTRICT_SUBURB = 1
export const DISTRICT_CITY = 2

/** Local slope is averaged over this many cells to judge a neighbourhood. */
const RELIEF_RADIUS = 12
/** Neighbourhoods gentler than this average grade count as level ground. */
const MAX_GRADE = 0.08
/** Land must clear the sea by this much before it can be built on. */
const COAST_MARGIN = 1.5
/** Cities to place, when the island has room for them. */
const CITY_COUNT = 3
const CITY_RADIUS = { min: 16, max: 26 } as const
const SUBURB_WIDTH = { min: 12, max: 20 } as const
/** A candidate needs this much level ground around it to become a city. */
const MIN_LEVEL_FRACTION = 0.4
/** Cities keep at least this much space between their centres. */
const MIN_CITY_SPACING = 120
const DISTRICT_SALT = 0x5d15

/** Greatest height change from a cell to its four neighbours, scaled to world units. */
function neighbourSlope(field: Heightfield): Float32Array {
  const { width, depth, cellSize, heights } = field
  const slope = new Float32Array(width * depth)

  for (let row = 0; row < depth; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col
      const height = heights[cell]!
      let steepest = 0
      if (col > 0) steepest = Math.max(steepest, Math.abs(height - heights[cell - 1]!))
      if (col < width - 1) steepest = Math.max(steepest, Math.abs(height - heights[cell + 1]!))
      if (row > 0) steepest = Math.max(steepest, Math.abs(height - heights[cell - width]!))
      if (row < depth - 1) steepest = Math.max(steepest, Math.abs(height - heights[cell + width]!))
      slope[cell] = steepest / cellSize
    }
  }

  return slope
}

/** Separable box blur with clamped edges, over a square window. */
function boxBlur(source: Float32Array, width: number, depth: number, radius: number): Float32Array {
  const clamp = (value: number, limit: number): number =>
    value < 0 ? 0 : value >= limit ? limit - 1 : value
  const diameter = radius * 2 + 1
  const horizontal = new Float32Array(source.length)

  for (let row = 0; row < depth; row++) {
    const base = row * width
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += source[base + clamp(k, width)]!
    horizontal[base] = sum / diameter
    for (let col = 1; col < width; col++) {
      sum += source[base + clamp(col + radius, width)]! - source[base + clamp(col - radius - 1, width)]!
      horizontal[base + col] = sum / diameter
    }
  }

  const result = new Float32Array(source.length)
  for (let col = 0; col < width; col++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += horizontal[clamp(k, depth) * width + col]!
    result[col] = sum / diameter
    for (let row = 1; row < depth; row++) {
      sum +=
        horizontal[clamp(row + radius, depth) * width + col]! -
        horizontal[clamp(row - radius - 1, depth) * width + col]!
      result[row * width + col] = sum / diameter
    }
  }

  return result
}

/** Fraction of the disc that is buildable land, used to size up a city site. */
function levelFraction(
  field: Heightfield,
  buildable: Uint8Array,
  col: number,
  row: number,
  radius: number,
): number {
  const cellRadius = Math.ceil(radius / field.cellSize)
  const minCol = Math.max(col - cellRadius, 0)
  const maxCol = Math.min(col + cellRadius, field.width - 1)
  const minRow = Math.max(row - cellRadius, 0)
  const maxRow = Math.min(row + cellRadius, field.depth - 1)
  const radiusSq = (radius / field.cellSize) ** 2

  let level = 0
  let total = 0
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const dc = c - col
      const dr = r - row
      if (dc * dc + dr * dr > radiusSq) continue
      total++
      if (buildable[r * field.width + c]) level++
    }
  }

  return total === 0 ? 0 : level / total
}

export interface DistrictMap {
  districts: District[]
  /** Row-major district code (`DISTRICT_*`) for every cell. */
  districtOf: Uint8Array
}

/**
 * Split the island into cities, suburbs and country. A city sits in the
 * gentlest ground it can find; its suburbs surround it, and everything on
 * ground too steep to build on stays country. Placement is deterministic.
 */
export function generateDistricts(
  field: Heightfield,
  seed: number,
  seaLevel: number,
  water: Set<number>,
): DistrictMap {
  const { width, depth, cellSize, heights } = field
  const count = width * depth
  const grade = boxBlur(neighbourSlope(field), width, depth, RELIEF_RADIUS)

  const buildable = new Uint8Array(count)
  const candidates: number[] = []
  for (let cell = 0; cell < count; cell++) {
    if (heights[cell]! <= seaLevel + COAST_MARGIN) continue
    if (grade[cell]! > MAX_GRADE) continue
    if (water.has(cell)) continue
    buildable[cell] = 1
    candidates.push(cell)
  }

  // Flattest first, with row-major order as a stable tie-break.
  candidates.sort((a, b) => grade[a]! - grade[b]! || a - b)

  const rng: Rng = createRng(seed ^ DISTRICT_SALT)
  const probeRadius = CITY_RADIUS.max
  const spacingSq = MIN_CITY_SPACING ** 2
  const centers: { col: number; row: number }[] = []
  const districts: District[] = []

  const placeCity = (cell: number): void => {
    const col = cell % width
    const row = (cell / width) | 0
    centers.push({ col, row })
    districts.push({
      id: districts.length,
      cx: (col + 0.5) * cellSize,
      cz: (row + 0.5) * cellSize,
      radius: randomRange(rng, CITY_RADIUS.min, CITY_RADIUS.max),
      suburbWidth: randomRange(rng, SUBURB_WIDTH.min, SUBURB_WIDTH.max),
      area: 0,
    })
  }

  for (const cell of candidates) {
    if (districts.length >= CITY_COUNT) break

    const col = cell % width
    const row = (cell / width) | 0
    const x = (col + 0.5) * cellSize
    const z = (row + 0.5) * cellSize
    let tooClose = false
    for (const center of centers) {
      const dx = x - (center.col + 0.5) * cellSize
      const dz = z - (center.row + 0.5) * cellSize
      if (dx * dx + dz * dz < spacingSq) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue
    if (levelFraction(field, buildable, col, row, probeRadius) < MIN_LEVEL_FRACTION) continue

    placeCity(cell)
  }

  // Rough islands may have no spot roomy enough; fall back to the gentlest one.
  if (districts.length === 0 && candidates.length > 0) placeCity(candidates[0]!)

  const districtOf = new Uint8Array(count)
  for (let cell = 0; cell < count; cell++) {
    if (!buildable[cell]) continue

    const x = ((cell % width) + 0.5) * cellSize
    const z = (((cell / width) | 0) + 0.5) * cellSize
    let nearest = -1
    let nearestSq = Infinity
    for (const district of districts) {
      const dx = x - district.cx
      const dz = z - district.cz
      const distanceSq = dx * dx + dz * dz
      if (distanceSq < nearestSq) {
        nearestSq = distanceSq
        nearest = district.id
      }
    }
    if (nearest < 0) continue

    const district = districts[nearest]!
    const distance = Math.sqrt(nearestSq)
    if (distance <= district.radius) {
      districtOf[cell] = DISTRICT_CITY
      district.area++
    } else if (distance <= district.radius + district.suburbWidth) {
      districtOf[cell] = DISTRICT_SUBURB
      district.area++
    }
  }

  return { districts, districtOf }
}
