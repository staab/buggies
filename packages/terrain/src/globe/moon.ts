/**
 * A planet's moon: half its size, gray and airless, its ground all rock,
 * pocked with craters and raised into mountains and cut by valleys, with
 * no sea, no rivers and no roads. On it stand a flag and the lander that
 * brought it, and the one portal back to the planet.
 */

import * as exact from '@buggies/physics'
import { createRng, randomRange, type Rng, type Vec3 } from '@buggies/physics'

import { fbm3D, ridged3D, smoothstep } from '../noise.ts'
import { createSphereGround, sphereHeight, type SphereGround } from '../sphere.ts'
import { groundDirections } from '../sphere-water.ts'
import { randomDirection } from '../world-queries.ts'
import { DRY, type World, type WorldBuilding, type WorldPortal } from '../world.ts'
import { angleBetween, lift } from './lines.ts'
import { axisAt, spotFrame, spotSamples, turnOf, type Spot } from './placing.ts'
import { PLANET_RADIUS, SPHERE_CELLS, generatePlanet } from './planet.ts'
import { PORTAL_RADIUS } from './portals.ts'
import { fromFrame } from './frame.ts'

const { cos, sin } = exact

/** Which bit of a world's id says it is a moon: a moon's id is its planet's seed with this bit set. */
export const MOON_BIT = 0x8000_0000

/** The id of a planet's moon. */
export function moonOf(seed: number): number {
  return (seed | MOON_BIT) >>> 0
}

/** Whether a world's id is a moon's. */
export function isMoon(id: number): boolean {
  return (id & MOON_BIT) !== 0
}

/** The seed of the planet a world belongs to: its own, or its moon's planet's. */
export function planetSeedOf(id: number): number {
  return (id & ~MOON_BIT) >>> 0
}

/** How big a moon is, as a share of its planet. */
const MOON_SIZE = 0.5
/** Far under anything on the moon: it has no sea. */
const MOON_SEA = -1000
/** The rolling of its plains, how high and how broad. */
const PLAINS = { height: 5, frequency: 0.012 } as const
/** Its mountains: ridges this high, where the broad noise that gathers them into ranges runs high. */
const MOUNTAINS = { height: 32, frequency: 0.009, range: 0.004, from: 0.5, to: 0.7 } as const
/** Its valleys: troughs this deep, where another ridged noise runs high. */
const VALLEYS = { depth: 14, frequency: 0.006 } as const
/** How many craters, how wide across their rims, how deep a bowl for its width, and how high a rim. */
const CRATERS = 90
const CRATER_RADIUS = { min: 6, max: 55 } as const
const CRATER_DEPTH = 0.3
const CRATER_RIM = 0.08
/** How level the ground under the flag, the lander and the portal must be, and how many spots are tried for each. */
const LEVEL = 1.2
const TRIES = 2000
const MOON_SALT = 0x3004

/** The flag, planted in the ground; and the lander that brought it, on its legs. */
const FLAG = { width: 0.12, depth: 0.12, height: 4 } as const
const LANDER = { width: 6, depth: 6, height: 5 } as const
/** How far from the portal the lander and the flag stand. */
const LANDING_FROM_PORTAL = { least: 40, most: 120 } as const

interface Crater {
  readonly center: Vec3
  readonly radius: number
}

/** The moon's ground: plains, mountain ranges, valleys, and the craters over all of it. */
function raiseMoonGround(ground: SphereGround, seed: number, rng: Rng): void {
  const { radius, heights } = ground
  const directions = groundDirections(ground)
  const craters: Crater[] = Array.from({ length: CRATERS }, () => {
    const center = randomDirection(rng)
    // Small craters far outnumber big ones.
    const t = rng()
    return { center: { ...center }, radius: CRATER_RADIUS.min + (CRATER_RADIUS.max - CRATER_RADIUS.min) * t * t * t }
  })
  const p = { x: 0, y: 0, z: 0 }
  for (let at = 0; at < heights.length; at++) {
    p.x = directions[at * 3]!
    p.y = directions[at * 3 + 1]!
    p.z = directions[at * 3 + 2]!
    const x = p.x * radius
    const y = p.y * radius
    const z = p.z * radius
    let height = (fbm3D(x * PLAINS.frequency, y * PLAINS.frequency, z * PLAINS.frequency, seed + 1, 3) - 0.5) * 2 * PLAINS.height
    const range = smoothstep(MOUNTAINS.from, MOUNTAINS.to, fbm3D(x * MOUNTAINS.range, y * MOUNTAINS.range, z * MOUNTAINS.range, seed + 2, 2))
    height += range * ridged3D(x * MOUNTAINS.frequency, y * MOUNTAINS.frequency, z * MOUNTAINS.frequency, seed + 3, 4) * MOUNTAINS.height
    const trough = ridged3D(x * VALLEYS.frequency, y * VALLEYS.frequency, z * VALLEYS.frequency, seed + 4, 2)
    height -= smoothstep(0.75, 1, trough) * VALLEYS.depth
    for (const crater of craters) {
      const d = angleBetween(p, crater.center) * radius
      const r = crater.radius
      if (d > r * 2) continue
      // A bowl inside the rim, the rim raised round it, and its throw fading out beyond.
      const inside = d < r ? -CRATER_DEPTH * r * (1 - (d / r) * (d / r)) : 0
      const rim = CRATER_RIM * r * Math.exp(-((d - r) * (d - r)) / (0.08 * r * r))
      height += inside + rim
    }
    heights[at] = height
  }
}

