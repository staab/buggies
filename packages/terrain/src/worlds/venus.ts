/**
 * Venus: jungle under yellow cloud, its trees giants that a car drives
 * about the trunks of under the crowns. There are no cities, only small
 * villages, and between them roads cut straight through the jungle, wide
 * and flat, the ground stamped level under them however it rolls, and
 * arches of stone over them. Out in the jungle stand the works of whoever
 * was here before: black monoliths, spires far steeper than any temple,
 * towers with a ramp wound round them up to a platform floating beside
 * the top, more platforms floating high over everything, and mines dug
 * deep, a road wound down round each pit's wall to its floor.
 */

import { createRng, randomInt, randomRange, type Rng, type Vec3 } from '@buggies/physics'

import { ROAD_SURFACE } from '../roads/constants.ts'
import { limitSweepGradeAlong } from '../roads/grades.ts'
import { DISTRICT_QUARRY, DISTRICT_SUBURB } from '../sphere-districts.ts'
import { sphereHeight } from '../sphere.ts'
import { ARCH, type BuildingKind } from '../types.ts'
import type { World, WorldPlatform, WorldPortal, WorldRoad } from '../world.ts'
import { globeDecks } from '../globe/decks.ts'
import { along, angleBetween, lift, resample, runs, unit } from '../globe/lines.ts'
import { axisAt, eachPointNear, turnOf, type Spot } from '../globe/placing.ts'
import { globeRailMesh, globeRailRuns } from '../globe/rails.ts'
import { randomDirection } from '../world-queries.ts'
import { BURY } from '../globe/sizes.ts'
import { bareWorld } from './bare.ts'
import { worldId } from './kinds.ts'
import { groundOfSize, landOf, levelGround, meanHeight, rollGround } from './ground.ts'
import { districtOfPlace, linkPlaces, markDistricts, pointIn, ringAround, scatterPlaces } from './places.ts'
import { Stands, buildSettlement, furnish, plantTrees, portalIn, type FurnitureStyle, type SettlementStyle, type TreeStyle } from './stands.ts'
import { roadAlong, roadsMeet, stampRoad } from './roads.ts'
import { digPit, pastScrew, roundPit, screwRamp, type Screw } from './spirals.ts'

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

/** Monoliths: slabs of black stone, sheer and smooth, standing alone in the jungle far over its crowns. */
const MONOLITHS: FurnitureStyle = { kind: 'monolith', count: 14, width: [7, 12], depth: [2, 3.5], height: [60, 140], relief: 4, gap: 8 }
/** Spires: pyramids of dark stone far steeper than a temple, capped in gold: how many, how wide at the foot, how many times as tall as wide, and how far round the ground is eased back from their level. */
const SPIRES = { count: 3, base: [40, 60], tall: 1.5, blend: 16, tries: 300 } as const
/**
 * Screw towers: how many; how far the ramp wound round each runs from its
 * middle, how wide it is and how steep; how high its top is over its foot,
 * and how far the tower's crown stands over that; how far the bridge runs
 * straight off the top to the platform floating beside it, how far onto
 * the platform it goes, and how big the platform is.
 */
const SCREWS = { count: 3, reach: 18, width: 10, grade: 0.09, top: [55, 85], crown: 6, bridge: 30, onto: 12, platform: [28, 38], tries: 300 } as const
/** What stands on a screw tower's platform: a monolith in its middle, and glowing crystals round its foot. */
const SHRINE = { width: 6, depth: 2, height: [18, 26], crystals: 6, ring: 7 } as const
/** Loose platforms floating high over the jungle, joined to nothing, and how far anything tall keeps out from under them. */
const LOOSE = { count: 4, reach: [18, 30], height: [100, 140], apart: 160, clear: 12 } as const
/**
 * Mines: how many; how far out each pit's rim is and its floor; how far
 * apart the turns of the road down its wall are, how wide the road is and
 * how steep; and how far round the ground is eased to the rim's level.
 */
