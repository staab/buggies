/**
 * Neptune: all sea, with nothing above the water at all. On the sea floor
 * stand glass stations, round halls under a dome, and between them run
 * tunnels three times a planet's, wide and oval across, each with a road
 * along its floor. The sea is kept out of all of it: inside, it is dry.
 * Out on the floor, kelp grows thick in beds and thin between them.
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
import { groundOfSize, landOf, levelGround, meanHeight, rollGround } from './ground.ts'
import { hollowOut, roofNear, type Hollow } from './hollows.ts'
import { worldId } from './kinds.ts'
import { districtOfPlace, linkPlaces, markDistricts, pointIn, ringAround, scatterPlaces, someOf, toward } from './places.ts'
import { Stands, buildSettlement, furnish, plantTrees, portalIn, type FurnitureStyle, type SettlementStyle, type Span, type TreeStyle } from './stands.ts'
import { roadAlong } from './roads.ts'

const NEPTUNE_SALT = 0x4e97
const SEA_LEVEL = 0
/** The sea floor: how deep, and how much it rolls; deep enough that the domes stand well under the surface. */
const FLOOR = { depth: 64, roll: 9, frequency: 0.004 } as const
/** The stations: how many, how far each reaches, how high its dome and how deep its floor, and how far apart two stand past their reaches. */
const STATIONS = { min: 5, max: 7 } as const
const STATION_REACH = { min: 90, max: 130 } as const
const STATION = { above: 34, below: 0, squareness: 3 } as const
const STATIONS_APART = 160
/** How many links past the fewest that join every station. */
const EXTRA_TUNNELS = 2
/** How many of the stations have a portal in them: a few, not every one. */
const PORTALS = { least: 2, most: 3 } as const
/**
 * A tunnel: three times as wide as a planet's highway tunnel, and lower
 * than it is wide, its roof this high over its middle and its floor this
 * deep under it, at its middle line.
 */
const TUNNEL = { reach: 3 * (HIGHWAY_WIDTH / 2 + TUNNEL_CLEARANCE), above: 12, below: 3, squareness: 2.4 } as const
/** How far round a station the sea floor is eased to its floor's level, so the dome stands flush on the floor all round. */
const STATION_BLEND = 40
/** The roads along the tunnels, how wide, and how far off a station's middle they start. */
const ROAD_WIDTH = 12
const SQUARE = 12

/** Kelp, tall and slender, out on the sea floor: in beds, how many, how far each reaches and how thick it grows; and strands between them. */
const KELP_BEDS = { count: 64, reach: [12, 30] as Span } as const
const BED_KELP: TreeStyle = { kind: 'kelp', count: 60, height: [14, 30], crown: [1.2, 2.2], spacing: 0.5 }
const KELP: TreeStyle = { kind: 'kelp', count: 1400, height: [8, 24], crown: [1, 2], spacing: 0.6 }
/** Coral heads, about the floor. */
const CORAL: { count: number; size: Span } = { count: 1400, size: [1.5, 4.5] }
/** How far kelp keeps from the glass, so none of its blades sways into a tunnel. */
const KELP_CLEAR = 8

/** What a station holds under its dome: towers, shops, tanks and domed halls; and trees and shrubs growing between them. */
const PODS: SettlementStyle = {
  kinds: [
    { kind: 'block', odds: 3, width: [10, 16], depth: [10, 16], height: [12, 28] },
    { kind: 'shop', odds: 2, width: [8, 12], depth: [6, 9], height: [4, 6] },
    { kind: 'silo', odds: 1, width: [6, 9], depth: [6, 9], height: [10, 18] },
    { kind: 'observatory', odds: 0.5, width: [16, 22], depth: [16, 22], height: [10, 14] },
  ],
  count: 28,
  gap: 4,
  roadMargin: 3,
  relief: 2.5,
}
const STATION_TREES: TreeStyle = { kind: 'tree', count: 30, height: [6, 11], crown: [1.8, 3] }
const STATION_SHRUBS: TreeStyle = { kind: 'shrub', count: 40, height: [0.9, 2], crown: [0.7, 1.6] }
/** How far out from a station's middle its trees grow: where the dome is still high over them. */
const GARDEN = 0.7

/** What lies about the sea floor: anemones, giant clams, starfish, urchins, anchors and amphorae. */
const SEA_FLOOR: readonly FurnitureStyle[] = [
  { kind: 'anemone', count: 400, width: [1.5, 3.5], depth: [1.5, 3.5], height: [1, 2.5], relief: 1.5, gap: 0.5 },
  { kind: 'clam', count: 60, width: [2.5, 4.5], depth: [2, 3.5], height: [1, 2], relief: 1, gap: 1 },
  { kind: 'starfish', count: 300, width: [0.6, 1.4], depth: [0.6, 1.4], height: [0.12, 0.16], relief: 0.6, gap: 0.3 },
  { kind: 'urchin', count: 300, width: [0.5, 1.1], depth: [0.5, 1.1], height: [0.4, 0.9], relief: 0.6, gap: 0.3 },
  { kind: 'anchor', count: 12, width: [2, 3.5], depth: [0.8, 1.2], height: [3, 4.5], relief: 1, gap: 2 },
  { kind: 'amphora', count: 40, width: [0.6, 0.9], depth: [0.6, 0.9], height: [1.2, 1.8], relief: 0.6, gap: 0.5 },
]

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
  // Each station's floor flat, at the sea floor's mean under it, and the sea floor eased to it round the dome.
  const middles = stations.map((station) => meanHeight(land, station.center, station.reach))
  stations.forEach((station, k) => levelGround(land, station.center, station.reach, STATION_BLEND, middles[k]!))
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
  const gated = someOf(rng, stations.length, randomInt(rng, PORTALS.least, PORTALS.most))
  const portals: WorldPortal[] = gated.map((k) => portalIn(stands, rng, stations[k]!.center, stations[k]!.reach * 0.3))
  const roofOver = (p: Vec3): number => roofNear(ground, roof, p)
  for (const station of stations) {
    buildSettlement(stands, rng, { center: station.center, reach: station.reach * 0.75 }, PODS, (p) => roofOver(p) - 3)
    for (const style of [STATION_TREES, STATION_SHRUBS]) plantTrees(stands, rng, () => pointIn(rng, station.center, station.reach * GARDEN, radius), style)
  }
  // Out on the sea floor, open to the water and clear of the glass, kelp swaying up and coral heads.
  const open = (p: Vec3): boolean => Number.isNaN(roofOver(p))
  const clearOfGlass = (p: Vec3): boolean => open(p) && ringAround(p, KELP_CLEAR, 6, radius).every(open)
  const openSea = (): Vec3 | null => {
    const p = randomDirection(rng)
    return open(p) ? p : null
  }
  for (let bed = 0; bed < KELP_BEDS.count; bed++) {
    const center = openSea()
    if (center === null) continue
    const reach = randomRange(rng, ...KELP_BEDS.reach)
    plantTrees(stands, rng, () => {
      const p = pointIn(rng, center, reach, radius)
      return clearOfGlass(p) ? p : null
    }, BED_KELP)
  }
  plantTrees(stands, rng, () => {
    const p = randomDirection(rng)
    return clearOfGlass(p) ? p : null
  }, KELP)
  for (let k = 0; k < CORAL.count; k++) {
    const p = openSea()
    if (p !== null) stands.rock(p, 'coral', randomRange(rng, ...CORAL.size), rng)
  }
  for (const style of SEA_FLOOR) furnish(stands, rng, openSea, style)

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
