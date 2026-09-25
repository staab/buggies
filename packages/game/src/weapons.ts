import * as exact from '@buggies/physics'
import {
  FIXED_TIMESTEP,
  clamp,
  v3,
  vaddScaled,
  vcopy,
  vdot,
  vlength,
  vnormalize,
  vscale,
  vset,
  vsub,
  type Vec3,
} from '@buggies/physics'
import { sampleHeight, type TerrainMap } from '@buggies/terrain'
import {
  WORLD_UP,
  addForceAlong,
  addTorqueAbout,
  hurtVehicle,
  type Vehicle,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleTuning,
} from '@buggies/vehicle'

import { PICKUP_HEIGHT, LOOSE_IDS, pickupSeed, type Loose } from './pickups.ts'

/** What a car can be carrying over its roof: nothing, or something won with bananas. */
export type Weapon = 'none' | 'rocket' | 'machineGun' | 'bomb' | 'engine' | 'wings' | 'shockwave' | 'siren' | 'repair'

/** What can be won, in the order the HUD rolls through them. */
export const WEAPONS: readonly Weapon[] = ['rocket', 'machineGun', 'bomb', 'engine', 'wings', 'shockwave', 'siren', 'repair']

export const WEAPON_LABELS: Readonly<Record<Weapon, string>> = {
  none: '',
  rocket: 'Rocket',
  machineGun: 'Machine gun',
  bomb: 'Bomb',
  engine: 'Rocket engine',
  wings: 'Wings',
  shockwave: 'Shockwave',
  siren: 'Siren',
  repair: 'Repair',
}

/** How far behind the middle of the car a bomb is dropped. */
export const BOMB_DROP_BACK = 5

/** Every so many bananas wins something. */
export const BANANAS_PER_WEAPON = 1

/** How far over the roof a weapon rides, and rockets and bullets leave from. */
export const MOUNT_HEIGHT = 1.1

/** Where a car's own gun ends, in the chassis frame: ahead of the middle of the car, and above it. */
export interface Muzzle {
  ahead: number
  up: number
}

/**
 * Cars with a gun of their own built in. Their rockets and shots leave from
 * its muzzle, and nothing is mounted over the roof for them. The tank's is
 * measured off its model.
 */
export const BUILT_IN_GUNS: Readonly<Partial<Record<VehicleProfileId, Muzzle>>> = {
  tank: { ahead: 1.7, up: 1.2 },
}

export function hasBuiltInGun(profile: VehicleProfileId): boolean {
  return BUILT_IN_GUNS[profile] !== undefined
}

/**
 * Where what is a car's own leaves from, with no gun built in: the front
 * of the car, this much of the chassis's half height above its middle.
 * Nothing is mounted over the roof for what is the car's own, so its
 * shots and missiles come from the car itself.
 */
export const NOSE_UP = 0.2

/**
 * How long, held down, the machine gun fires for, the rocket engine burns
 * and the wings hold the car up, in ticks; the gun fires a shot every so
 * many of them.
 */
export const MACHINE_GUN_AMMO_TICKS = 60 * 10
export const ENGINE_BURN_TICKS = 60 * 10
export const WINGS_FLIGHT_TICKS = 60 * 10
export const MACHINE_GUN_SHOT_TICKS = 6

/** How hard the rocket engine pushes, in meters a second a second, fading out toward this many times the car's own top speed. */
export const ENGINE_PUSH = 12
export const ENGINE_TOP_SPEED = 1.8

/**
 * How fast the wings climb, in meters a second, and how hard they push up
 * toward that; how hard they turn the car in the air, as a share of what
 * the pedals pitch it by; and how hard the pedals drive it along up there,
 * in meters a second a second.
 */
export const WINGS_CLIMB_SPEED = 8
export const WINGS_CLIMB_PUSH = 6
/**
 * On wings the steering banks the car and swings its motion around rather
 * than turning its nose: the arc is this many times as wide as the car's
 * own tightest turn at speed, the car leans into it by this much of its up
 * (the tangent of the bank) at full steer, and its nose is put on the way
 * it is going. Below this speed there is no motion to swing, so the nose
 * is turned gently instead, this much of the way the steering asks.
 */
export const WINGS_TURN_WIDEN = 5
export const WINGS_LEAN = 0.55
export const WINGS_TURN_MIN_SPEED = 3
export const WINGS_HOVER_TURN = 0.35
export const WINGS_THRUST = 9

/**
 * The siren sounds this long, held, and slows every other car within this
 * of it by this much; the shockwave stuns every car within this for this
 * long. A slowed car is held back this hard, in meters a second each
 * second at a full slow, and stays slowed this long after the siren has
 * passed it.
 */
