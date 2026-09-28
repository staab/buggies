/**
 * An island's moon: half its size, gray and airless, its ground all rock,
 * pocked with craters, raised into ridges of mountains, cut by valleys and
 * walled about by a ring of highlands at its edge, with no sea, no rivers
 * and no roads. On it stand a flag and the lander that brought it, and the
 * one portal back to the island.
 */

import { createRng, randomRange, type Rng } from '@buggies/physics'

import { WORLD_SCALE } from './generate.ts'
import { sampleHeight } from './heightfield.ts'
import { fbm2D, ridged2D, smoothstep } from './noise.ts'
import { levelRun, portalAt } from './portals.ts'
import type { Building, Heightfield, Portal, Rock, TerrainMap } from './types.ts'

/** How many cells a side a moon has: half an island's, at the same scale. */
const MOON_CELLS = 641
/** The height of its plains, and how much they roll, and how broadly. */
const PLAINS = { base: 24, height: 6, frequency: 0.004 } as const
/** Its mountains: ridges this high, where the broad noise that gathers them into ranges runs high. */
const MOUNTAINS = { height: 60, frequency: 0.004, range: 0.0015, from: 0.5, to: 0.68 } as const
/** Its valleys: troughs this deep, where another ridged noise runs high. */
const VALLEYS = { depth: 16, frequency: 0.002 } as const
/** How many craters, how wide across their rims, how deep a bowl for its width, and how high a rim. */
const CRATERS = 120
const CRATER_RADIUS = { min: 8, max: 110 } as const
const CRATER_DEPTH = 0.28
const CRATER_RIM = 0.08
/** How far in from its edge the highlands that wall it about rise, and how high. */
const WALL = { reach: 160, height: 90 } as const
/** Nothing is lower than this: the moon has no sea to fill anything. */
const FLOOR = 2
/** How many boulders lie about. */
const BOULDERS = 220
/** The flag, planted in the ground; and the lander that brought it, on its legs. */
const FLAG = { width: 0.2, depth: 0.2, height: 4 } as const
const LANDER = { width: 6, depth: 6, height: 5.5 } as const
/** How far from the portal the lander and the flag stand, and how flat the ground about each is made. */
const LANDING_FROM_PORTAL = { least: 45, most: 110 } as const
const PAD = { portal: 34, lander: 9, flag: 3 } as const
const TRIES = 3000
const MOON_SALT = 0x3004

interface Crater {
  readonly x: number
  readonly z: number
  readonly radius: number
}

/** The moon's ground at a point, before anything is levelled for what stands on it. */
function groundAt(x: number, z: number, extent: number, seed: number, craters: readonly Crater[]): number {
  let height = PLAINS.base + PLAINS.height * fbm2D(x * PLAINS.frequency, z * PLAINS.frequency, seed)
  const range = smoothstep(MOUNTAINS.from, MOUNTAINS.to, fbm2D(x * MOUNTAINS.range, z * MOUNTAINS.range, seed + 17, 3))
  height += MOUNTAINS.height * range * ridged2D(x * MOUNTAINS.frequency, z * MOUNTAINS.frequency, seed + 29)
  height -= VALLEYS.depth * ridged2D(x * VALLEYS.frequency, z * VALLEYS.frequency, seed + 41, 3) ** 3
  for (const crater of craters) {
    const r = Math.hypot(x - crater.x, z - crater.z) / crater.radius
    if (r > 1.6) continue
    // A bowl inside the rim, the rim heaped up round it, and the ejecta falling away outside.
    if (r < 1) height -= crater.radius * CRATER_DEPTH * (1 - r * r)
    height += crater.radius * CRATER_RIM * Math.exp(-(((r - 1) / 0.22) ** 2))
  }
  const edge = Math.min(x, z, extent - x, extent - z)
  height += WALL.height * smoothstep(WALL.reach, 0, edge) ** 2
  return Math.max(height, FLOOR)
}

/** Level the ground about a point to its height there, easing back into the ground round it. */
function levelAbout(field: Heightfield, x: number, z: number, radius: number): number {
  const { width, depth, cellSize, heights } = field
  const level = sampleHeight(field, x, z)
  const reach = radius * 2
  const c0 = Math.max(Math.floor((x - reach) / cellSize), 0)
  const c1 = Math.min(Math.ceil((x + reach) / cellSize), width - 1)
  const r0 = Math.max(Math.floor((z - reach) / cellSize), 0)
  const r1 = Math.min(Math.ceil((z + reach) / cellSize), depth - 1)
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const d = Math.hypot(col * cellSize - x, row * cellSize - z)
      const share = smoothstep(reach, radius, d)
      const cell = row * width + col
      heights[cell] = heights[cell]! + (level - heights[cell]!) * share
    }
  }
  return level
}

