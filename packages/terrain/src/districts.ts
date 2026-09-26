import { createRng, randomRange, type Rng } from '@buggies/physics'

import type { District, Heightfield } from './types.ts'

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
/** Which land mass a cell is land of: none, or its number, from 1 for the largest. */
export const ISLAND_NONE = 0
export const ISLAND_MAIN = 1
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
/** The fewest cities a map has, however little room it has for them: enough for the highway loop. */
const CITY_LEAST = 3
/** Cities keep at least this much space between their centers. */
const MIN_CITY_SPACING = 300
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
 * Split the land into cities, suburbs and country. Up to `cityCount` cities
 * are spread over the land masses by how much level ground each has, as many
 * as have room, and a rough or cramped map still gets three on whatever dry
 * land is available. Placement is deterministic.
 */
export function generateDistricts(
  field: Heightfield,
  seed: number,
  seaLevel: number,
  water: Set<number>,
  islandOf: Uint8Array = new Uint8Array(field.width * field.depth).fill(ISLAND_MAIN),
  cityCount = 3,
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
  const districts: District[] = []

  const centers: Point[] = []
  const citiesOn = new Map<number, number>()

  const placeCity = (cell: number): void => {
    const center = cellCenter(cell, width, cellSize)
    const island = islandOf[cell]!
    centers.push(center)
    citiesOn.set(island, (citiesOn.get(island) ?? 0) + 1)
    districts.push({
      id: districts.length,
      cx: center.x,
      cz: center.z,
      radius: randomRange(rng, CITY_RADIUS.min, CITY_RADIUS.max),
      suburbWidth: randomRange(rng, SUBURB_WIDTH.min, SUBURB_WIDTH.max),
      area: 0,
      island,
    })
  }

  const tooClose = (cell: number, spacingSq: number): boolean => {
    const center = cellCenter(cell, width, cellSize)
    for (const other of centers) {
      const dx = center.x - other.x
      const dz = center.z - other.z
      if (dx * dx + dz * dz < spacingSq) return true
    }
    return false
  }

  // The level sites of each land mass, roomiest first, and how many there are.
  const sitesOn = new Map<number, number[]>()
  for (const cell of candidates) {
    if (level[cell]! < MIN_LEVEL_FRACTION || islandOf[cell] === ISLAND_NONE) continue
    const sites = sitesOn.get(islandOf[cell]!)
    if (sites) sites.push(cell)
    else sitesOn.set(islandOf[cell]!, [cell])
  }
  const islands = [...sitesOn.keys()].sort((a, b) => a - b)

  // Each city goes to the land mass with the most level ground left for each
  // of its cities, on its roomiest site well clear of the cities so far.
  while (districts.length < cityCount) {
    let best = -1
    let bestShare = -Infinity
    for (const island of islands) {
      const sites = sitesOn.get(island)!
      const share = sites.length / ((citiesOn.get(island) ?? 0) + 1)
      if (share <= bestShare) continue
      const site = sites.find((cell) => !tooClose(cell, MIN_CITY_SPACING ** 2))
      if (site === undefined) continue
      best = site
      bestShare = share
    }
    if (best < 0) break
    placeCity(best)
  }

  // Then from the gentlest remaining land, as far apart. A map without room
  // for more has fewer, but never fewer than `CITY_LEAST`: those are
  // backfilled closer together, then from the dry land farthest from the
  // cities so far, so a small or rough map still gets them without stacking
  // them on top of one another.
  for (const cell of candidates) {
    if (districts.length >= cityCount) break
    if (islandOf[cell] === ISLAND_NONE || tooClose(cell, MIN_CITY_SPACING ** 2)) continue
    placeCity(cell)
  }
  const least = Math.min(cityCount, CITY_LEAST)
  const fillSpacingSq = (MIN_CITY_SPACING * FILL_SPACING_FRACTION) ** 2
  for (const cell of candidates) {
    if (districts.length >= least) break
    if (islandOf[cell] === ISLAND_NONE || tooClose(cell, fillSpacingSq)) continue
    placeCity(cell)
  }
  while (districts.length < least) {
    let best = -1
    let bestDistance = -1
    for (let cell = 0; cell < count; cell++) {
      if (islandOf[cell] === ISLAND_NONE || heights[cell]! <= seaLevel || water.has(cell)) continue
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
      if (candidate.island !== islandOf[cell]) continue
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
