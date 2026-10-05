import * as exact from '@buggies/physics'
import {
  FIXED_TIMESTEP,
  clamp,
  v3,
  vaddScaled,
  vcopy,
  vcross,
  vdot,
  vlength,
  vnormalize,
  vscale,
  vset,
  vsub,
  type Vec3,
} from '@buggies/physics'
import { atHeight, groundUnder, heightOver, upOf, type World } from '@buggies/terrain'
import {
  addForceAlong,
  addTorqueAbout,
  hurtVehicle,
  type Vehicle,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleTuning,
} from '@buggies/vehicle'

import { NPC_FRAGILITY } from './npcs.ts'
import { SPIDER_BELLY, SPIDER_BODY } from './spiders.ts'

import type * as RAPIER from '@dimforge/rapier3d-compat'

import { PICKUP_HEIGHT, LOOSE_IDS, type Loose, type LooseKind } from './pickups.ts'

/** A weapon every car has, each on its own number key, or none. */
export type Weapon = 'none' | 'rocket' | 'machineGun' | 'mines' | 'engine' | 'wings' | 'magnet' | 'plow' | 'laser' | 'shockwave'

/** The weapons, in the order of their keys: the first on 1, the last on 9. */
export const WEAPONS: readonly Weapon[] = ['rocket', 'machineGun', 'mines', 'engine', 'wings', 'magnet', 'plow', 'laser', 'shockwave']

/** No weapon key held. */
export const NO_KEY = 0

export const WEAPON_LABELS: Readonly<Record<Weapon, string>> = {
  none: '',
  rocket: 'Rocket',
  machineGun: 'Machine gun',
  mines: 'Mine field',
  engine: 'Rocket engine',
  wings: 'Wings',
  magnet: 'Magnet',
  plow: 'Ram plow',
  laser: 'Laser',
  shockwave: 'Shockwave',
}

/**
 * What a weapon costs in bananas, the car's fuel: one that goes all at
 * once costs this much a press, and one that lasts while its key is held
 * this much a second of it.
 */
export const WEAPON_COSTS: Readonly<Record<Weapon, number>> = {
  none: 0,
  rocket: 2,
  machineGun: 1,
  mines: 3,
  engine: 1,
  wings: 1,
  magnet: 2,
  plow: 3,
  laser: 2,
  shockwave: 3,
}

/** The weapons that last while their key is held, burning bananas as they go; the rest go all at once. */
const LASTING: readonly Weapon[] = ['machineGun', 'engine', 'wings', 'laser']

/** Whether a weapon lasts while its key is held, rather than going all at once. */
export function lasting(weapon: Weapon): boolean {
  return LASTING.includes(weapon)
}

/** The weapon on a number key, or none. */
export function weaponOfKey(key: number): Weapon {
  return WEAPONS[key - 1] ?? 'none'
}

/** The number key a weapon is on, or none. */
export function keyOf(weapon: Weapon): number {
  return WEAPONS.indexOf(weapon) + 1
}

/**
 * A banana is burned a sixtieth at a time by what lasts: a weapon that
 * costs a banana a second burns one sixtieth a tick, and one that costs
 * two burns two.
 */
export const BANANA_BURN = 60

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

/** The machine gun fires a shot every so many ticks while its key is held. */
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

/** The shockwave stuns every car within this for this long, and is seen going for this long. */
export const SHOCKWAVE_RANGE = 30
export const SHOCKWAVE_STUN_TICKS = 60 * 5
export const SHOCKWAVE_SHOWN_TICKS = 30

/** What a bomb takes of what wrecks a car before its `DURABILITY`: all of it. */
export const BOMB_DAMAGE = 1

/** The magnet takes every banana within this of the car, for this long. */
export const MAGNET_REACH = 50
export const MAGNET_TICKS = 60 * 30

/**
 * The ram plow shoves whatever is in front of the car for this long: a car
 * or a prop this far ahead of its nose and this far to either side of its
 * body is thrown on, this much faster than the plow is closing on it, and
 * a little up.
 */
export const PLOW_TICKS = 60 * 10
export const PLOW_AHEAD = 2.5
export const PLOW_ASIDE = 0.8
export const PLOW_SHOVE = 1.6
export const PLOW_LIFT = 0.3
/** A robot is not shoved but battered: this much of what wrecks a car, a tick, for every m/s the plow closes on it. */
export const PLOW_MACHINE_BITE = 0.007
/** How far a robot stands out from its middle, to the side and ahead, for the plow. */
const ROBOT_HALF_WIDTH = 1.6
const ROBOT_HALF_DEPTH = 1.4

