import { FIXED_TIMESTEP, uprightRotation, v3, vaddScaled, vdistance, vdot } from '@buggies/physics'
import { DRY, alongGround, heightOver, upOf, waterUnder, type PropKind, type World, type WorldProp } from '@buggies/terrain'
import {
  DEFAULT_VEHICLE_PROFILE,
  NEUTRAL_INPUT,
  addProp,
  addTerrain,
  propPlacement,
  applyChassisMassProperties,
  applyWaterResponse,
  applyWorldTuning,
  createPhysicsWorld,
  pullBody,
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

import type { Goal } from './goals.ts'
import { createBoats, moveBoat, type Boat } from './boats.ts'
import { createSpiders, rebuildSpider, SPIDER_BELLY, walkSpider, type Spider } from './spiders.ts'
import { createUfos, flyUfo, rebuildUfo, type Ufo } from './ufos.ts'
import { NPC_FRAGILITY, NPC_PROFILES, UNSTUCK_AHEAD, createDriver, drive, driverSpawn, type Driver, type DriverCommand } from './npcs.ts'
import {
  ROBOT_COOLDOWN_TICKS,
  ROBOT_DAMAGE,
  ROBOT_RANGE,
  ROBOT_BEAM_TICKS,
  createRobots,
  rebuildRobot,
  robotEyes,
  seatRobotBody,
  walkRobot,
  type Robot,
} from './robots.ts'
import { CEILING } from './sky.ts'
import { findSpawns, forwardOf, nearestRoadSpotTo, spawnFacing } from './spawns.ts'

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
  PROP_SHAPES,
  addHeightfield,
  addProp,
  levelSpawn,
  propRise,
  propRotation,
  type PropShape,
  DAMAGE_SMOKING,
  DEFAULT_WORLD_TUNING,
  DEFAULT_VEHICLE_PROFILE,
  armorShare,
  DURABILITY,
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
export { portalCrossed, portalLink, portalSpawn } from './portals.ts'
export { CEILING, CLOUD_HEIGHT, DAY_SECONDS, sunDirection } from './sky.ts'
export {
  UFOS,
  UFO_BEAM_REACH,
  UFO_CARRY_SPEED,
  UFO_COOLDOWN_TICKS,
  UFO_CRUISE,
  UFO_HOVER,
  UFO_HUNT_RANGE,
  UFO_LIFT_TICKS,
  UFO_STATES,
  type Ufo,
  type UfoState,
} from './ufos.ts'
export { moveBoat, type Boat } from './boats.ts'
export { spawnHere } from './spawns.ts'
export { SPIDER_TARGET } from './weapons.ts'
export {
  SPIDER_BELLY,
  SPIDER_BODY,
  SPIDER_BOMB_TICKS,
  SPIDER_REACH,
  SPIDER_SPEED,
  SPIDERS,
  createSpiders,
  seatSpiderBody,
  spiderWaypoint,
  type Spider,
} from './spiders.ts'
export { NPC_CARS, NPC_FRAGILITY, NPC_PROFILES, NPC_SPEED, type Driver } from './npcs.ts'
export {
  ROBOTS,
  ROBOT_BEAM_TICKS,
  ROBOT_COOLDOWN_TICKS,
  ROBOT_DAMAGE,
  ROBOT_EYES,
  ROBOT_RANGE,
  ROBOT_SIZE,
  ROBOT_SPEED,
  placeRobot,
  robotEyes,
  seatRobotBody,
  type Robot,
} from './robots.ts'
export {
  GOAL_KINDS,
  GOAL_LABELS,
  GOAL_PRIZE,
  GOAL_REACH,
  GOAL_TARGET_MOST,
  awardGoals,
  goalMet,
  goalProgress,
  setGoal,
  validGoal,
  type Goal,
  type GoalKind,
  type GoalRequest,
} from './goals.ts'
export {
  BANANA_REACH,
  BANANA_SLOTS,
  HEALTH_MEND,
  HEALTH_SLOTS,
  PICKUP_HEIGHT,
  PICKUP_REACH_UP,
  PICKUP_HELD,
  PICKUP_RESPAWN_TICKS,
  PICKUP_SLOTS,
  SPILL_FAR,
  SPILL_FLIGHT_TICKS,
  SPILL_NEAR,
  LOOSE_IDS,
  LOOSE_KINDS,
  BOMB_REACH,
  MINE_REACH,
  OIL_LIFE_TICKS,
  OIL_REACH,
  LOOSE_MOST,
  pickupKind,
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
  type PickupKind,
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
  LASER_AMMO_TICKS,
  LASER_DAMAGE,
  LASER_RANGE,
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
  OWN_OIL_POWER,
  OWN_OILS_MOST,
  OIL_GRIP,
  OIL_SLIP_TICKS,
  SHIELD_TICKS,
  MAGNET_REACH,
  MAGNET_TICKS,
  TRIPLE_ROCKETS,
  TRIPLE_ROCKET_FAN,
  TRIPLE_ROCKET_POWER,
  PLOW_TICKS,
  PLOW_AHEAD,
  PLOW_ASIDE,
  PLOW_SHOVE,
  PLOW_LIFT,
  GRAPPLE_RANGE,
  GRAPPLE_COS,
  GRAPPLE_TICKS,
  GRAPPLE_MISS_TICKS,
  GRAPPLE_BREAK,
  GRAPPLE_SLACK,
  GRAPPLE_PULL,
  GRAPPLE_DRAG,
  MINES,
  MINE_POWER,
  MINES_WIDE,
  MINES_DEEP,
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
  gripOf,
  harm,
  hasBuiltInGun,
  hinder,
  hooked,
  lifting,
  mend,
  mountPoint,
  muzzlePoint,
  nosePoint,
  ownAction,
  pushWithWeapons,
  reel,
  restAction,
  rocketId,
  shielded,
  shotShare,
  slowable,
  stunned,
  weaponWon,
  weaponsFor,
  winged,
  wingsTurnRadius,
  aimPoint,
  MACHINE_TOUGHNESS,
  ROBOT_TARGET,
  UFO_TARGET,
  type Machine,
  NATIVE_POWER_UPS,
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
  MAGNET_REACH,
  NO_TARGET,
  OIL_SLIP_TICKS,
  arm,
  bombShare,
  burning,
  disarm,
  fireWeapons,
  flyRockets,
  gripOf,
  harm,
  hinder,
  ROBOT_TARGET,
  strike,
  hooked,
  lifting,
  sightLine,
  mend,
  pushWithWeapons,
  reel,
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
  HEALTH_MEND,
  pickupKind,
  pickupOut,
  reachesPickup,
  reachesLoose,
  setPickup,
  spillFrom,
  looseGone,
  looseOut,
  PICKUP_HEIGHT,
  PICKUP_HELD,
  PICKUP_RESPAWN_TICKS,
  LOOSE_MOST,
  LOOSE_IDS,
  BANANA_SLOTS,
  type Pickup,
  type Loose,
} from './pickups.ts'

const pulled = v3()

/** Pull every prop down its way up by its weight; a car pulls itself, as it is stepped. */
function pullToMiddle(arena: Arena, gravity: number): void {
  for (const prop of arena.props) pullBody(prop.body, upOf(prop.body.translation(), pulled), gravity)
}

/** How many vehicles a map is laid out for. Every seat exists from the start. */
export const MAX_PLAYERS = 32

/**
 * A place for one vehicle. Seats are created with the arena and never go
 * away: a player takes one, drives, and leaves it for the next. The epoch
 * counts the times the vehicle has been put back on its spawn, so anyone
 * watching from outside can tell a teleport from a drive.
 */
export interface Seat {
  readonly id: number
  /** Where it starts. */
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
  /** Bananas held: taken since sitting down, less those spent on weapons or spilled from a wreck, and any won with a goal. */
  score: number
  /** Bananas taken since sitting down, all told. */
  collected: number
  /** Cars its weapons have wrecked since sitting down, and robots they have brought down. */
  kills: number
  robotKills: number
  /** The goal it is playing for, if any, and how many it has reached, counted around past 255. */
  goal: Goal | null
  goalsWon: number
  /** A car nobody drives, and what drives it: a round of the arterials. */
  npc: boolean
  driver: Driver | null
  /** What it is carrying over its roof, won with bananas, and how long the machine gun has left. */
  weapon: Weapon
  /** How many weapons it has won, counted around past 255: a new one is told from the last even when it is the same. */
  wins: number
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
  /** How much longer its shield holds, its magnet pulls, its plow shoves and its tires slip on oil, in ticks. */
  shieldTicks: number
  magnetTicks: number
  plowTicks: number
  slipTicks: number
  /** How much longer its grappling hook holds, and the seat it has caught, or none. */
  grappleTicks: number
  grappleTarget: number
}

/**
 * A prop in the arena: a crate or a barrel, as a body the
 * physics steps, and where the map stands it, for putting it back.
 */
export interface ArenaProp {
  readonly id: number
  readonly kind: PropKind
  readonly body: RAPIER.RigidBody
  readonly home: WorldProp
}

/**
 * A map with vehicles on it. Unlike the rest of buggies this is not a value
 * that gets replaced each step: a physics world is a live thing that is
 * advanced in place, and every handle in here points into it.
 */
export interface Arena {
  /** The planet, everything on it where it is. */
  readonly planet: World
  readonly world: RAPIER.World
  readonly worldTuning: WorldTuning
  readonly seats: readonly Seat[]
  /** The map's bananas, a slot each, for the taking. */
  readonly pickups: readonly Pickup[]
  /** What lies loose: bananas spilled from wrecks, until taken, and bombs dropped from cars, until set off. */
  loose: Loose[]
  /** The number the next banana spilled gets. */
  looseNext: number
  /** Rockets in the air. Replaced whole by the server's word. */
  rockets: Rocket[]
  /** The machine gun and laser shots of the last tick, the robots' included, for drawing. */
  readonly shots: Shot[]
  /** The robots on their rounds. Their places are replaced by the server's word. */
  readonly robots: readonly Robot[]
  /** The giant spiders. Replaced by the server's word, like the saucers. */
  readonly spiders: readonly Spider[]
  /** The boats, meandering on the water as the time goes. */
  readonly boats: readonly Boat[]
  /** The flying saucers. Replaced by the server's word, too. */
  readonly ufos: readonly Ufo[]
  /** The props, numbered as the map lists them, each a body the physics steps. */
  readonly props: readonly ArenaProp[]
  tick: number
  /** A client's copy of the server's arena: nothing in it is wrecked or brought down but on the server's word. */
  mirror: boolean
}

export function createArena(planet: World, seatCount = MAX_PLAYERS): Arena {
  const worldTuning = createWorldTuning()
  const world = createPhysicsWorld(worldTuning)
  addTerrain(world, planet)
  const props: ArenaProp[] = planet.props.map((home, id) => ({ id, kind: home.kind, body: addProp(world, home), home }))

  const seats: Seat[] = findSpawns(planet, seatCount).map((spawn, id) => {
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
      collected: 0,
      kills: 0,
      robotKills: 0,
      goal: null,
      goalsWon: 0,
      npc: false,
      driver: null,
      weapon: 'none',
      wins: 0,
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
      shieldTicks: 0,
      magnetTicks: 0,
      plowTicks: 0,
      slipTicks: 0,
      grappleTicks: 0,
      grappleTarget: NO_TARGET,
    }
  })

  // Queries read the structures a step builds, so until the world has taken
  // one there is nothing for a wheel to find: the first frame would come back
  // with every ray missing and drop the vehicle through the road.
  world.step()

  return {
    props,
    planet,
    world,
    worldTuning,
    seats,
    pickups: createPickups(planet),
    loose: [],
    looseNext: 0,
    rockets: [],
    shots: [],
    robots: createRobots(planet, world),
    boats: createBoats(planet, world),
    spiders: createSpiders(planet, world),
    ufos: createUfos(planet),
    tick: 0,
    mirror: false,
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
  const spot = nearestRoadSpotTo(arena.planet, position)
  respawn(seat, spot === null ? seat.spawn : spawnFacing(spot, forward))
}

/**
 * Put someone in a different vehicle where they are: right where the old one
 * was, facing the way it was going, on whatever it was on, ground, road or
 * deck. The map, and the rest of the arena, go on as they were.
 */
export function changeVehicle(arena: Arena, seat: Seat, profile: VehicleProfileId): void {
  const { position, forward, up: roof } = seat.vehicle.frame
  const up = upOf(position)
  // Upright, the old car stood its ride height over what it was on; on its
  // side or roof, no more than its half height, so the new one is never set
  // down under the ground.
  const below = vdot(roof, up) > UPRIGHT ? seat.vehicle.rideHeight : seat.tuning.chassisHalfHeight
  const heading = alongGround(forward, up)
  const spawn: VehicleSpawn = {
    position: vaddScaled(v3(), position, up, -below),
    up,
    rotation: uprightRotation(up, vdot(heading, heading) > 1e-12 ? heading : forwardOf(seat.spawn)),
  }
  reshape(arena, seat, profile)
  respawn(seat, spawn)
}

/** How far up a car's up has to point for it to count as on its wheels. */
const UPRIGHT = 0.7

/** Put someone in a seat, in the vehicle they asked for, on the spawn. */
export function takeSeat(arena: Arena, id: number, profile: VehicleProfileId): Seat {
  const seat = arena.seats[id]
  if (seat === undefined) throw new RangeError(`no seat ${id}`)
  reshape(arena, seat, profile)
  seat.occupied = true
  clearTally(seat)
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
  clearTally(seat)
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
function waterAt(arena: Arena, seat: Seat): number {
  return waterUnder(arena.planet, seat.vehicle.frame.position)
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
  pullToMiddle(arena, gravity)
  for (const seat of arena.seats) {
    seat.vehicle.spared = arena.mirror
    upOf(seat.vehicle.frame.position, seat.vehicle.up)
    if (!seat.occupied) continue
    // A stunned car takes no driving.
    const input = stunned(seat) ? NEUTRAL_INPUT : inputFor(seat)
    // A car its engine or wings are driving along, or a grappling line
    // reeling in, is not one the tires hold still, and one its wings are lifting is not one the road holds down.
    seat.vehicle.boosted = burning(seat, input) || hooked(arena, seat)
    // A car in a saucer's beam is lifted off the road the same way.
    seat.vehicle.lifted = lifting(seat, input) || arena.ufos.some((ufo) => ufo.state === 'lift' && ufo.target === seat.id)
    // One carrying wings is held level and steered by them in the air, lifted or not.
    seat.vehicle.winged = winged(seat)
    seat.vehicle.grip = gripOf(seat)
    stepVehicle(arena.world, seat.vehicle, seat.tuning, input, dt)
    pushWithWeapons(seat, gravity)
    reel(arena, seat)
    hinder(seat)
    mend(seat)
    const level = waterAt(arena, seat)
    seat.submersion =
      level === DRY ? 0 : applyWaterResponse(seat.vehicle, seat.tuning, arena.worldTuning, level, heightOver(arena.planet, seat.vehicle.frame.position))
  }
  // The robots roll on, their bodies carried there over the step.
  for (const robot of arena.robots) {
    walkRobot(arena.planet, robot, dt)
    seatRobotBody(robot, false)
  }
  // The spiders stride on, each letting a bomb fall from its belly when one is due: on the server's word, in a mirror.
  for (const spider of arena.spiders) {
    if (walkSpider(arena.planet, spider, dt) && !arena.mirror) dropFromSpider(arena, spider)
  }
  // The boats drift on to where the next tick has them.
  for (const boat of arena.boats) moveBoat(boat, arena.tick + 1, false)
  // The saucers fly on, and pull on whatever car they have in their beams.
  for (const ufo of arena.ufos) flyUfo(arena.planet, ufo, arena.seats, gravity, dt)
  arena.world.step()
  arena.tick += 1
  for (const seat of arena.seats) if (seat.occupied) holdUnderCeiling(arena.planet.radius, seat.vehicle)
  restoreProps(arena)
  collectPickups(arena)
  spillBananas(arena)
  fireWeapons(arena)
  fireRobots(arena)
  armFromBananas(arena)
  flyRockets(arena, dt)
  // A machine the weapons have brought down comes back whole elsewhere.
  if (!arena.mirror) {
    for (const robot of arena.robots) if (robot.damage >= 1) rebuildRobot(arena.planet, robot)
    for (const ufo of arena.ufos) if (ufo.damage >= 1) rebuildUfo(arena.planet, ufo)
    for (const spider of arena.spiders) if (spider.damage >= 1) rebuildSpider(arena.planet, spider)
  }
  trimLoose(arena)
}

/**
 * Keep a vehicle under the ceiling, a little over the clouds: brought back
 * down to it where it has risen through, and whatever of its way was taking
 * it up and away from the planet taken off.
 */
function holdUnderCeiling(radius: number, vehicle: Seat['vehicle']): void {
  const { body } = vehicle
  const at = body.translation()
  const r = Math.sqrt(at.x * at.x + at.y * at.y + at.z * at.z)
  const most = radius + CEILING
  if (r <= most) return
  const ux = at.x / r
  const uy = at.y / r
  const uz = at.z / r
  body.setTranslation({ x: ux * most, y: uy * most, z: uz * most }, true)
  const v = body.linvel()
  const out = v.x * ux + v.y * uy + v.z * uz
  if (out > 0) body.setLinvel({ x: v.x - ux * out, y: v.y - uy * out, z: v.z - uz * out }, true)
}

const eyes = v3()

/**
 * The robots' eyes: each one holds its beam on a car for a while, burning
 * it as long as it can see it and it is in reach, then takes a while to
 * charge before it looks for the nearest car it can see to burn next.
 */
function fireRobots(arena: Arena): void {
  for (const robot of arena.robots) {
    robotEyes(eyes, robot)
    if (robot.beamTicks > 0) {
      robot.beamTicks -= 1
      if (robot.beamTicks === 0) robot.cooldownTicks = ROBOT_COOLDOWN_TICKS
      const target = arena.seats[robot.target]
      if (target === undefined || !target.occupied || target.vehicle.wrecked) {
        robot.beamTicks = 0
        robot.cooldownTicks = ROBOT_COOLDOWN_TICKS
        continue
      }
      const at = target.vehicle.frame.position
      const clear = sightLine(arena.planet, eyes, at)
      const to = v3(eyes.x + (at.x - eyes.x) * clear, eyes.y + (at.y - eyes.y) * clear, eyes.z + (at.z - eyes.z) * clear)
      const hit = clear === 1 && vdistance(at, eyes) <= ROBOT_RANGE
      if (hit) harm(target, ROBOT_DAMAGE)
      arena.shots.push({ owner: NO_TARGET, from: v3(eyes.x, eyes.y, eyes.z), to, hit: hit ? target.id : NO_TARGET, kind: 'laser' })
      continue
    }
    if (robot.cooldownTicks > 0) {
      robot.cooldownTicks -= 1
      continue
    }
    let nearest = ROBOT_RANGE
    robot.target = NO_TARGET
    for (const seat of arena.seats) {
      if (!seat.occupied || seat.vehicle.wrecked) continue
      const at = seat.vehicle.frame.position
      const distance = vdistance(at, eyes)
      if (distance > nearest || sightLine(arena.planet, eyes, at) < 1) continue
      nearest = distance
      robot.target = seat.id
    }
    if (robot.target !== NO_TARGET) robot.beamTicks = ROBOT_BEAM_TICKS
  }
}

/** A prop that has sunk deep under the sea, or through the ground, is put back where the map stands it, at rest. */
function restoreProps(arena: Arena): void {
  for (const prop of arena.props) {
    if (heightOver(arena.planet, prop.body.translation()) >= arena.planet.seaLevel - ABYSS) continue
    putPropBack(prop)
  }
}

/** Stand a prop back where the map has it, at rest. */
export function putPropBack(prop: ArenaProp): void {
  const { body, home } = prop
  const { position, rotation } = propPlacement(home)
  body.setTranslation(position, true)
  body.setRotation(rotation, true)
  body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)
}

/**
 * Only so many bombs, mines, oil slicks and rockets lie loose on a map at
 * once; past that the oldest go, whichever they are. Spilled bananas are
 * held to the banana slots, and stay until taken.
 */
function trimLoose(arena: Arena): void {
  let count = arena.rockets.length
  for (const loose of arena.loose) if (loose.kind !== 'banana') count++
  while (count > LOOSE_MOST) {
    const oldest = arena.loose.findIndex((loose) => loose.kind !== 'banana')
    const loose = arena.loose[oldest]
    const rocket = arena.rockets[0]
    if (rocket === undefined || (loose !== undefined && loose.bornTick <= rocket.bornTick)) arena.loose.splice(oldest, 1)
    else arena.rockets.shift()
    count--
  }
}

/** A banana taken: one more to spend, and one more collected. */
function score(seat: Seat): void {
  seat.score += 1
  seat.collected += 1
}

/** A seat sat down in, or left, starts again: no bananas, no wrecks and no goal. */
function clearTally(seat: Seat): void {
  seat.score = 0
  seat.collected = 0
  seat.kills = 0
  seat.robotKills = 0
  seat.goal = null
  seat.goalsWon = 0
  seat.npc = false
  seat.driver = null
}

/**
 * Put a car nobody drives in a seat: one of the NPC vehicles, in turn by
 * seat, on a round of the arterials, and a third as tough as any other.
 * Nothing, on an island without arterials.
 */
export function seatNpc(arena: Arena, id: number): Seat | null {
  const driver = createDriver(arena.planet, id)
  if (driver === null) return null
  const seat = takeSeat(arena, id, NPC_PROFILES[id % NPC_PROFILES.length]!)
  seat.npc = true
  seat.driver = driver
  seat.tuning.damageToWreck /= NPC_FRAGILITY
  respawn(seat, driverSpawn(arena.planet, driver))
  return seat
}

const npcCommand: DriverCommand = { steer: 0, throttle: 0, brake: 0, stuck: false }

/** What a car nobody drives is asking for this tick, written into `out`: put back on its road, if it has been stuck too long. */
export function npcInput(arena: Arena, seat: Seat, out: VehicleInput): VehicleInput {
  Object.assign(out, NEUTRAL_INPUT)
  const { driver, vehicle } = seat
  if (driver === null || vehicle.wrecked) return out
  const { position, forward, right } = vehicle.frame
  drive(arena.planet, driver, { position, forward, right, speed: vehicle.speed }, npcCommand)
  if (npcCommand.stuck) {
    respawn(seat, driverSpawn(arena.planet, driver, UNSTUCK_AHEAD))
    return out
  }
  out.steer = npcCommand.steer
  out.throttle = npcCommand.throttle
  out.brake = npcCommand.brake
  return out
}

/**
 * Bananas buy weapons: a car carrying nothing that has enough of them
 * spends that many on the next weapon, at once, whether it has just taken
 * a banana or just used the last of what it had. Taking a banana while
 * armed keeps it for later, and never replaces what is carried.
 */
function armFromBananas(arena: Arena): void {
  for (const seat of arena.seats) {
    if (!seat.occupied || seat.vehicle.wrecked || seat.npc || seat.weapon !== 'none' || seat.score < BANANAS_PER_WEAPON) continue
    seat.score -= BANANAS_PER_WEAPON
    arm(seat, weaponWon(arena.planet.seed, seat.id, arena.tick, seat.score, seat.profile))
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
    const count = holdBananaSlots(arena, seat.score)
    arena.loose.push(
      ...spillFrom(arena.planet, seat.vehicle.frame.position, count, seat.id, arena.tick, arena.looseNext),
    )
    arena.looseNext = (arena.looseNext + count) % LOOSE_IDS
    seat.score = 0
  }
}

/** A bomb falls from a spider's belly to float over the ground under it, for the next car to run into. */
function dropFromSpider(arena: Arena, spider: Spider): void {
  const { position } = spider
  const up = upOf(position)
  arena.loose.push({
    id: arena.looseNext,
    kind: 'bomb',
    owner: NO_TARGET,
    power: 1,
    from: vaddScaled(v3(), position, up, SPIDER_BELLY),
    position: vaddScaled(v3(), position, up, PICKUP_HEIGHT),
    bornTick: arena.tick,
  })
  arena.looseNext = (arena.looseNext + 1) % LOOSE_IDS
}

/**
 * Hold this many banana slots for bananas spilled from a wreck, or as many
 * as there are: those waiting to come out first, then those out on the map,
 * which are gone from there. Returns how many were held.
 */
function holdBananaSlots(arena: Arena, count: number): number {
  let held = 0
  for (const waiting of [true, false]) {
    for (let slot = 0; slot < BANANA_SLOTS && held < count; slot++) {
      const pickup = arena.pickups[slot]!
      if (pickup.spawnTick === PICKUP_HELD || pickupOut(pickup, arena.tick) === waiting) continue
      setPickup(arena.planet, pickup, slot, pickup.generation + 1, PICKUP_HELD)
      held++
    }
  }
  return held
}

/** A spilled banana taken frees the slot it held, to come out on the map again in a while. */
function freeBananaSlot(arena: Arena): void {
  for (let slot = 0; slot < BANANA_SLOTS; slot++) {
    const pickup = arena.pickups[slot]!
    if (pickup.spawnTick !== PICKUP_HELD) continue
    setPickup(arena.planet, pickup, slot, pickup.generation + 1, arena.tick + PICKUP_RESPAWN_TICKS)
    return
  }
}

/** How far a car takes bananas from: its magnet's reach while that pulls, and a banana's own otherwise. */
function magnetOf(seat: Seat): number {
  return seat.magnetTicks > 0 ? MAGNET_REACH : 0
}

/**
 * Every banana a vehicle has reached is taken, a point to whoever reached
 * it, and its slot moves on to the next, to turn up elsewhere in a while.
 * A car with its magnet pulling reaches bananas from much further off. A
 * health pack is taken the same way, by a car with damage to mend and
 * from its own reach alone, and mends half of what wrecks a car. A wreck
 * takes nothing.
 */
function collectPickups(arena: Arena): void {
  for (const [slot, pickup] of arena.pickups.entries()) {
    if (!pickupOut(pickup, arena.tick)) continue
    const health = pickupKind(slot) === 'health'
    for (const seat of arena.seats) {
      // A car nobody drives takes nothing: it has no use for bananas or weapons.
      if (!seat.occupied || seat.vehicle.wrecked || seat.npc) continue
      if (health && seat.vehicle.damage <= 0) continue
      if (!reachesPickup(pickup, seat.vehicle.frame.position, health ? 0 : magnetOf(seat))) continue
      if (health) seat.vehicle.damage = Math.max(seat.vehicle.damage - HEALTH_MEND, 0)
      else score(seat)
      setPickup(arena.planet, pickup, slot, pickup.generation + 1, arena.tick + PICKUP_RESPAWN_TICKS)
      break
    }
  }
  // Spilled bananas go the same way, or fade if nobody comes for them; a
  // bomb or a mine goes off on the first car to reach it once it has
  // landed, with whatever it has of a full blast, and the car takes of that
  // what its nature and its shield let it. An oil slick stays where it lies
  // until it fades, and every car in it slips for a while, longer the more
  // of a full slick it is. Walked from the end, so taking one out moves
  // nothing still to come, and i stays within the list.
  for (let i = arena.loose.length - 1; i >= 0; i--) {
    const loose = arena.loose[i]!
    if (looseGone(loose, arena.tick)) {
      arena.loose.splice(i, 1)
      continue
    }
    if (!looseOut(loose, arena.tick)) continue
    for (const seat of arena.seats) {
      if (!seat.occupied || seat.vehicle.wrecked || !reachesLoose(loose, seat.vehicle.frame.position, magnetOf(seat))) continue
      if (loose.kind === 'banana' && seat.npc) continue
      if (loose.kind === 'oil') {
        seat.slipTicks = Math.max(seat.slipTicks, Math.round(OIL_SLIP_TICKS * loose.power))
        continue
      }
      if (loose.kind === 'banana') {
        score(seat)
        freeBananaSlot(arena)
      } else harm(seat, BOMB_DAMAGE * loose.power * bombShare(seat.profile), arena.seats[loose.owner])
      arena.loose.splice(i, 1)
      break
    }
    // A robot rolling over a bomb or a mine sets it off too, and takes the blast.
    if (arena.loose[i] !== loose || (loose.kind !== 'bomb' && loose.kind !== 'mine')) continue
    const robot = arena.robots.find((robot) => reachesLoose(loose, robot.position))
    if (robot === undefined) continue
    strike(arena, ROBOT_TARGET + robot.id, BOMB_DAMAGE * loose.power, arena.seats[loose.owner])
    arena.loose.splice(i, 1)
  }
}

/** Under this much water a vehicle is not coming back on its own. */
const SUNK = 0.6

/** How far beneath the sea a vehicle can be before it is lost for good. */
const ABYSS = 5

/** How long a vehicle stays lost before it is put back, in steps. */
const LOST_PATIENCE = 180
/** A wreck lies a little longer, to be watched burning. */
const WRECK_PATIENCE = 270

/** Whether a vehicle is done driving for now: blown up, deep in the water, or fallen through the world. */
export function isLost(arena: Arena, seat: Seat): boolean {
  return (
    seat.vehicle.wrecked ||
    // A hull that floats is where it means to be on the water, however far out.
    (seat.submersion > SUNK && seat.tuning.hull === undefined) ||
    heightOver(arena.planet, seat.vehicle.frame.position) < arena.planet.seaLevel - ABYSS
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
