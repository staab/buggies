import { createRng, randomRange, type Rng } from '@buggies/physics'
import * as exact from '@buggies/physics'

import type { District, Heightfield } from './types.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { acos, hypot } = exact

/** Per-cell district codes stored in `districtOf`. */
export const DISTRICT_COUNTRY = 0
export const DISTRICT_SUBURB = 1
export const DISTRICT_CITY = 2

/** Local slope is averaged over this many cells to judge a neighborhood. */
const RELIEF_RADIUS = 12
/** Ground is level when both its own and its neighborhood's grade are below this. */
const MAX_GRADE = 0.12
/**
 * A city may spread onto ground this steep, so it fills gently rolling land.
 * No steeper: its streets are the ground, held to a grade, and a grid of them
 * on a hillside cannot both keep that grade and meet at shared heights.
 */
const MAX_CITY_SLOPE = 0.1
/** Land must clear the sea by this much before it can be built on. */
const COAST_MARGIN = 1.5
/** Cities to place, when the island has room for them. */
const CITY_COUNT = 3
const CITY_RADIUS = { min: 57, max: 82 } as const
const SUBURB_WIDTH = { min: 45, max: 70 } as const
/** A candidate needs this much level ground around it to become a city. */
const MIN_LEVEL_FRACTION = 0.4
/**
 * Relief is judged over a city's whole reach as well, and a site scores
 * lower the more the land around it rises and falls: level ground at the
 * foot of a mountain is not away from significant elevation changes.
 */
const REGION_RELIEF_WEIGHT = 4
/** Cities keep at least this much space between their centers. */
const MIN_CITY_SPACING = 380
/** The triangle search only needs city cores not to overlap. */
const MIN_TRIANGLE_SIDE = CITY_RADIUS.max * 2
/** A city triangle may have each corner off a perfect equilateral by this much. */
const MAX_ANGLE_DEVIATION = 20
/** Candidate sites are thinned onto this coarse grid before the triangle search. */
const SITE_GRID = 96
/** Most sites considered when searching for the city triangle. */
const MAX_SITES = 64
/** Fraction of the full spacing allowed when backfilling the remaining cities. */
const FILL_SPACING_FRACTION = 0.6
const DISTRICT_SALT = 0x5d15

/**
 * Greatest height change from a cell to its four neighbors, scaled to world
 * units. Each neighbor is read only once it is known to be within the field.
 */
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

/**
 * Separable box blur with clamped edges, over a square window. The clamp
 * keeps every read within its row, or its column, so none comes back empty.
 */
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

export interface DistrictMap {
  districts: District[]
  /** Row-major district code (`DISTRICT_*`) for every cell. */
  districtOf: Uint8Array
}

interface Point {
  x: number
  z: number
}

/** World-space center of a cell. */
function cellCenter(cell: number, width: number, cellSize: number): Point {
  return { x: ((cell % width) + 0.5) * cellSize, z: (((cell / width) | 0) + 0.5) * cellSize }
}

/**
 * Thin the candidate cells onto a coarse grid, keeping the flattest cell in
 * each square. This gives the triangle search a handful of sites spread over
 * the whole island instead of a cluster from one flat patch.
 */
function representativeSites(candidates: number[], width: number, cellSize: number): number[] {
  const grid = Math.max(1, Math.round(SITE_GRID / cellSize))
  const columns = Math.ceil(width / grid)
  const seen = new Set<number>()
  const sites: number[] = []
  for (const cell of candidates) {
    const gx = ((cell % width) / grid) | 0
    const gz = (((cell / width) | 0) / grid) | 0
    const key = gz * columns + gx
    if (seen.has(key)) continue
    seen.add(key)
    sites.push(cell)
    if (sites.length >= MAX_SITES) break
  }
  return sites
}

/** Interior angles of a triangle with the given side lengths, in degrees. */
function triangleAngles(a: number, b: number, c: number): [number, number, number] {
  const angle = (opposite: number, x: number, y: number): number =>
    (acos(Math.min(Math.max((x * x + y * y - opposite * opposite) / (2 * x * y), -1), 1)) * 180) / Math.PI
  return [angle(a, b, c), angle(b, c, a), angle(c, a, b)]
}

/**
 * Score a candidate city triangle: the summed roominess of its corners, or
 * `-Infinity` when it is too small or not roughly equilateral.
 */