/**
 * A mine field is this many mines, each with this much of a bomb's blast,
 * laid behind the car, this far back of its middle, in a spread this wide
 * and this deep.
 */
export const MINES_BACK = 5
export const MINES = 5
export const MINE_POWER = 0.3
export const MINES_WIDE = 8
export const MINES_DEEP = 4

/**
 * What a vehicle is by nature, besides what it does: how it takes what is
 * done to it. The ambulance mends itself, this much of its life every so many
 * ticks; the fire truck takes this share of a bomb's blast, and the police
 * car this share of a shot's bite.
 */
export const AMBULANCE_HEAL = 0.01
export const AMBULANCE_HEAL_TICKS = 60 * 5
export const FIRETRUCK_BOMB_SHARE = 0.1
export const POLICE_SHOT_SHARE = 0.5
/** What is said of each vehicle's nature on the car page: nothing, for most. */
export const NATURE_NOTES: Readonly<Record<VehicleProfileId, readonly string[]>> = {
  raceCar: [],
  police: ['Takes half damage from machine guns.'],
  firetruck: ['Takes a tenth of the damage from bombs, mines and meteors.'],
  pickup: [],
  sportsCar: [],
  smallCar: [],
  tank: [],
  ambulance: ['Repairs 1% of its health every five seconds.'],
  semi: [],
  goKart: [],
  duneBuggy: [],
  amphibian: ['Floats, and drives on the water like a boat: it is never taken for lost there.'],
  moonRover: [],
}

/** How much of a bomb's, a mine's or a meteor's blast a vehicle takes. */
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
/** How much one shot takes of what wrecks a car before its `DURABILITY`. */
export const MACHINE_GUN_DAMAGE = 0.02
/** The laser: how far it reaches, and what each tick of its beam takes of what wrecks a car before its `DURABILITY`. */
export const LASER_RANGE = 100
export const LASER_DAMAGE = 0.006

export const ROCKET_SPEED = 45
export const ROCKET_LIFE_TICKS = 60 * 4
/** How much of the way toward its target a rocket turns each tick. */
export const ROCKET_TURN = 0.12
/**
 * The tightest a rocket turns, in meters: it swings wide of a car that
 * dodges late or close, rather than following it round on the spot.
 */
export const ROCKET_LEAST_RADIUS = 25
/** How far ahead, and how far off dead ahead, a car has to be for a rocket to go after it. */
export const ROCKET_LOCK_RANGE = 90
export const ROCKET_LOCK_COS = 0.5
/** How close a rocket has to come to a car to go off on it, and what that takes of what wrecks a car before its `DURABILITY`. */
export const ROCKET_REACH = 3.5
export const ROCKET_DAMAGE = 0.6

/** A rocket or a shot with no car in its sights. */
export const NO_TARGET = -1

/** How often the line of a shot is checked against the ground, in meters. */
const SIGHT_STEP = 4
/** How high over the ground a line of fire has to stay. */
const SIGHT_CLEARANCE = 0.3
/** The key the weapons read: which weapon's is held, if any. */
export type WeaponKeys = Pick<VehicleInput, 'weapon'>

/** What of a seat the weapons read and write. */
export interface Gunner {
  readonly id: number
  readonly occupied: boolean
  /** A car nobody drives, which weapons hurt all the more. */
  readonly npc: boolean
  /** How many other players' cars its weapons have wrecked since it sat down, and how many robots they have brought down. */
  kills: number
  robotKills: number
  readonly vehicle: Vehicle
  readonly tuning: VehicleTuning
  readonly profile: VehicleProfileId
  /** The bananas it has to spend on its weapons. */
  score: number
  /** The weapon last picked by its key, which rides over the roof: none until one is. */
  weapon: Weapon
  /** The weapon key held down last tick, or none, so that a press is told from a hold. */
  weaponHeld: number
  /** What is left of the banana last broken into by a lasting weapon, in `BANANA_BURN`ths. */
  burnLeft: number
  /** The seat the machine gun or the laser is trained on, or none. */
  aimTarget: number
  /** How many rockets it has fired, which numbers the next. */
  rocketsFired: number
  /** How long it is stunned for, taking no driving, and how long its own shockwave is seen going for. */
  stunnedTicks: number
  shockTicks: number
  /** How much longer its magnet pulls and its plow shoves, in ticks. */
  magnetTicks: number
  plowTicks: number
}

/** A rocket in the air: from whom, after whom, where it is going, and how much of a full blast it goes off with. */
export interface Rocket {
  readonly id: number
  readonly owner: number
  /** The seat or machine it is after, or none. */
  target: number
  readonly position: Vec3
  readonly velocity: Vec3
  readonly bornTick: number
  readonly power: number
}

