import { FIXED_TIMESTEP } from '@buggies/physics'
import * as exact from '@buggies/physics'
import {
  buildWaterLevels,
  DRY,
  ROAD_GRADE,
  ROAD_TUNNEL,
  roadLift,
  waterLevelAt,
  type Road,
  type RoadPoint,
  type TerrainMap,
} from '@buggies/terrain'
import {
  DEFAULT_VEHICLE_PROFILE,
  NEUTRAL_INPUT,
  addTerrain,
  applyChassisMassProperties,
  applyWaterResponse,
  applyWorldTuning,
  createPhysicsWorld,
  createVehicle,
  createVehicleTuning,
  createWorldTuning,
  resetVehicle,
  restingRideHeight,
  stepVehicle,
  worldGravity,
  wreckVehicle,
  type Vehicle,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleSpawn,
  type VehicleTuning,
  type WorldTuning,
} from '@buggies/vehicle'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, hypot } = exact

export { FIXED_TIMESTEP } from '@buggies/physics'
export {
  CHASSIS_FORWARD,
  copyVehicleInput,
  createVehicleInput,
  createVehicleStepState,
  createVehicleTuning,
  createVehicle,
  stepVehicle,
  createPhysicsWorld,
  addHeightfield,
  DAMAGE_SMOKING,
  DEFAULT_WORLD_TUNING,
  DEFAULT_VEHICLE_PROFILE,
  hurtVehicle,
  initPhysics,
  NEUTRAL_INPUT,
  readVehicleStepState,
  restingRideHeight,
  type Vehicle,
  VEHICLE_PROFILE_IDS,
  VEHICLE_PROFILE_LABELS,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleSpawn,
  type VehicleStepState,
  type VehicleTuning,
  WHEEL_CORNERS,
  WHEEL_COUNT,
  wheelMountLocal,
  type WheelState,
  worldGravity,
  wreckVehicle,
  writeVehicleStepState,
} from '@buggies/vehicle'
export type { Vec3 as Point } from '@buggies/physics'
export {
  BANANA_REACH,
  BANANA_SLOTS,
  PICKUP_HEIGHT,
  PICKUP_REACH_UP,
  PICKUP_RESPAWN_TICKS,
  PICKUP_SLOTS,
  SPILL_FAR,
  SPILL_FLIGHT_TICKS,
  SPILL_LIFE_TICKS,
  SPILL_MOST,
  SPILL_NEAR,
  SPILLED_IDS,
  SPILLED_KINDS,
  BOMB_REACH,
  LOOSE_MOST,
  pickupOut,
  pickupSeed,
  pickupSpot,
  reachesPickup,
  reachesSpilled,
  setPickup,
  spillFrom,
  spilledGone,
  spilledOut,
  type Pickup,
  type Spilled,
  type SpilledKind,
} from './pickups.ts'
export {
  BANANAS_PER_WEAPON,
  BOMB_DROP_BACK,
  BUILT_IN_GUNS,
  ENGINE_BURN_TICKS,
  ENGINE_PUSH,
  ENGINE_TOP_SPEED,
  MACHINE_GUN_AMMO_TICKS,
  MACHINE_GUN_DAMAGE,
  MACHINE_GUN_RANGE,
  MACHINE_GUN_SHOT_TICKS,
  MACHINE_GUN_SWEEP_COS,
  MOUNT_HEIGHT,
  NO_TARGET,
  ROCKET_DAMAGE,
  ROCKET_LIFE_TICKS,
  ROCKET_LOCK_RANGE,
  ROCKET_REACH,
  ROCKET_SPEED,
  WEAPON_LABELS,
  WEAPONS,
  WINGS_CLIMB_PUSH,
  WINGS_CLIMB_SPEED,
  WINGS_FLIGHT_TICKS,
  WINGS_TURN,
  ammoFor,
  arm,
  burning,
  disarm,
  fireWeapons,
  flyRockets,
  hasBuiltInGun,
  mountPoint,
  muzzlePoint,
  pushWithWeapons,
  rocketId,
  weaponWon,
  type Battlefield,
  type Gunner,
  type Muzzle,
  type Rocket,
  type Shot,
  type Weapon,
} from './weapons.ts'

