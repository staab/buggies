import { FIXED_TIMESTEP } from '@buggies/physics'
import { buildWaterLevels, DRY, waterLevelAt, type Prop, type PropKind, type TerrainMap } from '@buggies/terrain'
import {
  DEFAULT_VEHICLE_PROFILE,
  NEUTRAL_INPUT,
  CONE_SIDES,
  PROP_SHAPES,
  addProp,
  addTerrain,
  propRise,
  propRotation,
  applyChassisMassProperties,
  applyWaterResponse,
  applyWorldTuning,
  createPhysicsWorld,
  createVehicle,
  createVehicleTuning,
  createWorldTuning,
  hurtVehicle,
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

import { findSpawns, nearestRoadSpotTo, spawnFacing } from './spawns.ts'

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
  CONE_SIDES,
  PROP_SHAPES,
  addHeightfield,
  addProp,
  propRise,
  propRotation,
  type PropShape,
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
export { findSpawns } from './spawns.ts'
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
  LOOSE_IDS,
  LOOSE_KINDS,
  BOMB_REACH,
  LOOSE_MOST,
  pickupOut,
  pickupSeed,
  pickupSpot,
  reachesPickup,
  reachesLoose,
  setPickup,
  spillFrom,
  looseGone,
  looseOut,
  type Pickup,
  type Loose,
  type LooseKind,
} from './pickups.ts'
export {
  AMBULANCE_HEAL,
  AMBULANCE_HEAL_TICKS,
  BANANAS_PER_WEAPON,
  BOMB_DAMAGE,
  BOMB_DROP_BACK,
  BUILT_IN_GUNS,
  EMERGENCY_VEHICLES,
  ENGINE_BURN_TICKS,
  ENGINE_PUSH,
  ENGINE_TOP_SPEED,
  MACHINE_GUN_AMMO_TICKS,
  MACHINE_GUN_DAMAGE,
  MACHINE_GUN_RANGE,
  MACHINE_GUN_SHOT_TICKS,
  MACHINE_GUN_SWEEP_COS,
  FIRETRUCK_BOMB_SHARE,
  MOUNT_HEIGHT,
  NATURE_NOTES,
  NOSE_UP,
  NO_TARGET,
  OWN_BOMBS_MOST,
  OWN_BOMB_POWER,
  OWN_GUN_POWER,
  OWN_LIFT,
  OWN_MISSILE_POWER,
  POLICE_SHOT_SHARE,
  ROCKETS_COUNTED,
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
  WINGS_THRUST,
  WINGS_HOVER_TURN,
  WINGS_LEAN,
  WINGS_TURN_MIN_SPEED,
  WINGS_TURN_WIDEN,
  BOOST_PUSH,
  EMERGENCY_SLOW,
  HOP_SPEED,
  HORN_RANGE,
  HORN_STUN_TICKS,
  OWN_ACTIONS,
  SHOCKWAVE_RANGE,
  SHOCKWAVE_STUN_TICKS,
  SIREN_RANGE,
  SIREN_SLOW,
  SIREN_TICKS,
  SLOW_DRAG,
  SLOW_HOLD_TICKS,
  acting,
  ammoFor,
  arm,
  bombShare,
  burning,
  disarm,
  fireWeapons,
  flyRockets,
  hasBuiltInGun,
  hinder,
  lifting,
  mend,
  mountPoint,
  muzzlePoint,
  nosePoint,
  ownAction,
  pushWithWeapons,
  restAction,
  rocketId,
  shotShare,
  slowable,
  stunned,
  weaponWon,
  winged,
  wingsTurnRadius,
  type Battlefield,
  type Gunner,
  type WeaponKeys,
  type Muzzle,
  type OwnAction,
  type OwnActionKind,
  type Rocket,
  type Shot,
  type Weapon,
} from './weapons.ts'