function triangleScore(
  points: [Point, Point, Point],
  cells: [number, number, number],
  level: Float32Array,
): number {
  const [a, b, c] = points
  const ab = hypot(a.x - b.x, a.z - b.z)
  const bc = hypot(b.x - c.x, b.z - c.z)
  const ca = hypot(c.x - a.x, c.z - a.z)
  if (Math.min(ab, bc, ca) < MIN_TRIANGLE_SIDE) return -Infinity
  const deviation = Math.max(...triangleAngles(bc, ca, ab).map((angle) => Math.abs(angle - 60)))
  if (deviation > MAX_ANGLE_DEVIATION) return -Infinity
  // The cells are sites, which are cells of the field the level covers.
  return level[cells[0]]! + level[cells[1]]! + level[cells[2]]!
}

/** The roomiest roughly-equilateral triangle of sites, or `null` if none fits. */
function bestTriangle(
  sites: number[],
  level: Float32Array,
  width: number,
  cellSize: number,
): number[] | null {
  if (sites.length < 3) return null
  const points = sites.map((cell) => cellCenter(cell, width, cellSize))
  let best: [number, number, number] | null = null
  let bestScore = -Infinity
  // i, j and k all run within the sites, and the points were made from them one for one.
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      for (let k = j + 1; k < sites.length; k++) {
        const score = triangleScore(
          [points[i]!, points[j]!, points[k]!],
          [sites[i]!, sites[j]!, sites[k]!],
          level,
        )
        if (score > bestScore) {
          bestScore = score
          best = [sites[i]!, sites[j]!, sites[k]!]
        }
      }
    }
  }
  return best
}

/**
 * Split the island into cities, suburbs and country. The three cities prefer a
 * roomy, roughly equilateral triangle so they never line up; a rough or cramped
 * island still gets its full complement on whatever dry land is available.
 * Placement is deterministic.
 */