import {
  BANANAS_PER_WEAPON,
  NO_TARGET,
  arm,
  burning,
  disarm,
  fireWeapons,
  flyRockets,
  pushWithWeapons,
  weaponWon,
  type Rocket,
  type Shot,
  type Weapon,
} from './weapons.ts'
import {
  createPickups,
  pickupOut,
  reachesPickup,
  reachesSpilled,
  setPickup,
  spillFrom,
  spilledGone,
  spilledOut,
  PICKUP_RESPAWN_TICKS,
  SPILL_MOST,
  LOOSE_MOST,
  SPILLED_IDS,
  type Pickup,
  type Spilled,
} from './pickups.ts'

/** How many vehicles a map is laid out for. Every seat exists from the start. */
export const MAX_PLAYERS = 8

/** Nose to tail along the road, with room to pull out. */
const SPAWN_SPACING = 9

/** How far along a road to look for the next point when facing a vehicle. */
const FACING_REACH = 3

/**
 * A place for one vehicle. Seats are created with the arena and never go
 * away: a player takes one, drives, and leaves it for the next. The epoch
 * counts the times the vehicle has been put back on its spawn, so anyone
 * watching from outside can tell a teleport from a drive.
 */
export interface Seat {
  readonly id: number
  readonly spawn: VehicleSpawn
  readonly vehicle: Vehicle
  tuning: VehicleTuning
  profile: VehicleProfileId
  occupied: boolean
  epoch: number
  /** How much of the chassis is under water, as of the last step. */
  submersion: number
  /** Consecutive steps spent sunk or off the map. */
  lostTicks: number
  /** Bananas taken since sitting down. */
  score: number
  /** What it is carrying over its roof, won with bananas, and how long the machine gun has left. */
  weapon: Weapon
  ammoTicks: number
  /** The seat the machine gun is trained on, or none. */
  aimTarget: number
}

/**
 * A map with vehicles on it. Unlike the rest of buggies this is not a value
 * that gets replaced each step: a physics world is a live thing that is
 * advanced in place, and every handle in here points into it.
 */
export interface Arena {
  readonly map: TerrainMap
  readonly world: RAPIER.World
  readonly worldTuning: WorldTuning
  readonly seats: readonly Seat[]
  /** Water surface per terrain cell, for whatever a vehicle is sitting in. */
  readonly water: Float32Array
  /** The map's bananas, a slot each, for the taking. */
  readonly pickups: readonly Pickup[]
  /** What lies loose: bananas spilled from wrecks, until taken, and bombs dropped from cars, until set off. */
  spilled: Spilled[]
  /** The number the next banana spilled gets. */
  spilledNext: number
  /** Rockets in the air. Replaced whole by the server's word. */
  rockets: Rocket[]
  /** The machine gun shots of the last tick, for drawing. */
  readonly shots: Shot[]
  tick: number
}

/** A sample of a road: the point, and where along the road it is. */
interface RoadSpot {
  road: Road
  index: number
  point: RoadPoint
}

function spawnAt(spot: RoadSpot): VehicleSpawn {
  const { road, index, point } = spot
  const count = road.points.length
  const ahead = road.points[Math.min(index + FACING_REACH, count - 1)] ?? point
  return {
    position: { x: point.x, y: point.y + roadLift(road), z: point.z },
    // A chassis faces its own -Z, so a yaw of zero looks down -Z too.
    yaw: atan2(-(ahead.x - point.x), -(ahead.z - point.z)),
  }
}

