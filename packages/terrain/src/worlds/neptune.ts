/**
 * Neptune: all sea, with nothing above the water at all. On the sea floor
 * stand glass stations, round halls under a dome, and between them run
 * tunnels three times a planet's, wide and low, oval across, each with a
 * road along its floor. The sea is kept out of all of it: inside, it is dry.
 */

import { createRng, randomInt, randomRange, type Vec3 } from '@buggies/physics'

import { MAX_ARTERIAL_GRADE, ROAD_WIDTH as HIGHWAY_WIDTH } from '../roads/constants.ts'
import { DISTRICT_CITY } from '../sphere-districts.ts'
import { sphereHeight } from '../sphere.ts'
import { randomDirection } from '../world-queries.ts'
import { DRY, type World, type WorldPortal } from '../world.ts'
import { resample } from '../globe/lines.ts'
import { TUNNEL_CLEARANCE } from '../globe/tunnels.ts'
import { bareWorld } from './bare.ts'
import { groundOfSize, landOf, meanHeight, rollGround } from './ground.ts'
import { hollowOut, roofNear, type Hollow } from './hollows.ts'
import { worldId } from './kinds.ts'
import { districtOfPlace, linkPlaces, markDistricts, scatterPlaces, toward } from './places.ts'
import { Stands, buildSettlement, plantTrees, portalIn, type SettlementStyle, type Span, type TreeStyle } from './stands.ts'
import { roadAlong } from './roads.ts'

const NEPTUNE_SALT = 0x4e97
const SEA_LEVEL = 0
/** The sea floor: how deep, and how much it rolls. */
const FLOOR = { depth: 46, roll: 9, frequency: 0.004 } as const
/** The stations: how many, how far each reaches, how high its dome and how deep its floor, and how far apart two stand past their reaches. */
const STATIONS = { min: 6, max: 8 } as const
const STATION_REACH = { min: 42, max: 58 } as const
const STATION = { above: 20, below: 4, squareness: 3 } as const
const STATIONS_APART = 160
/** How many links past the fewest that join every station. */
const EXTRA_TUNNELS = 2
/**
 * A tunnel: three times as wide as a planet's highway tunnel, and short
 * and wide across, its roof this high over its middle and its floor this
 * deep under it, at its middle line.
 */
const TUNNEL = { reach: 3 * (HIGHWAY_WIDTH / 2 + TUNNEL_CLEARANCE), above: 7, below: 3, squareness: 2.4 } as const
/** How far over the sea floor a station's middle stands, so its floor lies on the floor. */
const STATION_RISE = 4
/** The roads along the tunnels, how wide, and how far off a station's middle they start. */
const ROAD_WIDTH = 12
const SQUARE = 12

/** Kelp, tall and slender, and coral heads, out on the sea floor. */
const KELP: TreeStyle = { kind: 'kelp', count: 1400, height: [8, 24], crown: [1, 2], spacing: 0.6 }
const CORAL: { count: number; size: Span } = { count: 900, size: [1.5, 4.5] }

const PODS: SettlementStyle = {
  kinds: [
    { kind: 'block', odds: 2, width: [7, 11], depth: [7, 11], height: [5, 10] },
    { kind: 'shop', odds: 1, width: [8, 12], depth: [6, 9], height: [4, 5] },
  ],
  count: 6,
  gap: 3,
  roadMargin: 3,
  relief: 2.5,
}

/** Make a planet's Neptune, from the planet's seed. */
export function generateNeptune(seed: number): World {
  const rng = createRng((seed ^ NEPTUNE_SALT) >>> 0)
  const ground = groundOfSize(1)
  const { radius } = ground
  const land = landOf(ground, SEA_LEVEL)
  rollGround(land, (seed ^ NEPTUNE_SALT) >>> 0, FLOOR.roll, FLOOR.frequency, -FLOOR.depth)

  const stations = scatterPlaces(
    rng,
    radius,
    randomInt(rng, STATIONS.min, STATIONS.max),
    (a, b) => a + b + STATIONS_APART,
    () => randomRange(rng, STATION_REACH.min, STATION_REACH.max),
  )
  const middles = stations.map((station) => meanHeight(land, station.center, station.reach) + STATION_RISE)
  const halls: Hollow[] = stations.map((station, k) => ({ kind: 'bore', line: [station.center], middle: [middles[k]!], reach: station.reach, ...STATION }))
  const links = linkPlaces(
    stations.map((station) => station.center),
    EXTRA_TUNNELS,
  )
  const tunnels: Hollow[] = links.map(([a, b]) => {
    const line = resample([stations[a]!.center, stations[b]!.center], 12, radius, false)
    const middle = line.map((_, i) => middles[a]! + ((middles[b]! - middles[a]!) * i) / Math.max(line.length - 1, 1) - STATION.below + TUNNEL.below)
    return { kind: 'bore', line, middle, reach: TUNNEL.reach, above: TUNNEL.above, below: TUNNEL.below, squareness: TUNNEL.squareness }
  })
  const roof = hollowOut(land, [...halls, ...tunnels], false)

  // The sea over everything but what is closed in under a roof.
  const water = new Float32Array(ground.heights.length)
  for (let at = 0; at < water.length; at++) water[at] = Number.isNaN(roof[at]!) ? SEA_LEVEL : DRY
  const districtOf = markDistricts(land, stations, DISTRICT_CITY)

  // A road along each tunnel's floor, from the square of one station to the other's.
  const roads = links.map(([a, b], id) => {
    const from = stations[a]!.center
    const to = stations[b]!.center
    const line = resample([toward(from, to, SQUARE, radius), toward(to, from, SQUARE, radius)], 6, radius, false)
    return roadAlong(id, 'arterial', line, ROAD_WIDTH, land, MAX_ARTERIAL_GRADE, Float32Array.from(line, (p) => sphereHeight(ground, p)))
  })

  const stands = new Stands({ ...land, water }, roads)
  const portals: WorldPortal[] = stations.map((station) => portalIn(stands, rng, station.center, station.reach * 0.3))
  const roofOver = (p: Vec3): number => roofNear(ground, roof, p)
  for (const station of stations) buildSettlement(stands, rng, { center: station.center, reach: station.reach * 0.75 }, PODS, (p) => roofOver(p) - 3)
  // Out on the sea floor, open to the water, kelp swaying up and coral heads.
  const openSea = (): Vec3 | null => {
    const p = randomDirection(rng)
    return Number.isNaN(roofOver(p)) ? p : null
  }
  plantTrees(stands, rng, openSea, KELP)
  for (let k = 0; k < CORAL.count; k++) {
    const p = openSea()
    if (p !== null) stands.rock(p, 'coral', randomRange(rng, ...CORAL.size), rng)
  }

  return bareWorld({
    seed: worldId(seed, 'neptune'),
    kind: 'neptune',
    radius,
    seaLevel: SEA_LEVEL,
    ground,
    roof,
    water,
    districtOf,
    districts: stations.map((station, id) => districtOfPlace(id, station)),
    roads,
    buildings: stands.buildings,
    trees: stands.trees,
    rocks: stands.rocks,
    portals,
  })
}
