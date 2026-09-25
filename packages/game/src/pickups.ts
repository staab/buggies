import { createRng, v3, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { DRY, roadLift, sampleHeight, waterLevelAt, type TerrainMap } from '@buggies/terrain'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { cos, hypot, sin } = exact

/** How many bananas are out on a map at once. */
export const BANANA_SLOTS = 64
export const PICKUP_SLOTS = BANANA_SLOTS

/** How far above the ground a pickup floats, to be seen from a car. */
export const PICKUP_HEIGHT = 1.4

/**
 * How close a chassis has to come, across the ground and up it, to take a
 * banana: about as far as one is drawn out to.
 */
export const BANANA_REACH = 3.4
export const PICKUP_REACH_UP = 2.8

/** How long a taken pickup's slot stays empty before another turns up elsewhere, in ticks. */
export const PICKUP_RESPAWN_TICKS = 480

/** How many pickups are put on roads, where they will be come across, rather than anywhere on land. */
const ON_ROADS = 0.6

/** How far in from a road's edge a pickup on it keeps. */
const ROAD_SHOULDER = 1

/** How far in from the map's edge a pickup on land keeps. */
const LAND_MARGIN = 40

/** How many times to try for dry land before settling for a road. */
const LAND_TRIES = 12

/**
 * One of the map's banana slots. Each banana a slot has had is somewhere
 * else, worked out from the map's seed, the slot and how many it has had,
 * so that everyone with the map agrees where it is without being told.
 */
export interface Pickup {
  /** How many bananas this slot has had. */
  generation: number
  /** The tick the slot's current pickup appears on, or did. */
  spawnTick: number
  /** Where it is, or will be. */
  readonly position: Vec3
}

/** A different 32-bit seed for every pickup a map ever has. */
export function pickupSeed(mapSeed: number, slot: number, generation: number): number {
  return (Math.imul(mapSeed, 0x9e3779b1) ^ Math.imul(slot + 1, 0x85ebca6b) ^ Math.imul(generation + 1, 0xc2b2ae35)) >>> 0
}

/** A spot on one of the map's roads, chosen by the rng; none if the road it chose has no points. */
function roadSpot(map: TerrainMap, rng: () => number, out: Vec3): Vec3 | null {
  const road = map.roads[Math.floor(rng() * map.roads.length)]
  if (road === undefined) return null
  const count = road.points.length
  const at = Math.floor(rng() * count)
  const point = road.points[at]
  if (point === undefined) return null
  const next = road.points[road.closed ? (at + 1) % count : Math.min(at + 1, count - 1)] ?? point
  const prior = road.points[road.closed ? (at - 1 + count) % count : Math.max(at - 1, 0)] ?? point
  const dx = next.x - prior.x
  const dz = next.z - prior.z
  const length = hypot(dx, dz) || 1
  // Across the road, anywhere but the very edge.
  const across = (rng() * 2 - 1) * Math.max(road.width / 2 - ROAD_SHOULDER, 0)
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
  if (onRoad) {
    const spot = roadSpot(map, rng, out)
    if (spot !== null) return spot
  }
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
  if (map.roads.length > 0) {
    const spot = roadSpot(map, rng, out)
    if (spot !== null) return spot
  }
  out.x = extent / 2
  out.y = sampleHeight(map.heightfield, extent / 2, extent / 2) + PICKUP_HEIGHT
  out.z = extent / 2
  return out
}

/** A map's pickups, each slot's first, all out from the start. */
export function createPickups(map: TerrainMap, water: Float32Array): Pickup[] {
  return Array.from({ length: PICKUP_SLOTS }, (_, slot) => ({
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

/** Whether something at this point has reached a pickup: from a banana's own reach, or a magnet's if that is further. */
export function reachesPickup(pickup: Pickup, point: Vec3, magnet = 0): boolean {
  return within(point, pickup.position, Math.max(BANANA_REACH, magnet), Math.max(PICKUP_REACH_UP, magnet))
}

/** Whether a point is within this far of another across the ground, and this far up or down. */
function within(point: Vec3, at: Vec3, reach: number, up: number): boolean {
  const dx = point.x - at.x
  const dz = point.z - at.z
  return Math.abs(point.y - at.y) <= up && dx * dx + dz * dz <= reach * reach
}

/** How many of a wreck's bananas spill out, at most; the rest are lost in the blast. */
export const SPILL_MOST = 16

/** How far from the wreck a spilled banana lands, in meters, at the nearest and the furthest. */
export const SPILL_NEAR = 5
export const SPILL_FAR = 16

/** How long a spilled banana is in the air, in ticks, before it can be taken. */
export const SPILL_FLIGHT_TICKS = 60

/** How long a spilled banana lies about before it is gone, in ticks. */
export const SPILL_LIFE_TICKS = 60 * 90

/** How many loose things a map holds at once, bananas, bombs and rockets together; past that the oldest go. */
export const LOOSE_MOST = 256

/** What lies loose on the map: a banana spilled from a wreck, or a bomb, a mine or an oil slick dropped from a car. */
export type LooseKind = 'banana' | 'bomb' | 'mine' | 'oil'
export const LOOSE_KINDS: readonly LooseKind[] = ['banana', 'bomb', 'mine', 'oil']

/** How close a chassis has to come to a bomb or a mine to set it off, and to an oil slick to drive into it. */
export const BOMB_REACH = 3.2
export const MINE_REACH = 2.5
export const OIL_REACH = 4

/** How long an oil slick lies on the road before it is gone, in ticks. */
export const OIL_LIFE_TICKS = 60 * 60

/** Spilled bananas are numbered as they come, and the numbers come around after this many: far more than are ever out at once. */
export const LOOSE_IDS = 0x10000

/**
 * Something loose on the map: a banana spilled from a wreck, thrown from
 * where the car blew up to where it lands, to lie there for the taking
 * until it is taken or fades; or a bomb dropped behind a car, to float
 * there until any car runs into it, the one that dropped it included once
 * it has landed.
 */
export interface Loose {
  /** Its number, by which it is spoken of on the wire; no two out at once share one. */
  readonly id: number
  readonly kind: LooseKind
  /** Whose it is: the seat of the wreck it spilled from, or of the car that dropped it. */
  readonly owner: number
  /** How much of a full bomb's blast it goes off with; a banana has none. */
  readonly power: number
  readonly from: Vec3
  readonly position: Vec3
  readonly bornTick: number
}

/**
 * Where a wreck's bananas land: scattered about it, every one of them
 * worked out from the map, the seat and the tick, so that everyone who
 * knows those agrees.
 */
export function spillFrom(
  map: TerrainMap,
  from: Vec3,
  count: number,
  seat: number,
  tick: number,
  firstId: number,
): Loose[] {
  const rng = createRng(pickupSeed(map.seed, PICKUP_SLOTS + seat, tick))
  const loose: Loose[] = []
  const origin = v3(from.x, from.y, from.z)
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2
    const radius = SPILL_NEAR + rng() * (SPILL_FAR - SPILL_NEAR)
    const x = from.x + cos(angle) * radius
    const z = from.z + sin(angle) * radius
    loose.push({
      id: (firstId + i) % LOOSE_IDS,
      kind: 'banana',
      owner: seat,
      power: 0,
      from: origin,
      position: v3(x, sampleHeight(map.heightfield, x, z) + PICKUP_HEIGHT, z),
      bornTick: tick,
    })
  }
  return loose
}

/** Whether a spilled banana has landed, and can be taken. */
export function looseOut(loose: Loose, tick: number): boolean {
  return tick >= loose.bornTick + SPILL_FLIGHT_TICKS
}

/** Whether a spilled banana or an oil slick has lain about long enough to be gone. A bomb or a mine lies there until it goes off. */
export function looseGone(loose: Loose, tick: number): boolean {
  if (loose.kind === 'banana') return tick >= loose.bornTick + SPILL_LIFE_TICKS
  if (loose.kind === 'oil') return tick >= loose.bornTick + OIL_LIFE_TICKS
  return false
}

const LOOSE_REACH: Readonly<Record<LooseKind, number>> = { banana: BANANA_REACH, bomb: BOMB_REACH, mine: MINE_REACH, oil: OIL_REACH }

/** Whether something at this point has reached a loose banana, set off a bomb or a mine, or driven into oil; a banana from as far as a magnet's reach, if more. */
export function reachesLoose(loose: Loose, point: Vec3, magnet = 0): boolean {
  if (loose.kind === 'banana') return within(point, loose.position, Math.max(BANANA_REACH, magnet), Math.max(PICKUP_REACH_UP, magnet))
  return within(point, loose.position, LOOSE_REACH[loose.kind], PICKUP_REACH_UP)
}