export const SIREN_TICKS = 60 * 10
export const SIREN_RANGE = 30
export const SIREN_SLOW = 0.5
export const SHOCKWAVE_RANGE = 30
export const SHOCKWAVE_STUN_TICKS = 60 * 5
export const SLOW_DRAG = 9
export const SLOW_HOLD_TICKS = 2

/** What a bomb takes of a car's life: all of it, for one won; a car's own take a share of that. */
export const BOMB_DAMAGE = 1

/**
 * What a car does with its own key: something of the vehicle's own, had
 * besides whatever it carries, and lesser than the power-ups. Nothing is
 * mounted over the roof for it, and the HUD makes nothing of it.
 */
export type OwnActionKind = 'missile' | 'hop' | 'boost' | 'lights' | 'gun' | 'fly' | 'horn' | 'bomb'
export interface OwnAction {
  kind: OwnActionKind
  label: string
  /** What it does, in a line, for the car page. */
  about: string
  /** How long one that goes all at once is seen and heard going, in ticks. */
  activeTicks: number
  /** How long before it may go again: nothing, for all but the missile and the bomb. */
  cooldownTicks: number
}
const LIGHTS: OwnAction = {
  kind: 'lights',
  label: 'Lights',
  about: 'Turns the lights on or off. While they are on, every car within 30 meters is slowed by 20%.',
  activeTicks: 0,
  cooldownTicks: 0,
}
export const OWN_ACTIONS: Readonly<Record<VehicleProfileId, OwnAction>> = {
  tank: {
    kind: 'missile',
    label: 'Missile',
    about: 'Fires a missile with half the blast of the rocket power-up, every three seconds.',
    activeTicks: 0,
    cooldownTicks: 60 * 3,
  },
  goKart: { kind: 'hop', label: 'Hop', about: 'Jumps into the air whenever the kart is on the ground.', activeTicks: 6, cooldownTicks: 0 },
  raceCar: {
    kind: 'boost',
    label: 'Boost',
    about: 'Pushes with half the force of the rocket engine power-up while held.',
    activeTicks: 0,
    cooldownTicks: 0,
  },
  police: LIGHTS,
  ambulance: LIGHTS,
  firetruck: LIGHTS,
  sportsCar: {
    kind: 'gun',
    label: 'Machine gun',
    about: 'Fires at the car ahead while held, with a quarter of the damage of the machine gun power-up.',
    activeTicks: 0,
    cooldownTicks: 0,
  },
  smallCar: {
    kind: 'fly',
    label: 'Wings',
    about: 'Holds the car up while held, with a tenth of the lift of the wings power-up.',
    activeTicks: 0,
    cooldownTicks: 0,
  },
  semi: {
    kind: 'horn',
    label: 'Horn',
    about: 'Stuns every car within 10 meters for a second.',
    activeTicks: 60,
    cooldownTicks: 0,
  },
  pickup: {
    kind: 'bomb',
    label: 'Bomb',
    about: 'Drops a bomb behind with a quarter of the blast of the bomb power-up, every five seconds. Up to five can be out at once, and a sixth replaces the oldest.',
    activeTicks: 0,
    cooldownTicks: 60 * 5,
  },
}
/** The actions that go on while the key is held. */
const LASTING: readonly OwnActionKind[] = ['boost', 'gun', 'fly']
/** The hop: this much speed straight up, from the ground, which carries the kart a few meters into the air. */
export const HOP_SPEED = 8
/** The race car's boost: this much of the rocket engine's push. */
export const BOOST_PUSH = ENGINE_PUSH * 0.5
/** The semi's horn stuns every car within this for this long; an emergency vehicle's lights slow every car within the siren's reach by this much. */
export const HORN_RANGE = 10
export const HORN_STUN_TICKS = 60
export const EMERGENCY_SLOW = 0.2
/**
 * How much of what is won a car's own is: the tank's missile of a rocket's
 * blast, the sports car's gun of a shot's bite, the pickup's bomb of a
 * bomb's blast, and the small car's wings of the wings' lift.
 */
export const OWN_MISSILE_POWER = 0.5
export const OWN_GUN_POWER = 0.25
export const OWN_BOMB_POWER = 0.25
export const OWN_LIFT = 0.1
/** The pickup has this many bombs out at once at most: past that, the oldest goes as the next is dropped. */
export const OWN_BOMBS_MOST = 5

/**
 * What a vehicle is by nature, besides what it does: how it takes what is
 * done to it. The emergency vehicles are not slowed by any siren or
 * lights; the ambulance mends itself, this much of its life every so many
 * ticks; the fire truck takes this share of a bomb's blast, and the police
 * car this share of a shot's bite.
 */
