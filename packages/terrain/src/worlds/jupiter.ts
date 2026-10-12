/**
 * Jupiter: a sky with nothing under it but cloud. Its cities stand on
 * great platforms floating in the air, linked by highways out over the
 * drop with no rail along them; and smaller platforms float about at their
 * own heights, joined to nothing, for whoever can get onto them. Whatever
 * goes over an edge falls into the cloud.
 */

import { createRng, randomInt, randomRange, type Vec3 } from '@buggies/physics'

import { ROAD_BRIDGE, ROAD_GRADE, ROAD_SURFACE, ROAD_WIDTH } from '../roads/constants.ts'
import { smoothstep } from '../noise.ts'
import { DISTRICT_CITY } from '../sphere-districts.ts'
import { DRY, type World, type WorldPlatform, type WorldPortal, type WorldRoad } from '../world.ts'
import { globeDecks } from '../globe/decks.ts'
import { angleBetween, lift, resample } from '../globe/lines.ts'
import { axisAt, eachPointNear } from '../globe/placing.ts'
import { platformEdge } from './platforms.ts'
import { bareWorld } from './bare.ts'
import { worldId } from './kinds.ts'
import { groundOfSize, landOf } from './ground.ts'
import { districtOfPlace, linkPlaces, markDistricts, pointIn, scatterPlaces, toward } from './places.ts'
import { Stands, buildSettlement, furnish, plantTrees, portalIn, type FurnitureStyle, type SettlementStyle, type TreeStyle } from './stands.ts'

const JUPITER_SALT = 0x1b17
/** The cloud everything falls into, and the floor far under it that nothing ever reaches. */
const CLOUD_DECK = -60
const DEPTHS = -160
/** The cities' platforms: how many, how far each reaches, how high they float, and how far apart two stand past their reaches. */
const CITIES = { min: 4, max: 5 } as const
const CITY_REACH = { min: 70, max: 100 } as const
const CITY_HEIGHT = { min: 10, max: 80 } as const
const CITIES_APART = 160
/** The loose platforms: how many, how big, and over what heights. */
const LOOSE = { min: 10, max: 14 } as const
const LOOSE_REACH = { min: 14, max: 34 } as const
const LOOSE_HEIGHT = { min: -30, max: 110 } as const
const LOOSE_APART = 40
/** How many highways past the fewest that join every city, how steep one may climb, and how far onto a platform it runs. */
const EXTRA_HIGHWAYS = 2
const HIGHWAY_GRADE = 0.09
const ONTO = 18

/** Beacons round a platform's edge: how far in from it, how far apart, how thick and how tall. */
const BEACON = { inset: 2, apart: 24, width: 0.6, height: 4.5 } as const
/** Wind turbines, as a planet's are; gas tanks, raised on their columns as a water tower is; and a flag, as on a moon. */
const TURBINES: FurnitureStyle = { kind: 'turbine', count: 3, width: [2.6, 2.6], depth: [2.6, 2.6], height: [38, 44], roadMargin: 6, gap: 20, relief: 2 }
const GAS: FurnitureStyle = { kind: 'watertower', count: 2, width: [2.4, 2.4], depth: [2.4, 2.4], height: [18, 24], roadMargin: 4, gap: 8 }
const FLAG: FurnitureStyle = { kind: 'flag', count: 1, width: [0.12, 0.12], depth: [0.12, 0.12], height: [4, 4] }
/** The trees in a city's parks; and the wild trees and shrubs on a loose platform, a few to every so many meters of its reach. */
const CITY_TREES: TreeStyle = { kind: 'tree', count: 25, height: [5, 9], crown: [1.6, 2.8] }
const LOOSE_TREES = { kind: 'tree', every: 6, height: [5, 10], crown: [1.6, 3] } as const
const LOOSE_SHRUBS = { kind: 'shrub', every: 4, height: [0.9, 2], crown: [0.7, 1.4] } as const