/** A spawn at a spot, facing whichever way along the road is nearer to `forward`. */
function spawnFacing(spot: RoadSpot, forward: { x: number; z: number }): VehicleSpawn {
  const { road, index, point } = spot
  const count = road.points.length
  // Wrapped round a loop or held at an end, so always one of the road's points.
  const at = (i: number): RoadPoint =>
    road.points[road.closed ? ((i % count) + count) % count : Math.min(Math.max(i, 0), count - 1)]!
  const ahead = at(index + FACING_REACH)
  const behind = at(index - FACING_REACH)
  let dx = ahead.x - point.x
  let dz = ahead.z - point.z
  if (dx * forward.x + dz * forward.z < 0) {
    dx = point.x - behind.x
    dz = point.z - behind.z
  }
  if (hypot(dx, dz) < 1e-6) return spawnAt(spot)
  return {
    position: { x: point.x, y: point.y + roadLift(road), z: point.z },
    yaw: atan2(-dx, -dz),
  }
}

/** The road point nearest a position, on any road that is not a tunnel. */
function nearestRoadSpotTo(map: TerrainMap, x: number, z: number): RoadSpot | null {
  let best: RoadSpot | null = null
  let bestDistance = Infinity
  for (const road of map.roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (const [i, point] of road.points.entries()) {
      if (i >= segmentCount) break
      if (road.structure[i] === ROAD_TUNNEL) continue
      const distance = hypot(point.x - x, point.z - z)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = { road, index: i, point }
    }
  }
  return best
}

/**
 * The road point nearest the middle of the first city, at grade: on the
 * highway for preference, which loops and so never runs out ahead of a car
 * setting off, and on any road only where there is no highway to be had.
 */
function nearestGradeSpot(map: TerrainMap): RoadSpot | null {
  const highways = map.roads.filter((road) => road.kind === 'highway')
  return nearestGradeSpotOn(map, highways) ?? nearestGradeSpotOn(map, map.roads)
}

function nearestGradeSpotOn(map: TerrainMap, roads: Road[]): RoadSpot | null {
  const worldSize = map.size * map.cellSize
  const district = map.districts[0]
  const targetX = district?.cx ?? worldSize / 2
  const targetZ = district?.cz ?? worldSize / 2

  let best: RoadSpot | null = null
  let bestDistance = Infinity
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (const [i, point] of road.points.entries()) {
      if (i >= segmentCount) break
      if (road.structure[i] !== ROAD_GRADE) continue
      const distance = hypot(point.x - targetX, point.z - targetZ)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = { road, index: i, point }
    }
  }
  return best
}

/**
 * Points along a road from a starting index, one every `spacing` metres,
 * walking in one direction until the road ends or leaves the ground. Road
 * points can be centimetres apart, so distance is measured, not counted.
 */
function spotsAlong(from: RoadSpot, spacing: number, step: 1 | -1, wanted: number): RoadSpot[] {
  const { road } = from
  const segmentCount = road.closed ? road.points.length : road.points.length - 1
  const spots: RoadSpot[] = []
  let travelled = 0
  let index = from.index
  let point = from.point
  while (spots.length < wanted) {
    const next = index + step
    if (next < 0 || next >= segmentCount) break
    if (road.structure[Math.min(index, next)] !== ROAD_GRADE) break
    const ahead = road.points[next]
    if (ahead === undefined) break
    travelled += hypot(ahead.x - point.x, ahead.z - point.z)
    index = next
    point = ahead
    if (travelled < spacing) continue
    spots.push({ road, index, point })
    travelled = 0
  }
  return spots
}

/**
 * Somewhere worth starting, for each of `count` vehicles: on a road, at
 * grade, as near the middle of the first city as one runs, lined up one
 * behind the other. Cities are where the map is densest, so that is the most
 * interesting place to be dropped.
 */