export const EMERGENCY_VEHICLES: readonly VehicleProfileId[] = ['police', 'ambulance', 'firetruck']
export const AMBULANCE_HEAL = 0.01
export const AMBULANCE_HEAL_TICKS = 60 * 5
export const FIRETRUCK_BOMB_SHARE = 0.1
export const POLICE_SHOT_SHARE = 0.5
const UNSLOWED = 'Not slowed by sirens or lights.'
/** What is said of each vehicle's nature on the car page: nothing, for most. */
export const NATURE_NOTES: Readonly<Record<VehicleProfileId, readonly string[]>> = {
  raceCar: [],
  police: [UNSLOWED, 'Takes half damage from machine guns.'],
  firetruck: [UNSLOWED, 'Takes a tenth of the damage from bombs.'],
  pickup: [],
  sportsCar: [],
  smallCar: [],
  tank: [],
  ambulance: [UNSLOWED, 'Repairs 1% of its health every five seconds.'],
  semi: [],
  goKart: [],
}

/** Whether a siren or lights slow a vehicle: not an emergency vehicle. */
export function slowable(profile: VehicleProfileId): boolean {
  return !EMERGENCY_VEHICLES.includes(profile)
}

/** How much of a bomb's blast a vehicle takes. */
export function bombShare(profile: VehicleProfileId): number {
  return profile === 'firetruck' ? FIRETRUCK_BOMB_SHARE : 1
}

/** How much of a shot's bite a vehicle takes. */
export function shotShare(profile: VehicleProfileId): number {
  return profile === 'police' ? POLICE_SHOT_SHARE : 1
}

/**
 * How far a shot carries, and how far off dead ahead the gun swings to
 * pick out a car: it trains itself on the nearest one in that sweep, and
 * fires straight ahead when there is none.
 */
export const MACHINE_GUN_RANGE = 70
export const MACHINE_GUN_SWEEP_COS = 0.82
/** How much of a car's life one shot takes: a few seconds of hits blows it up. */
export const MACHINE_GUN_DAMAGE = 0.02

export const ROCKET_SPEED = 45
export const ROCKET_LIFE_TICKS = 60 * 4
/** How much of the way toward its target a rocket turns each tick. */
export const ROCKET_TURN = 0.12
/** How far ahead, and how far off dead ahead, a car has to be for a rocket to go after it. */
export const ROCKET_LOCK_RANGE = 90
export const ROCKET_LOCK_COS = 0.5
/** How close a rocket has to come to a car to go off on it, and what that takes of its life. */
export const ROCKET_REACH = 3.5
export const ROCKET_DAMAGE = 0.6

/** A rocket or a shot with no car in its sights. */
export const NO_TARGET = -1

/** How often the line of a shot is checked against the ground, in meters. */
const SIGHT_STEP = 4
/** How high over the ground a line of fire has to stay. */
const SIGHT_CLEARANCE = 0.3

/** The keys the weapons read: the fire key, for what is carried, and the car's own. */
export type WeaponKeys = Pick<VehicleInput, 'fire' | 'ability'>

