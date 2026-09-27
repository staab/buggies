/**
 * A planet's cities filled. Blocks lie between the circles its streets run
 * on, a sidewalk in from each; each is cut into a few lots, and each lot
 * gets a building, taller toward the heart of the city, unless a road runs
 * through it, the ground under it is wet or too steep, or it is left open:
 * a park, a parking lot, a building site with a crane, or the city square.
 */

import * as exact from '@buggies/physics'
import { randomInt, randomRange, type Rng, type Vec3 } from '@buggies/physics'

import { DISTRICT_CITY } from '../sphere-districts.ts'
import { STREET_CURB, STREET_SPACING, STREET_WIDTH } from '../roads/constants.ts'
import type { WorldDistrict, WorldRoad } from '../world.ts'
import { angleBetween, lift, unit } from './lines.ts'
import { districtAt, groundUnder, heightAt, spotFrame, turnOf, type Clearance, type Spot } from './placing.ts'
import { fromFrame } from './frame.ts'
import { SegmentIndex, nearestOn } from './segments.ts'
import { prop, raise, worldField, type Planter, type Raised, type Site } from './site.ts'
import {
  BLOCK_HEIGHT,
  BLOCK_RELIEF,
  BUILDING_GAP,
  BURY,
  CLOCK_TOWER,
  CRANE_BASE,
  CRANE_HEIGHT_LEAST,
  CRANE_OVER,
  CRANE_REACH,
  FENCE_HEIGHT,
  FENCE_INSET,
  FOUNTAIN,
  HOUSE_RELIEF,
  LOT_INSET,
  LOT_MIN,
  PARK_LOT_ODDS,
  PARK_SHRUBS,
  PARK_TREES,
  PARK_TRIES,
  PARKING_LOT_ODDS,
  ROAD_MARGIN,
  SHRUB_RADIUS,
  SIDEWALK,
  SIDEWALK_ALONG_RELIEF,
  SIDEWALK_BAND,
  SIDEWALK_CROSS_RELIEF,
  SIDEWALK_SAMPLE,
  SITE_CORE,
  SITE_CRATES,
  SITE_ODDS,
  SITES_MOST,
  SQUARE_CORE,
  STATUE,
  STORY,
  STREET_TREE_HEIGHT,
  STREET_TREE_RADIUS,
  STREET_TREE_SPACING,
  TOWER_FLOOR,
  TOWER_HEIGHT,
  TREE_RADIUS,
} from './sizes.ts'
import { gridAxis, gridPoint, type Grid } from './streets.ts'

const { cos } = exact

/** Whole stories, never fewer than the least. */
function stories(height: number): number {
  return Math.max(STORY * Math.round(height / STORY), BLOCK_HEIGHT.min)
}

/** Cut a span into lots, as many as leave each at least `LOT_MIN` wide, each cut placed at random within the room it has. */
function cutLots(rng: Rng, from: number, to: number): [number, number][] {
  const span = to - from
  const most = Math.floor(span / LOT_MIN)
  if (most < 1) return []
  const count = randomInt(rng, Math.min(2, most), Math.min(3, most))
  const lots: [number, number][] = []
  let start = from
  for (let k = 0; k < count; k++) {
    const left = count - k - 1
    const end = k === count - 1 ? to : randomRange(rng, start + LOT_MIN, to - left * LOT_MIN)
    lots.push([start, end])
    start = end
  }
  return lots
}

/** A statue on its plinth at a spot, where the ground is free and dry. */
export function raiseStatue(site: Site, spot: Spot): boolean {
  if (!site.clear(spot, ROAD_MARGIN) || !site.offStreets(spot, 0) || site.placed.meets(spot, 0)) return false
  const ground = groundUnder(site.land, site.wet, spot)
  if (ground.wet || ground.high - ground.low > HOUSE_RELIEF) return false
  site.placed.add(spot)
  raise(site, 'statue', spot, ground, STATUE.height)
  return true
}

/**
 * Fill every city's blocks. `grids` are the cities' street grids, one for
 * each of `cities` where it has one; `offStreets` keeps a lot off a
 * street's whole roadway.
 */
