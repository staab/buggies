/**
 * What stands about a planet's open country and its coasts: the pyramid,
 * the observatory, farms and orchards, the wind farm, the standing stones,
 * the lighthouse and the boats off the shore, the chair lift, a church for
 * every village, a water tower at the edge of each suburb, and camp sites.
 * Each is laid out in a frame at the spot found for it.
 */

import { randomInt, randomRange, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'

import { DISTRICT_COUNTRY, DISTRICT_SUBURB } from '../districts.ts'
import { signedDistanceToTriangle } from '../mountain.ts'
import { smoothstep } from '../noise.ts'
import { ROAD_GRADE } from '../roads/constants.ts'
import { onTangentPlane, tangentFrame, type SphereMountain } from '../sphere-heights.ts'
import { HOUSE_KINDS } from '../types.ts'
import type { WorldDistrict, WorldRoad } from '../world.ts'
import { fromFrame, toFrame, type Frame } from './frame.ts'
import { along, angleBetween, lift, slerp, unit } from './lines.ts'
import {
  axisAt,
  carryAxis,
  districtAt,
  eachPointNear,
  groundUnder,
  heightAt,
  secondAxis,
  spotFrame,
  spotSamples,
  turnOf,
  type Spot,
} from './placing.ts'
import { roadFrameAt } from './rails.ts'
import { mainRoads } from './roadside.ts'
import { chordWay } from './segments.ts'
import { farFromKind, noteStood, prop, raise, standsHere, tower, worldField, type Planter, type Raised, type Site } from './site.ts'
import {
  ALTAR,
  BARN,
  BARN_OFF,
  BARNS_APART,
  BOAT,
  BOAT_ROAD_MARGIN,
  BOAT_TRIES,
  BOAT_WATER,
  BOATS_APART,
  BOATS_MOST,
  BUILDING_GAP,
  BURY,
  CAMP_NEAR_ROAD,
  CAMP_TRIES,
  CAMPER,
  CAMPERS,
  CAMPS_MOST,
  CHURCH_APART,
  CHURCH_SETBACK,
  CHURCHES_MOST,
  CLEARING_RADIUS,
  COAST_STEP,
  FARM_APART,
  FARM_TRIES,
  FARMS_MOST,
  FEATURE_APART,
  FIELD_BALES,
  FIELD_GAP,
  FIELD_LENGTH,
  FIELD_RELIEF,
  FIELD_ROAD_MARGIN,
  FIELD_WIDTH,
  FIELDS_PER_FARM,
  FIRE_PIT,
  FRUIT_RADIUS,
  FURNITURE_GAP,
  GREEN_TREES,
  HEADLAND_REACH,
  HEADLAND_SAMPLES,
  HEADLAND_SEA,
  HEDGE_OUT,
  HEDGE_SPACING,
  HOUSE_RELIEF,
  LIFT_ENDS,
  LIFT_FOOT,
  LIFT_GRADE,
  LIFT_ROAD_MARGIN,
  LIFT_STATION,
  LIFT_STATION_RELIEF,
  LIFTS_MOST,
  LIGHTHOUSE,
  LIGHTHOUSE_APART,
  LIGHTHOUSE_RELIEF,
  LIGHTHOUSE_ROAD_MARGIN,
  LIGHTHOUSES_MOST,
  LINTEL,
  LINTEL_ODDS,
  NAVE,
  OBSERVATORY_HEIGHT,
  OBSERVATORY_ODDS,
  OBSERVATORY_RELIEF,
  OBSERVATORY_SIZE,
  ORCHARD_ALONG,
  ORCHARD_ODDS,
  ORCHARD_ROW,
  ORCHARD_SIZE,
  ORCHARD_TRIES,
  ORCHARDS_ALONE,
  PYLON,
  PYLON_RELIEF,
  PYRAMID,
  RIM_TREES,
  ROAD_MARGIN,
  SHORE,
  SILO,
  SILO_RELIEF,
  SILOS,
  STONE,
  STONE_RING,
  STONES,
  STONES_RELIEF,
  STONES_ROAD_MARGIN,
  STONES_TRIES,
  TENT,
  TENT_RING,
  TENTS,
  TOWER,
  TURBINE,
  TURBINE_GAP,
  TURBINE_RELIEF,
  TURBINE_ROAD_MARGIN,
  TURBINE_SPACING,
  TURBINES,
  TURBINES_LEAST,
  VILLAGE_HOUSES,
  VILLAGE_REACH,
  WATER_TOWER,
  WATER_TOWER_IN,
  WATER_TOWER_TRIES,
  WATER_TOWERS_APART,
  WIND_FARM_TRIES,
} from './sizes.ts'

const { cos, sin } = exact

/** The frame a feature is laid out in at a way out: across it east, and down it south, the way a map is laid out. */
function localAt(p: Vec3, radius: number): Frame {
  return spotFrame(p, tangentFrame(p).east, radius)
}

/** The first axis of a thing standing at a point of a frame, turned by `yaw` from the frame's east the way a map turns it. */
function axisOn(frame: Frame, yaw: number, p: Vec3): Vec3 {
  const c = cos(yaw)
  const s = sin(yaw)
  return carryAxis({ x: frame.east.x * c + frame.north.x * s, y: frame.east.y * c + frame.north.y * s, z: frame.east.z * c + frame.north.z * s }, p)
}

/** A point of a spot's own frame. */
function onSpot(site: Site, spot: Spot, u: number, v: number): Vec3 {
  return fromFrame(spotFrame(spot.at, spot.u, site.radius), u, v)
}

/** A spot at a point of another's frame, turned as that one is. */
function besideSpot(site: Site, spot: Spot, u: number, v: number, width: number, depth: number): Spot {
  const at = onSpot(site, spot, u, v)
  return { at, u: carryAxis(spot.u, at), width, depth }
}

/** Every grid point of land in the open country that is not down at the shore: what the furniture picks its spots from. */
export function countryLand(site: Site): Int32Array {
  const { land } = site
  const points: number[] = []
  for (let at = 0; at < land.districtOf.length; at++) {
    if (land.districtOf[at] !== DISTRICT_COUNTRY) continue
    if (land.ground.heights[at]! < land.seaLevel + 2) continue
    points.push(at)
  }
  return Int32Array.from(points)
}

/** Somewhere on the land in the open country, taken at random, or nothing on a planet with none. */
function countrySpot(site: Site, country: Int32Array): Vec3 | null {
  const at = country[Math.floor(site.rng() * country.length)]
  if (at === undefined) return null
  const { directions } = site.land
  return { x: directions[at * 3]!, y: directions[at * 3 + 1]!, z: directions[at * 3 + 2]! }
}

/** Whether a spot lies in the open country to its corners. */
function inCountry(site: Site, spot: Spot): boolean {
  return spotSamples(spot, site.radius).every((p) => districtAt(site.land, p) === DISTRICT_COUNTRY)
}

/** How far a point is inside a mountain's triangle, negative outside it, on the plane it was raised on. */
function intoMountain(mountain: SphereMountain, p: Vec3, radius: number): number {
  const at = onTangentPlane(p, mountain.center, mountain.east, mountain.north, radius)
  return signedDistanceToTriangle(at.x, at.z, mountain.triangle)
}

/** Whether a point is on a mountain: within its triangle, or the skirt round it. */
export function onMountain(mountains: readonly SphereMountain[], p: Vec3, radius: number): boolean {
  return mountains.some((mountain) => intoMountain(mountain, p, radius) >= -mountain.skirt)
}

/** How far up a mountain a point is, 0 clear of every skirt to 1 on a crest. */
export function riseOf(mountains: readonly SphereMountain[], p: Vec3, radius: number, inradii: readonly number[]): number {
  let most = 0
  for (const [k, mountain] of mountains.entries()) most = Math.max(most, smoothstep(-mountain.skirt, inradii[k]!, intoMountain(mountain, p, radius)))
  return most
}

/** How far apart the points a spot is tried at are, across and along it. */
const MOUNTAIN_PROBE = 8

function spotOnMountain(site: Site, mountains: readonly SphereMountain[], spot: Spot): boolean {
  const stepsU = Math.max(1, Math.ceil(spot.width / MOUNTAIN_PROBE))
  const stepsV = Math.max(1, Math.ceil(spot.depth / MOUNTAIN_PROBE))
  const frame = spotFrame(spot.at, spot.u, site.radius)
  for (let i = 0; i <= stepsU; i++) {
    for (let j = 0; j <= stepsV; j++) {
      if (onMountain(mountains, fromFrame(frame, spot.width * (i / stepsU - 0.5), spot.depth * (j / stepsV - 0.5)), site.radius)) return true
    }
  }
  return false
}

/** The highest ground inside a mountain's triangle, at a grid point, or nothing. */
function peakOf(site: Site, mountain: SphereMountain): Vec3 | null {
  const { triangle } = mountain
  const reach = Math.max(...[triangle.ax, triangle.az, triangle.bx, triangle.bz, triangle.cx, triangle.cz].map(Math.abs)) * 1.5
  let best: Vec3 | null = null
  let top = -Infinity
  eachPointNear(site.land, mountain.center, reach, (at, p) => {
    if (intoMountain(mountain, p, site.radius) < 0) return
    const height = site.land.ground.heights[at]!
    if (height <= top) return
    top = height
    best = p
  })
  return best
}

/** Level the ground over a spot to one height, blended back to the land around it over `blend`. */
function levelSite(site: Site, spot: Spot, level: number, blend: number): void {
  const { heights } = site.land.ground
  const frame = spotFrame(spot.at, spot.u, site.radius)
  eachPointNear(site.land, spot.at, Math.sqrt(spot.width * spot.width + spot.depth * spot.depth) / 2 + blend, (at, p) => {
    const { x, z } = toFrame(frame, p)
    const u = Math.max(Math.abs(x) - spot.width / 2, 0)
    const v = Math.max(Math.abs(z) - spot.depth / 2, 0)
    const out = Math.sqrt(u * u + v * v)
    if (out >= blend) return
    heights[at] = level + (heights[at]! - level) * smoothstep(0, blend, out)
  })
}

/**
 * The planet's one pyramid, if there is open country enough for it: a
 * stepped pyramid of stone with a tunnel through its foot, and a straight
 * ramp up each of its other two sides to the top. The ground is levelled
 * under it, so it is placed before anything else in the country.
 */
export function raisePyramid(site: Site, country: Int32Array, mountains: readonly SphereMountain[]): void {
  const { rng, placed, radius, land } = site
  const { tiers, ledge, top, tunnel, ramp, apron, blend } = PYRAMID
  const base = top + 2 * ledge * (tiers.length - 1)
  const reach = base / 2 + apron
  for (let attempt = 0; attempt < PYRAMID.tries * PYRAMID.relief.length; attempt++) {
    const relief = PYRAMID.relief[Math.floor(attempt / PYRAMID.tries)]!
    const at = countrySpot(site, country)
    if (at === null) return
    const yaw = randomRange(rng, 0, Math.PI / 2)
    const spot: Spot = { at, u: axisAt(at, yaw), width: reach * 2, depth: reach * 2 }
    if (!inCountry(site, spot) || spotOnMountain(site, mountains, spot)) continue
    if (!site.clear({ ...spot, width: spot.width + 2 * blend, depth: spot.depth + 2 * blend }, ROAD_MARGIN) || placed.meets(spot, 0)) continue
    // Level enough, dry, and all of it country: looked at across a grid over the site.
    let low = Infinity
    let high = -Infinity
    let sum = 0
    let count = 0
    let sound = true
    for (let i = -4; i <= 4 && sound; i++) {
      for (let j = -4; j <= 4 && sound; j++) {
        const p = onSpot(site, spot, (i / 4) * reach, (j / 4) * reach)
        const height = heightAt(land, p)
        if (height <= land.seaLevel || site.wet(p) || districtAt(land, p) !== DISTRICT_COUNTRY) sound = false
        low = Math.min(low, height)
        high = Math.max(high, height)
        sum += height
        count += 1
      }
    }
    if (!sound || high - low > relief) continue
    // The more the land rises and falls, the further out it is blended back to the level.
    const spread = Math.max(blend, (high - low) * PYRAMID.easing)
    if (!site.clear({ ...spot, width: spot.width + 2 * spread, depth: spot.depth + 2 * spread }, ROAD_MARGIN)) continue
    const level = sum / count
    levelSite(site, spot, level, spread)
    placed.add(spot)
    const stone = (u: number, v: number, width: number, depth: number, bottom: number, height: number, tier: number): void => {
      site.buildings.push({ kind: 'pyramid', spot: besideSpot(site, spot, u, v, width, depth), bottom, top: height, tone: tier / tiers.length })
    }
    // The first tier either side of the tunnel, and the lintel over it; each tier above on the one below.
    let floor = level
    for (const [tier, rise] of tiers.entries()) {
      const side = base - 2 * ledge * tier
      const roof = floor + rise
      if (tier === 0) {
        const wing = (base - tunnel.width) / 2
        for (const s of [-1, 1]) stone(0, s * (tunnel.width / 2 + wing / 2), base, wing, level - BURY, roof, tier)
        stone(0, 0, base, tunnel.width, level + tunnel.height, roof, tier)
      } else {
        stone(0, 0, side, side, floor, roof, tier)
      }
      floor = roof
    }
    // A straight ramp up each side the tunnel does not run through, from the ground out beyond the foot to the edge of the top.
    for (const s of [-1, 1]) {
      const foot = onSpot(site, spot, 0, s * (top / 2 + ramp))
      // It climbs toward the middle, along the spot's second axis; its x is that crossed with the way up.
      const v = carryAxis(secondAxis(spot.at, spot.u), foot)
      const climb = { x: -v.x * s, y: -v.y * s, z: -v.z * s }
      const x = unit({ x: foot.y * climb.z - foot.z * climb.y, y: foot.z * climb.x - foot.x * climb.z, z: foot.x * climb.y - foot.y * climb.x })
      site.ramps.push({ at: lift(foot, radius, level), turn: turnOf(foot, x), width: tunnel.width, length: ramp, rise: floor - level, straight: true })
    }
    return
  }
}

/**
 * The planet's one observatory, if it has one: a round tower under a dome
 * on the highest ground within a mountain's own triangle, where no road runs
 * and nothing else stands.
 */
export function raiseObservatory(site: Site, rng: () => number, mountains: readonly SphereMountain[]): void {
  if (mountains.length === 0 || rng() >= OBSERVATORY_ODDS) return
  const first = Math.floor(rng() * mountains.length)
  const tone = rng()
  for (let tried = 0; tried < mountains.length; tried++) {
    const peak = peakOf(site, mountains[(first + tried) % mountains.length]!)
    if (peak === null) continue
    const spot: Spot = { at: peak, u: axisAt(peak, 0), width: OBSERVATORY_SIZE, depth: OBSERVATORY_SIZE }
    if (!site.clear(spot, ROAD_MARGIN)) continue
    const ground = groundUnder(site.land, site.wet, spot)
    if (ground.wet || ground.high - ground.low > OBSERVATORY_RELIEF) continue
    if (site.placed.meets(spot, BUILDING_GAP)) continue
    site.placed.add(spot)
    raise(site, 'observatory', spot, ground, OBSERVATORY_HEIGHT, tone)
    return
  }
}

/** A hedge round a spot: shrubs a step apart along each side, just outside it. */
function hedge(site: Site, spot: Spot, plant: Planter): void {
  const halfU = spot.width / 2 + HEDGE_OUT
  const halfV = spot.depth / 2 + HEDGE_OUT
  for (let u = -halfU; u <= halfU; u += HEDGE_SPACING) for (const v of [-halfV, halfV]) plant(onSpot(site, spot, u, v), 'shrub')
  for (let v = -halfV + HEDGE_SPACING; v < halfV; v += HEDGE_SPACING) for (const u of [-halfU, halfU]) plant(onSpot(site, spot, u, v), 'shrub')
}

/** How far in from an orchard's edge the outermost trees stand. */
const ORCHARD_IN = 3.5

function orchardGrid(site: Site, spot: Spot): Vec3[] {
  const halfU = spot.width / 2 - ORCHARD_IN
  const halfV = spot.depth / 2 - ORCHARD_IN
  const grid: Vec3[] = []
  for (let v = -halfV; v <= halfV + 1e-6; v += ORCHARD_ROW) {
    for (let u = -halfU; u <= halfU + 1e-6; u += ORCHARD_ALONG) grid.push(onSpot(site, spot, u, v))
  }
  return grid
}

/** An orchard on a spot, where nearly all of its trees would stand on dry ground away from any road: fruit trees in rows, hedged about. */
function plantOrchard(site: Site, spot: Spot, plant: Planter): boolean {
  if (!farFromKind(site, 'orchard', spot.at, FEATURE_APART)) return false
  const grid = orchardGrid(site, spot)
  const crown = FRUIT_RADIUS.max
  const fine = grid.filter((p) => !site.wet(p) && site.clear({ at: p, u: axisAt(p, 0), width: crown * 2, depth: crown * 2 }, 4))
  if (fine.length < grid.length * 0.9) return false
  for (const p of grid) plant(p, 'fruit')
  site.placed.add(spot)
  hedge(site, spot, plant)
  noteStood(site, 'orchard', spot.at)
  return true
}

/**
 * Farms in the open country: a row of fields side by side, each hedged
 * round with shrubs, and off one end of the row a barn with a silo or two
 * beside it. A farm is at least two fields, on ground flat enough to plow.
 */
export function plantFarms(site: Site, country: Int32Array, plant: Planter, mountains: readonly SphereMountain[]): void {
  const { rng, placed, radius } = site
  let farms = 0
  for (let attempt = 0; attempt < FARM_TRIES && farms < FARMS_MOST; attempt++) {
    const at = countrySpot(site, country)
    if (at === null || onMountain(mountains, at, radius) || !farFromKind(site, 'farm', at, FARM_APART)) continue
    const yaw = randomRange(rng, 0, Math.PI)
    const count = randomInt(rng, FIELDS_PER_FARM.min, FIELDS_PER_FARM.max)
    const length = randomRange(rng, FIELD_LENGTH.min, FIELD_LENGTH.max)
    const width = randomRange(rng, FIELD_WIDTH.min, FIELD_WIDTH.max)
    const row: Spot = { at, u: axisAt(at, yaw), width: length, depth: width }
    const laid: Spot[] = []
    for (let k = 0; k < count; k++) {
      const spot = besideSpot(site, row, 0, k * (width + FIELD_GAP), length, width)
      // The row stops where the country does, and at the foot of a mountain.
      if (!inCountry(site, spot) || spotOnMountain(site, mountains, spot)) break
      if (standsHere(site, spot, FIELD_ROAD_MARGIN, FIELD_RELIEF, FURNITURE_GAP) === null) break
      laid.push(spot)
    }
    if (laid.length < 2) continue
    noteStood(site, 'farm', at)
    for (const [k, spot] of laid.entries()) {
      // The last field of a farm is sometimes an orchard instead of a crop, where one will take.
      if (k === laid.length - 1 && rng() < ORCHARD_ODDS && plantOrchard(site, spot, plant)) continue
      placed.add(spot)
      worldField(site, 'crop', spot, rng())
      hedge(site, spot, plant)
      // A few bales left lying in the field.
      const { propRng } = site
      for (let n = randomInt(propRng, FIELD_BALES.min, FIELD_BALES.max); n > 0; n--) {
        const u = randomRange(propRng, -spot.width / 2 + 3, spot.width / 2 - 3)
        const v = randomRange(propRng, -spot.depth / 2 + 3, spot.depth / 2 - 3)
        const p = onSpot(site, spot, u, v)
        prop(site, 'bale', p, axisOn(localAt(p, radius), yaw + randomRange(propRng, -0.4, 0.4), p))
      }
    }
    // The barn off the end of the first field, broadside to the row, and the silos beside it.
    const first = laid[0]!
    const barn = besideSpot(site, first, first.width / 2 + BARN.width / 2 + BARN_OFF, 0, BARN.width, BARN.depth)
    const ground = farFromKind(site, 'barn', barn.at, BARNS_APART) ? standsHere(site, barn, ROAD_MARGIN, HOUSE_RELIEF, FURNITURE_GAP) : null
    if (ground !== null) {
      noteStood(site, 'barn', barn.at)
      placed.add(barn)
      raise(site, 'barn', barn, ground, BARN.height)
      for (let k = randomInt(rng, SILOS.min, SILOS.max), n = 0; n < k; n++) {
        const p = onSpot(site, barn, BARN.width / 2 + SILO.radius + 3.5 + n * (SILO.radius * 2 + 2), 0)
        const silo: Spot = { at: p, u: axisAt(p, 0), width: SILO.radius * 2, depth: SILO.radius * 2 }
        const under = standsHere(site, silo, ROAD_MARGIN, SILO_RELIEF, FURNITURE_GAP)
        if (under !== null) tower(site, 'silo', silo, under, SILO.height)
      }
    }
    farms += 1
  }
}

/** A couple of orchards on their own in the open country, where a field's worth of gentle ground is free. */
export function plantOrchards(site: Site, country: Int32Array, plant: Planter, mountains: readonly SphereMountain[]): void {
  let orchards = 0
  for (let attempt = 0; attempt < ORCHARD_TRIES && orchards < ORCHARDS_ALONE; attempt++) {
    const at = countrySpot(site, country)
    if (at === null || onMountain(mountains, at, site.radius)) continue
    const spot: Spot = { at, u: axisAt(at, randomRange(site.rng, 0, Math.PI)), ...ORCHARD_SIZE }
    if (!inCountry(site, spot) || spotOnMountain(site, mountains, spot)) continue
    if (standsHere(site, spot, FIELD_ROAD_MARGIN, FIELD_RELIEF, FURNITURE_GAP) === null) continue
    if (plantOrchard(site, spot, plant)) orchards += 1
  }
}

/** The planet's wind farm: a line of turbines across the open country, all facing the same way, wherever there is room for enough of them in a row. */
export function raiseWindFarm(site: Site, country: Int32Array): void {
  const { rng, radius } = site
  for (let attempt = 0; attempt < WIND_FARM_TRIES; attempt++) {
    const at = countrySpot(site, country)
    if (at === null) continue
    const line = randomRange(rng, 0, Math.PI)
    const facing = randomRange(rng, 0, Math.PI * 2)
    const wanted = randomInt(rng, TURBINES.min, TURBINES.max)
    const frame = localAt(at, radius)
    const standing: { spot: Spot; ground: { low: number; high: number } }[] = []
    for (let k = 0; k < wanted; k++) {
      const p = fromFrame(frame, cos(line) * k * TURBINE_SPACING, sin(line) * k * TURBINE_SPACING)
      const spot: Spot = { at: p, u: axisOn(frame, facing, p), width: TURBINE.radius * 2, depth: TURBINE.radius * 2 }
      const ground = standsHere(site, spot, TURBINE_ROAD_MARGIN, TURBINE_RELIEF, TURBINE_GAP)
      if (ground === null) break
      standing.push({ spot, ground })
    }
    if (standing.length < TURBINES_LEAST) continue
    for (const { spot, ground } of standing) tower(site, 'turbine', spot, ground, TURBINE.height)
    return
  }
}

/** The planet's ring of standing stones, on the highest open ground of a few tries: the stones round the ring, each turned to face its middle, some joined by lintels. */
export function raiseStones(site: Site, country: Int32Array): void {
  const { rng, radius, land } = site
  let best: { at: Vec3; height: number } | null = null
  for (let attempt = 0; attempt < STONES_TRIES; attempt++) {
    const at = countrySpot(site, country)
    if (at === null) continue
    const height = heightAt(land, at)
    if (best !== null && height <= best.height) continue
    const ring: Spot = { at, u: axisAt(at, 0), width: (STONE_RING + 2) * 2, depth: (STONE_RING + 2) * 2 }
    if (standsHere(site, ring, STONES_ROAD_MARGIN, STONES_RELIEF, FURNITURE_GAP) === null) continue
    best = { at, height }
  }
  if (best === null) return
  site.placed.add({ at: best.at, u: axisAt(best.at, 0), width: (STONE_RING + 2) * 2, depth: (STONE_RING + 2) * 2 })
  const frame = localAt(best.at, radius)
  // The altar in the middle, lying down.
  const altar: Spot = { at: best.at, u: axisAt(best.at, rng() * Math.PI), width: ALTAR.width, depth: ALTAR.depth }
  const under = groundUnder(land, site.wet, altar)
  if (!under.wet) raise(site, 'stone', altar, under, ALTAR.height)
  // Which pairs of neighbors carry a lintel, and how tall each stone is: the same as its neighbor where a lintel joins them.
  const lintels = Array.from({ length: STONES }, () => rng() < LINTEL_ODDS)
  const heights = Array.from({ length: STONES }, () => randomRange(rng, STONE.height.min, STONE.height.max))
  for (let k = 0; k < STONES; k++) if (lintels[k]) heights[(k + 1) % STONES] = heights[k] ?? STONE.height.min
  const standing: (Raised | null)[] = []
  for (let k = 0; k < STONES; k++) {
    const angle = (k * Math.PI * 2) / STONES + randomRange(rng, -0.12, 0.12)
    const p = fromFrame(frame, cos(angle) * STONE_RING, sin(angle) * STONE_RING)
    // Broadside to the middle of the ring.
    const stone: Spot = { at: p, u: axisOn(frame, -(angle + Math.PI / 2), p), width: STONE.width, depth: STONE.depth }
    const ground = groundUnder(land, site.wet, stone)
    if (ground.wet) {
      standing.push(null)
      continue
    }
    standing.push(raise(site, 'stone', stone, ground, heights[k] ?? STONE.height.min))
  }
  // Stones joined by lintels, however many in a row, are brought to one top, the tallest of them.
  const joined = (k: number): (Raised | null)[] => {
    const run: (Raised | null)[] = [standing[k] ?? null]
    for (let n = 0; n < STONES && lintels[(k + n) % STONES]; n++) run.push(standing[(k + n + 1) % STONES] ?? null)
    return run
  }
  for (let k = 0; k < STONES; k++) {
    if (lintels[(k + STONES - 1) % STONES] && !lintels.every(Boolean)) continue
    const run = joined(k)
    if (run.length < 2) continue
    const top = Math.max(...run.map((stone) => stone?.top ?? -Infinity))
    for (const stone of run) if (stone !== null) stone.top = top
    if (lintels.every(Boolean)) break
  }
  // The lintels, laid from each stone across to its neighbor, resting on both.
  for (let k = 0; k < STONES; k++) {
    if (!lintels[k]) continue
    const a = standing[k]
    const b = standing[(k + 1) % STONES]
    if (a === null || b === null || a === undefined || b === undefined) continue
    const span = angleBetween(a.spot.at, b.spot.at) * radius
    const rest = Math.min(a.top, b.top) - LINTEL.seat
    const middle = slerp(a.spot.at, b.spot.at, 0.5)
    site.buildings.push({
      kind: 'lintel',
      spot: { at: middle, u: carryAxis(chordWay(a.spot.at, b.spot.at), middle), width: span + STONE.width + LINTEL.overhang * 2, depth: LINTEL.depth },
      bottom: rest,
      top: rest + LINTEL.height,
      tone: rng(),
    })
  }
}

/** A spot on the shore with the sea about it: how much of the ground round it is sea. */
interface ShoreSpot {
  readonly at: Vec3
  readonly index: number
  readonly sea: number
}

/** Whether a grid point is one of those the coast is walked at: every few along each face of the grid. */
function coastPoint(n: number, at: number): boolean {
  const side = n + 1
  const i = at % side
  const j = Math.floor(at / side) % side
  return i % COAST_STEP === 0 && j % COAST_STEP === 0
}

/** Whether any of the ground round a point at this reach is land, looked at in as many ways as a headland is. */
function landWithin(site: Site, p: Vec3, reach: number): boolean {
  const frame = localAt(p, site.radius)
  for (let k = 0; k < HEADLAND_SAMPLES; k++) {
    const angle = (k * Math.PI * 2) / HEADLAND_SAMPLES
    if (heightAt(site.land, fromFrame(frame, cos(angle) * reach, sin(angle) * reach)) >= site.land.seaLevel) return true
  }
  return false
}

/** The shore, walked for the points just above the sea with plenty of sea about them, the most seaward first. */
function shoreSpots(site: Site): ShoreSpot[] {
  const { land } = site
  const spots: ShoreSpot[] = []
  for (let at = 0; at < land.ground.heights.length; at++) {
    if (!coastPoint(land.ground.n, at)) continue
    const height = land.ground.heights[at]!
    if (height < land.seaLevel + SHORE.over || height > land.seaLevel + SHORE.under) continue
    const p = { x: land.directions[at * 3]!, y: land.directions[at * 3 + 1]!, z: land.directions[at * 3 + 2]! }
    const frame = localAt(p, site.radius)
    let sea = 0
    for (let k = 0; k < HEADLAND_SAMPLES; k++) {
      const angle = (k * Math.PI * 2) / HEADLAND_SAMPLES
      if (heightAt(land, fromFrame(frame, cos(angle) * HEADLAND_REACH, sin(angle) * HEADLAND_REACH)) < land.seaLevel) sea += 1
    }
    sea /= HEADLAND_SAMPLES
    if (sea < HEADLAND_SEA || sea >= 1) continue
    spots.push({ at: p, index: at, sea })
  }
  spots.sort((a, b) => b.sea - a.sea || a.index - b.index)
  return spots
}

/** The planet's lighthouse: the shore is walked for the spots with the most sea about them, and the most seaward whose ground will take a tower gets it. */
export function raiseLighthouses(site: Site): void {
  const raised: Vec3[] = []
  for (const { at } of shoreSpots(site)) {
    if (raised.length >= LIGHTHOUSES_MOST) break
    if (raised.some((other) => angleBetween(other, at) * site.radius < LIGHTHOUSE_APART)) continue
    const spot: Spot = { at, u: axisAt(at, 0), width: LIGHTHOUSE.radius * 2, depth: LIGHTHOUSE.radius * 2 }
    const ground = standsHere(site, spot, LIGHTHOUSE_ROAD_MARGIN, LIGHTHOUSE_RELIEF, FURNITURE_GAP)
    if (ground === null) continue
    tower(site, 'lighthouse', spot, ground, LIGHTHOUSE.height)
    noteStood(site, 'lighthouse', at)
    raised.push(at)
  }
}

/** A few boats moored off the shore, wherever the sea is a couple of meters deep with the shore in sight but not close, none too near another. */
export function moorBoats(site: Site, rng: () => number): void {
  const { land, placed } = site
  const water: Vec3[] = []
  for (let at = 0; at < land.ground.heights.length; at++) {
    if (!coastPoint(land.ground.n, at)) continue
    if (land.ground.heights[at]! > land.seaLevel - BOAT_WATER.depth) continue
    const p = { x: land.directions[at * 3]!, y: land.directions[at * 3 + 1]!, z: land.directions[at * 3 + 2]! }
    if (landWithin(site, p, BOAT_WATER.offshore) || !landWithin(site, p, BOAT_WATER.nearShore)) continue
    water.push(p)
  }
  let moored = 0
  for (let attempt = 0; attempt < BOAT_TRIES && moored < BOATS_MOST && water.length > 0; attempt++) {
    const at = water[Math.floor(rng() * water.length)]!
    const length = randomRange(rng, BOAT.length.min, BOAT.length.max)
    const beam = randomRange(rng, BOAT.beam.min, BOAT.beam.max)
    const yaw = rng() * Math.PI * 2
    const tone = rng()
    if (!farFromKind(site, 'boat', at, BOATS_APART)) continue
    const boat: Spot = { at, u: axisAt(at, yaw), width: length, depth: beam }
    // Not under a bridge: a deck over the water is a road like any other.
    if (!site.clear(boat, BOAT_ROAD_MARGIN) || placed.meets(boat, FURNITURE_GAP)) continue
    placed.add(boat)
    site.buildings.push({ kind: 'boat', spot: boat, bottom: land.seaLevel - BOAT.draft, top: land.seaLevel + BOAT.freeboard, tone })
    noteStood(site, 'boat', at)
    moored += 1
  }
}

/**
 * The chair lift: down a mountain's slope from its peak toward a city,
 * where the slope will take it, the mountains without an observatory
 * tried first.
 */
export function raiseLifts(site: Site, mountains: readonly SphereMountain[], cities: readonly WorldDistrict[]): void {
  if (cities.length === 0) return
  const { radius } = site
  const domes = site.buildings.filter((raised) => raised.kind === 'observatory')
  const crowned = (mountain: SphereMountain): boolean => domes.some((dome) => intoMountain(mountain, dome.spot.at, radius) >= 0)
  const tried = [...mountains].sort((a, b) => Number(crowned(a)) - Number(crowned(b)))
  let lifts = 0
  for (const mountain of tried) {
    if (lifts >= LIFTS_MOST) break
    const peak = peakOf(site, mountain)
    if (peak === null) continue
    const nearest = [...cities].sort((a, b) => angleBetween(a.center, peak) - angleBetween(b.center, peak))
    for (const city of nearest) {
      if (lifts >= LIFTS_MOST) break
      if (raiseLift(site, peak, city)) lifts += 1
    }
  }
}

function raiseLift(site: Site, peak: Vec3, city: WorldDistrict): boolean {
  const { land, placed, radius, rng } = site
  // The way from the peak toward the city, along the ground.
  const toward = chordWay(peak, city.center)
  const way = carryAxis(toward, peak)
  const at = (down: number): Vec3 => along(peak, way, down, radius)
  const heightAlong = (down: number): number => heightAt(land, at(down))
  // Down the slope toward the city to where it eases off, or gets wet.
  let foot = -1
  for (let down = LIFT_FOOT.stretch; down <= LIFT_FOOT.mostDown; down += LIFT_FOOT.step) {
    const p = at(down)
    if (site.wet(p) || heightAt(land, p) <= land.seaLevel) break
    if ((heightAlong(down - LIFT_FOOT.stretch) - heightAlong(down)) / LIFT_FOOT.stretch < LIFT_FOOT.grade) {
      foot = down
      break
    }
  }
  if (foot < 0) return false
  const spotAt = (down: number, width: number, depth: number): Spot => {
    const p = at(down)
    return { at: p, u: carryAxis(chordWay(at(down - 0.5), at(down + 0.5)), p), width, depth }
  }
  const bottomDown = foot - LIFT_ENDS.aboveFoot
  const bottom = spotAt(bottomDown, LIFT_STATION.width, LIFT_STATION.depth)
  const top = spotAt(LIFT_ENDS.belowPeak, LIFT_STATION.width, LIFT_STATION.depth)
  const length = bottomDown - LIFT_ENDS.belowPeak
  const rise = heightAt(land, top.at) - heightAt(land, bottom.at)
  if (length < PYLON.spacing * (PYLON.least + 1) || rise / length < LIFT_GRADE.min || rise / length > LIFT_GRADE.max) return false
  const bottomGround = standsHere(site, bottom, LIFT_ROAD_MARGIN, LIFT_STATION_RELIEF, FURNITURE_GAP)
  const topGround = standsHere(site, top, LIFT_ROAD_MARGIN, LIFT_STATION_RELIEF, FURNITURE_GAP)
  if (bottomGround === null || topGround === null) return false
  // The pylons, up the line from the bottom station, each standing higher than the one below it.
  const pylons: { spot: Spot; ground: { low: number; high: number } }[] = []
  let below = -Infinity
  for (let up = PYLON.spacing; up < length - PYLON.spacing / 2; up += PYLON.spacing) {
    const spot = spotAt(bottomDown - up, PYLON.size, PYLON.size)
    const ground = standsHere(site, spot, LIFT_ROAD_MARGIN, PYLON_RELIEF, FURNITURE_GAP)
    if (ground === null || ground.high <= below) return false
    pylons.push({ spot, ground })
    below = ground.high
  }
  if (pylons.length < PYLON.least) return false
  if (topGround.high + LIFT_STATION.height <= below + PYLON.height) return false
  // The cable's way between must cross no road.
  for (let up = 0; up <= length; up += 8) if (!site.clear(spotAt(bottomDown - up, 4, 4), LIFT_ROAD_MARGIN)) return false
  for (const [station, ground] of [
    [bottom, bottomGround],
    [top, topGround],
  ] as const) {
    placed.add(station)
    raise(site, 'station', station, ground, LIFT_STATION.height, rng())
  }
  for (const [k, pylon] of pylons.entries()) {
    placed.add(pylon.spot)
    // The tone counts the pylons up the line, for whoever strings the cable.
    raise(site, 'pylon', pylon.spot, pylon.ground, PYLON.height, (k + 1) / (pylons.length + 1))
  }
  return true
}

/** The nearest point of any of these roads to a way out, at grade, and how far off it is. */
function nearestRoadPoint(site: Site, roads: readonly WorldRoad[], p: Vec3): { road: WorldRoad; index: number; distance: number } | null {
  let best: { road: WorldRoad; index: number; distance: number } | null = null
  for (const road of roads) {
    const segments = road.closed ? road.points.length : road.points.length - 1
    for (let i = 0; i < segments; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const distance = angleBetween(unit(road.points[i]!), p) * site.radius
      if (best !== null && distance >= best.distance) continue
      best = { road, index: i, distance }
    }
  }
  return best
}

/**
 * A church for every village: where the houses along a road stand
 * thickest, a nave broadside to the road, set back behind a green with trees
 * on it, and a tower at one end of the nave. The thickest cluster first,
 * then the next far enough from every church so far.
 */
export function raiseChurches(site: Site, plant: Planter): void {
  const { rng, placed, radius } = site
  const houses = site.buildings.filter((raised) => HOUSE_KINDS.includes(raised.kind))
  const clusters = houses
    .map((house, index) => ({ house, index, near: houses.filter((other) => angleBetween(other.spot.at, house.spot.at) * radius < VILLAGE_REACH).length }))
    .filter((cluster) => cluster.near >= VILLAGE_HOUSES)
    .sort((a, b) => b.near - a.near || a.index - b.index)
  const roads = mainRoads(site.roads)
  const churches: Vec3[] = []
  const farFromChurches = (p: Vec3): boolean => churches.every((church) => angleBetween(church, p) * radius >= CHURCH_APART)
  for (const { house } of clusters) {
    if (churches.length >= CHURCHES_MOST) break
    if (!farFromChurches(house.spot.at)) continue
    const beside = nearestRoadPoint(site, roads, house.spot.at)
    if (beside === null) continue
    const { road, index } = beside
    const point = unit(road.points[index]!)
    const { ahead, left } = roadFrameAt(road, index)
    for (const side of [1, -1]) {
      const back = road.widths[0]! / 2 + CHURCH_SETBACK + NAVE.depth / 2
      const naveAt = along(point, left, side * back, radius)
      const nave: Spot = { at: naveAt, u: carryAxis(ahead, naveAt), width: NAVE.width, depth: NAVE.depth }
      // Kept apart where the church itself stands, which is off by the road rather than at the house it was found by.
      if (!farFromChurches(nave.at)) continue
      const naveGround = standsHere(site, nave, ROAD_MARGIN, HOUSE_RELIEF + 1, FURNITURE_GAP)
      if (naveGround === null) continue
      const steeple = besideSpot(site, nave, NAVE.width / 2 + TOWER.size / 2 + 0.2, 0, TOWER.size, TOWER.size)
      const towerGround = standsHere(site, steeple, ROAD_MARGIN, HOUSE_RELIEF + 1, FURNITURE_GAP)
      if (towerGround === null) continue
      placed.add(nave)
      placed.add(steeple)
      const tone = rng()
      raise(site, 'church', nave, naveGround, NAVE.height, tone)
      raise(site, 'steeple', steeple, towerGround, TOWER.height, tone)
      // The green between the road and the nave, kept open, with trees at its ends.
      const greenAt = along(point, left, side * (road.widths[0]! / 2 + CHURCH_SETBACK / 2), radius)
      const green: Spot = { at: greenAt, u: carryAxis(ahead, greenAt), width: NAVE.width + TOWER.size, depth: CHURCH_SETBACK - 2 }
      for (let k = 0; k < GREEN_TREES; k++) {
        const end = (k % 2 === 0 ? 1 : -1) * (green.width / 2 - 1)
        const off = (k < 2 ? -1 : 1) * (green.depth / 4)
        plant(onSpot(site, green, end, off), 'tree')
      }
      if (!placed.meets(green, 0)) placed.add(green)
      churches.push(nave.at)
      break
    }
  }
}

/** A water tower at the edge of each suburb, on the first spot of a few tried that will take one. */
export function raiseWaterTowers(site: Site, cities: readonly WorldDistrict[]): void {
  const { rng, placed, radius } = site
  for (const city of cities) {
    const ring = city.radius + city.suburbWidth - WATER_TOWER_IN
    const frame = localAt(city.center, radius)
    for (let attempt = 0; attempt < WATER_TOWER_TRIES; attempt++) {
      const angle = randomRange(rng, 0, Math.PI * 2)
      const p = fromFrame(frame, cos(angle) * ring, sin(angle) * ring)
      if (districtAt(site.land, p) !== DISTRICT_SUBURB) continue
      if (!farFromKind(site, 'watertower', p, WATER_TOWERS_APART)) continue
      // Nothing under the tank, though only the column is anything to hit.
      const under: Spot = { at: p, u: axisAt(p, 0), width: WATER_TOWER.tank, depth: WATER_TOWER.tank }
      const ground = standsHere(site, under, ROAD_MARGIN, HOUSE_RELIEF, FURNITURE_GAP)
      if (ground === null) continue
      placed.add(under)
      raise(site, 'watertower', { ...under, width: WATER_TOWER.column, depth: WATER_TOWER.column }, ground, WATER_TOWER.height)
      noteStood(site, 'watertower', p)
      break
    }
  }
}

/**
 * Camp sites in the country near a road: a clearing with a fire in the
 * middle, tents on a ring round it turned to face it, a couple of campers
 * off to one side, and trees round the rim.
 */
export function pitchCamps(site: Site, rng: () => number, plant: Planter): void {
  const { land, placed, radius } = site
  const roads = mainRoads(site.roads)
  let camps = 0
  for (let attempt = 0; attempt < CAMP_TRIES && camps < CAMPS_MOST; attempt++) {
    // Off to one side of a main road, as far out as a camp keeps from one, in the open country.
    const road = roads[Math.floor(rng() * roads.length)]
    if (road === undefined || road.points.length < 2) continue
    const index = Math.floor(rng() * road.points.length)
    const { left } = roadFrameAt(road, index)
    const offset = (rng() < 0.5 ? -1 : 1) * randomRange(rng, CAMP_NEAR_ROAD.min, CAMP_NEAR_ROAD.max)
    const middle = along(unit(road.points[index]!), left, offset, radius)
    if (districtAt(land, middle) !== DISTRICT_COUNTRY || site.wet(middle)) continue
    if (!farFromKind(site, 'camp', middle, FEATURE_APART)) continue
    const beside = nearestRoadPoint(site, roads, middle)
    if (beside === null || beside.distance < CAMP_NEAR_ROAD.min || beside.distance > CAMP_NEAR_ROAD.max) continue
    const clearing: Spot = { at: middle, u: axisAt(middle, 0), width: CLEARING_RADIUS * 2, depth: CLEARING_RADIUS * 2 }
    if (standsHere(site, clearing, 1, FIELD_RELIEF, FURNITURE_GAP) === null) continue
    const frame = localAt(middle, radius)
    const pit: Spot = { at: middle, u: axisAt(middle, rng() * Math.PI), width: FIRE_PIT.size, depth: FIRE_PIT.size }
    const tents: Spot[] = []
    for (let k = 0; k < TENTS; k++) {
      const angle = (k * Math.PI * 2) / TENTS + randomRange(rng, -0.2, 0.2)
      const p = fromFrame(frame, cos(angle) * TENT_RING, sin(angle) * TENT_RING)
      // Its door to the fire: broadside to the middle.
      tents.push({ at: p, u: axisOn(frame, -(angle + Math.PI / 2), p), width: TENT.width, depth: TENT.depth })
    }
    // The campers parked side by side along the rim, nose to the fire.
    const parking = randomRange(rng, 0, Math.PI * 2)
    const campers: Spot[] = []
    for (let k = 0; k < CAMPERS; k++) {
      const angle = parking + k * 0.8
      const p = fromFrame(frame, cos(angle) * (CLEARING_RADIUS - 5), sin(angle) * (CLEARING_RADIUS - 5))
      campers.push({ at: p, u: axisOn(frame, -(angle + Math.PI / 2), p), width: CAMPER.width, depth: CAMPER.depth })
    }
    // A camp is pitched whole or not at all: a clearing by a river can reach the water at its rim.
    if ([pit, ...tents, ...campers].some((spot) => groundUnder(land, site.wet, spot).wet)) continue
    // The camps throw their own dice for their tones too.
    raise(site, 'firepit', pit, groundUnder(land, site.wet, pit), FIRE_PIT.height, rng())
    for (const tent of tents) raise(site, 'tent', tent, groundUnder(land, site.wet, tent), TENT.height, rng())
    for (const camper of campers) raise(site, 'camper', camper, groundUnder(land, site.wet, camper), CAMPER.height, rng())
    for (let k = 0; k < RIM_TREES; k++) {
      const angle = (k * Math.PI * 2) / RIM_TREES
      plant(fromFrame(frame, cos(angle) * (CLEARING_RADIUS - 1), sin(angle) * (CLEARING_RADIUS - 1)), 'tree')
    }
    placed.add(clearing)
    noteStood(site, 'camp', middle)
    camps += 1
  }
}