import {
  BANANAS_PER_WEAPON,
  BOMB_DAMAGE,
  NO_TARGET,
  arm,
  bombShare,
  burning,
  disarm,
  fireWeapons,
  flyRockets,
  hinder,
  lifting,
  mend,
  pushWithWeapons,
  restAction,
  stunned,
  weaponWon,
  winged,
  type Rocket,
  type Shot,
  type Weapon,
} from './weapons.ts'
import {
  createPickups,
  pickupOut,
  reachesPickup,
  reachesLoose,
  setPickup,
  spillFrom,
  looseGone,
  looseOut,
  PICKUP_RESPAWN_TICKS,
  SPILL_MOST,
  LOOSE_MOST,
  LOOSE_IDS,
  type Pickup,
  type Loose,
} from './pickups.ts'

/** How many vehicles a map is laid out for. Every seat exists from the start. */
export const MAX_PLAYERS = 8

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
  /** The car's own action, had besides what it carries: how long it is seen going for, how long before it may go again, and whether its lights are on. */
  actionTicks: number
  cooldownTicks: number
  lightsOn: boolean
  /** Whether the car's own key was down last tick, so that a press is told from a hold. */
  abilityHeld: boolean
  /** How many rockets it has fired, which numbers the next. */
  rocketsFired: number
  /** How long it is stunned for, taking no driving, and slowed for, held back by this share of a full slow. */
  stunnedTicks: number
  slowedTicks: number
  slowedBy: number
}

/**
 * A prop in the arena: a crate, a barrel, a cone or a bale, as a body the
 * physics steps, and where the map stands it, for putting it back.
 */
export interface ArenaProp {
  readonly id: number
  readonly kind: PropKind
  readonly body: RAPIER.RigidBody
  readonly home: Prop
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
  loose: Loose[]
  /** The number the next banana spilled gets. */
  looseNext: number
  /** Rockets in the air. Replaced whole by the server's word. */
  rockets: Rocket[]
  /** The machine gun shots of the last tick, for drawing. */
  readonly shots: Shot[]
  /** The props, numbered as the map lists them, each a body the physics steps. */
  readonly props: readonly ArenaProp[]
  tick: number
}

export function createArena(map: TerrainMap, seatCount = MAX_PLAYERS): Arena {
  const worldTuning = createWorldTuning()
  const world = createPhysicsWorld(worldTuning)
  addTerrain(world, map)
  const props: ArenaProp[] = map.props.map((home, id) => ({ id, kind: home.kind, body: addProp(world, home), home }))

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
      actionTicks: 0,
      cooldownTicks: 0,
      lightsOn: false,
      abilityHeld: false,
      rocketsFired: 0,
      stunnedTicks: 0,
      slowedTicks: 0,
      slowedBy: 0,
    }
  })

  // Queries read the structures a step builds, so until the world has taken
  // one there is nothing for a wheel to find: the first frame would come back
  // with every ray missing and drop the vehicle through the road.
  world.step()

  const water = buildWaterLevels(map)
  return {
    props,
    map,
    world,
    worldTuning,
    seats,
    water,
    pickups: createPickups(map, water),
    loose: [],
    looseNext: 0,
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
  restAction(seat)
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
  restAction(seat)
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
 * the world is stepped once afterward however many vehicles were driven
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
    // A stunned car takes no driving.
    const input = stunned(seat) ? NEUTRAL_INPUT : inputFor(seat)
    // A car its engine or wings are driving along is not one the tires hold
    // still, and one its wings are lifting is not one the road holds down.
    seat.vehicle.boosted = burning(seat, input)
    seat.vehicle.lifted = lifting(seat, input)
    // One carrying wings is held level and steered by them in the air, lifted or not.
    seat.vehicle.winged = winged(seat)
    stepVehicle(arena.world, seat.vehicle, seat.tuning, input, dt)
    pushWithWeapons(seat, gravity)
    hinder(seat)
    mend(seat)
    const level = waterUnder(arena, seat)
    seat.submersion =
      level === DRY ? 0 : applyWaterResponse(seat.vehicle, seat.tuning, arena.worldTuning, level)
  }
  arena.world.step()
  arena.tick += 1
  restoreProps(arena)
  collectPickups(arena)
  spillBananas(arena)
  fireWeapons(arena)
  armFromBananas(arena)
  flyRockets(arena, dt)
  trimLoose(arena)
}

