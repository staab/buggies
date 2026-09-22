import { createRng, v3, type Vec3 } from '@buggies/physics'
import { DRY, roadLift, sampleHeight, waterLevelAt, type TerrainMap } from '@buggies/terrain'

/** What floats about the map to be driven into: a banana for a point, or a bomb. */
export type PickupKind = 'banana' | 'bomb'

/** How many bananas are out on a map at once, and how many bombs. */
export const BANANA_SLOTS = 64
export const BOMB_SLOTS = 24
export const PICKUP_SLOTS = BANANA_SLOTS + BOMB_SLOTS

/** How far above the ground a pickup floats, to be seen from a car. */
export const PICKUP_HEIGHT = 1.4

/** How close a chassis has to come, across the ground and up it, to take a banana or set off a bomb. */
export const BANANA_REACH = 2.8
export const BOMB_REACH = 3
export const PICKUP_REACH_UP = 2.6

/** How long a taken pickup's slot stays empty before another turns up elsewhere, in ticks. */
export const PICKUP_RESPAWN_TICKS = 480

/** How many pickups are put on roads, where they will be come across, rather than anywhere on land. */
const ON_ROADS = 0.6

/** How far in from a road's edge a pickup on it keeps. */
const ROAD_VERGE = 1

/** How far in from the map's edge a pickup on land keeps. */
const LAND_MARGIN = 40

/** How many times to try for dry land before settling for a road. */
const LAND_TRIES = 12

/**
 * One of the map's pickup slots. Each pickup a slot has had is somewhere
 * else, worked out from the map's seed, the slot and how many it has had,
 * so that everyone with the map agrees where it is without being told.
 * The first slots are bananas, the rest bombs.
 */
export interface Pickup {
  readonly kind: PickupKind
  /** How many pickups this slot has had. */
  generation: number
  /** The tick the slot's current pickup appears on, or did. */
  spawnTick: number
  /** Where it is, or will be. */
  readonly position: Vec3
}

/** What a slot holds: the first so many are bananas, the rest bombs. */
export function pickupKind(slot: number): PickupKind {
  return slot < BANANA_SLOTS ? 'banana' : 'bomb'
}

/** A different 32-bit seed for every pickup a map ever has. */
export function pickupSeed(mapSeed: number, slot: number, generation: number): number {
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
  out.y = point.y + roadLift(road) + PICKUP_HEIGHT
  out.z = point.z + (dx / length) * across
  return out
}

/**
 * Where a slot's pickup of a given generation is: on a road for the most
 * part, and otherwise anywhere on dry land, floating above the ground.
 */
export function pickupSpot(map: TerrainMap, water: Float32Array, slot: number, generation: number, out: Vec3 = v3()): Vec3 {
  const rng = createRng(pickupSeed(map.seed, slot, generation))
  const onRoad = map.roads.length > 0 && rng() < ON_ROADS
  if (onRoad) return roadSpot(map, rng, out)
  const extent = map.size * map.cellSize
  for (let attempt = 0; attempt < LAND_TRIES; attempt++) {
    const x = LAND_MARGIN + rng() * (extent - 2 * LAND_MARGIN)
    const z = LAND_MARGIN + rng() * (extent - 2 * LAND_MARGIN)
    if (waterLevelAt(map.heightfield, water, x, z) !== DRY) continue
    out.x = x
    out.y = sampleHeight(map.heightfield, x, z) + PICKUP_HEIGHT
    out.z = z
    return out
  }
  if (map.roads.length > 0) return roadSpot(map, rng, out)
  out.x = extent / 2
  out.y = sampleHeight(map.heightfield, extent / 2, extent / 2) + PICKUP_HEIGHT
  out.z = extent / 2
  return out
}

/** A map's pickups, each slot's first, all out from the start. */
export function createPickups(map: TerrainMap, water: Float32Array): Pickup[] {
  return Array.from({ length: PICKUP_SLOTS }, (_, slot) => ({
    kind: pickupKind(slot),
    generation: 0,
    spawnTick: 0,
    position: pickupSpot(map, water, slot, 0),
  }))
}

/** Move a slot on to another of its pickups, or to where someone else says it is. */
export function setPickup(
  map: TerrainMap,
  water: Float32Array,
  pickup: Pickup,
  slot: number,
  generation: number,
  spawnTick: number,
): void {
  if (pickup.generation !== generation) pickupSpot(map, water, slot, generation, pickup.position)
  pickup.generation = generation
  pickup.spawnTick = spawnTick
}

/** Whether a slot's pickup is out to be taken on this tick. */
export function pickupOut(pickup: Pickup, tick: number): boolean {
  return tick >= pickup.spawnTick
}

/** Whether something at this point has reached a pickup. */
export function reachesPickup(pickup: Pickup, point: Vec3): boolean {
  const reach = pickup.kind === 'bomb' ? BOMB_REACH : BANANA_REACH
  const dx = point.x - pickup.position.x
  const dz = point.z - pickup.position.z
  return Math.abs(point.y - pickup.position.y) <= PICKUP_REACH_UP && dx * dx + dz * dz <= reach * reach
}