/** One shot of a machine gun, from the muzzle to where it stopped, and whom it hit if anyone. */
export interface Shot {
  /** Whose it is: a seat, or nobody, for a robot's eyes. */
  readonly owner: number
  readonly from: Vec3
  readonly to: Vec3
  readonly hit: number
  /** A bullet, gone in a flash, or a tick of a laser's beam, which holds while the laser does. */
  readonly kind: 'bullet' | 'laser'
}

/**
 * A machine that can be shot at besides the cars: a robot or a saucer.
 * Where it is, and how much of what brings it down it has taken, 0 to 1:
 * it is a good deal tougher than any car.
 */
export interface Machine {
  readonly id: number
  readonly position: Vec3
  damage: number
}

/** A target number from here up is a robot, the robot's number on from it; from here up, a saucer; from here up, a spider. Below, a seat. */
export const ROBOT_TARGET = 200
export const UFO_TARGET = 240
export const SPIDER_TARGET = 250
/** How many times tougher than the sports car a robot or a saucer is, weighed before `DURABILITY`: eight rockets or so bring one down. */
export const MACHINE_TOUGHNESS = 5
/** How high over a robot's feet it is aimed at, and how near a rocket has to come to a machine to go off on it. */
const ROBOT_MIDDLE = 3
/** Where a spider is aimed at: its body, high over its feet. */
const SPIDER_MIDDLE = SPIDER_BELLY + SPIDER_BODY.halfHeight
const MACHINE_REACH = 5
/** A spider is bigger: a rocket goes off on it this near its middle. */
const SPIDER_HIT_REACH = 8

/** Where a target is to be aimed at, into `out`: a car in play, a robot's middle or a saucer; `null` for nothing there to aim at. */
export function aimPoint(arena: Pick<Battlefield, 'seats' | 'robots' | 'ufos' | 'spiders'>, target: number, out: Vec3): Vec3 | null {
  if (target === NO_TARGET) return null
  if (target >= SPIDER_TARGET) {
    const spider = arena.spiders[target - SPIDER_TARGET]
    if (spider === undefined) return null
    return vaddScaled(out, spider.position, upOf(spider.position, way), SPIDER_MIDDLE)
  }
  if (target >= UFO_TARGET) {
    const ufo = arena.ufos[target - UFO_TARGET]
    return ufo === undefined ? null : vcopy(out, ufo.position)
  }
  if (target >= ROBOT_TARGET) {
    const robot = arena.robots[target - ROBOT_TARGET]
    if (robot === undefined) return null
    return vaddScaled(out, robot.position, upOf(robot.position, way), ROBOT_MIDDLE)
  }
  const seat = arena.seats[target]
  if (seat === undefined || !seat.occupied || seat.vehicle.wrecked) return null
  return vcopy(out, seat.vehicle.frame.position)
}
const way = v3()

/** Take this much of a target with a weapon: of a car, as `harm` does; of a machine, as much less as it is tougher. */
export function strike(arena: Battlefield, target: number, damage: number, by?: Gunner): void {
  if (target >= SPIDER_TARGET) {
    const spider = arena.spiders[target - SPIDER_TARGET]
    if (spider !== undefined) spider.damage = Math.min(spider.damage + damage / MACHINE_TOUGHNESS, 1)
    return
  }
  if (target >= UFO_TARGET) {
    const ufo = arena.ufos[target - UFO_TARGET]
    if (ufo !== undefined) ufo.damage = Math.min(ufo.damage + damage / MACHINE_TOUGHNESS, 1)
    return
  }
  if (target >= ROBOT_TARGET) {
    const robot = arena.robots[target - ROBOT_TARGET]
    if (robot === undefined || robot.damage >= 1) return
    robot.damage = Math.min(robot.damage + damage / MACHINE_TOUGHNESS, 1)
    if (robot.damage >= 1 && by !== undefined && by.occupied) by.robotKills += 1
    return
  }
  const seat = arena.seats[target]
  if (seat !== undefined) harm(seat, damage, by)
}

/** Every machine, by its target number, and where to aim at it. */
function machinesOf(arena: Battlefield, visit: (target: number, at: Vec3) => void): void {
  for (const robot of arena.robots) {
    if (aimPoint(arena, ROBOT_TARGET + robot.id, machineAt) !== null) visit(ROBOT_TARGET + robot.id, machineAt)
  }
  for (const ufo of arena.ufos) {
    if (aimPoint(arena, UFO_TARGET + ufo.id, machineAt) !== null) visit(UFO_TARGET + ufo.id, machineAt)
  }
  for (const spider of arena.spiders) {
    if (aimPoint(arena, SPIDER_TARGET + spider.id, machineAt) !== null) visit(SPIDER_TARGET + spider.id, machineAt)
  }
}
const machineAt = v3()
const aimed = v3()

