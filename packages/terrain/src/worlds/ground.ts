/**
 * A world's ground past the planet: made at a size, taken as land to place
 * on, rolled with noise, levelled where something wide is to stand, and
 * asked how high and how even it is about a place.
 */

import type { Vec3 } from '@buggies/physics'

import { fbm3D, smoothstep } from '../noise.ts'
import { createSphereGround, type SphereGround } from '../sphere.ts'
import { groundDirections, groundNeighbors } from '../sphere-water.ts'
import { DRY } from '../world.ts'
import { angleBetween } from '../globe/lines.ts'
import { eachPointNear, type Land } from '../globe/placing.ts'
import { PLANET_RADIUS, SPHERE_CELLS } from '../globe/planet.ts'

/** A world's ground, made this big as a share of the planet's, with its grid as fine as the planet's or finer. */
export function groundOfSize(size: number, cells = Math.round(SPHERE_CELLS * size)): SphereGround {
  return createSphereGround(cells, PLANET_RADIUS * size)
}

/** A world's ground as land to place things on. */
export function landOf(ground: SphereGround, seaLevel: number, water?: Float32Array, districtOf?: Uint8Array): Land {
  const count = ground.heights.length
  return {
    ground,
    neighbors: groundNeighbors(ground),
    directions: groundDirections(ground),
    water: water ?? new Float32Array(count).fill(DRY),
    districtOf: districtOf ?? new Uint8Array(count),
    seaLevel,
    radius: ground.radius,
  }
}

/** Rolling ground: noise this high, this broad, laid over every grid point at its own place on the sphere. */
export function rollGround(land: Land, seed: number, height: number, frequency: number, base = 0, octaves = 3): void {
  const { ground, directions, radius } = land
  for (let at = 0; at < ground.heights.length; at++) {
    const x = directions[at * 3]! * radius * frequency
    const y = directions[at * 3 + 1]! * radius * frequency
    const z = directions[at * 3 + 2]! * radius * frequency
    ground.heights[at] = base + (fbm3D(x, y, z, seed, octaves) - 0.5) * 2 * height
  }
}

/**
 * Bring the ground level to a height over a round reach about a way out,
 * eased back into the ground as it was over `blend` beyond: a dome's
 * floor, a temple's.
 */
export function levelGround(land: Land, center: Vec3, reach: number, blend: number, height: number): void {
  const { heights } = land.ground
  eachPointNear(land, center, reach + blend, (at, p) => {
    const share = 1 - smoothstep(reach, reach + blend, angleBetween(p, center) * land.radius)
    heights[at] = heights[at]! + (height - heights[at]!) * share
  })
}

/** The ground's mean height over a round reach about a way out. */
export function meanHeight(land: Land, center: Vec3, reach: number): number {
  let sum = 0
  let count = 0
  eachPointNear(land, center, reach, (at) => {
    sum += land.ground.heights[at]!
    count++
  })
  return count === 0 ? 0 : sum / count
}

/** How far the ground rises and falls over a round reach about a way out: highest less lowest. */
export function reliefOver(land: Land, center: Vec3, reach: number): number {
  let low = Infinity
  let high = -Infinity
  eachPointNear(land, center, reach, (at) => {
    low = Math.min(low, land.ground.heights[at]!)
    high = Math.max(high, land.ground.heights[at]!)
  })
  return high - low
}