const CITY: SettlementStyle = {
  kinds: [
    { kind: 'block', odds: 4, width: [12, 20], depth: [12, 20], height: [14, 45] },
    { kind: 'block', odds: 2, width: [8, 12], depth: [8, 12], height: [30, 60] },
    { kind: 'shop', odds: 1, width: [9, 13], depth: [7, 10], height: [4, 6] },
  ],
  count: 30,
  gap: 6,
  roadMargin: 4,
  relief: 1,
}

/** Make a planet's Jupiter, from the planet's seed. */
export function generateJupiter(seed: number): World {
  const rng = createRng((seed ^ JUPITER_SALT) >>> 0)
  const ground = groundOfSize(1)
  const { radius } = ground
  ground.heights.fill(DEPTHS)
  const land = landOf(ground, CLOUD_DECK)

  const cities = scatterPlaces(
    rng,
    radius,
    randomInt(rng, CITIES.min, CITIES.max),
    (a, b) => a + b + CITIES_APART,
    () => randomRange(rng, CITY_REACH.min, CITY_REACH.max),
  )
  // Each city as high as the highways from the first allow: none so far from its neighbor's height that the way over climbs too steeply.
  const links = linkPlaces(
    cities.map((city) => city.center),
    EXTRA_HIGHWAYS,
  )
  const heights = cities.map(() => Number.NaN)
  if (cities.length > 0) heights[0] = randomRange(rng, CITY_HEIGHT.min, CITY_HEIGHT.max)
  for (let settled = true; settled; ) {
    settled = false
    for (const [a, b] of links) {
      const [known, unknown] = Number.isNaN(heights[a]!) ? [b, a] : [a, b]
      if (Number.isNaN(heights[known]!) || !Number.isNaN(heights[unknown]!)) continue
      const span = angleBetween(cities[a]!.center, cities[b]!.center) * radius - cities[a]!.reach - cities[b]!.reach
      const most = span * HIGHWAY_GRADE * 0.8
      heights[unknown] = Math.min(Math.max(heights[known]! + randomRange(rng, -most, most), CITY_HEIGHT.min), CITY_HEIGHT.max)
      settled = true
    }
  }
  const platforms: WorldPlatform[] = cities.map((city, k) => ({ center: city.center, radius: city.reach, height: heights[k]! }))
  const loose = scatterPlaces(
    rng,
    radius,
    randomInt(rng, LOOSE.min, LOOSE.max),
    (a, b) => a + b + LOOSE_APART,
    () => randomRange(rng, LOOSE_REACH.min, LOOSE_REACH.max),
    (place) => platforms.every((platform) => angleBetween(place.center, platform.center) * radius > platform.radius + place.reach + LOOSE_APART),
  )
  platforms.push(...loose.map((place) => ({ center: place.center, radius: place.reach, height: randomRange(rng, LOOSE_HEIGHT.min, LOOSE_HEIGHT.max) })))
  for (const platform of platforms) {
    eachPointNear(land, platform.center, platform.radius, (at) => (ground.heights[at] = platform.height))
  }

  // The highways, out over the drop from the edge of one city to the next, climbing evenly between them.
  const roads: WorldRoad[] = links.map(([a, b], id) => highwayBetween(id, platforms[a]!, platforms[b]!, radius))

  // The ground the cloud covers, and the cities on their platforms.
  const water = new Float32Array(ground.heights.length)
  for (let at = 0; at < water.length; at++) water[at] = ground.heights[at]! <= CLOUD_DECK ? CLOUD_DECK : DRY
  const districtOf = markDistricts(land, cities, DISTRICT_CITY)
  // None of the ground's grid is drawn: each platform is drawn by its own round top, and floats.
  const holes = new Uint8Array(ground.heights.length).fill(1)

  const stands = new Stands({ ...land, water }, roads)
  const portals: WorldPortal[] = cities.map((city) => portalIn(stands, rng, city.center, city.reach * 0.5))
  // Every platform's edge ringed with beacons, to be seen from across the drop.
  for (const platform of platforms) {
    const edge = platformEdge(platform, radius, BEACON.inset)
    const every = Math.max(1, Math.round((edge.length * BEACON.apart) / (2 * Math.PI * platform.radius)))
    for (let k = 0; k < edge.length; k += every) {
      const spot = { at: edge[k]!, u: axisAt(edge[k]!, 0), width: BEACON.width, depth: BEACON.width }
      const ground = stands.fits(spot, { roadMargin: 1, gap: 0.5, relief: 1 })
      if (ground !== null) stands.raise('beacon', spot, ground, BEACON.height, rng())
    }
  }
  // The cities' power, turning in the wind at their edges, and their gas, held in tanks.
  for (const city of cities) {
    furnish(stands, rng, () => pointIn(rng, city.center, city.reach * 0.88, radius, city.reach * 0.72), TURBINES)
    furnish(stands, rng, () => pointIn(rng, city.center, city.reach * 0.8, radius), GAS)
  }
  // A flag planted on each platform joined to nothing, by whoever got there first.
  for (const place of loose) furnish(stands, rng, () => pointIn(rng, place.center, place.reach * 0.4, radius), FLAG)
  for (const city of cities) {
    buildSettlement(stands, rng, { center: city.center, reach: city.reach * 0.85 }, CITY)
    plantTrees(stands, rng, () => pointIn(rng, city.center, city.reach * 0.9, radius), CITY_TREES)
  }
  for (const place of loose) {
    for (const { every, ...style } of [LOOSE_TREES, LOOSE_SHRUBS]) {
      plantTrees(stands, rng, () => pointIn(rng, place.center, place.reach * 0.8, radius), { ...style, count: Math.round(place.reach / every) })
    }
  }

  return bareWorld({
    seed: worldId(seed, 'jupiter'),
    kind: 'jupiter',
    radius,
    seaLevel: CLOUD_DECK,
    ground,
    water,
    holes,
    districtOf,
    platforms,
    districts: cities.map((city, id) => districtOfPlace(id, city)),
    roads,
    decks: globeDecks(ground, roads),
    buildings: stands.buildings,
    trees: stands.trees,
    portals,
  })
}

