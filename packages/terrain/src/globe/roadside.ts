/**
 * What stands beside a planet's main roads: kickers on the shoulders out
 * of the cities, filling stations and roadworks through the suburbs, houses
 * with their gardens through the suburbs and now and then out in the
 * country, trees along the country stretches and the city shoulders, and
 * the parks inside the interchanges.
 */

import { randomInt, randomRange, type Vec3 } from '@buggies/physics'

import { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB } from '../districts.ts'
import { ROAD_BRIDGE, ROAD_GRADE } from '../roads/constants.ts'
import type { WorldRoad } from '../world.ts'
import { tangentFrame } from '../sphere-heights.ts'
import { fromFrame, toFrame } from './frame.ts'
import { along, angleBetween, lift, unit } from './lines.ts'
import { districtAt, heightAt, insideRing, spotFrame, turnOf, type Clearance, type Spot } from './placing.ts'
import { roadFrameAt } from './rails.ts'
import { raiseStatue } from './city.ts'
import { prop, raise, standsHere, worldField, type Planter, type Site } from './site.ts'
import {
  BUILDING_GAP,
  CANOPY,
  CITY_SHOULDER_SPACING,
  CITY_VERGE_SETBACK,
  CLEARING,
  COTTAGE_DEPTH,
  COTTAGE_HEIGHT,
  COTTAGE_WIDTH,
  COUNTRY_HOUSE_SPACING,
  GARDEN_SHRUBS,
  GARDEN_TREES,
  HOUSE_DEPTH,
  HOUSE_HEIGHT,
  HOUSE_RELIEF,
  HOUSE_SETBACK,
  HOUSE_STYLES,
  HOUSE_WIDTH,
  INTERCHANGE_SHRUBS,
  INTERCHANGE_TREES,
  PARK_TRIES,
  POST,
  RAMP_LANDING,
  RAMP_LENGTH,
  RAMP_RELIEF,
  RAMP_RISE,
  RAMP_SHOULDER,
  RAMP_SPACING,
  RAMP_WIDTH,
  ROAD_MARGIN,
  ROADWORKS,
  SHOP,
  SIGN,
  STATION_APART,
  STATION_BARRELS,
  STATION_LOT,
  STATION_RELIEF,
  STATUE,
  SUBURB_SPACING,
  TREE_BACK_SETBACK,
  TREE_GAP_ODDS,
  TREE_RADIUS,
  TREE_SETBACK,
  TREE_SPACING,
  VILLA_DEPTH,
  VILLA_HEIGHT,
  VILLA_WIDTH,
  FURNITURE_GAP,
} from './sizes.ts'

/** A point this far out from a way out along a way across the ground, on a planet this big. */
function out(site: Site, from: Vec3, way: Vec3, distance: number): Vec3 {
  return distance >= 0 ? along(from, way, distance, site.radius) : along(from, { x: -way.x, y: -way.y, z: -way.z }, -distance, site.radius)
}

/** How far along the ground from one of a road's points to the next. */
function step(site: Site, a: Vec3, b: Vec3): number {
  return angleBetween(unit(a), unit(b)) * site.radius
}

/** The main roads: what runs between and through the towns, as opposed to the streets of a city. */
export function mainRoads(roads: readonly WorldRoad[]): WorldRoad[] {
  return roads.filter((road) => road.kind === 'arterial' || road.kind === 'cross' || road.kind === 'highway')
}

/**
 * Stand kickers on the shoulders of the arterials and cross roads, out of
 * the cities: every so often, on one side or the other, running along the
 * road one way or the other, where the shoulder is level enough and its
 * landing strip beyond the lip is free.
 */