export function findSpawns(map: TerrainMap, count: number): VehicleSpawn[] {
  const first = nearestGradeSpot(map)
  if (first === null) {
    const worldSize = map.size * map.cellSize
    const middle = { x: worldSize / 2, y: 0, z: worldSize / 2 }
    return Array.from({ length: count }, (_, i) => ({
      position: { ...middle, z: middle.z + i * SPAWN_SPACING },
      yaw: 0,
    }))
  }

  // Behind the first spot for preference, so the front car is the one nearest
  // the city; ahead of it when the road behind runs out.
  const spots = [first, ...spotsAlong(first, SPAWN_SPACING, -1, count - 1)]
  spots.push(...spotsAlong(first, SPAWN_SPACING, 1, count - spots.length))
  // A road too short for the field stacks the rest on its last spot rather
  // than leaving seats with nowhere to be.
  while (spots.length < count) spots.push(spots.at(-1) ?? first)
  return spots.map(spawnAt)
}

export function createArena(map: TerrainMap, seatCount = MAX_PLAYERS): Arena {
  const worldTuning = createWorldTuning()
  const world = createPhysicsWorld(worldTuning)
  addTerrain(world, map)

  const seats: Seat[] = findSpawns(map, seatCount).map((spawn, id) => {
    const tuning = createVehicleTuning()
    const vehicle = createVehicle(world, tuning, spawn)
    // An empty seat's vehicle is out of the world entirely, not parked on the
    // road for everyone else to hit.
    vehicle.body.setEnabled(false)
    return {
      id,
      spawn,
      vehicle,
      tuning,
      profile: DEFAULT_VEHICLE_PROFILE,
      occupied: false,
      epoch: 0,
      submersion: 0,
      lostTicks: 0,
      score: 0,
      weapon: 'none',
      ammoTicks: 0,
      aimTarget: NO_TARGET,
    }
  })

  // Queries read the structures a step builds, so until the world has taken
  // one there is nothing for a wheel to find: the first frame would come back
  // with every ray missing and drop the vehicle through the road.
  world.step()

  const water = buildWaterLevels(map)
  return {
    map,
    world,
    worldTuning,
    seats,
    water,
    pickups: createPickups(map, water),
    spilled: [],
    spilledNext: 0,
    rockets: [],
    shots: [],
    tick: 0,
  }
}

function nextEpoch(epoch: number): number {
  return (epoch + 1) & 0xff
}

/**
 * Give a vehicle a different body: the chassis box and its mass follow the
 * profile, and so does how high it rests on its springs, which is what a
 * reset places it by.
 */
function reshape(arena: Arena, seat: Seat, profile: VehicleProfileId): void {
  seat.profile = profile
  seat.tuning = createVehicleTuning(profile)
  applyChassisMassProperties(seat.vehicle, seat.tuning)
  seat.vehicle.rideHeight = restingRideHeight(seat.tuning, worldGravity(arena.world))
}

/** Put a vehicle back on its spawn, or another, at rest, and count the reset. */
export function respawn(seat: Seat, spawn: VehicleSpawn = seat.spawn): void {
  // A wreck comes back whole; a car only put back, out of the water or
  // onto the road, keeps the knocks it had.
  const { damage, wrecked } = seat.vehicle
  resetVehicle(seat.vehicle, spawn)
  if (!wrecked) seat.vehicle.damage = damage
  seat.epoch = nextEpoch(seat.epoch)
  seat.submersion = 0
  seat.lostTicks = 0
}

/**
 * Put a vehicle back on the road nearest to where it is, facing the way it
 * was going, rather than all the way back at its spawn: a car that has come
 * to grief carries on from about where it did.
 */
export function respawnNearby(arena: Arena, seat: Seat): void {
  const { position, forward } = seat.vehicle.frame
  const spot = nearestRoadSpotTo(arena.map, position.x, position.z)
  respawn(seat, spot === null ? seat.spawn : spawnFacing(spot, forward))
}

/**
 * Put someone in a different vehicle where they are: on the road nearest to
 * where the old one was, facing the way it was going. The map, and the rest
 * of the arena, go on as they were.
 */