/** A spot on the moon whose ground is level enough to stand this on, or nothing after every try. */
function levelSpot(ground: SphereGround, rng: Rng, width: number, depth: number, near: ((p: Vec3) => boolean) | null = null): Spot | null {
  const p = { x: 0, y: 0, z: 0 }
  for (let attempt = 0; attempt < TRIES; attempt++) {
    randomDirection(rng, p)
    if (near !== null && !near(p)) continue
    const at = { ...p }
    const spot: Spot = { at, u: axisAt(at, randomRange(rng, 0, Math.PI)), width, depth }
    const samples = spotSamples(spot, ground.radius).map((sample) => sphereHeight(ground, sample))
    if (Math.max(...samples) - Math.min(...samples) <= LEVEL) return spot
  }
  return null
}

/** Something standing on a spot, buried a little under its lowest ground. */
function standing(ground: SphereGround, kind: WorldBuilding['kind'], spot: Spot, height: number, tone: number): WorldBuilding {
  const low = Math.min(...spotSamples(spot, ground.radius).map((sample) => sphereHeight(ground, sample)))
  return { kind, at: lift(spot.at, ground.radius, low - 0.3), turn: turnOf(spot.at, spot.u), width: spot.width, depth: spot.depth, height: height + 0.3, tone }
}

/** Make a planet's moon, from the planet's seed. */
export function generateMoon(seed: number): World {
  const radius = PLANET_RADIUS * MOON_SIZE
  const rng = createRng((seed ^ MOON_SALT) >>> 0)
  const ground = createSphereGround(Math.round(SPHERE_CELLS * MOON_SIZE), radius)
  raiseMoonGround(ground, seed ^ MOON_SALT, rng)

  // The portal back, where there is a level run through it.
  const portals: WorldPortal[] = []
  const run = levelSpot(ground, rng, PORTAL_RADIUS * 2 + 4, 50)
  if (run !== null) {
    const at = lift(run.at, radius, sphereHeight(ground, run.at))
    portals.push({ at, turn: turnOf(run.at, run.u), radius: PORTAL_RADIUS })
  }
  const portalAt = run?.at ?? null
  // The lander and its flag, a walk off the portal, the flag beside the lander.
  const buildings: WorldBuilding[] = []
  const near = portalAt === null ? null : (p: Vec3): boolean => {
    const d = angleBetween(p, portalAt) * radius
    return d > LANDING_FROM_PORTAL.least && d < LANDING_FROM_PORTAL.most
  }
  const landing = levelSpot(ground, rng, LANDER.width, LANDER.depth, near)
  if (landing !== null) {
    buildings.push(standing(ground, 'lander', landing, LANDER.height, rng()))
    const frame = spotFrame(landing.at, landing.u, radius)
    const angle = randomRange(rng, 0, Math.PI * 2)
    const flagAt = fromFrame(frame, cos(angle) * 9, sin(angle) * 9)
    buildings.push(standing(ground, 'flag', { at: flagAt, u: axisAt(flagAt, randomRange(rng, 0, Math.PI)), width: FLAG.width, depth: FLAG.depth }, FLAG.height, rng()))
  }

  const count = ground.heights.length
  const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) }
  return {
    seed: moonOf(seed),
    kind: 'moon',
    radius,
    seaLevel: MOON_SEA,
    ground,
    bored: Float32Array.from(ground.heights),
    holes: new Uint8Array(count),
    water: new Float32Array(count).fill(DRY),
    districtOf: new Uint8Array(count),
    mountains: [],
    rivers: [],
    lakes: [],
    districts: [],
    roads: [],
    buildings,
    trees: [],
    rocks: [],
    props: [],
    ramps: [],
    sidewalks: [],
    fields: [],
    portals,
    decks: { ...empty, surfaces: new Uint8Array(0) },
    paths: [],
    shells: [],
    rails: empty,
    curbs: empty,
    kickers: [],
  }
}

/** Make a planet, or its moon, by its id. */
export function generateWorld(id: number): World {
  return isMoon(id) ? generateMoon(planetSeedOf(id)) : generatePlanet(id)
}