export function lineRamps(site: Site): void {
  const { rng, land, placed, radius } = site
  for (const road of site.roads) {
    if (road.kind !== 'arterial' && road.kind !== 'cross') continue
    const { points } = road
    const width = road.widths[0]!
    let traveled = 0
    let next = randomRange(rng, RAMP_SPACING.min / 2, RAMP_SPACING.max / 2)
    for (let i = 1; i < points.length; i++) {
      traveled += step(site, points[i - 1]!, points[i]!)
      if (traveled < next) continue
      next = traveled + randomRange(rng, RAMP_SPACING.min, RAMP_SPACING.max)
      if (road.structure[i - 1] !== ROAD_GRADE || road.structure[Math.min(i, points.length - 2)] !== ROAD_GRADE) continue
      const side = randomInt(rng, 1, 2) === 1 ? 1 : -1
      const way = randomInt(rng, 1, 2) === 1 ? 1 : -1
      const { ahead, left } = roadFrameAt(road, i)
      const middle = out(site, unit(points[i]!), left, side * (width / 2 + RAMP_SHOULDER + RAMP_WIDTH / 2))
      if (districtAt(land, middle) === DISTRICT_CITY) continue
      const frame = spotFrame(middle, ahead, radius)
      const foot = fromFrame(frame, (-way * RAMP_LENGTH) / 2, 0)
      const lip = fromFrame(frame, (way * RAMP_LENGTH) / 2, 0)
      if (site.wet(foot) || site.wet(lip)) continue
      const bottom = heightAt(land, foot)
      if (Math.abs(heightAt(land, lip) - bottom) > RAMP_RELIEF) continue
      const spot: Spot = { at: middle, u: ahead, width: RAMP_LENGTH, depth: RAMP_WIDTH }
      // The landing strip: the shoulder beyond the lip, kept free of houses and trees.
      const landing: Spot = { at: fromFrame(frame, way * (RAMP_LENGTH / 2 + RAMP_LANDING / 2), 0), u: ahead, width: RAMP_LANDING, depth: RAMP_WIDTH + 2 }
      if (!site.clear(spot, 0) || placed.meets(spot, BUILDING_GAP)) continue
      if (placed.meets(landing, 0)) continue
      placed.add(spot)
      placed.add(landing)
      // Climbing along its own z, the way along the road it runs: its x is that crossed with the way up.
      const climb = way > 0 ? ahead : { x: -ahead.x, y: -ahead.y, z: -ahead.z }
      const x = { x: foot.y * climb.z - foot.z * climb.y, y: foot.z * climb.x - foot.x * climb.z, z: foot.x * climb.y - foot.y * climb.x }
      site.ramps.push({ at: lift(foot, radius, bottom), turn: turnOf(foot, unit(x)), width: RAMP_WIDTH, length: RAMP_LENGTH, rise: RAMP_RISE })
    }
  }
}

/**
 * Line the arterials with what belongs beside them: houses through the
 * suburbs, and trees with the occasional house through the country, and
 * trees along the shoulders through the cities with a statue where an
 * arterial comes in. Slots are walked along each road on both sides.
 */