export function changeVehicle(arena: Arena, seat: Seat, profile: VehicleProfileId): void {
  const { position, forward } = seat.vehicle.frame
  const spot = nearestRoadSpotTo(arena.map, position.x, position.z)
  const spawn = spot === null ? seat.spawn : spawnFacing(spot, forward)
  reshape(arena, seat, profile)
  respawn(seat, spawn)
}

/** Put someone in a seat, in the vehicle they asked for, on the spawn. */
export function takeSeat(arena: Arena, id: number, profile: VehicleProfileId): Seat {
  const seat = arena.seats[id]
  if (seat === undefined) throw new RangeError(`no seat ${id}`)
  reshape(arena, seat, profile)
  seat.occupied = true
  seat.score = 0
  disarm(seat)
  seat.vehicle.body.setEnabled(true)
  respawn(seat)
  return seat
}

/** Take a vehicle out of the world. The seat keeps its epoch for the next occupant. */
export function leaveSeat(arena: Arena, id: number): void {
  const seat = arena.seats[id]
  if (seat === undefined || !seat.occupied) return
  seat.occupied = false
  seat.score = 0
  disarm(seat)
  seat.vehicle.body.setEnabled(false)
}

/** The first free seat, or nothing when the map is full. */
export function freeSeat(arena: Arena): Seat | undefined {
  return arena.seats.find((seat) => !seat.occupied)
}

export function occupiedSeats(arena: Arena): Seat[] {
  return arena.seats.filter((seat) => seat.occupied)
}

/** Water surface where a vehicle is, or nothing at all where it is dry. */
function waterUnder(arena: Arena, seat: Seat): number {
  const { x, z } = seat.vehicle.frame.position
  return waterLevelAt(arena.map.heightfield, arena.water, x, z)
}

/**
 * Advance the arena by exactly one fixed step, driving every occupied seat
 * with whatever its driver asks for. `stepVehicle` only applies forces, so
 * the world is stepped once afterwards however many vehicles were driven
 * into it.
 */
export function advance(
  arena: Arena,
  inputFor: (seat: Seat) => VehicleInput = () => NEUTRAL_INPUT,
  dt = FIXED_TIMESTEP,
): void {
  applyWorldTuning(arena.world, arena.worldTuning)
  const gravity = worldGravity(arena.world)
  for (const seat of arena.seats) {
    if (!seat.occupied) continue
    const input = inputFor(seat)
    // A car its engine or wings are driving along is not one the tyres hold
    // still, and one its wings are lifting is not one the road holds down.
    const lit = burning(seat, input.fire)
    seat.vehicle.boosted = lit
    seat.vehicle.lifted = lit && seat.weapon === 'wings'
    stepVehicle(arena.world, seat.vehicle, seat.tuning, input, dt)
    pushWithWeapons(seat, gravity)
    const level = waterUnder(arena, seat)
    seat.submersion =
      level === DRY ? 0 : applyWaterResponse(seat.vehicle, seat.tuning, arena.worldTuning, level)
  }
  arena.world.step()
  arena.tick += 1
  collectPickups(arena)
  spillBananas(arena)
  fireWeapons(arena)
  flyRockets(arena, dt)
  trimLoose(arena)
}

/**
 * Only so much lies loose on a map at once, bananas, bombs and rockets
 * together; past that the oldest go, whichever they are.
 */
function trimLoose(arena: Arena): void {
  while (arena.spilled.length + arena.rockets.length > LOOSE_MOST) {
    const loose = arena.spilled[0]
    const rocket = arena.rockets[0]
    if (rocket === undefined || (loose !== undefined && loose.bornTick <= rocket.bornTick)) arena.spilled.shift()
    else arena.rockets.shift()
  }
}

/** A banana taken: a point, and every so many of them something to fire. */
function score(arena: Arena, seat: Seat): void {
  seat.score += 1
  if (seat.score % BANANAS_PER_WEAPON === 0) arm(seat, weaponWon(arena.map.seed, seat.id, arena.tick, seat.score))
}

