/**
 * A planet's cities, placed on its own ground: every grid point judged by
 * how level it and its neighborhood are, cities put on the roomiest level
 * ground of each land mass, well apart along the ground, and every grid
 * point marked city, suburb or country by how far along the ground it is
 * from the nearest city on its own land.
 */

import { createRng, randomRange, type Vec3 } from '@buggies/physics'

import { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB, ISLAND_NONE } from './districts.ts'
import { arcDistance, createSphereGround, groundIndex, type SphereGround } from './sphere.ts'
import { groundDirections, groundNeighbors } from './sphere-water.ts'
import type { WorldDistrict } from './world.ts'

/** A neighborhood's grade is its slope averaged over this far round it, in meters. */
const RELIEF_REACH = 36
/** Ground is level when both its own and its neighborhood's grade are below this. */
const MAX_GRADE = 0.12
/**
 * A city may spread onto ground this steep, so it fills gently rolling land.
 * No steeper: its streets are the ground, held to a grade, and a grid of them
 * on a hillside cannot both keep that grade and meet at shared heights.
 */
const MAX_CITY_SLOPE = 0.1
/** Land must clear the sea by this much before it can be built on, in meters. */
const COAST_MARGIN = 4.5
/** How far a city's core reaches, and its suburbs past that, in meters. */
const CITY_RADIUS = { min: 171, max: 246 } as const
const SUBURB_WIDTH = { min: 135, max: 210 } as const
/** A site needs this much level ground around it to become a city. */
const MIN_LEVEL_FRACTION = 0.4
/**
 * Relief is judged over a city's whole reach as well, and a site scores
 * lower the more the land around it rises and falls: level ground at the
 * foot of a mountain is not away from significant elevation changes.
 */
const REGION_RELIEF_WEIGHT = 4
/** The fewest cities a planet has, however little room it has for them: enough for the highway loop. */
const CITY_LEAST = 3
/** Cities keep at least this far apart along the ground, between their middles, in meters. */
const MIN_CITY_SPACING = 900
/** Fraction of the full spacing allowed when backfilling the remaining cities. */
const FILL_SPACING_FRACTION = 0.6
const DISTRICT_SALT = 0x5d15
/** How many grid cells a side the coarse grid neighborhoods are averaged on has, for each face. */
const COARSE_CELLS = 40

/** What the cities are, and which district every grid point of the ground is in. */
export interface SphereDistricts {
  readonly districts: WorldDistrict[]
  readonly districtOf: Uint8Array
}

/** Which land mass every grid point is on: none, or its number, from 1 for the largest. */
export function labelSphereLand(ground: SphereGround, neighbors: Int32Array, seaLevel: number): Uint8Array {
  const { heights } = ground
  const count = heights.length
  const component = new Int32Array(count).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let start = 0; start < count; start++) {
    if (component[start] !== -1 || heights[start]! <= seaLevel) continue
    const id = sizes.length
    let size = 0
    component[start] = id
    stack.push(start)
    for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
      size++
      for (let k = 0; k < 8; k++) {
        const next = neighbors[at * 8 + k]!
        if (next < 0 || component[next] !== -1 || heights[next]! <= seaLevel) continue
        component[next] = id
        stack.push(next)
      }
    }
    sizes.push(size)
  }
  const ranked = sizes.map((_, id) => id).sort((a, b) => sizes[b]! - sizes[a]! || a - b)
  const number = new Uint8Array(sizes.length)
  for (const [rank, id] of ranked.entries()) number[id] = rank + 1 <= 255 ? rank + 1 : ISLAND_NONE
  const islandOf = new Uint8Array(count)
  for (let at = 0; at < count; at++) {
    const id = component[at]!
    if (id >= 0) islandOf[at] = number[id]!
  }
  return islandOf
}

/** The steepest rise from a grid point to any of its neighbors, rise over run. */
function pointSlopes(ground: SphereGround, neighbors: Int32Array, directions: Float64Array): Float32Array {
  const { heights, radius } = ground
  const slope = new Float32Array(heights.length)
  for (let at = 0; at < heights.length; at++) {
    let steepest = 0
    for (let k = 0; k < 8; k++) {
      const next = neighbors[at * 8 + k]!
      if (next < 0) continue
      const dx = directions[at * 3]! - directions[next * 3]!
      const dy = directions[at * 3 + 1]! - directions[next * 3 + 1]!
      const dz = directions[at * 3 + 2]! - directions[next * 3 + 2]!
      const run = Math.sqrt(dx * dx + dy * dy + dz * dz) * radius
      if (run > 0) steepest = Math.max(steepest, Math.abs(heights[at]! - heights[next]!) / run)
    }
    slope[at] = steepest
  }
  return slope
}