/** What of a seat the weapons read and write. */
export interface Gunner {
  readonly id: number
  readonly occupied: boolean
  readonly vehicle: Vehicle
  readonly tuning: VehicleTuning
  readonly profile: VehicleProfileId
  weapon: Weapon
  /** How much longer the machine gun fires for, in ticks. */
  ammoTicks: number
  /** The seat the machine gun is trained on, or none. */
  aimTarget: number
  /** The car's own action: how long it is seen going for, how long before it may go again, and whether its lights are on. */
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

/** A rocket in the air: from whom, after whom, where it is going, and how much of a full blast it goes off with. */
export interface Rocket {
  readonly id: number
  readonly owner: number
  /** The seat it is after, or none. */
  target: number
  readonly position: Vec3
  readonly velocity: Vec3
  readonly bornTick: number
  readonly power: number
}

/** One shot of a machine gun, from the muzzle to where it stopped, and whom it hit if anyone. */
export interface Shot {
  readonly owner: number
  readonly from: Vec3
  readonly to: Vec3
  readonly hit: number
}

/** What of an arena the weapons need. */
export interface Battlefield {
  readonly map: TerrainMap
  readonly seats: readonly Gunner[]
  readonly rockets: Rocket[]
  /** What lies loose on the map: bombs are dropped among the bananas. */
  readonly loose: Loose[]
  looseNext: number
  /** The shots fired this tick. */
  readonly shots: Shot[]
  readonly tick: number
}

// The exact trigonometry, so every copy of the simulation turns the same.
const { atan2, cos: cosine, hypot, sin: sine } = exact

const muzzle = v3()
const toward = v3()
const desired = v3()
const heading = v3()
const spin = v3()
const aside = v3()

/**
 * What a seat wins with its bananas: anyone's guess, but the same guess on
 * every copy of the simulation, worked out from the map, the seat, the tick
 * and the score.
 */
export function weaponWon(mapSeed: number, seat: number, tick: number, score: number): Weapon {
  const hash = pickupSeed(mapSeed ^ Math.imul(score, 0x27d4eb2f), seat, tick)
  return WEAPONS[hash % WEAPONS.length] ?? 'none'
}

/** How long a weapon lasts, held down: none at all for one that goes all at once. */
export function ammoFor(weapon: Weapon): number {
  switch (weapon) {
    case 'machineGun':
      return MACHINE_GUN_AMMO_TICKS
    case 'engine':
      return ENGINE_BURN_TICKS
    case 'wings':
      return WINGS_FLIGHT_TICKS
    case 'siren':
      return SIREN_TICKS
    default:
      return 0
  }
}

/** What the car does with its own key. */
export function ownAction(seat: Gunner): OwnAction {
  return OWN_ACTIONS[seat.profile]
}

/**
 * Whether the car's own lasting action is going: the boost, the wings or
 * the gun, with its key held. It goes whatever the car carries. A wreck
 * does nothing.
 */
export function acting(seat: Gunner, keys: WeaponKeys = seat.vehicle.command): boolean {
  if (!keys.ability || seat.vehicle.wrecked) return false
  return LASTING.includes(ownAction(seat).kind)
}

/** Whether a car is using what it carries: this, with the fire key down and something left of it. A wreck holds nothing. */
function using(seat: Gunner, weapon: Weapon, keys: WeaponKeys): boolean {
  return seat.weapon === weapon && keys.fire && seat.ammoTicks > 0 && !seat.vehicle.wrecked
}

/** Give a seat what it has won, with however long it lasts. */
export function arm(seat: Gunner, weapon: Weapon): void {
  seat.weapon = weapon
  seat.ammoTicks = ammoFor(weapon)
}

/**
 * Whether the car is being driven along by a weapon: the rocket engine
 * burning or the wings holding it up, or the car's own boost or wings
 * going.
 */
export function burning(seat: Gunner, keys: WeaponKeys = seat.vehicle.command): boolean {
  if (using(seat, 'engine', keys) || using(seat, 'wings', keys)) return true
  if (!acting(seat, keys)) return false
  const { kind } = ownAction(seat)
  return kind === 'boost' || kind === 'fly'
}

/** Whether the car is held up by wings: the ones it has won, or its own. */
export function lifting(seat: Gunner, keys: WeaponKeys = seat.vehicle.command): boolean {
  return using(seat, 'wings', keys) || (acting(seat, keys) && ownAction(seat).kind === 'fly')
}

/** Whether the car has wings out: the ones it has won, with time left of them, whether or not the key is held. A wreck has none. */
export function winged(seat: Gunner): boolean {
  return seat.weapon === 'wings' && seat.ammoTicks > 0 && !seat.vehicle.wrecked
}

/**
 * The push of the rocket engine and the lift of the wings, for the step:
 * the engine shoves the car the way its nose points, less and less as it
 * gets far past what its own engine could do, and the car's own boost
 * shoves it half as hard, with it if both are going; the wings push it up
 * toward a steady climb, arrest a fall, and turn it as it is steered, the
 * car's own wings a share as hard toward a climb as much slower. A car
 * carrying wings is steered the same way whenever it is in the air, key
 * or no key: gliding, it turns like a plane too.
 */
export function pushWithWeapons(seat: Gunner, gravity: number): void {
  const { vehicle, tuning } = seat
  const { body, frame, command } = vehicle
  const engine = using(seat, 'engine', command)
  const boost = acting(seat) && ownAction(seat).kind === 'boost'
  if (engine || boost) {
    const headroom = clamp(1 - vehicle.speed / (tuning.maxSpeed * ENGINE_TOP_SPEED), 0, 1)
    const push = (engine ? ENGINE_PUSH : 0) + (boost ? BOOST_PUSH : 0)
    addForceAlong(body, frame.forward, tuning.mass * push * headroom)
  }
  const lifted = lifting(seat)
  if (lifted) {
    const lift = using(seat, 'wings', command) ? 1 : OWN_LIFT
    const climb = clamp(1 - frame.linearVelocity.y / (WINGS_CLIMB_SPEED * lift), 0, 1)
    addForceAlong(body, WORLD_UP, tuning.mass * (gravity + WINGS_CLIMB_PUSH * lift * climb))
    // The pedals drive it along, forward or back, wherever it is.
    addForceAlong(body, frame.forward, tuning.mass * WINGS_THRUST * (command.throttle - command.brake))
  }
  if (lifted || (vehicle.winged && vehicle.groundedCount === 0)) bank(seat)
  // Off its wings, or on the ground with them, the car has no bank to hold.
  else vset(vehicle.lean, 0, 0, 0)
}

/** How wide the turn a car on wings makes at full steer: a few times its own tightest turn at speed. */
export function wingsTurnRadius(tuning: VehicleTuning): number {
  const wheelbase = Math.abs(tuning.rearAxleZ - tuning.frontAxleZ)
  const steer = tuning.maxSteerAngle * tuning.steerAtHighSpeed
  return (wheelbase / (sine(steer) / cosine(steer))) * WINGS_TURN_WIDEN
}

/**
 * Turn a car on wings the way a plane turns: the steering leans it into
 * the turn, and the turn swings the way it is going around a wide arc,
 * the nose put on the motion outright, so the car faces where it goes.
 * The lean is left for the wings to hold, and the swing is the pull a
 * circle of the turn's radius asks for at the car's speed. Too slow for
 * any of that, the nose is turned gently instead.
 */
function bank(seat: Gunner): void {
  const { vehicle, tuning } = seat
  const { body, frame, command, lean } = vehicle
  const { linearVelocity: velocity } = frame
  const speed = hypot(velocity.x, velocity.z)
  body.angvel(spin)
  const yawRate = spin.y
  if (speed < WINGS_TURN_MIN_SPEED) {
    vset(lean, 0, 0, 0)
    addTorqueAbout(body, WORLD_UP, -command.steer * tuning.airPitchTorque * WINGS_HOVER_TURN - yawRate * tuning.airLevelDamping)
    return
  }
  // Aside from the way it is going, the steering's way: where the turn pulls it, and what it leans toward.
  const turn = command.steer
  vset(aside, -velocity.z / speed, 0, velocity.x / speed)
  addForceAlong(body, aside, (tuning.mass * speed * speed * turn) / wingsTurnRadius(tuning))
  vset(lean, aside.x * WINGS_LEAN * turn, 0, aside.z * WINGS_LEAN * turn)
  // The nose is put on the way the car is going: the car is turned about
  // the world's up by however far its nose is off the motion, its bank and
  // pitch kept as they are, and whatever yaw it had is taken out of its spin.
  const { forward, rotation } = frame
  const flat = hypot(forward.x, forward.z) || 1
  const error = atan2(
    (forward.x * velocity.z - forward.z * velocity.x) / (flat * speed),
    (forward.x * velocity.x + forward.z * velocity.z) / (flat * speed),
  )
  // A turn about +Y takes the nose the other way from the error's sense, so it is turned back by it.
  const s = sine(-error / 2)
  const c = cosine(-error / 2)
  const { x, y, z, w } = rotation
  body.setRotation({ x: c * x + s * z, y: c * y + s * w, z: c * z - s * x, w: c * w - s * y }, true)
  body.setAngvel({ x: spin.x, y: 0, z: spin.z }, true)
}

export function disarm(seat: Gunner): void {
  seat.weapon = 'none'
  seat.ammoTicks = 0
  seat.aimTarget = NO_TARGET
}

/** Put a seat's own action, and whatever has been done to it, back to nothing. */
export function restAction(seat: Gunner): void {
  seat.actionTicks = 0
  seat.cooldownTicks = 0
  seat.lightsOn = false
  seat.abilityHeld = false
  seat.rocketsFired = 0
  seat.stunnedTicks = 0
  seat.slowedTicks = 0
  seat.slowedBy = 0
}

/** Whether a car is stunned: it takes no driving. */
export function stunned(seat: Gunner): boolean {
  return seat.stunnedTicks > 0
}

/**
 * What has been done to a car by others, for the step: a stun wears off,
 * and a slow holds the car back, dragging against the way it is going,
 * until it wears off too.
 */
export function hinder(seat: Gunner): void {
  if (seat.stunnedTicks > 0) seat.stunnedTicks -= 1
  if (seat.slowedTicks <= 0) return
  const { vehicle, tuning } = seat
  if (vehicle.speed > 0.1) {
    vnormalize(heading, vehicle.frame.linearVelocity)
    addForceAlong(vehicle.body, heading, -tuning.mass * SLOW_DRAG * seat.slowedBy)
  }
  seat.slowedTicks -= 1
  if (seat.slowedTicks === 0) seat.slowedBy = 0
}

/** The ambulance mends itself as it goes, a little every tick, unless it is a wreck. */
export function mend(seat: Gunner): void {
  const { vehicle } = seat
  if (seat.profile !== 'ambulance' || vehicle.wrecked || vehicle.damage <= 0) return
  vehicle.damage = Math.max(vehicle.damage - AMBULANCE_HEAL / AMBULANCE_HEAL_TICKS, 0)
}

/** Where a car's weapon rides: over the middle of its roof. */
export function mountPoint(out: Vec3, vehicle: Vehicle, tuning: VehicleTuning): Vec3 {
  return vaddScaled(out, vehicle.frame.position, vehicle.frame.up, tuning.chassisHalfHeight + MOUNT_HEIGHT)
}

/** The front of a car, a little up from its middle: where what is its own leaves from. */
export function nosePoint(out: Vec3, seat: Gunner): Vec3 {
  const { position, forward, up } = seat.vehicle.frame
  vaddScaled(out, position, forward, seat.tuning.chassisHalfLength)
  return vaddScaled(out, out, up, seat.tuning.chassisHalfHeight * NOSE_UP)
}

/**
 * Where a car's rockets and shots leave from: the muzzle of its own gun if
 * it has one; else over the roof, where what it carries rides, or for what
 * is the car's own the front of the car.
 */
export function muzzlePoint(out: Vec3, seat: Gunner, own = false): Vec3 {
  const gun = BUILT_IN_GUNS[seat.profile]
  if (gun === undefined) return own ? nosePoint(out, seat) : mountPoint(out, seat.vehicle, seat.tuning)
  const { position, forward, up } = seat.vehicle.frame
  vaddScaled(out, position, forward, gun.ahead)
  return vaddScaled(out, out, up, gun.up)
}

/** Rockets fired by a seat are counted from zero again after this many. */
export const ROCKETS_COUNTED = 0x2000

/**
 * A rocket's number: whose it is and how many went before it, so that a
 * copy of the simulation that fires it a tick early or late, as a mirror
 * running ahead of the server does, numbers it as the server will.
 */
export function rocketId(seat: number, fired: number): number {
  return ((fired % ROCKETS_COUNTED) << 3) | (seat & 7)
}

/**
 * How far along the line from one point to another the ground lets a shot
 * go: all the way, as one, or the share of it before a hill gets in the way.
 */
function sightLine(map: TerrainMap, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const steps = Math.max(Math.ceil(Math.sqrt(dx * dx + dz * dz) / SIGHT_STEP), 1)
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const x = from.x + dx * t
    const z = from.z + dz * t
    if (sampleHeight(map.heightfield, x, z) > from.y + dy * t - SIGHT_CLEARANCE) return (i - 1) / steps
  }
  return 1
}