/** What of an arena the weapons need. */
export interface Battlefield {
  readonly planet: World
  readonly seats: readonly Gunner[]
  /** The machines that can be shot at besides the cars: the robots and the saucers. */
  readonly robots: readonly Machine[]
  readonly ufos: readonly Machine[]
  readonly spiders: readonly Machine[]
  readonly rockets: Rocket[]
  /** What lies loose on the map: bombs are dropped among the bananas. */
  readonly loose: Loose[]
  looseNext: number
  /** The shots fired this tick. */
  readonly shots: Shot[]
  /** What a ram plow knocks aside besides cars. */
  readonly props: readonly { readonly body: RAPIER.RigidBody }[]
  readonly tick: number
}

// The exact trigonometry, so every copy of the simulation turns the same.
const { acos, atan2, cos: cosine, sin: sine } = exact

const muzzle = v3()
const toward = v3()
const desired = v3()
const heading = v3()
const spin = v3()
const aside = v3()
const shove = v3()

/**
 * Whether a lasting weapon can go this tick: there is enough left of the
 * banana last broken into, or another banana to break into.
 */
function fuelled(seat: Gunner, weapon: Weapon): boolean {
  return seat.burnLeft >= WEAPON_COSTS[weapon] || seat.score > 0
}

/** Whether a car is using a lasting weapon this tick: its key held, with the fuel for it. A wreck uses nothing. */
export function using(seat: Gunner, weapon: Weapon, keys: WeaponKeys = seat.vehicle.command): boolean {
  return weaponOfKey(keys.weapon) === weapon && !seat.vehicle.wrecked && fuelled(seat, weapon)
}

/** Burn a tick's worth of a lasting weapon's fuel, breaking into another banana if need be; whether there was any. */
function burn(seat: Gunner, weapon: Weapon): boolean {
  const cost = WEAPON_COSTS[weapon]
  if (seat.burnLeft < cost) {
    if (seat.score <= 0) return false
    seat.score -= 1
    seat.burnLeft += BANANA_BURN
  }
  seat.burnLeft -= cost
  return true
}

/** Whether the car is being driven along by a weapon: the rocket engine burning or the wings holding it up. */
export function burning(seat: Gunner, keys: WeaponKeys = seat.vehicle.command): boolean {
  return using(seat, 'engine', keys) || using(seat, 'wings', keys)
}

/** Whether the car is held up in the air by its wings. */
export function lifting(seat: Gunner, keys: WeaponKeys = seat.vehicle.command): boolean {
  return using(seat, 'wings', keys)
}

/**
 * Whether the car has wings out: picked last, with the fuel to fly on,
 * whether or not the key is held. A wreck has none.
 */
export function winged(seat: Gunner): boolean {
  return seat.weapon === 'wings' && !seat.vehicle.wrecked && fuelled(seat, 'wings')
}

/**
 * The push of the rocket engine and the lift of the wings, for the step:
 * the engine shoves the car the way its nose points, less and less as it
 * gets far past what its own engine could do; the wings push it up toward
 * a steady climb, arrest a fall, and turn it as it is steered. A car with
 * wings out is steered the same way whenever it is in the air, key or no
 * key: gliding, it turns like a plane too.
 */
