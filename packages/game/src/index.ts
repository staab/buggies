import { FIXED_TIMESTEP } from '@buggies/physics'
import {
  DRY,
  ROAD_GRADE,
  ROAD_SURFACE,
  buildWaterLevels,
  waterLevelAt,
  type Road,
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
  type Vehicle,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleSpawn,
  type VehicleTuning,
  type WorldTuning,
} from '@buggies/vehicle'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export { FIXED_TIMESTEP } from '@buggies/physics'
export {
  CHASSIS_FORWARD,
  DEFAULT_VEHICLE_PROFILE,
  NEUTRAL_INPUT,
  VEHICLE_PROFILE_IDS,
  VEHICLE_PROFILE_LABELS,
  WHEEL_CORNERS,
  WHEEL_COUNT,
  copyVehicleInput,
  createVehicleInput,
  createVehicleStepState,
  createVehicleTuning,
  initPhysics,
  readVehicleStepState,
  restingRideHeight,
  wheelMountLocal,
  writeVehicleStepState,
  type Vehicle,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleSpawn,
  type VehicleStepState,
  type VehicleTuning,
  type WheelState,
} from '@buggies/vehicle'
export type { Vec3 as Point } from '@buggies/physics'

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
  tick: number
}

interface RoadSpot {
  road: Road
  index: number
}

function spawnAt(spot: RoadSpot): VehicleSpawn {
  const { road, index } = spot
  const count = road.points.length
  const point = road.points[index]!
  const ahead = road.points[Math.min(index + FACING_REACH, count - 1)] ?? point
  return {
    position: { x: point.x, y: point.y + ROAD_SURFACE, z: point.z },
    // A chassis faces its own -Z, so a yaw of zero looks down -Z too.
    yaw: Math.atan2(-(ahead.x - point.x), -(ahead.z - point.z)),
  }
}

/** The road point nearest the middle of the first city, at grade. */
function nearestGradeSpot(map: TerrainMap): RoadSpot | null {
  const worldSize = map.size * map.cellSize
  const district = map.districts[0]
  const targetX = district?.cx ?? worldSize / 2
  const targetZ = district?.cz ?? worldSize / 2

  let best: RoadSpot | null = null
  let bestDistance = Infinity
  for (const road of map.roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const point = road.points[i]!
      const distance = Math.hypot(point.x - targetX, point.z - targetZ)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = { road, index: i }
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
  while (spots.length < wanted) {
    const next = index + step
    if (next < 0 || next >= segmentCount) break
    if (road.structure[Math.min(index, next)] !== ROAD_GRADE) break
    const a = road.points[index]!
    const b = road.points[next]!
    travelled += Math.hypot(b.x - a.x, b.z - a.z)
    index = next
    if (travelled < spacing) continue
    spots.push({ road, index })
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
  while (spots.length < count) spots.push(spots[spots.length - 1]!)
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
    }
  })

  // Queries read the structures a step builds, so until the world has taken
  // one there is nothing for a wheel to find: the first frame would come back
  // with every ray missing and drop the vehicle through the road.
  world.step()

  return { map, world, worldTuning, seats, water: buildWaterLevels(map), tick: 0 }
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

/** Put a vehicle back on its spawn, at rest, and count the reset. */
export function respawn(seat: Seat): void {
  resetVehicle(seat.vehicle, seat.spawn)
  seat.epoch = nextEpoch(seat.epoch)
  seat.submersion = 0
  seat.lostTicks = 0
}

/** Put someone in a seat, in the vehicle they asked for, on the spawn. */
export function takeSeat(arena: Arena, id: number, profile: VehicleProfileId): Seat {
  const seat = arena.seats[id]
  if (seat === undefined) throw new RangeError(`no seat ${id}`)
  reshape(arena, seat, profile)
  seat.occupied = true
  seat.vehicle.body.setEnabled(true)
  respawn(seat)
  return seat
}

/** Take a vehicle out of the world. The seat keeps its epoch for the next occupant. */
export function leaveSeat(arena: Arena, id: number): void {
  const seat = arena.seats[id]
  if (seat === undefined || !seat.occupied) return
  seat.occupied = false
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
  for (const seat of arena.seats) {
    if (!seat.occupied) continue
    stepVehicle(arena.world, seat.vehicle, seat.tuning, inputFor(seat), dt)
    const level = waterUnder(arena, seat)
    seat.submersion =
      level === DRY ? 0 : applyWaterResponse(seat.vehicle, seat.tuning, arena.worldTuning, level)
  }
  arena.world.step()
  arena.tick += 1
}

/** Under this much water a vehicle is not coming back on its own. */
const SUNK = 0.6

/** How far beneath the sea a vehicle can be before it has left the map. */
const ABYSS = 5

/** How long a vehicle stays lost before it is put back, in steps. */
const LOST_PATIENCE = 180

/**
 * Whether a vehicle is somewhere it cannot drive out of: deep in the water,
 * fallen through the world, or off the edge of it.
 */
export function isLost(arena: Arena, seat: Seat): boolean {
  const { x, y, z } = seat.vehicle.frame.position
  const worldSize = arena.map.size * arena.map.cellSize
  return (
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
    if (seat.lostTicks < LOST_PATIENCE) continue
    respawn(seat)
    respawned.push(seat)
  }
  return respawned
}