/** The nearest car within this far and this near dead ahead of the gun, or none. */
function pickOut(arena: Battlefield, seat: Gunner, from: Vec3, range: number, sweepCos: number): number {
  const { forward } = seat.vehicle.frame
  let target = NO_TARGET
  let nearest = range
  for (const other of arena.seats) {
    if (!inPlay(seat, other)) continue
    vsub(toward, other.vehicle.frame.position, from)
    const distance = vlength(toward)
    if (distance === 0 || distance > nearest) continue
    if (vdot(toward, forward) / distance < sweepCos) continue
    target = other.id
    nearest = distance
  }
  return target
}

/** Anyone else's car, out and not a wreck. */
function inPlay(seat: Gunner, other: Gunner): boolean {
  return other !== seat && other.occupied && !other.vehicle.wrecked
}

/**
 * Train the gun on the nearest car ahead: the one the car carries, whether
 * or not it is firing, or the car's own while its key is held. With
 * neither, it is trained on nothing.
 */
function trainGun(arena: Battlefield, seat: Gunner): void {
  const carried = seat.weapon === 'machineGun'
  if (!carried && !(ownAction(seat).kind === 'gun' && acting(seat))) {
    seat.aimTarget = NO_TARGET
    return
  }
  muzzlePoint(muzzle, seat, !carried)
  seat.aimTarget = pickOut(arena, seat, muzzle, MACHINE_GUN_RANGE, MACHINE_GUN_SWEEP_COS)
}