export function lineArterials(site: Site, clear: Clearance, plant: Planter): void {
  const { rng, land, placed, radius } = site
  const clearings: Vec3[] = []
  const inClearing = (p: Vec3): boolean => clearings.some((house) => angleBetween(house, p) * radius < CLEARING)

  /** A house beside the road at this point, facing it, if it fits there in `zone`. */
  const placeHouse = (road: WorldRoad, index: number, side: number, zone: number): Vec3 | null => {
    const { ahead, left } = roadFrameAt(road, index)
    const kind = HOUSE_STYLES[Math.floor(rng() * HOUSE_STYLES.length)] ?? 'house'
    const [widths, depths, heights] = kind === 'cottage' ? [COTTAGE_WIDTH, COTTAGE_DEPTH, COTTAGE_HEIGHT] : kind === 'villa' ? [VILLA_WIDTH, VILLA_DEPTH, VILLA_HEIGHT] : [HOUSE_WIDTH, HOUSE_DEPTH, HOUSE_HEIGHT]
    const houseWidth = randomRange(rng, widths.min, widths.max)
    const houseDepth = randomRange(rng, depths.min, depths.max)
    const height = randomRange(rng, heights.min, heights.max)
    const tone = rng()
    const setback = road.widths[0]! / 2 + randomRange(rng, HOUSE_SETBACK.min, HOUSE_SETBACK.max) + houseDepth / 2
    const at = out(site, unit(road.points[index]!), left, side * setback)
    // Broadside to the road: its x along it.
    const spot: Spot = { at, u: ahead, width: houseWidth, depth: houseDepth }
    if (districtAt(land, at) !== zone) return null
    const ground = standsHere(site, spot, ROAD_MARGIN, HOUSE_RELIEF, BUILDING_GAP)
    if (ground === null || !clear(spot, ROAD_MARGIN)) return null
    placed.add(spot)
    raise(site, kind, spot, ground, height, tone)
    // A garden: shrubs along the front, between the house and the road, and a tree or two behind it.
    const frame = spotFrame(at, ahead, radius)
    // The house's second axis runs to the road's left, so the road lies toward -side along it.
    for (let k = randomInt(rng, GARDEN_SHRUBS.min, GARDEN_SHRUBS.max); k > 0; k--) {
      const along = randomRange(rng, -houseWidth / 2, houseWidth / 2)
      plant(fromFrame(frame, along, -side * (houseDepth / 2 + 1.5)), 'shrub')
    }
    for (let k = randomInt(rng, GARDEN_TREES.min, GARDEN_TREES.max); k > 0; k--) {
      const along = randomRange(rng, -houseWidth / 2, houseWidth / 2)
      plant(fromFrame(frame, along, side * (houseDepth / 2 + TREE_RADIUS.max + randomRange(rng, 1, 6))), 'tree')
    }
    return at
  }
  /** A tree beside the road at this point, `setback` from its edge, if the ground there is free. */
  const placeTree = (road: WorldRoad, index: number, side: number, setback: number): void => {
    const { left } = roadFrameAt(road, index)
    const at = out(site, unit(road.points[index]!), left, side * (road.widths[0]! / 2 + setback))
    if (districtAt(land, at) !== DISTRICT_COUNTRY || inClearing(at)) return
    plant(at, 'tree')
  }

  for (const road of mainRoads(site.roads)) {
    const highway = road.kind === 'highway'
    const { points } = road
    const width = road.widths[0]!
    for (const side of [1, -1]) {
      let traveled = 0
      let nextSlot = 0
      let nextHouse = randomRange(rng, COUNTRY_HOUSE_SPACING.min, COUNTRY_HOUSE_SPACING.max)
      let owed = false
      let inCity = false
      for (let i = 1; i < points.length; i++) {
        traveled += step(site, points[i - 1]!, points[i]!)
        if (traveled < nextSlot) continue
        // Nothing beside a bridge: there is a river or a valley there.
        if (road.structure[i - 1] === ROAD_BRIDGE || road.structure[Math.min(i, points.length - 2)] === ROAD_BRIDGE) {
          nextSlot = traveled + TREE_SPACING.min
          continue
        }
        const { ahead, left } = roadFrameAt(road, i)
        const here = unit(points[i]!)
        const beside = districtAt(land, out(site, here, left, side * width))
        if (beside === DISTRICT_CITY && !inCity && road.kind === 'arterial') owed = true
        inCity = beside === DISTRICT_CITY
        if (beside === DISTRICT_CITY) {
          // Through the city: trees along the shoulder, and a statue where an arterial comes in, just beyond the trees' line.
          const verge = width / 2 + CITY_VERGE_SETBACK
          const statue: Spot = { at: out(site, here, left, side * (verge + STATUE.shoulderOut)), u: ahead, width: STATUE.width, depth: STATUE.width }
          if (owed && districtAt(land, statue.at) === DISTRICT_CITY) {
            owed = false
            if (raiseStatue(site, statue)) {
              nextSlot = traveled + CITY_SHOULDER_SPACING
              continue
            }
          }
          plant(out(site, here, left, side * verge), 'tree')
          nextSlot = traveled + CITY_SHOULDER_SPACING
        } else if (highway) {
          nextSlot = traveled + TREE_SPACING.max
        } else if (beside === DISTRICT_SUBURB) {
          placeHouse(road, i, side, DISTRICT_SUBURB)
          nextSlot = traveled + randomRange(rng, SUBURB_SPACING.min, SUBURB_SPACING.max)
        } else if (beside === DISTRICT_COUNTRY) {
          if (traveled >= nextHouse) {
            const house = placeHouse(road, i, side, DISTRICT_COUNTRY)
            if (house !== null) clearings.push(house)
            nextHouse = traveled + randomRange(rng, COUNTRY_HOUSE_SPACING.min, COUNTRY_HOUSE_SPACING.max)
            nextSlot = traveled + TREE_SPACING.max
          } else {
            if (randomInt(rng, 1, TREE_GAP_ODDS) !== 1) placeTree(road, i, side, randomRange(rng, TREE_SETBACK.min, TREE_SETBACK.max))
            if (randomInt(rng, 1, 2) === 1) placeTree(road, i, side, randomRange(rng, TREE_BACK_SETBACK.min, TREE_BACK_SETBACK.max))
            nextSlot = traveled + randomRange(rng, TREE_SPACING.min, TREE_SPACING.max)
          }
        } else {
          nextSlot = traveled + TREE_SPACING.max
        }
        if (beside !== DISTRICT_CITY) owed = false
      }
    }
  }
}