export function pushWithWeapons(seat: Gunner, gravity: number): void {
  const { vehicle, tuning } = seat
  const { body, frame, command } = vehicle
  if (using(seat, 'engine', command)) {
    const headroom = clamp(1 - vehicle.speed / (tuning.maxSpeed * ENGINE_TOP_SPEED), 0, 1)
    addForceAlong(body, frame.forward, tuning.mass * ENGINE_PUSH * headroom)
  }
  const lifted = lifting(seat)
  if (lifted) {
    const climb = clamp(1 - vdot(frame.linearVelocity, vehicle.up) / WINGS_CLIMB_SPEED, 0, 1)
    addForceAlong(body, vehicle.up, tuning.mass * (gravity + WINGS_CLIMB_PUSH * climb))
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
  const { body, frame, command, lean, up } = vehicle
  // The way it is going along the ground: its velocity less its part up or down.
  vaddScaled(level, frame.linearVelocity, up, -vdot(frame.linearVelocity, up))
  const speed = vlength(level)
  body.angvel(spin)
  const yawRate = vdot(spin, up)
  if (speed < WINGS_TURN_MIN_SPEED) {
    vset(lean, 0, 0, 0)
    addTorqueAbout(body, up, -command.steer * tuning.airPitchTorque * WINGS_HOVER_TURN - yawRate * tuning.airLevelDamping)
    return
  }
  // Aside from the way it is going, the steering's way: where the turn pulls it, and what it leans toward.
  const turn = command.steer
  vcross(aside, level, up)
  vscale(aside, aside, 1 / speed)
  addForceAlong(body, aside, (tuning.mass * speed * speed * turn) / wingsTurnRadius(tuning))
  vscale(lean, aside, WINGS_LEAN * turn)
  // The nose is put on the way the car is going: the car is turned about
  // the way up by however far its nose is off the motion, its bank and
  // pitch kept as they are, and whatever yaw it had is taken out of its spin.
  const { forward, rotation } = frame
  vaddScaled(nose, forward, up, -vdot(forward, up))
  const flat = vlength(nose) || 1
  vcross(across, nose, level)
  const error = atan2(-vdot(across, up) / (flat * speed), vdot(nose, level) / (flat * speed))
  // A turn about the up by the error's opposite, put before the car's own turn.
  const s = sine(-error / 2)
  const c = cosine(-error / 2)
  const ax = up.x * s
  const ay = up.y * s
  const az = up.z * s
  const { x, y, z, w } = rotation
  body.setRotation(
    {
      x: c * x + ax * w + (ay * z - az * y),
      y: c * y + ay * w + (az * x - ax * z),
      z: c * z + az * w + (ax * y - ay * x),
      w: c * w - (ax * x + ay * y + az * z),
    },
    true,
  )
  vaddScaled(spin, spin, up, -yawRate)
  body.setAngvel(spin, true)
}
const level = v3()
const nose = v3()
const across = v3()

/** Put whatever a seat has going, and whatever has been done to it, back to nothing. */
export function restAction(seat: Gunner): void {
  seat.weaponHeld = NO_KEY
  seat.aimTarget = NO_TARGET
  seat.rocketsFired = 0
  seat.stunnedTicks = 0
  seat.shockTicks = 0
  seat.magnetTicks = 0
  seat.plowTicks = 0
}

/**
 * Take this much of a car's life with a weapon. A
 * hit that wrecks another player's car is a kill to whoever fired: a car
 * nobody drives is no kill to anyone.
 */
export function harm(seat: Gunner, damage: number, by?: Gunner): void {
  const whole = !seat.vehicle.wrecked
  // A car nobody drives has its toughness cut by its fragility, which its armor already takes the root of.
  hurtVehicle(seat.vehicle, seat.tuning, damage * (seat.npc ? Math.sqrt(NPC_FRAGILITY) : 1))
  if (whole && seat.vehicle.wrecked && !seat.npc && by !== undefined && by.id !== seat.id && by.occupied) by.kills += 1
}

/** Whether a car is stunned: it takes no driving. */
export function stunned(seat: Gunner): boolean {
  return seat.stunnedTicks > 0
}

/** What has been done to a car by others, for the step: a stun wears off. */
export function hinder(seat: Gunner): void {
  if (seat.stunnedTicks > 0) seat.stunnedTicks -= 1
}

/** The ambulance mends itself as it goes, a little every tick, unless it is a wreck. */
export function mend(seat: Gunner): void {
  const { vehicle } = seat
  if (seat.profile !== 'ambulance' || vehicle.wrecked || vehicle.damage <= 0) return
  vehicle.damage = Math.max(vehicle.damage - AMBULANCE_HEAL / AMBULANCE_HEAL_TICKS, 0)
}

/** Where a car's weapon rides: over the middle of its roof. */
export function mountPoint(out: Vec3, seat: Gunner): Vec3 {
  return offsetOnCar(out, seat, 0, seat.tuning.chassisHalfHeight + MOUNT_HEIGHT)
}

/** Where a car's rockets and shots leave from: the muzzle of its own gun if it has one, else over the roof, where its weapon rides. */
export function muzzlePoint(out: Vec3, seat: Gunner): Vec3 {
  const gun = BUILT_IN_GUNS[seat.profile]
  if (gun === undefined) return mountPoint(out, seat)
  return offsetOnCar(out, seat, gun.ahead, gun.up)
}

/** A point on a car, this far ahead of its middle and this far up. */
function offsetOnCar(out: Vec3, seat: Gunner, ahead: number, up: number): Vec3 {
  const { position, forward, up: roof } = seat.vehicle.frame
  vaddScaled(out, position, forward, ahead)
  return vaddScaled(out, out, roof, up)
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
export function sightLine(map: World, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const steps = Math.max(Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / SIGHT_STEP), 1)
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    sighted.x = from.x + dx * t
    sighted.y = from.y + dy * t
    sighted.z = from.z + dz * t
    if (groundUnder(map, sighted) > heightOver(map, sighted) - SIGHT_CLEARANCE) return (i - 1) / steps
  }
  return 1
}
const sighted = v3()