/**
 * One shot from a car's gun, with this much of a full shot's bite: at the
 * car it is trained on, from the muzzle, hitting unless a hill is in the
 * way; or straight ahead at nothing when there is no such car. Either way
 * it is on the record for the tick, to be drawn.
 */
function shoot(arena: Battlefield, seat: Gunner, power: number, own: boolean): void {
  muzzlePoint(muzzle, seat, own)
  const from = vcopy(v3(), muzzle)
  const to = v3()
  const target = seat.aimTarget === NO_TARGET ? undefined : arena.seats[seat.aimTarget]
  if (target === undefined) {
    vaddScaled(to, muzzle, seat.vehicle.frame.forward, MACHINE_GUN_RANGE)
    arena.shots.push({ owner: seat.id, from, to, hit: NO_TARGET })
    return
  }
  const clear = sightLine(arena.map, muzzle, target.vehicle.frame.position)
  vsub(toward, target.vehicle.frame.position, muzzle)
  vaddScaled(to, muzzle, toward, clear)
  if (clear === 1) hurtVehicle(target.vehicle, target.tuning, MACHINE_GUN_DAMAGE * power * shotShare(target.profile))
  arena.shots.push({ owner: seat.id, from, to, hit: clear === 1 ? target.id : NO_TARGET })
}

/** Every other car within reach of a seat, middle to middle, in play, given to a hand. */
function reach(arena: Battlefield, seat: Gunner, range: number, hit: (other: Gunner) => void): void {
  for (const other of arena.seats) {
    if (other === seat || !other.occupied || other.vehicle.wrecked) continue
    vsub(toward, other.vehicle.frame.position, seat.vehicle.frame.position)
    if (vlength(toward) <= range) hit(other)
  }
}