export function fillCities(
  site: Site,
  cities: readonly WorldDistrict[],
  grids: readonly (Grid | null)[],
  streets: readonly WorldRoad[],
  offStreets: Clearance,
  plant: Planter,
): void {
  const { rng, land, radius, placed } = site
  const inCity = (p: Vec3): boolean => districtAt(land, p) === DISTRICT_CITY
  // A point is on a street when it lies within the roadway of one.
  const onStreets = new SegmentIndex<number>(radius)
  for (const street of streets) {
    const line = street.points.map(unit)
    for (let i = 0; i + 1 < line.length; i++) onStreets.add(line[i]!, line[i + 1]!, street.widths[0]! / 2)
  }
  const onStreet = (p: Vec3): boolean => onStreets.around(p, STREET_WIDTH).some((segment) => nearestOn(p, segment.a, segment.b, radius).distance <= segment.data + 1)

  /** A street tree: its trunk on the sidewalk, needing only that much room, its crown over the street. */
  const plantStreetTree = (p: Vec3, u: Vec3): void => {
    const treeRadius = randomRange(rng, STREET_TREE_RADIUS.min, STREET_TREE_RADIUS.max)
    const height = randomRange(rng, STREET_TREE_HEIGHT.min, STREET_TREE_HEIGHT.max)
    const tone = rng()
    if (site.wet(p)) return
    const spot: Spot = { at: p, u, width: 1, depth: 1 }
    if (!site.clearOfRoads(spot, 0) || placed.meets(spot, 0)) return
    placed.add(spot)
    site.trees.push({ kind: 'tree', at: lift(p, radius, heightAt(land, p)), height, radius: treeRadius, tone })
  }
  /** Trees and shrubs scattered over a park lot, each far enough inside for its crown to stay in it, and a statue in the middle where there is room. */
  const plantPark = (lot: Spot): void => {
    const area = (lot.width * lot.depth) / 100
    if (lot.width >= 2 * STATUE.parkInset && lot.depth >= 2 * STATUE.parkInset) raiseStatue(site, { at: lot.at, u: lot.u, width: STATUE.width, depth: STATUE.width })
    const frame = spotFrame(lot.at, lot.u, radius)
    const somewhere = (inset: number): Vec3 | null => {
      if (lot.width < 2 * inset || lot.depth < 2 * inset) return null
      const u = randomRange(rng, -lot.width / 2 + inset, lot.width / 2 - inset)
      const v = randomRange(rng, -lot.depth / 2 + inset, lot.depth / 2 - inset)
      return fromFrame(frame, u, v)
    }
    for (let k = 0; k < Math.round(area * PARK_TREES) * PARK_TRIES; k++) {
      const at = somewhere(TREE_RADIUS.max)
      if (at) plant(at, 'tree')
    }
    for (let k = 0; k < Math.round(area * PARK_SHRUBS) * PARK_TRIES; k++) {
      const at = somewhere(SHRUB_RADIUS.max)
      if (at) plant(at, 'shrub')
    }
  }

  for (const [c, city] of cities.entries()) {
    const grid = grids[c]
    if (grid === null || grid === undefined) continue
    const point = (u: number, v: number): Vec3 => gridPoint(grid, u, v, radius)
    const axis = (u: number, v: number): Vec3 => gridAxis(grid, u, v, radius)
    // The lots are laid out from the old curb, whatever the street's width now: the sidewalk fills the difference.
    const edge = STREET_CURB + SIDEWALK
    const half = STREET_SPACING / 2 - STREET_WIDTH / 2
    const band = SIDEWALK_BAND
    const first = (value: number): number => Math.floor(value / STREET_SPACING) * STREET_SPACING
    const heartOf = (p: Vec3): number => 1 - (angleBetween(p, city.center) * radius) / city.radius
    const blocks: Raised[] = []
    const sites: Spot[] = []
    let squared = false
    for (let v0 = first(grid.vMin); v0 < grid.vMax; v0 += STREET_SPACING) {
      // The streets along the grid's first axis close in on each other away from its middle, as meridians do toward a pole:
      // a block is as wide as its streets are apart along its far side, and laid out that wide.
      const narrow = cos(Math.max(Math.abs(v0), Math.abs(v0 + STREET_SPACING)) / radius)
      for (let u0 = first(grid.uMin); u0 < grid.uMax; u0 += STREET_SPACING) {
        const blockU = u0 + STREET_SPACING / 2
        const blockV = v0 + STREET_SPACING / 2
        const block = point(blockU, blockV)
        /** The point of the block this far across it and down it from its middle, along the ground. */
        const at = (x: number, y: number): Vec3 => point(blockU + x / cos((blockV + y) / radius), blockV + y)
        /** A rectangle of the block, from its middle, turned with the grid. */
        const spotOf = (x: number, y: number, width: number, depth: number): Spot => {
          const u = blockU + x / cos((blockV + y) / radius)
          return { at: point(u, blockV + y), u: axis(u, blockV + y), width, depth }
        }
        const halfAcross = (STREET_SPACING / 2) * narrow - STREET_WIDTH / 2
        /**
         * Which sides of the block's sidewalk ring have only the block's own
         * streets beside them, round from the side at +y, and ground level
         * enough to lay a slab on.
         */
        const ringSides = (): [boolean, boolean, boolean, boolean] => {
          const gentle = (x: number, y: number, along: boolean): boolean => {
            let lastMiddle = Number.NaN
            const run = along ? halfAcross : half
            for (let t = -run; t <= run; t += SIDEWALK_SAMPLE) {
              const sx = along ? x + t : x
              const sy = along ? y : y + t
              const outer = heightAt(land, at(along ? sx : sx + Math.sign(x) * (band / 2), along ? sy + Math.sign(y) * (band / 2) : sy))
              const inner = heightAt(land, at(along ? sx : sx - Math.sign(x) * (band / 2), along ? sy - Math.sign(y) * (band / 2) : sy))
              const middle = heightAt(land, at(sx, sy))
              if (Math.abs(outer - inner) > SIDEWALK_CROSS_RELIEF) return false
              if (!Number.isNaN(lastMiddle) && Math.abs(middle - lastMiddle) > SIDEWALK_ALONG_RELIEF) return false
              lastMiddle = middle
            }
            return true
          }
          const sideClear = (x: number, y: number, along: boolean): boolean => {
            // Only inside the city, and only along a street that is there the whole side long.
            if (!inCity(at(x, y))) return false
            const run = along ? halfAcross : half
            for (const t of [-(run - 1), 0, run - 1]) {
              const street = along ? at(t, Math.sign(y) * (STREET_SPACING / 2)) : point(blockU + Math.sign(x) * (STREET_SPACING / 2), blockV + t)
              if (!onStreet(street)) return false
            }
            return gentle(x, y, along) && site.clear(spotOf(x, y, along ? 2 * halfAcross : band, along ? band : 2 * half), 0)
          }
          return [
            sideClear(0, half - band / 2, true),
            sideClear(-(halfAcross - band / 2), 0, false),
            sideClear(0, -(half - band / 2), true),
            sideClear(halfAcross - band / 2, 0, false),
          ]
        }
        // The ring is decided now, before the lots are cut, and laid only if something is built on the block.
        const sides = inCity(block) ? ringSides() : null
        let built = 0
        const lotsU = cutLots(rng, -(STREET_SPACING / 2) * narrow + edge, (STREET_SPACING / 2) * narrow - edge)
        const lotsV = cutLots(rng, -STREET_SPACING / 2 + edge, STREET_SPACING / 2 - edge)
        for (const [vFrom, vTo] of lotsV) {
          for (const [uFrom, uTo] of lotsU) {
            if (randomInt(rng, 1, PARK_LOT_ODDS) === 1) {
              const lot = spotOf((uFrom + uTo) / 2, (vFrom + vTo) / 2, uTo - uFrom, vTo - vFrom)
              if (!inCity(lot.at)) continue
              // An open lot: the city square, a building site near the heart, a parking lot, or a park.
              const heart = heartOf(lot.at)
              const open = site.clear(lot, 0) && offStreets(lot, 0) && !placed.meets(lot, 0)
              const ground = open ? groundUnder(land, site.wet, lot) : null
              const level = ground !== null && !ground.wet && ground.high - ground.low <= BLOCK_RELIEF
              if (level && heart >= SQUARE_CORE && !squared) {
                placed.add(lot)
                worldField(site, 'square', lot, 0)
                const basin: Spot = { ...lot, width: FOUNTAIN.width, depth: FOUNTAIN.width }
                raise(site, 'fountain', basin, groundUnder(land, site.wet, basin), FOUNTAIN.height)
                squared = true
                built += 1
                continue
              }
              if (level && heart >= SITE_CORE && sites.length < SITES_MOST && rng() < SITE_ODDS) {
                placed.add(lot)
                const fence: Spot = { ...lot, width: lot.width - 2 * FENCE_INSET, depth: lot.depth - 2 * FENCE_INSET }
                raise(site, 'site', fence, ground, FENCE_HEIGHT)
                sites.push(fence)
                // Crates along the strip between the fencing and the sidewalk.
                const frame = spotFrame(lot.at, lot.u, radius)
                for (let k = 0; k < SITE_CRATES; k++) {
                  const along = (k - (SITE_CRATES - 1) / 2) * 1.3
                  const out = fence.depth / 2 + FENCE_INSET / 2
                  prop(site, 'crate', fromFrame(frame, along, out), lot.u)
                }
                built += 1
                continue
              }
              if (level && rng() < PARKING_LOT_ODDS) {
                placed.add(lot)
                worldField(site, 'parkingLot', lot, 0)
                built += 1
                continue
              }
              plantPark(lot)
              continue
            }
            const insetU = randomRange(rng, LOT_INSET.min, LOT_INSET.max)
            const insetV = randomRange(rng, LOT_INSET.min, LOT_INSET.max)
            const spot = spotOf((uFrom + uTo) / 2, (vFrom + vTo) / 2, uTo - uFrom - 2 * insetU, vTo - vFrom - 2 * insetV)
            const core = Math.max(0, heartOf(spot.at))
            const height = stories(BLOCK_HEIGHT.min + rng() * BLOCK_HEIGHT.spread + Math.sqrt(core * core * core) * (TOWER_FLOOR + (1 - TOWER_FLOOR) * rng()) * TOWER_HEIGHT)
            const tone = rng()
            if (!inCity(spot.at)) continue
            if (!site.clear(spot, ROAD_MARGIN) || !offStreets(spot, 0)) continue
            const ground = groundUnder(land, site.wet, spot)
            if (ground.wet || ground.high - ground.low > BLOCK_RELIEF) continue
            if (placed.meets(spot, BUILDING_GAP)) continue
            placed.add(spot)
            blocks.push(raise(site, 'block', spot, ground, height, tone))
            built += 1
          }
        }
        if (sides === null || built === 0 || !sides.some((side) => side)) continue
        const ring = spotOf(0, 0, 2 * halfAcross, 2 * half)
        site.sidewalks.push({ at: lift(block, radius, heightAt(land, block)), turn: turnOf(ring.at, ring.u), halfWidth: halfAcross, halfDepth: half, band, sides })
        // Street trees along each laid side of the ring, down the middle of the sidewalk.
        for (const [k, laid] of sides.entries()) {
          if (!laid) continue
          const along = k === 0 || k === 2
          const run = (along ? halfAcross : half) - STREET_TREE_SPACING / 2
          const out = (along ? half : halfAcross) - band / 2
          for (let t = -run; t <= run + 1e-6; t += STREET_TREE_SPACING) {
            const x = along ? t : k === 1 ? -out : out
            const y = along ? (k === 0 ? out : -out) : t
            const spot = spotOf(x, y, 1, 1)
            plantStreetTree(spot.at, spot.u)
          }
        }
      }
    }
    // The clock tower takes over the block nearest the city's middle that is as big as it is, and stands above every block within its lookout.
    let nearest: Raised | null = null
    const fromMiddle = (raised: Raised): number => angleBetween(raised.spot.at, city.center) * radius
    for (const block of blocks) {
      if (Math.min(block.spot.width, block.spot.depth) < CLOCK_TOWER.width || fromMiddle(block) > CLOCK_TOWER.reach) continue
      if (nearest === null || fromMiddle(block) < fromMiddle(nearest)) nearest = block
    }
    if (nearest !== null) {
      let tallest = -Infinity
      for (const block of blocks) {
        if (block !== nearest && angleBetween(block.spot.at, nearest.spot.at) * radius <= CLOCK_TOWER.lookout) tallest = Math.max(tallest, block.top)
      }
      const spot: Spot = { ...nearest.spot, width: CLOCK_TOWER.width, depth: CLOCK_TOWER.width }
      const ground = groundUnder(land, site.wet, spot)
      Object.assign(nearest, { kind: 'clocktower', spot, bottom: ground.low - BURY, top: Math.max(ground.high + CLOCK_TOWER.height, tallest + CLOCK_TOWER.over), tone: rng() })
    }
    // A tower crane in the middle of each site, standing above every block near it.
    for (const fence of sites) {
      let tallest = -Infinity
      for (const block of blocks) {
        if (block.kind === 'block' && angleBetween(block.spot.at, fence.at) * radius <= CRANE_REACH) tallest = Math.max(tallest, block.top)
      }
      const base: Spot = { ...fence, width: CRANE_BASE, depth: CRANE_BASE }
      const ground = groundUnder(land, site.wet, base)
      site.buildings.push({ kind: 'crane', spot: base, bottom: ground.low - BURY, top: Math.max(ground.high + CRANE_HEIGHT_LEAST, tallest + CRANE_OVER), tone: rng() })
    }
  }
}

