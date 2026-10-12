/**
 * Venus: jungle under yellow cloud, its trees giants that a car drives
 * about the trunks of under the crowns. There are no cities, only small
 * villages, and between them roads cut straight through the jungle, wide
 * and flat, the ground stamped level under them however it rolls.
 */

import { createRng, randomInt, randomRange, type Rng, type Vec3 } from '@buggies/physics'

import { limitSweepGradeAlong } from '../roads/grades.ts'
import { DISTRICT_SUBURB } from '../sphere-districts.ts'
import { sphereHeight } from '../sphere.ts'
import type { World, WorldPortal, WorldRoad } from '../world.ts'
import { angleBetween, lift, resample, runs } from '../globe/lines.ts'
import { axisAt, turnOf, type Spot } from '../globe/placing.ts'
import { randomDirection } from '../world-queries.ts'
import { BURY } from '../globe/sizes.ts'
import { bareWorld } from './bare.ts'
import { worldId } from './kinds.ts'
import { groundOfSize, landOf, levelGround, meanHeight, rollGround } from './ground.ts'
import { districtOfPlace, linkPlaces, markDistricts, pointIn, scatterPlaces } from './places.ts'
import { Stands, buildSettlement, furnish, plantTrees, portalIn, type FurnitureStyle, type SettlementStyle, type TreeStyle } from './stands.ts'
import { roadAlong, roadsMeet, stampRoad } from './roads.ts'

const VENUS_SALT = 0x7e05
/** Far under anything: the jungle has no sea. */
const NO_SEA = -1000
/** How the jungle floor rolls. */
const HILLS = { height: 16, frequency: 0.003 } as const
/** The villages: how many, how far each reaches, and how far apart two stand past their reaches. */
const VILLAGES = { min: 8, max: 11 } as const
const VILLAGE_REACH = { min: 32, max: 48 } as const
const VILLAGES_APART = 200
/** How many roads past the fewest that join every village; how wide each is, how steep it may be, how broad its stamped shoulder and how long a run its level is smoothed over. */
const EXTRA_ROADS = 4
const ROAD_WIDTH = 18
const ROAD_GRADE = 0.05
const SHOULDER = 14
const SMOOTHING = 24
/** How many villages have a portal. */
const PORTALS = 3
/** The giant trees, their canopies closing overhead over the roads and each other, and the undergrowth about their feet. */
const GIANTS: TreeStyle = { kind: 'tree', count: 3200, height: [28, 55], crown: [9, 16], spacing: 1.1 }
const UNDERGROWTH: TreeStyle = { kind: 'shrub', count: 2600, height: [1, 3], crown: [1, 2.5] }

/** Idols, standing stones carved and set up by each village; and giant mushrooms, their caps this wide, scattered through the jungle. */
const IDOLS: FurnitureStyle = { kind: 'stone', count: 3, width: [1.6, 2.4], depth: [1, 1.4], height: [3.5, 6] }
const MUSHROOMS: FurnitureStyle = { kind: 'mushroom', count: 260, width: [5, 10], depth: [5, 10], height: [4, 10], relief: 2.5, gap: 2 }
/**
 * The temples deep in the jungle, stepped pyramids of stone: how many, how
 * wide at the foot, how many tiers, how far each steps in from the one
 * under it and how high each is, and how far round the ground is eased
 * back from their level.
 */
const TEMPLES = { count: 2, base: 26, tiers: 4, step: 3, rise: 3.5, blend: 18, tries: 300 } as const

const VILLAGE: SettlementStyle = {
  kinds: [
    { kind: 'cottage', odds: 3, width: [6, 8], depth: [6, 9], height: [3, 4] },
    { kind: 'house', odds: 2, width: [7, 9], depth: [7, 9], height: [3.5, 5] },
    { kind: 'church', odds: 0.4, width: [8, 10], depth: [14, 18], height: [7, 9] },
  ],
  count: 8,
  gap: 3,
  roadMargin: 2,
  relief: 1.5,
}