/** Somewhere near the middle to stand the portal, on as level ground as can be found. */
function portalSpot(map: TerrainMap, rng: Rng): { x: number; z: number; dx: number; dz: number } {
  const extent = map.size * map.cellSize
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const spread = extent * (0.1 + (0.25 * attempt) / TRIES)
    const x = extent / 2 + randomRange(rng, -spread, spread)
    const z = extent / 2 + randomRange(rng, -spread, spread)
    const turn = randomRange(rng, 0, Math.PI * 2)
    const dx = Math.cos(turn)
    const dz = Math.sin(turn)
    if (levelRun(map, null, x, z, dx, dz)) return { x, z, dx, dz }
  }
  return { x: extent / 2, z: extent / 2, dx: 1, dz: 0 }
}

/** A building standing on the ground at a point. */
function standing(kind: Building['kind'], x: number, z: number, yaw: number, size: { width: number; depth: number; height: number }, bottom: number): Building {
  return { kind, x, z, yaw, width: size.width, depth: size.depth, bottom: bottom - 0.3, top: bottom + size.height, tone: 0.5 }
}

/** Generate the moon of the island with this seed: its own seed is the island's with the moon's bit set. */
export function generateMoon(seed: number): TerrainMap {
  const rng = createRng((seed ^ MOON_SALT) >>> 0)
  const cellSize = WORLD_SCALE
  const size = MOON_CELLS
  const extent = size * cellSize
  const craters: Crater[] = Array.from({ length: CRATERS }, () => {
    // Small craters far outnumber big ones.
    const t = rng()
    return {
      x: randomRange(rng, 0, extent),
      z: randomRange(rng, 0, extent),
      radius: CRATER_RADIUS.min + (CRATER_RADIUS.max - CRATER_RADIUS.min) * t ** 3,
    }
  })
  const heights = new Float32Array(size * size)
  const noiseSeed = (seed ^ (MOON_SALT * 7919)) >>> 0
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) heights[row * size + col] = groundAt(col * cellSize, row * cellSize, extent, noiseSeed, craters)
  }
  const heightfield: Heightfield = { width: size, depth: size, cellSize, heights }
  const map: TerrainMap = {
    seed,
    size,
    cellSize,
    seaLevel: 0,
    heightfield,
    mountains: [],
    rivers: [],
    lakes: [],
    districts: [],
    districtOf: new Uint8Array(size * size),
    roads: [],
    buildings: [],
    trees: [],
    rocks: [],
    props: [],
    ramps: [],
    sidewalks: [],
    fields: [],
    portals: [],
    moon: true,
  }

  // The portal back, on ground levelled for a run at it either way.
  const spot = portalSpot(map, rng)
  levelAbout(heightfield, spot.x, spot.z, PAD.portal)
  const portal: Portal = portalAt(map, spot.x, spot.z, spot.dx, spot.dz)
  map.portals.push(portal)

  // The lander a little way off to one side of it, and the flag it planted beside it.
  const off = randomRange(rng, LANDING_FROM_PORTAL.least, LANDING_FROM_PORTAL.most)
  const side = rng() < 0.5 ? 1 : -1
  const landerX = portal.x - portal.dz * off * side
  const landerZ = portal.z + portal.dx * off * side
  const landerYaw = randomRange(rng, 0, Math.PI * 2)
  map.buildings.push(standing('lander', landerX, landerZ, landerYaw, LANDER, levelAbout(heightfield, landerX, landerZ, PAD.lander)))
  const flagX = landerX + portal.dx * 12
  const flagZ = landerZ + portal.dz * 12
  map.buildings.push(standing('flag', flagX, flagZ, randomRange(rng, 0, Math.PI * 2), FLAG, levelAbout(heightfield, flagX, flagZ, PAD.flag)))

  // Boulders thrown about the plains, clear of the portal's run and the landing.
  for (let k = 0; k < BOULDERS; k++) {
    const x = randomRange(rng, WALL.reach / 2, extent - WALL.reach / 2)
    const z = randomRange(rng, WALL.reach / 2, extent - WALL.reach / 2)
    if (Math.hypot(x - portal.x, z - portal.z) < PAD.portal * 2 || Math.hypot(x - landerX, z - landerZ) < 30) continue
    const rock: Rock = { kind: 'boulder', x, z, bottom: sampleHeight(heightfield, x, z), size: randomRange(rng, 1.2, 4.5), yaw: randomRange(rng, 0, Math.PI * 2), tone: rng() }
    map.rocks.push(rock)
  }
  return map
}