/**
 * Averages of a value over the ground round each grid point, this far each
 * way, worked out on a coarse copy of the grid: a neighbor average repeated
 * until it has spread about as far as asked, then read back at each point.
 */
function neighborhood(ground: SphereGround, values: Float32Array, reach: number): Float32Array {
  const coarse = createSphereGround(COARSE_CELLS, ground.radius)
  const neighbors = groundNeighbors(coarse)
  const count = coarse.heights.length
  const coarseOf = (face: number, i: number, j: number): number =>
    groundIndex(coarse, face, Math.round((i / ground.n) * COARSE_CELLS), Math.round((j / ground.n) * COARSE_CELLS))
  let sums = new Float32Array(count)
  const weights = new Float32Array(count)
  const side = ground.n + 1
  for (let at = 0; at < values.length; at++) {
    const face = Math.floor(at / (side * side))
    const within = at - face * side * side
    const to = coarseOf(face, within % side, Math.floor(within / side))
    sums[to] = sums[to]! + values[at]!
    weights[to] = weights[to]! + 1
  }
  for (let at = 0; at < count; at++) sums[at] = weights[at]! > 0 ? sums[at]! / weights[at]! : 0
  // Each pass spreads a value over its eight neighbors and itself; its spread grows as the square root of the passes.
  const spacing = (Math.PI / 2) * ground.radius / COARSE_CELLS
  const passes = Math.ceil((reach * reach) / (2 * spacing * spacing))
  let next = new Float32Array(count)
  for (let pass = 0; pass < passes; pass++) {
    for (let at = 0; at < count; at++) {
      let total = sums[at]!
      let taken = 1
      for (let k = 0; k < 8; k++) {
        const other = neighbors[at * 8 + k]!
        if (other < 0) continue
        total += sums[other]!
        taken++
      }
      next[at] = total / taken
    }
    ;[sums, next] = [next, sums]
  }
  const out = new Float32Array(values.length)
  for (let at = 0; at < values.length; at++) {
    const face = Math.floor(at / (side * side))
    const within = at - face * side * side
    out[at] = sums[coarseOf(face, within % side, Math.floor(within / side))]!
  }
  return out
}

/**
 * Split the land into cities, suburbs and country. Up to `cityCount` cities
 * are spread over the land masses by how much level ground each has, as many
 * as have room, and a rough or cramped planet still gets three on whatever
 * dry land is available. Placement is deterministic.
 */