/**
 * A highway from one platform to another: from a little way in from the
 * edge of the first, at its top, out over the drop, and onto the second at
 * its top, climbing or falling evenly between the two edges; its deck at
 * grade on the platforms and a bridge between.
 */
function highwayBetween(id: number, from: WorldPlatform, to: WorldPlatform, radius: number): WorldRoad {
  const start = toward(from.center, to.center, from.radius - ONTO, radius)
  const end = toward(to.center, from.center, to.radius - ONTO, radius)
  const line = resample([start, end], 6, radius, false)
  const total = angleBetween(start, end) * radius
  // Off the edge of the first, and onto the edge of the second.
  const leaves = ONTO
  const arrives = Math.max(total - ONTO, leaves + 1)
  const levels = line.map((p) => from.height + (to.height - from.height) * smoothstep(leaves, arrives, angleBetween(start, p) * radius) + ROAD_SURFACE)
  const over = (p: Vec3, platform: WorldPlatform): boolean => angleBetween(p, platform.center) * radius < platform.radius - 1
  const structure = new Uint8Array(line.length - 1)
  for (let i = 0; i < structure.length; i++) {
    const onPlatform = [line[i]!, line[i + 1]!].every((p) => over(p, from) || over(p, to))
    structure[i] = onPlatform ? ROAD_GRADE : ROAD_BRIDGE
  }
  return {
    id,
    kind: 'highway',
    closed: false,
    points: line.map((p, i) => lift(p, radius, levels[i]!)),
    widths: new Float32Array(line.length).fill(ROAD_WIDTH),
    structure,
  }
}
