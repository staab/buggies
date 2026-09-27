/**
 * A planet's wilds: woods and clearings over the open country and up the
 * foothills of the mountains, thinning to nothing on the bare heights, and a
 * lighter scatter through the suburbs; and on the bare heights and the
 * slopes too steep to grow on, rocks instead, boulders in fields of their
 * own and scree on the steep. Every spot is tried at random against a
 * density that follows the lie of the land, so the woods clump.
 */

import { randomRange, type Vec3 } from '@buggies/physics'

import { DISTRICT_COUNTRY, DISTRICT_SUBURB } from '../districts.ts'
import { triangleInradius } from '../mountain.ts'
import { fbm3D, smoothstep } from '../noise.ts'
import { createSphereGround } from '../sphere.ts'
import { tangentFrame, type SphereMountain } from '../sphere-heights.ts'
import { groundDirections } from '../sphere-water.ts'
import type { WorldRock } from '../world.ts'
import { along, angleBetween, lift } from './lines.ts'
import { riseOf } from './country.ts'
import { axisAt, districtAt, heightAt, turnOf, type Spot } from './placing.ts'
import type { Planter, Site } from './site.ts'
import {
  BOULDER_MAX_SLOPE,
  BOULDER_ODDS,
  BOULDER_SIZE,
  FOOTHILL,
  FOOTHILL_BOOST,
  LONE_SHRUBS,
  LONE_TREES,
  ROCK_BURY,
  ROCK_FIELD,
  ROCK_FREQUENCY,
  ROCK_ROAD_MARGIN,
  ROCK_SALT,
  SCREE_ODDS,
  SCREE_SIZE,
  SCREE_SLOPE,
  SUBURB_WOODS,
  TREELINE,
  WILD_MAX_SLOPE,
  WILD_SALT,
  WILD_SPACING,
  WOOD_EDGE,
  WOOD_FREQUENCY,
  WOOD_SHRUBS,
  WOOD_TREES,
} from './sizes.ts'

/** How far across the ground a slope is read. */
const SLOPE_STEP = 3

export function plantWilds(site: Site, seed: number, mountains: readonly SphereMountain[], plant: Planter): void {
  const { rng, land, radius, placed } = site
  const inradii = mountains.map((mountain) => Math.max(triangleInradius(mountain.triangle), 1e-3))
  const slopeAt = (p: Vec3): number => {
    const { east, north } = tangentFrame(p)
    const dx = heightAt(land, along(p, east, SLOPE_STEP, radius)) - heightAt(land, along(p, east, -SLOPE_STEP, radius))
    const dz = heightAt(land, along(p, north, SLOPE_STEP, radius)) - heightAt(land, along(p, north, -SLOPE_STEP, radius))
    return Math.sqrt(dx * dx + dz * dz) / (2 * SLOPE_STEP)
  }
  const rock = (p: Vec3, kind: WorldRock['kind'], size: number): void => {
    const u = axisAt(p, randomRange(rng, 0, Math.PI))
    const tone = rng()
    const spot: Spot = { at: p, u, width: size, depth: size }
    // A boulder is something to hit, placed in its turn; a scree stone is nothing to hit, and nothing keeps off it.
    if (!site.clear(spot, ROCK_ROAD_MARGIN) || placed.meets(spot, 0)) return
    if (kind === 'boulder') placed.add(spot)
    site.rocks.push({ kind, at: lift(p, radius, heightAt(land, p) - size * ROCK_BURY), turn: turnOf(p, u), size, tone })
  }

  const noiseSeed = (seed ^ WILD_SALT) >>> 0
  const rockSeed = (seed ^ ROCK_SALT) >>> 0
  let highest = -Infinity
  for (const height of land.ground.heights) highest = Math.max(highest, height)
  const treeline = land.seaLevel + TREELINE * (highest - land.seaLevel)
  // The spots tried: a grid over the planet about the wilds' spacing apart, each nudged about in its own cell.
  const grid = createSphereGround(Math.round((radius * Math.PI) / 2 / WILD_SPACING), radius)
  const directions = groundDirections(grid)
  const side = grid.n + 1
  const count = directions.length / 3
  const point = (at: number): Vec3 => ({ x: directions[at * 3]!, y: directions[at * 3 + 1]!, z: directions[at * 3 + 2]! })
  for (let at = 0; at < count; at++) {
    const i = at % side
    const j = Math.floor(at / side) % side
    // A face's last row and column are the next face's first: each spot is tried once.
    if (i === grid.n || j === grid.n) continue
    const corner = point(at)
    // What share of the wilds' spacing squared this spot stands for: its cell's two sides.
    const cell = (angleBetween(corner, point(at + 1)) * angleBetween(corner, point(at + side)) * radius * radius) / (WILD_SPACING * WILD_SPACING)
    const { east, north } = tangentFrame(corner)
    const across = randomRange(rng, -WILD_SPACING / 2, WILD_SPACING / 2)
    const down = randomRange(rng, -WILD_SPACING / 2, WILD_SPACING / 2)
    const p = along(along(corner, east, across, radius), north, down, radius)
    const roll = rng() / cell
    const district = districtAt(land, p)
    if (district !== DISTRICT_COUNTRY && district !== DISTRICT_SUBURB) continue
    const height = heightAt(land, p)
    if (height <= land.seaLevel) continue
    const up = riseOf(mountains, p, radius, inradii)
    const slope = slopeAt(p)
    const x = p.x * radius
    const y = p.y * radius
    const z = p.z * radius
    if (height >= treeline || up >= FOOTHILL.treeline || slope > WILD_MAX_SLOPE) {
      // Bare ground: rock. Boulders come in fields where their noise runs high, and the odd one anywhere; scree lies on the steep slopes.
      if (site.wet(p)) continue
      const strewn = smoothstep(ROCK_FIELD.open, ROCK_FIELD.deep, fbm3D(x * ROCK_FREQUENCY, y * ROCK_FREQUENCY, z * ROCK_FREQUENCY, rockSeed, 3))
      const boulders = slope > BOULDER_MAX_SLOPE ? 0 : BOULDER_ODDS.lone + (BOULDER_ODDS.field - BOULDER_ODDS.lone) * strewn
      if (roll < boulders) rock(p, 'boulder', randomRange(rng, BOULDER_SIZE.min, BOULDER_SIZE.max))
      else if (slope > SCREE_SLOPE && roll < boulders + SCREE_ODDS) rock(p, 'scree', randomRange(rng, SCREE_SIZE.min, SCREE_SIZE.max))
      continue
    }
    // Woods where the noise runs high; the foothills thicken them, and thin them again toward the treeline.
    const wood = smoothstep(WOOD_EDGE.open, WOOD_EDGE.deep, fbm3D(x * WOOD_FREQUENCY, y * WOOD_FREQUENCY, z * WOOD_FREQUENCY, noiseSeed, 3))
    const foothill = up < FOOTHILL.thickest ? smoothstep(FOOTHILL.from, FOOTHILL.thickest, up) : 1 - smoothstep(FOOTHILL.thickest, FOOTHILL.treeline, up)
    const thickness = Math.min(1, wood + foothill * FOOTHILL_BOOST) * (district === DISTRICT_SUBURB ? SUBURB_WOODS : 1)
    const trees = LONE_TREES + (WOOD_TREES - LONE_TREES) * thickness
    const shrubs = LONE_SHRUBS + (WOOD_SHRUBS - LONE_SHRUBS) * thickness
    if (roll >= trees + shrubs) continue
    plant(p, roll < trees ? 'tree' : 'shrub')
  }
}