export function generateDistricts(
  field: Heightfield,
  seed: number,
  seaLevel: number,
  water: Set<number>,
): DistrictMap {
  const { width, depth, cellSize, heights } = field
  const count = width * depth
  // Every field read below has a value a cell, and cells run up to the count.
  const slope = neighbourSlope(field)
  const grade = boxBlur(slope, width, depth, RELIEF_RADIUS)

  const buildable = new Uint8Array(count)
  const cityGround = new Uint8Array(count)
  const candidates: number[] = []
  for (let cell = 0; cell < count; cell++) {
    if (heights[cell]! <= seaLevel + COAST_MARGIN) continue
    // Gentle both locally and over the neighborhood, so a city never straddles
    // a single sharp step even when the surrounding terrain is otherwise even.
    if (slope[cell]! > MAX_GRADE || grade[cell]! > MAX_GRADE) continue
    if (water.has(cell)) continue
    buildable[cell] = 1
    candidates.push(cell)
  }

  // A city's footprint may spread onto gently rolling ground, but never onto
  // steep terrain or water, so it fills the land around its flat core.
  for (let cell = 0; cell < count; cell++) {
    if (heights[cell]! <= seaLevel + COAST_MARGIN) continue
    if (slope[cell]! > MAX_CITY_SLOPE || grade[cell]! > MAX_CITY_SLOPE) continue
    if (water.has(cell)) continue
    cityGround[cell] = 1
  }

  // Fraction of buildable land in a window the size of a city, blurred once so
  // scoring a candidate is a lookup rather than a scan over its footprint,
  // less the relief over the city's whole reach.
  const levelWindow = Math.max(1, Math.round((CITY_RADIUS.max * 0.7) / cellSize))
  const regionWindow = Math.max(1, Math.round((CITY_RADIUS.max + SUBURB_WIDTH.max) / cellSize))
  const region = boxBlur(slope, width, depth, regionWindow)
  const level = boxBlur(Float32Array.from(buildable), width, depth, levelWindow)
  for (let cell = 0; cell < count; cell++) {
    level[cell] = level[cell]! - REGION_RELIEF_WEIGHT * region[cell]!
  }

  // Best sites first: the most level, least relief, with row-major order as a
  // stable tie-break.
  candidates.sort((a, b) => level[b]! - level[a]! || grade[a]! - grade[b]! || a - b)

  const rng: Rng = createRng(seed ^ DISTRICT_SALT)
  const centers: Point[] = []
  const districts: District[] = []

  const placeCity = (cell: number): void => {
    const col = cell % width
    const row = (cell / width) | 0
    centers.push({ x: (col + 0.5) * cellSize, z: (row + 0.5) * cellSize })
    districts.push({
      id: districts.length,
      cx: (col + 0.5) * cellSize,
      cz: (row + 0.5) * cellSize,
      radius: randomRange(rng, CITY_RADIUS.min, CITY_RADIUS.max),
      suburbWidth: randomRange(rng, SUBURB_WIDTH.min, SUBURB_WIDTH.max),
      area: 0,
    })
  }

  const tooClose = (cell: number, spacingSq: number): boolean => {
    const center = cellCenter(cell, width, cellSize)
    for (const placed of centers) {
      const dx = center.x - placed.x
      const dz = center.z - placed.z
      if (dx * dx + dz * dz < spacingSq) return true
    }
    return false
  }

  // Prefer a roughly equilateral triangle of roomy sites, so the cities do not
  // line up and the loop between them has room to bend.
  const sites = representativeSites(candidates, width, cellSize)
  const triangle = bestTriangle(sites, level, width, cellSize)
  if (triangle) for (const cell of triangle) placeCity(cell)

  // Roomiest, flattest sites first.
  for (const cell of candidates) {
    if (districts.length >= CITY_COUNT) break
    if (tooClose(cell, MIN_CITY_SPACING ** 2)) continue
    if (level[cell]! < MIN_LEVEL_FRACTION) continue
    placeCity(cell)
  }

  // Backfill from the gentlest remaining land, then from the dry land farthest
  // from the cities so far, so a small or rough island still gets its full
  // complement of cities without stacking them on top of one another.
  const fillSpacingSq = (MIN_CITY_SPACING * FILL_SPACING_FRACTION) ** 2
  for (const cell of candidates) {
    if (districts.length >= CITY_COUNT) break
    if (tooClose(cell, fillSpacingSq)) continue
    placeCity(cell)
  }
  while (districts.length < CITY_COUNT) {
    let best = -1
    let bestDistance = -1
    for (let cell = 0; cell < count; cell++) {
      if (heights[cell]! <= seaLevel || water.has(cell)) continue
      const point = cellCenter(cell, width, cellSize)
      let nearest = Infinity
      for (const center of centers) {
        const dx = point.x - center.x
        const dz = point.z - center.z
        nearest = Math.min(nearest, dx * dx + dz * dz)
      }
      if (nearest > bestDistance) {
        bestDistance = nearest
        best = cell
      }
    }
    if (best < 0) break
    placeCity(best)
  }

  const districtOf = new Uint8Array(count)
  const owner = new Int16Array(count).fill(-1)
  for (let cell = 0; cell < count; cell++) {
    if (!cityGround[cell]) continue

    const x = ((cell % width) + 0.5) * cellSize
    const z = (((cell / width) | 0) + 0.5) * cellSize
    let district: District | null = null
    let nearestSq = Infinity
    for (const candidate of districts) {
      const dx = x - candidate.cx
      const dz = z - candidate.cz
      const distanceSq = dx * dx + dz * dz
      if (distanceSq < nearestSq) {
        nearestSq = distanceSq
        district = candidate
      }
    }
    if (district === null) continue

    const distance = Math.sqrt(nearestSq)
    if (distance <= district.radius) {
      districtOf[cell] = DISTRICT_CITY
      owner[cell] = district.id
      district.area++
    } else if (distance <= district.radius + district.suburbWidth) {
      districtOf[cell] = DISTRICT_SUBURB
      owner[cell] = district.id
      district.area++
    }
  }

  // Keep only the largest contiguous piece of each city, so a city reads as one
  // blob rather than a core with scattered specks around it.
  for (const district of districts) {
    const cells: number[] = []
    for (let cell = 0; cell < count; cell++) {
      if (districtOf[cell] === DISTRICT_CITY && owner[cell] === district.id) cells.push(cell)
    }
    if (cells.length === 0) continue

    const inCity = new Set(cells)
    const visited = new Set<number>()
    let largest: number[] = []
    for (const start of cells) {
      if (visited.has(start)) continue
      const component: number[] = []
      const stack = [start]
      visited.add(start)
      for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
        component.push(cell)
        const col = cell % width
        const row = (cell / width) | 0
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nc = col + dc
          const nr = row + dr
          if (nc < 0 || nc >= width || nr < 0 || nr >= depth) continue
          const next = nr * width + nc
          if (inCity.has(next) && !visited.has(next)) {
            visited.add(next)
            stack.push(next)
          }
        }
      }
      if (component.length > largest.length) largest = component
    }

    if (largest.length === cells.length) continue
    const keep = new Set(largest)
    for (const cell of cells) {
      if (keep.has(cell)) continue
      districtOf[cell] = DISTRICT_COUNTRY
      district.area--
    }
  }

  return { districts, districtOf }
}
