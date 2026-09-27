/**
 * A whole planet from a seed: islands scattered over it with mountains on
 * the bigger ones, its ground raised, its rivers run down to the sea and
 * its lakes filled, its cities placed, its roads built and settled into the
 * ground, everything that stands on its land placed, and the solids built
 * from all of that. Deterministic: the same seed always makes the same
 * planet, bit for bit.
 */

import * as exact from '@buggies/physics'
import { createRng, randomInt, randomRange, type Rng } from '@buggies/physics'

import { orientedTriangle } from '../mountain.ts'
import { generateSphereDistricts } from '../sphere-districts.ts'
import { raiseSphereGround, tangentFrame, type SphereIsland, type SphereMountain } from '../sphere-heights.ts'
import { createSphereGround } from '../sphere.ts'
import { findSphereLakes, groundDirections, groundNeighbors, routeSphereFlow, traceSphereRivers } from '../sphere-water.ts'
import { randomDirection } from '../world-queries.ts'
import type { World } from '../world.ts'
import { buildGlobeStands } from './buildings.ts'
import { globeDecks } from './decks.ts'
import { along } from './lines.ts'
import { interchangeRings, type Land } from './placing.ts'
import { globeRailMesh, globeRailRuns } from './rails.ts'
import { buildGlobeRoads } from './roads.ts'
import { curbSolids, kickerSolids, parkPaths } from './solids.ts'
import { boreGround, tunnelShells } from './tunnels.ts'
import { settleWater } from './water.ts'

const { cos, sin } = exact

/** How far round a planet is from its middle, in meters. */
export const PLANET_RADIUS = (1281 * 3) / (2 * Math.PI)
/** How many cells a side each face of a planet's cube-sphere has: some 3 m a cell. */
export const SPHERE_CELLS = 320
const SEA_LEVEL = 0
const OCEAN_DEPTH = 30
/** How many islands a planet has, and how big they are across the ground from their middles. */
const ISLAND_COUNT = { min: 8, max: 15 } as const
const ISLAND_RADIUS = { least: 28.5, most: 660 } as const
/** The first island is at least this share of the largest, so every planet has room for its cities. */
const FIRST_ISLAND_LEAST = 0.75
/** How many mountains a planet has, how big and how tall, and how far out from an island's middle they stand, as a share of its radius. */
const MOUNTAIN_COUNT = { min: 1, max: 4 } as const
const MOUNTAIN_RADIUS = { min: 55.5, max: 88.8 } as const
const MOUNTAIN_SKIRT = { min: 24.4, max: 42.2 } as const
const MOUNTAIN_HEIGHT = { min: 47.4, max: 73 } as const
const MOUNTAIN_REACH = 0.5
/** An island this small carries no mountain. */
const MOUNTAIN_ISLAND_LEAST = 66.6
/** The odds a mountain has a river off it; every planet has at least one. */
const RIVER_CHANCE = 0.5
/** How many cities a planet has. */
const CITY_COUNT = { min: 3, max: 5 } as const
/** How wide a river's trace steps are, and the least a source is looked for about a mountain, in meters. */
const RIVER_CELL = 3
const RIVER_LEAST = 45

/** Islands scattered over the planet, each anywhere from a speck to the largest a planet holds; they may overlap into one. */
function layIslands(rng: Rng, count: number): SphereIsland[] {
  return Array.from({ length: count }, (_, i) => {
    const radius = randomRange(rng, i === 0 ? ISLAND_RADIUS.most * FIRST_ISLAND_LEAST : ISLAND_RADIUS.least, ISLAND_RADIUS.most)
    return { center: randomDirection(rng), radius }
  })
}

/**
 * Mountains on the islands, each on an island picked in proportion to its
 * area among those big enough to carry one, anywhere within
 * `MOUNTAIN_REACH` of its middle: a triangle laid on the plane touching the
 * planet at the mountain's middle, with a skirt and a height.
 */