/** Stun a car for this long, or longer if it already is. */
const stun =
  (ticks: number) =>
  (other: Gunner): void => {
    other.stunnedTicks = Math.max(other.stunnedTicks, ticks)
  }

/** Slow a car by this share for the moment, or more if it already is; an emergency vehicle is not slowed. */
const slow =
  (share: number) =>
  (other: Gunner): void => {
    if (!slowable(other.profile)) return
    other.slowedTicks = SLOW_HOLD_TICKS
    other.slowedBy = Math.max(other.slowedBy, share)
  }

/** A rocket goes, with this much of a full blast: from the muzzle, straight ahead, after whoever is there to go after. */
function launchRocket(arena: Battlefield, seat: Gunner, power: number, own: boolean): void {
  muzzlePoint(muzzle, seat, own)
  arena.rockets.push({
    id: rocketId(seat.id, seat.rocketsFired),
    owner: seat.id,
    target: pickOut(arena, seat, muzzle, ROCKET_LOCK_RANGE, ROCKET_LOCK_COS),
    position: vcopy(v3(), muzzle),
    velocity: vscale(v3(), seat.vehicle.frame.forward, ROCKET_SPEED),
    bornTick: arena.tick,
    power,
  })
  seat.rocketsFired = (seat.rocketsFired + 1) % ROCKETS_COUNTED
}

/**
 * A bomb goes down behind the car, with this much of a full blast, to
 * float over the ground there, or over the road the car is on where that
 * is higher, until a car runs into it. It is thrown out like a spilled
 * banana, and cannot go off until it has landed, which gives the car that
 * dropped it a moment to get clear; after that it goes off on anyone, that
 * car too.
 */
function dropBomb(arena: Battlefield, seat: Gunner, power: number): void {
  const { position, forward } = seat.vehicle.frame
  const x = position.x - forward.x * BOMB_DROP_BACK
  const z = position.z - forward.z * BOMB_DROP_BACK
  const level = Math.max(sampleHeight(arena.map.heightfield, x, z), position.y - seat.tuning.chassisHalfHeight)
  arena.loose.push({
    id: arena.looseNext,
    kind: 'bomb',
    owner: seat.id,
    power,
    from: vcopy(v3(), position),
    position: v3(x, level + PICKUP_HEIGHT, z),
    bornTick: arena.tick,
  })
  arena.looseNext = (arena.looseNext + 1) % LOOSE_IDS
}

/** A car has only so many bombs out at once: before the next is dropped, the oldest of its own go to make room for it. */
function harvestBombs(arena: Battlefield, seat: Gunner): void {
  for (;;) {
    let out = 0
    let oldest = -1
    arena.loose.forEach((loose, i) => {
      if (loose.kind !== 'bomb' || loose.owner !== seat.id) return
      out += 1
      if (oldest < 0 || loose.bornTick < arena.loose[oldest]!.bornTick) oldest = i
    })
    if (out < OWN_BOMBS_MOST || oldest < 0) return
    arena.loose.splice(oldest, 1)
  }
}

/**
 * The car's own action: what its vehicle does with its own key, besides
 * whatever it carries. A press starts it: the missile goes at once, when
 * it is not cooling down, the bomb and the horn every time, the hop only
 * from the ground, and the lights come on or go off; the boost, the wings
 * and the gun go on as long as the key is held, the gun firing at the car
 * it is trained on every few ticks. The horn stuns the cars near it, and
 * the lights, while on, slow them.
 */
function act(arena: Battlefield, seat: Gunner, pressed: boolean): void {
  const own = ownAction(seat)
  const ready = pressed && seat.cooldownTicks === 0
  if (seat.actionTicks > 0) seat.actionTicks -= 1
  switch (own.kind) {
    case 'missile':
      if (!ready) return
      launchRocket(arena, seat, OWN_MISSILE_POWER, true)
      seat.cooldownTicks = own.cooldownTicks
      return
    case 'bomb':
      if (!ready) return
      harvestBombs(arena, seat)
      dropBomb(arena, seat, OWN_BOMB_POWER)
      seat.cooldownTicks = own.cooldownTicks
      return
    case 'hop':
      if (!ready || seat.vehicle.groundedCount === 0) return
      seat.vehicle.body.applyImpulse(vscale(heading, seat.vehicle.frame.up, seat.tuning.mass * HOP_SPEED), true)
      seat.actionTicks = own.activeTicks
      return
    case 'horn':
      if (!ready) return
      reach(arena, seat, HORN_RANGE, stun(HORN_STUN_TICKS))
      seat.actionTicks = own.activeTicks
      seat.cooldownTicks = own.cooldownTicks
      return
    case 'lights':
      if (pressed) seat.lightsOn = !seat.lightsOn
      if (seat.lightsOn) reach(arena, seat, SIREN_RANGE, slow(EMERGENCY_SLOW))
      return
    case 'gun':
      if (acting(seat) && arena.tick % MACHINE_GUN_SHOT_TICKS === 0) shoot(arena, seat, OWN_GUN_POWER, true)
      return
    default:
      // The boost and the wings are read off the key as the car is stepped.
      return
  }
}