/** The nearest car, or machine where they count, within this far and this near dead ahead of the gun, or none. */
function pickOut(arena: Battlefield, seat: Gunner, from: Vec3, range: number, sweepCos: number, machines = true): number {
  const { forward } = seat.vehicle.frame
  let target = NO_TARGET
  let nearest = range
  const consider = (id: number, at: Vec3): void => {
    vsub(toward, at, from)
    const distance = vlength(toward)
    if (distance === 0 || distance > nearest) return
    if (vdot(toward, forward) / distance < sweepCos) return
    target = id
    nearest = distance
  }
  for (const other of arena.seats) if (inPlay(seat, other)) consider(other.id, other.vehicle.frame.position)
  if (machines) machinesOf(arena, consider)
  return target
}

/** Anyone else's car, out and not a wreck. */
function inPlay(seat: Gunner, other: Gunner): boolean {
  return other !== seat && other.occupied && !other.vehicle.wrecked
}

/** Train the gun on the nearest car ahead while the machine gun or the laser is the weapon picked, firing or not; otherwise on nothing. */
function trainGun(arena: Battlefield, seat: Gunner): void {
  if (seat.weapon !== 'machineGun' && seat.weapon !== 'laser') {
    seat.aimTarget = NO_TARGET
    return
  }
  muzzlePoint(muzzle, seat)
  seat.aimTarget = pickOut(arena, seat, muzzle, seat.weapon === 'laser' ? LASER_RANGE : MACHINE_GUN_RANGE, MACHINE_GUN_SWEEP_COS)
}

/**
 * One shot from a car's gun: at the
 * car it is trained on, from the muzzle, hitting unless a hill is in the
 * way; or straight ahead at nothing when there is no such car. Either way
 * it is on the record for the tick, to be drawn.
 */