/** Make a planet's Venus, from the planet's seed. */
export function generateVenus(seed: number): World {
  const rng = createRng((seed ^ VENUS_SALT) >>> 0)
  const ground = groundOfSize(1)
  const { radius } = ground
  const land = landOf(ground, NO_SEA)
  rollGround(land, (seed ^ VENUS_SALT) >>> 0, HILLS.height, HILLS.frequency, 0, 4)

  const villages = scatterPlaces(
    rng,
    radius,
    randomInt(rng, VILLAGES.min, VILLAGES.max),
    (a, b) => a + b + VILLAGES_APART,
    () => randomRange(rng, VILLAGE_REACH.min, VILLAGE_REACH.max),
  )
  const levels = villages.map((village) => meanHeight(land, village.center, village.reach))
  villages.forEach((village, k) => levelGround(land, village.center, village.reach, 30, levels[k]!))

  // Straight roads between them, none running into another but at a village.
  const lines: { line: ReturnType<typeof resample>; a: number; b: number }[] = []
  for (const [a, b] of linkPlaces(
    villages.map((village) => village.center),
    EXTRA_ROADS,
  )) {
    const line = resample([villages[a]!.center, villages[b]!.center], 6, radius, false)
    const ends = Math.max(villages[a]!.reach, villages[b]!.reach)
    if (lines.some((other) => roadsMeet(line, other.line, ROAD_WIDTH * 1.5, ends, radius))) continue
    lines.push({ line, a, b })
  }
  const roads: WorldRoad[] = lines.map(({ line, a, b }, id) => roadAlong(id, 'arterial', line, ROAD_WIDTH, land, ROAD_GRADE, flatLevels(land, line, levels[a]!, levels[b]!)))
  for (const road of roads) stampRoad(land, road, SHOULDER)

  const districtOf = markDistricts(land, villages, DISTRICT_SUBURB)

  const stands = new Stands(land, roads)
  // Anywhere in the jungle, out of the villages.
  const jungle = (): Vec3 | null => {
    const p = randomDirection(rng)
    return villages.every((village) => angleBetween(p, village.center) * radius > village.reach + 8) ? p : null
  }
  raiseTemples(stands, rng, jungle)
  const portals: WorldPortal[] = villages.slice(0, PORTALS).map((village) => portalIn(stands, rng, village.center, village.reach * 0.6))
  for (const village of villages) buildSettlement(stands, rng, village, VILLAGE)
  // The old gods' idols standing about each village's edge, and giant mushrooms out in the jungle.
  for (const village of villages) furnish(stands, rng, () => pointIn(rng, village.center, village.reach + 14, radius, village.reach + 2), IDOLS)
  furnish(stands, rng, jungle, MUSHROOMS)
  plantTrees(stands, rng, jungle, GIANTS)
  plantTrees(stands, rng, jungle, UNDERGROWTH)

  return bareWorld({
    seed: worldId(seed, 'venus'),
    kind: 'venus',
    radius,
    seaLevel: NO_SEA,
    ground,
    districtOf,
    districts: villages.map((village, id) => districtOfPlace(id, village)),
    roads,
    buildings: stands.buildings,
    trees: stands.trees,
    portals,
  })
}

/**
 * A straight road's level all along it: the ground under it smoothed out
 * over a long run, its ends at its villages', and held to a gentle grade.
 */
function flatLevels(land: ReturnType<typeof landOf>, line: readonly { x: number; y: number; z: number }[], start: number, end: number): Float32Array {
  const raw = line.map((p) => sphereHeight(land.ground, p))
  const levels = new Float32Array(line.length)
  for (let i = 0; i < line.length; i++) {
    let sum = 0
    let count = 0
    for (let k = Math.max(i - SMOOTHING, 0); k <= Math.min(i + SMOOTHING, line.length - 1); k++) {
      sum += raw[k]!
      count++
    }
    levels[i] = sum / count
  }
  levels[0] = start
  levels[line.length - 1] = end
  limitSweepGradeAlong(levels, runs(line, land.radius, false), ROAD_GRADE)
  return levels
}

/** The temples: each a stepped pyramid on ground levelled for it, off the roads and out of the villages. */
function raiseTemples(stands: Stands, rng: Rng, pick: () => Vec3 | null): void {
  const { land } = stands
  let raised = 0
  for (let attempt = 0; attempt < TEMPLES.tries && raised < TEMPLES.count; attempt++) {
    const at = pick()
    if (at === null) continue
    const u = axisAt(at, randomRange(rng, 0, Math.PI / 2))
    const site: Spot = { at, u, width: TEMPLES.base + 2 * TEMPLES.blend, depth: TEMPLES.base + 2 * TEMPLES.blend }
    if (stands.fits(site, { roadMargin: 4, gap: 4, relief: 12 }) === null) continue
    const level = meanHeight(land, at, TEMPLES.base / 2)
    levelGround(land, at, TEMPLES.base * 0.75, TEMPLES.blend, level)
    stands.placed.add(site)
    let floor = level - BURY
    for (let tier = 0; tier < TEMPLES.tiers; tier++) {
      const side = TEMPLES.base - 2 * TEMPLES.step * tier
      const top = level + TEMPLES.rise * (tier + 1)
      stands.buildings.push({ kind: 'pyramid', at: lift(at, land.radius, floor), turn: turnOf(at, u), width: side, depth: side, height: top - floor, tone: tier / TEMPLES.tiers })
      floor = top
    }
    raised++
  }
}