/**
 * A prop that has fallen off the map, into the sea or over its edge, is
 * put back where the map stands it, at rest.
 */
function restoreProps(arena: Arena): void {
  const worldSize = arena.map.size * arena.map.cellSize
  for (const prop of arena.props) {
    const { x, y, z } = prop.body.translation()
    if (y >= arena.map.seaLevel - ABYSS && x >= 0 && z >= 0 && x <= worldSize && z <= worldSize) continue
    putPropBack(prop)
  }
}

/** Stand a prop back where the map has it, at rest. */
export function putPropBack(prop: ArenaProp): void {
  const { body, home, kind } = prop
  body.setTranslation({ x: home.x, y: home.bottom + propRise(kind), z: home.z }, true)
  body.setRotation(propRotation(kind, home.yaw), true)
  body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)
}

/**
 * Only so much lies loose on a map at once, bananas, bombs and rockets
 * together; past that the oldest go, whichever they are.
 */
function trimLoose(arena: Arena): void {
  while (arena.loose.length + arena.rockets.length > LOOSE_MOST) {
    const loose = arena.loose[0]
    const rocket = arena.rockets[0]
    if (rocket === undefined || (loose !== undefined && loose.bornTick <= rocket.bornTick)) arena.loose.shift()
    else arena.rockets.shift()
  }
}

/** A banana taken: one more to spend. */
function score(seat: Seat): void {
  seat.score += 1
}

/**
 * Bananas buy weapons: a car carrying nothing that has enough of them
 * spends that many on the next weapon, at once, whether it has just taken
 * a banana or just used the last of what it had. Taking a banana while
 * armed keeps it for later, and never replaces what is carried.
 */
function armFromBananas(arena: Arena): void {
  for (const seat of arena.seats) {
    if (!seat.occupied || seat.vehicle.wrecked || seat.weapon !== 'none' || seat.score < BANANAS_PER_WEAPON) continue
    seat.score -= BANANAS_PER_WEAPON
    arm(seat, weaponWon(arena.map.seed, seat.id, arena.tick, seat.score))
  }
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
    arena.loose.push(
      ...spillFrom(arena.map, seat.vehicle.frame.position, count, seat.id, arena.tick, arena.looseNext),
    )
    arena.looseNext = (arena.looseNext + count) % LOOSE_IDS
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
      score(seat)
      setPickup(arena.map, arena.water, pickup, slot, pickup.generation + 1, arena.tick + PICKUP_RESPAWN_TICKS)
      break
    }
  }
  // Spilled bananas go the same way, or fade if nobody comes for them; a
  // bomb goes off on the first car to reach it once it has landed, with
  // whatever it has of a full blast, and the car takes of that what its
  // nature lets it. Walked from the end, so taking one out moves nothing
  // still to come, and i stays within the list.
  for (let i = arena.loose.length - 1; i >= 0; i--) {
    const loose = arena.loose[i]!
    if (looseGone(loose, arena.tick)) {
      arena.loose.splice(i, 1)
      continue
    }
    if (!looseOut(loose, arena.tick)) continue
    for (const seat of arena.seats) {
      if (!seat.occupied || seat.vehicle.wrecked || !reachesLoose(loose, seat.vehicle.frame.position)) continue
      if (loose.kind === 'bomb') hurtVehicle(seat.vehicle, seat.tuning, BOMB_DAMAGE * loose.power * bombShare(seat.profile))
      else score(seat)
      arena.loose.splice(i, 1)
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