function shoot(arena: Battlefield, seat: Gunner, kind: Shot['kind'] = 'bullet'): void {
  muzzlePoint(muzzle, seat)
  const from = vcopy(v3(), muzzle)
  const to = v3()
  const at = aimPoint(arena, seat.aimTarget, aimed)
  if (at === null) {
    vaddScaled(to, muzzle, seat.vehicle.frame.forward, kind === 'laser' ? LASER_RANGE : MACHINE_GUN_RANGE)
    arena.shots.push({ owner: seat.id, from, to, hit: NO_TARGET, kind })
    return
  }
  const clear = sightLine(arena.planet, muzzle, at)
  vsub(toward, at, muzzle)
  vaddScaled(to, muzzle, toward, clear)
  // A police car's armor turns bullets, not light.
  const car = seat.aimTarget < ROBOT_TARGET ? arena.seats[seat.aimTarget] : undefined
  const damage = kind === 'laser' ? LASER_DAMAGE : MACHINE_GUN_DAMAGE * (car === undefined ? 1 : shotShare(car.profile))
  if (clear === 1) strike(arena, seat.aimTarget, damage, seat)
  arena.shots.push({ owner: seat.id, from, to, hit: clear === 1 ? seat.aimTarget : NO_TARGET, kind })
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

/**
 * A rocket goes from the muzzle, straight ahead, after whoever is there
 * to go after.
 */
function launchRocket(arena: Battlefield, seat: Gunner): void {
  muzzlePoint(muzzle, seat)
  const { forward } = seat.vehicle.frame
  arena.rockets.push({
    id: rocketId(seat.id, seat.rocketsFired),
    owner: seat.id,
    target: pickOut(arena, seat, muzzle, ROCKET_LOCK_RANGE, ROCKET_LOCK_COS),
    position: vcopy(v3(), muzzle),
    velocity: vscale(v3(), forward, ROCKET_SPEED),
    bornTick: arena.tick,
    power: 1,
  })
  seat.rocketsFired = (seat.rocketsFired + 1) % ROCKETS_COUNTED
}

/** How far over the ground each thing dropped lies: a bomb floats, and a mine sits on it. */
const DROP_HEIGHT: Readonly<Record<LooseKind, number>> = { banana: PICKUP_HEIGHT, bomb: PICKUP_HEIGHT, mine: 0.1 }

/**
 * A mine goes down behind the car, this far back and this far to its
 * right, with this much of a bomb's blast, over the ground there or over
 * the road the car is on where that is higher, to sit until a car runs
 * into it. It is thrown out like a spilled banana, and cannot be run into
 * until it has landed, which gives the car that dropped it a moment to get
 * clear; after that it goes off on anyone, that car too.
 */
function drop(arena: Battlefield, seat: Gunner, kind: LooseKind, power: number, back: number, aside: number): void {
  const { position, forward, right } = seat.vehicle.frame
  const behind = vaddScaled(v3(), position, forward, -back)
  vaddScaled(behind, behind, right, aside)
  const level = Math.max(groundUnder(arena.planet, behind), heightOver(arena.planet, position) - seat.tuning.chassisHalfHeight)
  arena.loose.push({
    id: arena.looseNext,
    kind,
    owner: seat.id,
    power,
    from: vcopy(v3(), position),
    position: atHeight(arena.planet, upOf(behind), level + DROP_HEIGHT[kind]),
    bornTick: arena.tick,
  })
  arena.looseNext = (arena.looseNext + 1) % LOOSE_IDS
}

/** A mine field: its mines laid across behind the car, every other one further back. */
function layMines(arena: Battlefield, seat: Gunner): void {
  for (let k = 0; k < MINES; k++) {
    const aside = (k / (MINES - 1) - 0.5) * MINES_WIDE
    drop(arena, seat, 'mine', MINE_POWER, MINES_BACK + (k % 2) * MINES_DEEP, aside)
  }
}

/**
 * The ram plow: every car and prop just in front of the car, that the car
 * is closing on, is thrown on ahead of it, faster than the plow is closing
 * on it, and a little up.
 */
function plow(arena: Battlefield, seat: Gunner): void {
  const { frame } = seat.vehicle
  const { tuning } = seat
  vaddScaled(shove, frame.forward, seat.vehicle.up, PLOW_LIFT)
  vnormalize(shove, shove)
  const thrown = (position: Vec3, velocity: Vec3, halfLength: number, halfWidth: number): number => {
    vsub(toward, position, frame.position)
    const along = vdot(toward, frame.forward)
    if (along < 0 || along > tuning.chassisHalfLength + PLOW_AHEAD + halfLength) return 0
    if (Math.abs(vdot(toward, frame.right)) > tuning.chassisHalfWidth + PLOW_ASIDE + halfWidth) return 0
    vsub(toward, frame.linearVelocity, velocity)
    return Math.max(vdot(toward, frame.forward), 0)
  }
  for (const other of arena.seats) {
    if (!inPlay(seat, other)) continue
    const at = other.vehicle.frame
    const size = other.tuning
    const closing = thrown(at.position, at.linearVelocity, size.chassisHalfLength, size.chassisHalfWidth)
    if (closing > 0) other.vehicle.body.applyImpulse(vscale(heading, shove, size.mass * closing * PLOW_SHOVE), true)
  }
  for (const { body } of arena.props) {
    const closing = thrown(body.translation(), body.linvel(), 0.5, 0.5)
    if (closing > 0) body.applyImpulse(vscale(heading, shove, body.mass() * closing * PLOW_SHOVE), true)
  }
  for (const robot of arena.robots) {
    const closing = thrown(robot.position, STILL, ROBOT_HALF_DEPTH, ROBOT_HALF_WIDTH)
    if (closing > 0) strike(arena, ROBOT_TARGET + robot.id, closing * PLOW_MACHINE_BITE, seat)
  }
}
const STILL = v3()

/** Whatever lasts of what a car has used runs down, and all of it ends when the car is wrecked. */
function wearOff(seat: Gunner): void {
  if (seat.vehicle.wrecked) {
    seat.magnetTicks = 0
    seat.plowTicks = 0
    seat.shockTicks = 0
    return
  }
  if (seat.magnetTicks > 0) seat.magnetTicks -= 1
  if (seat.plowTicks > 0) seat.plowTicks -= 1
  if (seat.shockTicks > 0) seat.shockTicks -= 1
}

/**
 * Fire whatever weapon's key is held, paid for in bananas. A press picks
 * the weapon, to ride over the roof. One that goes all at once goes on the
 * press, if there are the bananas for it: a rocket after the car ahead, a
 * mine field dropped behind, the shockwave stunning every car near, or the
 * magnet and the ram plow set going for a while. One that lasts goes as
 * long as its key is held and there is fuel for it, burning bananas as it
 * goes: the machine gun, trained on the nearest car ahead, firing a shot
 * every few ticks, the laser burning it, and the rocket engine and the
 * wings, which are read off the key as the car is stepped. Whatever lasts
 * of what was used runs down meanwhile, the plow shoving all the while. A
 * wreck does nothing.
 */
export function fireWeapons(arena: Battlefield): void {
  arena.shots.length = 0
  for (const seat of arena.seats) {
    if (!seat.occupied) continue
    const key = seat.vehicle.command.weapon
    const pressed = key !== NO_KEY && key !== seat.weaponHeld
    seat.weaponHeld = key
    wearOff(seat)
    if (seat.vehicle.wrecked) {
      seat.aimTarget = NO_TARGET
      continue
    }
    const held = weaponOfKey(key)
    if (pressed && held !== 'none') seat.weapon = held
    if (seat.plowTicks > 0) plow(arena, seat)
    trainGun(arena, seat)
    if (held === 'none') continue
    if (!lasting(held)) {
      if (pressed) useAtOnce(arena, seat, held)
      continue
    }
    if (!burn(seat, held)) continue
    if (held === 'machineGun' && arena.tick % MACHINE_GUN_SHOT_TICKS === 0) shoot(arena, seat)
    if (held === 'laser') shoot(arena, seat, 'laser')
  }
}

/** Use a weapon that goes all at once, if there are the bananas for it, and pay for it. */
function useAtOnce(arena: Battlefield, seat: Gunner, weapon: Weapon): void {
  const cost = WEAPON_COSTS[weapon]
  if (seat.score < cost) return
  seat.score -= cost
  switch (weapon) {
    case 'rocket':
      launchRocket(arena, seat)
      return
    case 'mines':
      layMines(arena, seat)
      return
    case 'shockwave':
      reach(arena, seat, SHOCKWAVE_RANGE, stun(SHOCKWAVE_STUN_TICKS))
      seat.shockTicks = SHOCKWAVE_SHOWN_TICKS
      return
    case 'magnet':
      seat.magnetTicks = MAGNET_TICKS
      return
    case 'plow':
      seat.plowTicks = PLOW_TICKS
      return
    default:
      return
  }
}

/**
 * Every rocket in the air flies on: turning after its target if it still
 * has one, going off on any car it reaches, with whatever it has of a
 * full blast, and gone when it meets the ground or runs out of time.
 */
export function flyRockets(arena: Battlefield, dt = FIXED_TIMESTEP): void {
  const { planet, rockets, seats, tick } = arena
  for (let i = rockets.length - 1; i >= 0; i--) {
    const rocket = rockets[i]
    if (rocket === undefined) continue
    const at = aimPoint(arena, rocket.target, aimed)
    if (at !== null) {
      // Turn toward the middle of it, a little high, so it is the body that is met and not the wheels.
      vsub(desired, at, rocket.position)
      vaddScaled(desired, desired, upOf(at, way), 0.5)
      vnormalize(desired, desired)
      vnormalize(heading, rocket.velocity)
      vaddScaled(desired, heading, desired, ROCKET_TURN)
      vnormalize(desired, desired)
      // No tighter than its least radius: past that, it turns only so far this tick.
      const most = (ROCKET_SPEED * dt) / ROCKET_LEAST_RADIUS
      const turn = acos(Math.min(Math.max(vdot(heading, desired), -1), 1))
      if (turn > most) {
        const s = sine(turn)
        vscale(heading, heading, sine(turn - most) / s)
        vaddScaled(heading, heading, desired, sine(most) / s)
        vnormalize(heading, heading)
      } else vcopy(heading, desired)
      vscale(rocket.velocity, heading, ROCKET_SPEED)
    } else {
      rocket.target = NO_TARGET
    }
    vaddScaled(rocket.position, rocket.position, rocket.velocity, dt)
    let spent = tick - rocket.bornTick >= ROCKET_LIFE_TICKS
    spent ||= heightOver(planet, rocket.position) <= groundUnder(planet, rocket.position)
    if (!spent) {
      for (const other of seats) {
        if (other.id === rocket.owner || !other.occupied || other.vehicle.wrecked) continue
        vsub(toward, other.vehicle.frame.position, rocket.position)
        if (vlength(toward) > ROCKET_REACH) continue
        harm(other, ROCKET_DAMAGE * rocket.power, seats[rocket.owner])
        spent = true
        break
      }
      // A machine is met by any rocket that comes near it, after it or not.
      if (!spent) {
        machinesOf(arena, (target, point) => {
          if (spent) return
          vsub(toward, point, rocket.position)
          if (vlength(toward) > (target >= SPIDER_TARGET ? SPIDER_HIT_REACH : MACHINE_REACH)) return
          strike(arena, target, ROCKET_DAMAGE * rocket.power, seats[rocket.owner])
          spent = true
        })
      }
    }
    if (spent) rockets.splice(i, 1)
  }
}