/**
 * Filling stations along the suburb stretches of the main roads, one every
 * so far: a paved lot against the road, the shop at the back of it, a
 * canopy on four posts over the pumps, and a sign at the roadside corner.
 */
export function raiseStations(site: Site): void {
  const { rng, land, placed, radius } = site
  const stations: Vec3[] = []
  for (const road of mainRoads(site.roads)) {
    const { points } = road
    const segments = road.closed ? points.length : points.length - 1
    let traveled = randomRange(rng, 0, STATION_APART)
    for (let index = 1; index < segments; index++) {
      traveled += step(site, points[index - 1]!, points[index]!)
      if (traveled < STATION_APART || road.structure[index] !== ROAD_GRADE) continue
      const here = unit(points[index]!)
      if (districtAt(land, here) !== DISTRICT_SUBURB) continue
      if (stations.some((station) => angleBetween(station, here) * radius < STATION_APART)) continue
      const { ahead, left } = roadFrameAt(road, index)
      for (const side of [1, -1]) {
        const lot: Spot = { at: out(site, here, left, side * (road.widths[0]! / 2 + STATION_LOT.depth / 2 + 0.5)), u: ahead, ...STATION_LOT }
        if (districtAt(land, lot.at) !== DISTRICT_SUBURB) continue
        const ground = standsHere(site, lot, 0.5, STATION_RELIEF, FURNITURE_GAP)
        if (ground === null) continue
        placed.add(lot)
        worldField(site, 'asphalt', lot, 0)
        // In from the road: the lot's second axis runs to the road's left, away from it on that side.
        const frame = spotFrame(lot.at, ahead, radius)
        const at = (alongRoad: number, inward: number): Vec3 => fromFrame(frame, alongRoad, side * inward)
        // Whatever stands on the lot is buried like a house; the canopy floats over the highest ground under the lot, and its posts reach up to it.
        const stand = (kind: 'shop' | 'canopy' | 'post' | 'sign', p: Vec3, width: number, depth: number, over: number, height: number): void => {
          const spot: Spot = { at: p, u: ahead, width, depth }
          if (over > 0) site.buildings.push({ kind, spot, bottom: ground.high + over, top: ground.high + over + height, tone: rng() })
          else raise(site, kind, spot, ground, height)
        }
        stand('shop', at(0, STATION_LOT.depth / 2 - SHOP.depth / 2 - 1), SHOP.width, SHOP.depth, 0, SHOP.height)
        stand('canopy', at(0, -2), CANOPY.width, CANOPY.depth, CANOPY.over, CANOPY.thick)
        for (const cu of [-1, 1]) {
          for (const cv of [-1, 1]) stand('post', at(cu * (CANOPY.width / 2 - 0.6), -2 + cv * (CANOPY.depth / 2 - 0.6)), POST, POST, 0, CANOPY.over)
        }
        stand('sign', at(STATION_LOT.width / 2 - 2, -(STATION_LOT.depth / 2 - 1.5)), SIGN.width, SIGN.depth, 0, SIGN.height)
        // Barrels in a row beside the shop, along the back of the lot.
        for (let k = 0; k < STATION_BARRELS; k++) prop(site, 'barrel', at(SHOP.width / 2 + 1 + k * 0.8, STATION_LOT.depth / 2 - SHOP.depth / 2 - 1), ahead)
        stations.push(lot.at)
        traveled = 0
        break
      }
    }
  }
}

