import { createRng, v3, vdistance, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { DRY, onLand, overSurface, randomDirection, tangentFrame, upOf, waterUnder, type World, type WorldRoad } from '@buggies/terrain'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { cos, sin } = exact

/** How many bananas a map has, out on it or spilled from wrecks: a spilled one holds a slot until it is taken. */
export const BANANA_SLOTS = 256
/** How many health packs are out on a map at once, in the slots after the bananas'. */
export const HEALTH_SLOTS = 32
export const PICKUP_SLOTS = BANANA_SLOTS + HEALTH_SLOTS

/** What a slot holds: a banana, or a health pack. */
export type PickupKind = 'banana' | 'health'

/** What a slot holds, by its number. */
export function pickupKind(slot: number): PickupKind {
  return slot < BANANA_SLOTS ? 'banana' : 'health'
}

/** How much of a car's damage a health pack mends, of what wrecks it. */
export const HEALTH_MEND = 0.5

/** How far above the ground a pickup floats, to be seen from a car. */
export const PICKUP_HEIGHT = 1.4

/**
 * How close a chassis has to come, across the ground and up it, to take a
 * banana or a health pack: about as far as one is drawn out to.
 */
export const BANANA_REACH = 3.4
export const PICKUP_REACH_UP = 2.8

/** How long a taken pickup's slot stays empty before another turns up elsewhere, in ticks. */
export const PICKUP_RESPAWN_TICKS = 480

/** How many pickups are put on roads, where they will be come across, rather than anywhere on land. */
const ON_ROADS = 0.6

/** How far in from a road's edge a pickup on it keeps. */
const ROAD_SHOULDER = 1

/** How many times to try for dry land before settling for a road. */
const LAND_TRIES = 12

/**
 * One of the map's pickup slots, a banana's or a health pack's. Each pickup
 * a slot has had is somewhere else, worked out from the map's seed, the slot
 * and how many it has had, so that everyone with the map agrees where it is
 * without being told.
 */
export interface Pickup {
  /** How many pickups this slot has had. */
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

/** One straight piece of a road, from a point to the next, and how far along all the map's roads it starts. */
interface Stretch {
  road: WorldRoad
  from: number
  start: number
}

/** A map's roads end to end, for picking a spot on them by distance rather than by road. */
interface RoadLengths {
  stretches: Stretch[]
  total: number
}

const roadLengths = new WeakMap<World, RoadLengths>()

function lengthsOf(map: World): RoadLengths {
  const known = roadLengths.get(map)
  if (known !== undefined) return known
  const stretches: Stretch[] = []
  let total = 0
  for (const road of map.roads) {
    const count = road.points.length
    const pieces = road.closed ? count : count - 1
    for (let from = 0; from < pieces; from++) {
      const length = vdistance(road.points[(from + 1) % count]!, road.points[from]!)
      if (length <= 0) continue
      stretches.push({ road, from, start: total })
      total += length
    }
  }
  const lengths = { stretches, total }
  roadLengths.set(map, lengths)
  return lengths
}

/**
 * A spot on the map's roads, somewhere in one of `shares` shares of their length: every stretch of road gets its pickups, a city's
 * short streets no more than a long highway; none if the map has no road to speak of.
 */
function roadSpot(map: World, rng: () => number, share: number, shares: number, out: Vec3): Vec3 | null {
  const { stretches, total } = lengthsOf(map)
  if (stretches.length === 0) return null
  const along = ((share + rng()) / shares) * total
  let low = 0
  let high = stretches.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (stretches[middle]!.start <= along) low = middle
    else high = middle - 1
  }
  const { road, from, start } = stretches[low]!
  const a = road.points[from]!
  const b = road.points[(from + 1) % road.points.length]!
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  const length = vdistance(a, b)
  const t = Math.min(Math.max((along - start) / length, 0), 1)
  out.x = a.x + dx * t
  out.y = a.y + dy * t
  out.z = a.z + dz * t
  // Across the road, anywhere but the very edge: its run crossed with the way up.
  const across = (rng() * 2 - 1) * Math.max((road.widths[from] ?? 0) / 2 - ROAD_SHOULDER, 0)
  const up = upOf(out)
  const ax = dy * up.z - dz * up.y
  const ay = dz * up.x - dx * up.z
  const az = dx * up.y - dy * up.x
  const aside = Math.sqrt(ax * ax + ay * ay + az * az) || 1
  out.x += (ax / aside) * across + up.x * PICKUP_HEIGHT
  out.y += (ay / aside) * across + up.y * PICKUP_HEIGHT
  out.z += (az / aside) * across + up.z * PICKUP_HEIGHT
  return out
}

/**
 * How many shares a slot moves on by with each pickup it has: coprime with
 * the number of slots of its kind, so that at any one generation every slot
 * has a share of its own, and each pickup is well away from the last.
 */
const SHARE_STEP = 67

/** The golden angle, which spreads points round a sphere evenly one after another. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** The middle of one of `shares` patches spread evenly over the whole sphere. */
function patchMiddle(share: number, shares: number, out: Vec3): Vec3 {
  const y = 1 - (2 * (share + 0.5)) / shares
  const ring = Math.sqrt(Math.max(1 - y * y, 0))
  const around = share * GOLDEN_ANGLE
  out.x = ring * sin(around)
  out.y = y
  out.z = ring * cos(around)
  return out
}

/** Whether a direction is dry land: land, and no lake or river over it. */
function dryLand(map: World, direction: Vec3): boolean {
  return onLand(map, direction) && waterUnder(map, overSurface(map, direction, 0)) === DRY
}

/**
 * Where a slot's pickup of a given generation is: on a road for the most
 * part, and otherwise on dry land in its share's patch of the planet, or
 * failing that anywhere dry, floating above the ground. Bananas and health
 * packs each have the planet shared out among their own slots, so each
 * kind is spread over all of it.
 */
export function pickupSpot(map: World, slot: number, generation: number, out: Vec3 = v3()): Vec3 {
  const rng = createRng(pickupSeed(map.seed, slot, generation))
  const banana = pickupKind(slot) === 'banana'
  const shares = banana ? BANANA_SLOTS : HEALTH_SLOTS
  const share = ((banana ? slot : slot - BANANA_SLOTS) + generation * SHARE_STEP) % shares
  const onRoad = map.roads.length > 0 && rng() < ON_ROADS
  if (onRoad) {
    const spot = roadSpot(map, rng, share, shares, out)
    if (spot !== null) return spot
  }
  // The planet is cut into a patch a slot, so that pickups off the road are spread over all of it.
  const middle = patchMiddle(share, shares, v3())
  const { east, north } = tangentFrame(middle)
  const reach = Math.sqrt(4 / shares)
  const direction = v3()
  for (let attempt = 0; attempt < LAND_TRIES; attempt++) {
    // Half the tries in its own patch; if that is lake or sea, anywhere.
    if (attempt < LAND_TRIES / 2) {
      const u = (rng() * 2 - 1) * reach
      const v = (rng() * 2 - 1) * reach
      direction.x = middle.x + east.x * u + north.x * v
      direction.y = middle.y + east.y * u + north.y * v
      direction.z = middle.z + east.z * u + north.z * v
      upOf(direction, direction)
    } else randomDirection(rng, direction)
    if (!dryLand(map, direction)) continue
    return overSurface(map, direction, PICKUP_HEIGHT, out)
  }
  if (map.roads.length > 0) {
    const spot = roadSpot(map, rng, share, shares, out)
    if (spot !== null) return spot
  }
  return overSurface(map, map.districts[0]?.center ?? middle, PICKUP_HEIGHT, out)
}

/** A map's pickups, each slot's first, all out from the start. */
export function createPickups(map: World): Pickup[] {
  return Array.from({ length: PICKUP_SLOTS }, (_, slot) => ({
    generation: 0,
    spawnTick: 0,
    position: pickupSpot(map, slot, 0),
  }))
}

/** Move a slot on to another of its pickups, or to where someone else says it is. */
export function setPickup(
  map: World,
  pickup: Pickup,
  slot: number,
  generation: number,
  spawnTick: number,
): void {
  if (pickup.generation !== generation) pickupSpot(map, slot, generation, pickup.position)
  pickup.generation = generation
  pickup.spawnTick = spawnTick
}

/** A slot's spawn tick while its banana lies spilled from a wreck: it is not out on the map again until that one is taken. */
export const PICKUP_HELD = Number.MAX_SAFE_INTEGER

/** Whether a slot's pickup is out to be taken on this tick. */
export function pickupOut(pickup: Pickup, tick: number): boolean {
  return tick >= pickup.spawnTick
}

/** Whether something at this point has reached a pickup: from its own reach, or a magnet's if that is further. */
export function reachesPickup(pickup: Pickup, point: Vec3, magnet = 0): boolean {
  return within(point, pickup.position, Math.max(BANANA_REACH, magnet), Math.max(PICKUP_REACH_UP, magnet))
}

const way = v3()

/** Whether a point is within this far of another across the ground, and this far up or down. */
function within(point: Vec3, at: Vec3, reach: number, up: number): boolean {
  const dx = point.x - at.x
  const dy = point.y - at.y
  const dz = point.z - at.z
  // Further off in a straight line than across and up together could be, with a hair to spare, it is out of reach:
  // told without the root the way up takes, as nearly every pickup on the planet is from nearly every car.
  if (dx * dx + dy * dy + dz * dz > (reach * reach + up * up) * 1.001 + 1e-6) return false
  upOf(at, way)
  const rise = dx * way.x + dy * way.y + dz * way.z
  const x = dx - way.x * rise
  const y = dy - way.y * rise
  const z = dz - way.z * rise
  return Math.abs(rise) <= up && x * x + y * y + z * z <= reach * reach
}

/** How far from the wreck a spilled banana lands, in meters, at the nearest and the furthest. */
export const SPILL_NEAR = 5
export const SPILL_FAR = 16

/** How long a spilled banana is in the air, in ticks, before it can be taken. */
export const SPILL_FLIGHT_TICKS = 60

/** How many bombs, mines, oil slicks and rockets a map holds at once; past that the oldest go. Spilled bananas are held to the banana slots instead. */
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
 * knows those agrees. A machine brought down spills by its target number
 * instead of a seat, and its bananas are nobody's.
 */
export function spillFrom(
  map: World,
  from: Vec3,
  count: number,
  seat: number,
  tick: number,
  firstId: number,
  owner = seat,
): Loose[] {
  const rng = createRng(pickupSeed(map.seed, PICKUP_SLOTS + seat, tick))
  const loose: Loose[] = []
  const origin = v3(from.x, from.y, from.z)
  const { east, north } = tangentFrame(upOf(from))
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2
    const radius = SPILL_NEAR + rng() * (SPILL_FAR - SPILL_NEAR)
    const c = cos(angle) * radius
    const s = sin(angle) * radius
    const landing = upOf({ x: from.x + east.x * c + north.x * s, y: from.y + east.y * c + north.y * s, z: from.z + east.z * c + north.z * s })
    loose.push({
      id: (firstId + i) % LOOSE_IDS,
      kind: 'banana',
      owner,
      power: 0,
      from: origin,
      position: overSurface(map, landing, PICKUP_HEIGHT),
      bornTick: tick,
    })
  }
  return loose
}

/** Whether a spilled banana has landed, and can be taken. */
export function looseOut(loose: Loose, tick: number): boolean {
  return tick >= loose.bornTick + SPILL_FLIGHT_TICKS
}

/** Whether an oil slick has lain about long enough to be gone. A spilled banana lies there until it is taken, and a bomb or a mine until it goes off. */
export function looseGone(loose: Loose, tick: number): boolean {
  if (loose.kind === 'oil') return tick >= loose.bornTick + OIL_LIFE_TICKS
  return false
}

const LOOSE_REACH: Readonly<Record<LooseKind, number>> = { banana: BANANA_REACH, bomb: BOMB_REACH, mine: MINE_REACH, oil: OIL_REACH }

/** Whether something at this point has reached a loose banana, set off a bomb or a mine, or driven into oil; a banana from as far as a magnet's reach, if more. */
export function reachesLoose(loose: Loose, point: Vec3, magnet = 0): boolean {
  if (loose.kind === 'banana') return within(point, loose.position, Math.max(BANANA_REACH, magnet), Math.max(PICKUP_REACH_UP, magnet))
  return within(point, loose.position, LOOSE_REACH[loose.kind], PICKUP_REACH_UP)
}