function createMountains(rng: Rng, count: number, islands: readonly SphereIsland[], radius: number): SphereMountain[] {
  const hosts = islands.filter((island) => island.radius >= MOUNTAIN_ISLAND_LEAST)
  const pool = hosts.length > 0 ? hosts : islands.slice(0, 1)
  const total = pool.reduce((sum, island) => sum + island.radius * island.radius, 0)
  return Array.from({ length: count }, () => {
    let pick = rng() * total
    let island = pool[pool.length - 1]!
    for (const candidate of pool) {
      pick -= candidate.radius * candidate.radius
      if (pick < 0) {
        island = candidate
        break
      }
    }
    const bearing = randomRange(rng, 0, Math.PI * 2)
    const offset = island.radius * MOUNTAIN_REACH * Math.sqrt(rng())
    const { east, north } = tangentFrame(island.center)
    const way = { x: east.x * cos(bearing) + north.x * sin(bearing), y: east.y * cos(bearing) + north.y * sin(bearing), z: east.z * cos(bearing) + north.z * sin(bearing) }
    const center = along(island.center, way, offset, radius)
    const size = randomRange(rng, MOUNTAIN_RADIUS.min, MOUNTAIN_RADIUS.max)
    const rotation = randomRange(rng, 0, Math.PI * 2)
    const corner = (k: number): { x: number; z: number } => {
      const angle = rotation + (k * Math.PI * 2) / 3 + randomRange(rng, -0.35, 0.35)
      const r = size * randomRange(rng, 0.65, 1.05)
      return { x: cos(angle) * r, z: sin(angle) * r }
    }
    const a = corner(0)
    const b = corner(1)
    const c = corner(2)
    const frame = tangentFrame(center)
    return {
      center,
      east: frame.east,
      north: frame.north,
      triangle: orientedTriangle({ ax: a.x, az: a.z, bx: b.x, bz: b.z, cx: c.x, cz: c.z }),
      skirt: randomRange(rng, MOUNTAIN_SKIRT.min, MOUNTAIN_SKIRT.max),
      height: randomRange(rng, MOUNTAIN_HEIGHT.min, MOUNTAIN_HEIGHT.max),
    }
  })
}

/** Make a planet from a seed. */
export function generatePlanet(seed: number): World {
  const radius = PLANET_RADIUS
  const seaLevel = SEA_LEVEL
  const rng = createRng(seed)
  const islands = layIslands(rng, randomInt(rng, ISLAND_COUNT.min, ISLAND_COUNT.max))
  const mountains = createMountains(rng, randomInt(rng, MOUNTAIN_COUNT.min, MOUNTAIN_COUNT.max), islands, radius)
  // Up to one river a mountain, and always at least one.
  const springs = mountains.filter(() => rng() < RIVER_CHANCE)
  if (springs.length === 0 && mountains.length > 0) springs.push(mountains[0]!)
  const cityCount = randomInt(rng, CITY_COUNT.min, CITY_COUNT.max)

  const ground = createSphereGround(SPHERE_CELLS, radius)
  raiseSphereGround(ground, { seed, islands, mountains, oceanDepth: OCEAN_DEPTH, largest: ISLAND_RADIUS.most })
  const neighbors = groundNeighbors(ground)
  const directions = groundDirections(ground)
  const routing = routeSphereFlow(ground, neighbors, seaLevel)
  const courses = traceSphereRivers(ground, directions, routing, springs, springs.length, seaLevel, RIVER_CELL, RIVER_LEAST)
  const found = findSphereLakes(ground, neighbors, routing, seaLevel)
  const land: Land = { ground, neighbors, directions, water: new Float32Array(0), districtOf: new Uint8Array(0), seaLevel, radius }
  const { rivers, lakes, water, inland } = settleWater(land, courses, found)
  const { districts, districtOf } = generateSphereDistricts(ground, seed, seaLevel, inland, cityCount)
  const { roads, grids } = buildGlobeRoads(ground, water, seaLevel, districts, districtOf, seed)
  const stands = buildGlobeStands(ground, water, districtOf, seaLevel, districts, grids, roads, rivers, mountains, seed)
  const { bored, holes } = boreGround({ ...land, water, districtOf }, roads)
  return {
    seed,
    kind: 'planet',
    radius,
    seaLevel,
    ground,
    bored,
    holes,
    water,
    districtOf,
    mountains,
    rivers,
    lakes,
    districts,
    roads,
    ...stands,
    decks: globeDecks(ground, roads),
    paths: parkPaths(ground, interchangeRings(roads, radius)),
    shells: tunnelShells(roads, radius),
    rails: globeRailMesh(globeRailRuns(roads, radius), radius),
    curbs: curbSolids(ground, stands.sidewalks),
    kickers: kickerSolids(stands.ramps, radius),
  }
}