/**
 * Fire whatever the fire key is held on, and do the car's own with its own
 * key. A rocket goes the moment it is asked for, a bomb is dropped the
 * moment it is, the shockwave goes off at once, stunning every car near,
 * and the repair kit mends the car at once; the machine gun, trained on the nearest car ahead whether or not
 * it is firing, fires as long as the key is held and the ammunition lasts,
 * a shot every few ticks, and is gone when it runs dry; the siren sounds
 * as long as it is held, slowing every car near, until it runs out. A
 * cooldown runs down meanwhile. A wreck holds nothing and does nothing.
 */
export function fireWeapons(arena: Battlefield): void {
  arena.shots.length = 0
  for (const seat of arena.seats) {
    if (!seat.occupied) continue
    const { fire, ability } = seat.vehicle.command
    const pressed = ability && !seat.abilityHeld
    seat.abilityHeld = ability
    if (seat.cooldownTicks > 0) seat.cooldownTicks -= 1
    if (seat.vehicle.wrecked) {
      disarm(seat)
      seat.actionTicks = 0
      seat.lightsOn = false
      continue
    }
    trainGun(arena, seat)
    act(arena, seat, pressed)
    if (seat.weapon === 'none' || !fire) continue
    if (seat.weapon === 'rocket') {
      launchRocket(arena, seat, 1, false)
      disarm(seat)
      continue
    }
    if (seat.weapon === 'bomb') {
      dropBomb(arena, seat, 1)
      disarm(seat)
      continue
    }
    if (seat.weapon === 'shockwave') {
      reach(arena, seat, SHOCKWAVE_RANGE, stun(SHOCKWAVE_STUN_TICKS))
      disarm(seat)
      continue
    }
    // The repair kit mends the car whole, at once, and is spent.
    if (seat.weapon === 'repair') {
      seat.vehicle.damage = 0
      disarm(seat)
      continue
    }
    // The rest last as long as the button is held: the gun firing, the
    // engine burning, the wings holding the car up, the siren sounding,
    // until they run out.
    if (seat.weapon === 'machineGun' && seat.ammoTicks % MACHINE_GUN_SHOT_TICKS === 0) shoot(arena, seat, 1, false)
    if (seat.weapon === 'siren') reach(arena, seat, SIREN_RANGE, slow(SIREN_SLOW))
    seat.ammoTicks -= 1
    if (seat.ammoTicks <= 0) disarm(seat)
  }
}

/**
 * Every rocket in the air flies on: turning after its target if it still
 * has one, going off on any car it reaches, with whatever it has of a
 * full blast, and gone when it meets the ground, leaves the map or runs
 * out of time.
 */
export function flyRockets(arena: Battlefield, dt = FIXED_TIMESTEP): void {
  const { map, rockets, seats, tick } = arena
  const extent = map.size * map.cellSize
  for (let i = rockets.length - 1; i >= 0; i--) {
    const rocket = rockets[i]
    if (rocket === undefined) continue
    const target = rocket.target === NO_TARGET ? undefined : seats[rocket.target]
    if (target !== undefined && target.occupied && !target.vehicle.wrecked) {
      // Turn toward the middle of it, a little high, so it is the body that is met and not the wheels.
      vsub(desired, target.vehicle.frame.position, rocket.position)
      desired.y += 0.5
      vnormalize(desired, desired)
      vnormalize(heading, rocket.velocity)
      vaddScaled(heading, heading, desired, ROCKET_TURN)
      vnormalize(heading, heading)
      vscale(rocket.velocity, heading, ROCKET_SPEED)
    } else {
      rocket.target = NO_TARGET
    }
    vaddScaled(rocket.position, rocket.position, rocket.velocity, dt)
    const { x, y, z } = rocket.position
    let spent = tick - rocket.bornTick >= ROCKET_LIFE_TICKS
    spent ||= x < 0 || z < 0 || x > extent || z > extent || y <= sampleHeight(map.heightfield, x, z)
    if (!spent) {
      for (const other of seats) {
        if (other.id === rocket.owner || !other.occupied || other.vehicle.wrecked) continue
        vsub(toward, other.vehicle.frame.position, rocket.position)
        if (vlength(toward) > ROCKET_REACH) continue
        hurtVehicle(other.vehicle, other.tuning, ROCKET_DAMAGE * rocket.power)
        spent = true
        break
      }
    }
    if (spent) rockets.splice(i, 1)
  }
}