/** Roadworks along the suburb stretches of the main roads, every so far: a line of cones down one edge of the roadway. */
export function coneOffRoadworks(site: Site): void {
  const rng = site.propRng
  for (const road of mainRoads(site.roads)) {
    if (road.kind === 'highway') continue
    const { points } = road
    const segments = road.closed ? points.length : points.length - 1
    let traveled = randomRange(rng, 0, ROADWORKS.every)
    for (let index = 1; index < segments; index++) {
      traveled += step(site, points[index - 1]!, points[index]!)
      if (traveled < ROADWORKS.every || road.structure[index] !== ROAD_GRADE) continue
      if (districtAt(site.land, unit(points[index]!)) !== DISTRICT_SUBURB) continue
      const side = rng() < 0.5 ? 1 : -1
      const edge = road.widths[0]! / 2 - 0.6
      // Each cone is walked on along the road from the last, so a line of them follows a bend.
      let at = index
      let left = 0
      for (let k = 0; k < ROADWORKS.cones; k++) {
        while (left > 0 && at + 1 < segments) {
          const length = step(site, points[at]!, points[at + 1]!)
          if (length > left) break
          left -= length
          at += 1
        }
        if (at + 1 >= points.length || left > step(site, points[at]!, points[at + 1]!)) break
        const frame = roadFrameAt(road, at)
        const base = along(unit(points[at]!), frame.ahead, left, site.radius)
        prop(site, 'cone', out(site, base, frame.left, side * edge), frame.ahead)
        left += ROADWORKS.apart
      }
      traveled = 0
    }
  }
}

/** The ground each interchange's ramps enclose, as a park: trees and shrubs scattered over it, as many as will stand. */
export function plantInterchanges(site: Site, plant: Planter): void {
  const { rng, radius } = site
  for (const ring of site.zones) {
    const middle = unit(ring.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y, z: sum.z + p.z }), { x: 0, y: 0, z: 0 }))
    const frame = spotFrame(middle, tangentFrame(middle).east, radius)
    const flat = ring.map((p) => toFrame(frame, p))
    const minX = Math.min(...flat.map((p) => p.x))
    const maxX = Math.max(...flat.map((p) => p.x))
    const minZ = Math.min(...flat.map((p) => p.z))
    const maxZ = Math.max(...flat.map((p) => p.z))
    const area = ((maxX - minX) * (maxZ - minZ)) / 100
    for (const [kind, thick] of [
      ['tree', INTERCHANGE_TREES],
      ['shrub', INTERCHANGE_SHRUBS],
    ] as const) {
      for (let k = 0; k < Math.round(area * thick) * PARK_TRIES; k++) {
        const p = fromFrame(frame, randomRange(rng, minX, maxX), randomRange(rng, minZ, maxZ))
        if (insideRing(ring, p, radius)) plant(p, kind)
      }
    }
  }
}

