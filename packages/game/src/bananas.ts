import { createRng, v3, type Vec3 } from '@buggies/physics'
import { DRY, roadLift, sampleHeight, waterLevelAt, type TerrainMap } from '@buggies/terrain'

/** How many bananas are out on a map at once. */
export const BANANA_SLOTS = 64

/** How far above the ground a banana floats, to be seen from a car. */
export const BANANA_HEIGHT = 1.4

/** How close a chassis has to come, across the ground and up it, to take a banana. */
export const BANANA_REACH = 2.8
export const BANANA_REACH_UP = 2.6

/** How long a taken banana's slot stays empty before another turns up elsewhere, in ticks. */
export const BANANA_RESPAWN_TICKS = 480

/** How many bananas are put on roads, where they will be come across, rather than anywhere on land. */
const ON_ROADS = 0.6

/** How far in from a road's edge a banana on it keeps. */
const ROAD_VERGE = 1

/** How far in from the map's edge a banana on land keeps. */
const LAND_MARGIN = 40

/** How many times to try for dry land before settling for a road. */
const LAND_TRIES = 12

/**
 * One of the map's banana slots. Each banana a slot has had is somewhere
 * else, worked out from the map's seed, the slot and how many it has had,
 * so that everyone with the map agrees where it is without being told.
 */
export interface Banana {
  /** How many bananas this slot has had. */
  generation: number
  /** The tick the slot's current banana appears on, or did. */
  spawnTick: number
  /** Where it is, or will be. */
  readonly position: Vec3
}

/** A different 32-bit seed for every banana a map ever has. */
export function bananaSeed(mapSeed: number, slot: number, generation: number): number {
  return (Math.imul(mapSeed, 0x9e3779b1) ^ Math.imul(slot + 1, 0x85ebca6b) ^ Math.imul(generation + 1, 0xc2b2ae35)) >>> 0
}

function roadSpot(map: TerrainMap, rng: () => number, out: Vec3): Vec3 {
  const road = map.roads[Math.floor(rng() * map.roads.length)]!
  const count = road.points.length
  const at = Math.floor(rng() * count)
  const point = road.points[at]!
  const next = road.points[road.closed ? (at + 1) % count : Math.min(at + 1, count - 1)] ?? point
  const prior = road.points[road.closed ? (at - 1 + count) % count : Math.max(at - 1, 0)] ?? point
  const dx = next.x - prior.x
  const dz = next.z - prior.z
  const length = Math.hypot(dx, dz) || 1
  // Across the road, anywhere but the very edge.
  const across = (rng() * 2 - 1) * Math.max(road.width / 2 - ROAD_VERGE, 0)
  out.x = point.x + (-dz / length) * across
  out.y = point.y + roadLift(road) + BANANA_HEIGHT
  out.z = point.z + (dx / length) * across
  return out
}

/**
 * Where a slot's banana of a given generation is: on a road for the most
 * part, and otherwise anywhere on dry land, floating above the ground.
 */
export function bananaSpot(map: TerrainMap, water: Float32Array, slot: number, generation: number, out: Vec3 = v3()): Vec3 {
  const rng = createRng(bananaSeed(map.seed, slot, generation))
  const onRoad = map.roads.length > 0 && rng() < ON_ROADS
  if (onRoad) return roadSpot(map, rng, out)
  const extent = map.size * map.cellSize
  for (let attempt = 0; attempt < LAND_TRIES; attempt++) {
    const x = LAND_MARGIN + rng() * (extent - 2 * LAND_MARGIN)
    const z = LAND_MARGIN + rng() * (extent - 2 * LAND_MARGIN)
    if (waterLevelAt(map.heightfield, water, x, z) !== DRY) continue
    out.x = x
    out.y = sampleHeight(map.heightfield, x, z) + BANANA_HEIGHT
    out.z = z
    return out
  }
  if (map.roads.length > 0) return roadSpot(map, rng, out)
  out.x = extent / 2
  out.y = sampleHeight(map.heightfield, extent / 2, extent / 2) + BANANA_HEIGHT
  out.z = extent / 2
  return out
}

/** A map's bananas, each slot's first, all out from the start. */
export function createBananas(map: TerrainMap, water: Float32Array): Banana[] {
  return Array.from({ length: BANANA_SLOTS }, (_, slot) => ({
    generation: 0,
    spawnTick: 0,
    position: bananaSpot(map, water, slot, 0),
  }))
}

/** Move a slot on to another of its bananas, or to where someone else says it is. */
export function setBanana(
  map: TerrainMap,
  water: Float32Array,
  banana: Banana,
  slot: number,
  generation: number,
  spawnTick: number,
): void {
  if (banana.generation !== generation) bananaSpot(map, water, slot, generation, banana.position)
  banana.generation = generation
  banana.spawnTick = spawnTick
}

/** Whether a slot's banana is out to be taken on this tick. */
export function bananaOut(banana: Banana, tick: number): boolean {
  return tick >= banana.spawnTick
}

/** Whether something at this point has reached a banana. */
export function reachesBanana(banana: Banana, point: Vec3): boolean {
  const dx = point.x - banana.position.x
  const dz = point.z - banana.position.z
  return (
    Math.abs(point.y - banana.position.y) <= BANANA_REACH_UP && dx * dx + dz * dz <= BANANA_REACH * BANANA_REACH
  )
}