export function generateSphereDistricts(
  ground: SphereGround,
  seed: number,
  seaLevel: number,
  water: Uint8Array,
  cityCount = 3,
): SphereDistricts {
  const { heights, radius } = ground
  const count = heights.length
  const neighbors = groundNeighbors(ground)
  const directions = groundDirections(ground)
  const islandOf = labelSphereLand(ground, neighbors, seaLevel)
  const slope = pointSlopes(ground, neighbors, directions)
  const grade = neighborhood(ground, slope, RELIEF_REACH)

  const buildable = new Float32Array(count)
  const cityGround = new Uint8Array(count)
  const candidates: number[] = []
  for (let at = 0; at < count; at++) {
    if (heights[at]! <= seaLevel + COAST_MARGIN || water[at]) continue
    if (slope[at]! <= MAX_CITY_SLOPE && grade[at]! <= MAX_CITY_SLOPE) cityGround[at] = 1
    // Gentle both locally and over the neighborhood, so a city never straddles a sharp step.
    if (slope[at]! > MAX_GRADE || grade[at]! > MAX_GRADE) continue
    buildable[at] = 1
    candidates.push(at)
  }

  // How much of the ground round a site is level, less the relief over the city's whole reach.
  const region = neighborhood(ground, slope, CITY_RADIUS.max + SUBURB_WIDTH.max)
  const level = neighborhood(ground, buildable, CITY_RADIUS.max * 0.7)
  for (let at = 0; at < count; at++) level[at] = level[at]! - REGION_RELIEF_WEIGHT * region[at]!

  // Best sites first: the most level, least relief, with the grid's order as a stable tie-break.
  candidates.sort((a, b) => level[b]! - level[a]! || grade[a]! - grade[b]! || a - b)

  const rng = createRng(seed ^ DISTRICT_SALT)
  const districts: WorldDistrict[] = []
  const citiesOn = new Map<number, number>()
  const directionOf = (at: number): Vec3 => ({ x: directions[at * 3]!, y: directions[at * 3 + 1]!, z: directions[at * 3 + 2]! })

  const placeCity = (at: number): void => {
    const island = islandOf[at]!
    citiesOn.set(island, (citiesOn.get(island) ?? 0) + 1)
    districts.push({
      id: districts.length,
      center: directionOf(at),
      radius: randomRange(rng, CITY_RADIUS.min, CITY_RADIUS.max),
      suburbWidth: randomRange(rng, SUBURB_WIDTH.min, SUBURB_WIDTH.max),
      area: 0,
      island,
    })
  }
  const tooClose = (at: number, spacing: number): boolean =>
    districts.some((district) => arcDistance(directionOf(at), district.center, radius) < spacing)

  // The level sites of each land mass, roomiest first.
  const sitesOn = new Map<number, number[]>()
  for (const at of candidates) {
    if (level[at]! < MIN_LEVEL_FRACTION || islandOf[at] === ISLAND_NONE) continue
    const sites = sitesOn.get(islandOf[at]!)
    if (sites) sites.push(at)
    else sitesOn.set(islandOf[at]!, [at])
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
      const site = sites.find((at) => !tooClose(at, MIN_CITY_SPACING))
      if (site === undefined) continue
      best = site
      bestShare = share
    }
    if (best < 0) break
    placeCity(best)
  }

  // Then from the gentlest remaining land, as far apart. A planet without room
  // for more has fewer, but never fewer than `CITY_LEAST`: those are
  // backfilled closer together, then from the dry land farthest from the
  // cities so far.
  for (const at of candidates) {
    if (districts.length >= cityCount) break
    if (islandOf[at] === ISLAND_NONE || tooClose(at, MIN_CITY_SPACING)) continue
    placeCity(at)
  }
  const least = Math.min(cityCount, CITY_LEAST)
  for (const at of candidates) {
    if (districts.length >= least) break
    if (islandOf[at] === ISLAND_NONE || tooClose(at, MIN_CITY_SPACING * FILL_SPACING_FRACTION)) continue
    placeCity(at)
  }
  while (districts.length < least) {
    let best = -1
    let bestDistance = -1
    for (let at = 0; at < count; at++) {
      if (islandOf[at] === ISLAND_NONE || water[at]) continue
      let nearest = Infinity
      for (const district of districts) nearest = Math.min(nearest, arcDistance(directionOf(at), district.center, radius))
      if (nearest > bestDistance) {
        bestDistance = nearest
        best = at
      }
    }
    if (best < 0) break
    placeCity(best)
  }

  // Every grid point of the ground a city may spread onto, marked by how far along the ground it is from the nearest city on its land.
  const districtOf = new Uint8Array(count)
  const owner = new Int16Array(count).fill(-1)
  const areas = districts.map(() => 0)
  // Nearest by the way out lying closest to the city's, and within reach by the cosine of how far round that is.
  const reachOf = districts.map((city) => ({ core: Math.cos(city.radius / radius), suburbs: Math.cos((city.radius + city.suburbWidth) / radius) }))
  for (let at = 0; at < count; at++) {
    if (!cityGround[at]) continue
    let nearest = -Infinity
    let city: WorldDistrict | null = null
    for (const candidate of districts) {
      if (candidate.island !== islandOf[at]) continue
      const { center } = candidate
      const toward = directions[at * 3]! * center.x + directions[at * 3 + 1]! * center.y + directions[at * 3 + 2]! * center.z
      if (toward > nearest) {
        nearest = toward
        city = candidate
      }
    }
    if (city === null || nearest < reachOf[city.id]!.suburbs) continue
    districtOf[at] = nearest >= reachOf[city.id]!.core ? DISTRICT_CITY : DISTRICT_SUBURB
    owner[at] = city.id
    areas[city.id]! += 1
  }

  // Keep only the largest contiguous piece of each city's core, so a city reads as one blob rather than a core with specks round it.
  for (const city of districts) {
    const points: number[] = []
    for (let at = 0; at < count; at++) if (districtOf[at] === DISTRICT_CITY && owner[at] === city.id) points.push(at)
    if (points.length === 0) continue
    const inCity = new Set(points)
    const visited = new Set<number>()
    let largest: number[] = []
    for (const start of points) {
      if (visited.has(start)) continue
      const piece: number[] = []
      const stack = [start]
      visited.add(start)
      for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
        piece.push(at)
        for (let k = 0; k < 8; k++) {
          const next = neighbors[at * 8 + k]!
          if (next < 0 || !inCity.has(next) || visited.has(next)) continue
          visited.add(next)
          stack.push(next)
        }
      }
      if (piece.length > largest.length) largest = piece
    }
    const keep = new Set(largest)
    for (const at of points) {
      if (keep.has(at)) continue
      districtOf[at] = DISTRICT_COUNTRY
      areas[city.id]! -= 1
    }
  }
  return { districts: districts.map((district) => ({ ...district, area: areas[district.id]! })), districtOf }
}