const MINES = { count: 2, rim: [62, 74], floor: 14, pitch: 16, road: 10, grade: 0.1, blend: 20, tries: 300 } as const
/** What a mine has: a headframe over its rim, and ore glowing about its floor. */
const HEADFRAME = { width: 7, height: 28 } as const
const ORE: FurnitureStyle = { kind: 'crystal', count: 12, width: [1.2, 2.6], depth: [1.2, 2.6], height: [2, 6], relief: 2, gap: 1 }
/** Arches of stone over the roads: how far across they span, pillar to pillar, how high, and how far from any village one may stand. */
const ARCHES = { span: 30, height: [28, 38], fromVillage: 60 } as const

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
  // Anywhere in the jungle, out of the villages; and whether a place is out of them by as much as it reaches past its middle.
  const outOfVillages = (p: Vec3, reach: number): boolean => villages.every((village) => angleBetween(p, village.center) * radius > village.reach + reach)
  const jungle = (): Vec3 | null => {
    const p = randomDirection(rng)
    return outOfVillages(p, 8) ? p : null
  }
  // High over the jungle, platforms joined to nothing; and nothing tall stands under them, to run into them.
  const loose = scatterPlaces(
    rng,
    radius,
    LOOSE.count,
    (a, b) => a + b + LOOSE.apart,
    () => randomRange(rng, ...LOOSE.reach),
  ).map((place) => ({ center: place.center, radius: place.reach, height: randomRange(rng, ...LOOSE.height) }))
  const openSky = (): Vec3 | null => {
    const p = jungle()
    return p !== null && loose.every((platform) => angleBetween(p, platform.center) * radius > platform.radius + LOOSE.clear) ? p : null
  }
  raiseTemples(stands, rng, jungle)
  for (const mine of digMines(stands, rng, jungle, outOfVillages)) eachPointNear(land, mine.center, mine.rim, (at) => (districtOf[at] = DISTRICT_QUARRY))
  const towers = raiseScrews(stands, rng, openSky, outOfVillages)
  raiseSpires(stands, rng, openSky, outOfVillages)
  raiseArches(stands, rng, roads, villages)
  const portals: WorldPortal[] = villages.slice(0, PORTALS).map((village) => portalIn(stands, rng, village.center, village.reach * 0.6))
  for (const village of villages) buildSettlement(stands, rng, village, VILLAGE)
  // The old gods' idols standing about each village's edge, and monoliths and giant mushrooms out in the jungle.
  for (const village of villages) furnish(stands, rng, () => pointIn(rng, village.center, village.reach + 14, radius, village.reach + 2), IDOLS)
  furnish(stands, rng, openSky, MONOLITHS)
  furnish(stands, rng, jungle, MUSHROOMS)
  plantTrees(stands, rng, jungle, GIANTS)
  plantTrees(stands, rng, jungle, UNDERGROWTH)

  const ramps = towers.map((tower) => tower.ramp)
  return bareWorld({
    seed: worldId(seed, 'venus'),
    kind: 'venus',
    radius,
    seaLevel: NO_SEA,
    ground,
    districtOf,
    districts: villages.map((village, id) => districtOfPlace(id, village)),
    roads,
    platforms: [...towers.map((tower) => tower.platform), ...loose],
    decks: globeDecks(ground, ramps),
    rails: globeRailMesh(globeRailRuns(ramps, radius), radius),
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

/** A spot on the ground clear of the roads and of everything placed, and level enough, or nothing. */
function siteAt(stands: Stands, at: Vec3, u: Vec3, size: number, roadMargin: number, relief: number): Spot | null {
  const site: Spot = { at, u, width: size, depth: size }
  return stands.fits(site, { roadMargin, gap: 4, relief }) === null ? null : site
}

/** A building put straight where it stands, its foot sunk a little under `foot`, standing `height` over it. */
function erect(stands: Stands, kind: BuildingKind, at: Vec3, u: Vec3, foot: number, width: number, depth: number, height: number, tone: number): void {
  stands.buildings.push({ kind, at: lift(at, stands.land.radius, foot - BURY), turn: turnOf(at, u), width, depth, height: height + BURY, tone })
}

/** Whether a place is out of the villages by as much as it reaches past its middle. */
type Apart = (p: Vec3, reach: number) => boolean

/** The spires: each a steep pyramid on ground levelled for it, out in the open jungle. */
function raiseSpires(stands: Stands, rng: Rng, pick: () => Vec3 | null, apart: Apart): void {
  const { land } = stands
  let raised = 0
  for (let attempt = 0; attempt < SPIRES.tries && raised < SPIRES.count; attempt++) {
    const at = pick()
    if (at === null) continue
    const base = randomRange(rng, ...SPIRES.base)
    const u = axisAt(at, randomRange(rng, 0, Math.PI / 2))
    const site = siteAt(stands, at, u, base + 2 * SPIRES.blend, 4, 14)
    if (site === null || !apart(at, base / 2 + SPIRES.blend)) continue
    const level = meanHeight(land, at, base / 2)
    levelGround(land, at, base * 0.75, SPIRES.blend, level)
    stands.placed.add(site)
    erect(stands, 'spire', at, u, level, base, base, base * SPIRES.tall, rng())
    raised++
  }
}

/** A screw tower as it is raised: the road up round it and on to its platform, and the platform. */
interface Tower {
  readonly ramp: WorldRoad
  readonly platform: WorldPlatform
}

/**
 * The screw towers: each a round tower on levelled ground with a ramp
 * wound up round it from the jungle floor to its top, and from there a
 * bridge straight off to a platform floating beside it, with a monolith on
 * it and crystals round its foot. Nothing grows under the bridge or the
 * platform, to reach up into them.
 */
function raiseScrews(stands: Stands, rng: Rng, pick: () => Vec3 | null, apart: Apart): Tower[] {
  const { land } = stands
  const { radius } = land
  const towers: Tower[] = []
  const outside = SCREWS.reach + SCREWS.width / 2
  for (let attempt = 0; attempt < SCREWS.tries && towers.length < SCREWS.count; attempt++) {
    const at = pick()
    if (at === null) continue
    const size = randomRange(rng, ...SCREWS.platform)
    const start = randomRange(rng, 0, Math.PI * 2)
    const climb = randomRange(rng, ...SCREWS.top)
    const sketch: Screw = { center: at, reach: SCREWS.reach, width: SCREWS.width, foot: 0, top: climb, grade: SCREWS.grade, start }
    // The tower, the bridge's way off its top, and the platform at the end of it, all on clear ground.
    const off = pastScrew(sketch, 0, radius)
    const middle = pastScrew(sketch, SCREWS.bridge / 2, radius)
    const landing = pastScrew(sketch, SCREWS.bridge + size, radius)
    const way = unit({ x: landing.x - off.x, y: landing.y - off.y, z: landing.z - off.z })
    const tower = siteAt(stands, at, axisAt(at, 0), 2 * (outside + 6), 6, 16)
    const bridge: Spot = { at: middle, u: way, width: SCREWS.bridge, depth: SCREWS.width + 6 }
    const under = siteAt(stands, landing, way, 2 * size, 4, Infinity)
    if (tower === null || under === null || !stands.clear(bridge, 2) || stands.placed.meets(bridge, 2)) continue
    if (!apart(at, outside + 6) || !apart(landing, size)) continue
    const level = meanHeight(land, at, outside)
    levelGround(land, at, outside + 4, 16, level)
    for (const spot of [tower, bridge, under]) stands.placed.add(spot)
    const foot = level + ROAD_SURFACE
    const screw: Screw = { ...sketch, foot, top: foot + climb }
    const core = SCREWS.reach - SCREWS.width / 2 - 0.3
    erect(stands, 'screw', at, axisAt(at, start), level, core * 2, core * 2, climb + SCREWS.crown, rng())
    const platform: WorldPlatform = { center: landing, radius: size, height: screw.top - ROAD_SURFACE }
    // A shrine on the platform: a monolith, and crystals glowing in a ring round its foot.
    erect(stands, 'monolith', landing, way, platform.height, SHRINE.width, SHRINE.depth, randomRange(rng, ...SHRINE.height), rng())
    for (const [k, p] of ringAround(landing, SHRINE.ring, SHRINE.crystals, radius).entries()) {
      const width = randomRange(rng, 1.4, 2.6)
      erect(stands, 'crystal', p, axisAt(p, k), platform.height, width, width, randomRange(rng, 3, 6), rng())
    }
    towers.push({ ramp: screwRamp(screw, SCREWS.bridge + SCREWS.onto, radius), platform })
  }
  return towers
}

/** A mine as it is dug: where its pit is, and how far out its rim. */
interface Mine {
  readonly center: Vec3
  readonly rim: number
}

/**
 * The mines: each a pit dug deep into ground levelled round its rim, a road
 * wound down its wall from the rim to its floor, a headframe over the rim
 * across from where the road goes in, and ore glowing about the floor.
 */
function digMines(stands: Stands, rng: Rng, pick: () => Vec3 | null, apart: Apart): Mine[] {
  const { land } = stands
  const mines: Mine[] = []
  for (let attempt = 0; attempt < MINES.tries && mines.length < MINES.count; attempt++) {
    const at = pick()
    if (at === null) continue
    const rim = randomRange(rng, ...MINES.rim)
    const site = siteAt(stands, at, axisAt(at, 0), 2 * (rim + MINES.blend), 8, 24)
    if (site === null || !apart(at, rim + MINES.blend)) continue
    const level = meanHeight(land, at, rim)
    levelGround(land, at, rim + 4, MINES.blend, level)
    const start = randomRange(rng, 0, Math.PI * 2)
    digPit(land, { center: at, rim, floor: MINES.floor, pitch: MINES.pitch, road: MINES.road, grade: MINES.grade, start, level })
    furnish(stands, rng, () => pointIn(rng, at, MINES.floor * 0.85, land.radius), ORE)
    // Over the rim across from where the road goes down.
    const frame = roundPit(at, start + Math.PI, rim + HEADFRAME.width, land.radius)
    erect(stands, 'headframe', frame, axisAt(frame, start), level, HEADFRAME.width, HEADFRAME.width, HEADFRAME.height, rng())
    stands.placed.add(site)
    mines.push({ center: at, rim })
  }
  return mines
}

/** An arch over the middle of each road long enough to have a middle well out of the villages, its pillars either side of the road. */
function raiseArches(stands: Stands, rng: Rng, roads: readonly WorldRoad[], villages: readonly { center: Vec3; reach: number }[]): void {
  const { land } = stands
  const { radius } = land
  for (const road of roads) {
    const middle = Math.floor(road.points.length / 2)
    const at = unit(road.points[middle]!)
    if (villages.some((village) => angleBetween(at, village.center) * radius < village.reach + ARCHES.fromVillage)) continue
    const next = unit(road.points[middle + 1]!)
    const ahead = unit({ x: next.x - at.x, y: next.y - at.y, z: next.z - at.z })
    // Across the road: the way along it crossed with the way up.
    const across = unit({ x: ahead.y * at.z - ahead.z * at.y, y: ahead.z * at.x - ahead.x * at.z, z: ahead.x * at.y - ahead.y * at.x })
    const foot = sphereHeight(land.ground, at)
    erect(stands, 'arch', at, across, foot, ARCHES.span, ARCH.pillar, randomRange(rng, ...ARCHES.height), rng())
    for (const side of [-1, 1]) {
      const pillar = along(at, across, (side * (ARCHES.span - ARCH.pillar)) / 2, radius)
      stands.placed.add({ at: pillar, u: across, width: ARCH.pillar + 2, depth: ARCH.pillar + 2 })
    }
  }
}