/**
 * A car blown up spills its bananas: they fly out of the blast and land
 * about the wreck, for anyone to come and take. Only so many come out of
 * one blast, and a map only holds so many, the oldest going first.
 */
function spillBananas(arena: Arena): void {
  for (const seat of arena.seats) {
    if (!seat.occupied || !seat.vehicle.wrecked || seat.score === 0) continue
    const count = Math.min(seat.score, SPILL_MOST)
    arena.spilled.push(
      ...spillFrom(arena.map, seat.vehicle.frame.position, count, seat.id, arena.tick, arena.spilledNext),
    )
    arena.spilledNext = (arena.spilledNext + count) % SPILLED_IDS
    seat.score = 0
  }
}

/**
 * Every banana a vehicle has reached is taken, a point to whoever reached
 * it, and its slot moves on to the next, to turn up elsewhere in a while.
 * A wreck takes nothing.
 */
function collectPickups(arena: Arena): void {
  for (const [slot, pickup] of arena.pickups.entries()) {
    if (!pickupOut(pickup, arena.tick)) continue
    for (const seat of arena.seats) {
      if (!seat.occupied || seat.vehicle.wrecked || !reachesPickup(pickup, seat.vehicle.frame.position)) continue
      score(arena, seat)
      setPickup(arena.map, arena.water, pickup, slot, pickup.generation + 1, arena.tick + PICKUP_RESPAWN_TICKS)
      break
    }
  }
  // Spilled bananas go the same way, or fade if nobody comes for them; a
  // bomb goes off on the first car to reach it once it has landed. Walked
  // from the end, so taking one out moves nothing still to come, and i
  // stays within the list.
  for (let i = arena.spilled.length - 1; i >= 0; i--) {
    const spilled = arena.spilled[i]!
    if (spilledGone(spilled, arena.tick)) {
      arena.spilled.splice(i, 1)
      continue
    }
    if (!spilledOut(spilled, arena.tick)) continue
    for (const seat of arena.seats) {
      if (!seat.occupied || seat.vehicle.wrecked || !reachesSpilled(spilled, seat.vehicle.frame.position)) continue
      if (spilled.kind === 'bomb') wreckVehicle(seat.vehicle, seat.tuning)
      else score(arena, seat)
      arena.spilled.splice(i, 1)
      break
    }
  }
}

/** Under this much water a vehicle is not coming back on its own. */
const SUNK = 0.6

/** How far beneath the sea a vehicle can be before it has left the map. */
const ABYSS = 5

/** How long a vehicle stays lost before it is put back, in steps. */
const LOST_PATIENCE = 180
/** A wreck lies a little longer, to be watched burning. */
const WRECK_PATIENCE = 270

/**
 * Whether a vehicle is done driving for now: blown up, deep in the water,
 * fallen through the world, or off the edge of it.
 */
export function isLost(arena: Arena, seat: Seat): boolean {
  const { x, y, z } = seat.vehicle.frame.position
  const worldSize = arena.map.size * arena.map.cellSize
  return (
    seat.vehicle.wrecked ||
    seat.submersion > SUNK ||
    y < arena.map.seaLevel - ABYSS ||
    x < 0 ||
    z < 0 ||
    x > worldSize ||
    z > worldSize
  )
}

/**
 * Respawn whoever has been lost for long enough that they are not getting
 * out. Kept apart from `advance` so a mirror of somebody else's arena can
 * step without ever deciding a respawn for them: that is the owner's call.
 * Returns the seats put back.
 */
export function respawnLost(arena: Arena): Seat[] {
  const respawned: Seat[] = []
  for (const seat of arena.seats) {
    if (!seat.occupied) continue
    seat.lostTicks = isLost(arena, seat) ? seat.lostTicks + 1 : 0
    if (seat.lostTicks < (seat.vehicle.wrecked ? WRECK_PATIENCE : LOST_PATIENCE)) continue
    respawnNearby(arena, seat)
    respawned.push(seat)
  }
  return respawned
}
