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
import { mapExtent, sampleHeight, type TerrainMap } from '@buggies/terrain'
import {
  addForceAlong,
  addTorqueAbout,
  hurtVehicle,
  VEHICLE_PROFILE_IDS,
  type Vehicle,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleTuning,
} from '@buggies/vehicle'

import { NPC_FRAGILITY } from './npcs.ts'
import { SPIDER_BELLY, SPIDER_BODY } from './spiders.ts'

import type * as RAPIER from '@dimforge/rapier3d-compat'

import { PICKUP_HEIGHT, LOOSE_IDS, pickupSeed, type Loose, type LooseKind } from './pickups.ts'

/** What a car can be carrying over its roof: nothing, or something won with bananas. */
export type Weapon =
  | 'none'
  | 'rocket'
  | 'machineGun'
  | 'bomb'
  | 'engine'
  | 'wings'
  | 'shockwave'
  | 'siren'
  | 'oil'
  | 'shield'
  | 'magnet'
  | 'tripleRocket'
  | 'plow'
  | 'grapple'
  | 'mines'
  | 'laser'

/** What can be won, in the order the HUD rolls through them. */
export const WEAPONS: readonly Weapon[] = [
  'rocket',
  'machineGun',
  'bomb',
  'engine',
  'wings',
  'shockwave',
  'siren',
  'oil',
  'shield',
  'magnet',
  'tripleRocket',
  'plow',
  'grapple',
  'mines',
  'laser',
]

export const WEAPON_LABELS: Readonly<Record<Weapon, string>> = {
  none: '',
  rocket: 'Rocket',
  machineGun: 'Machine gun',
  bomb: 'Bomb',
  engine: 'Rocket engine',
  wings: 'Wings',
  shockwave: 'Shockwave',
  siren: 'Siren',
  oil: 'Oil slick',
  shield: 'Shield',
  magnet: 'Magnet',
  tripleRocket: 'Triple rocket',
  plow: 'Ram plow',
  grapple: 'Grappling hook',
  mines: 'Mine field',
  laser: 'Laser',
}

/** How far behind the middle of the car a bomb is dropped. */
export const BOMB_DROP_BACK = 5

/** Every so many bananas wins something. */
export const BANANAS_PER_WEAPON = 3

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
export const MACHINE_GUN_AMMO_TICKS = 60 * 5
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
/** How hard a car that flies of its own drives itself along in the air, in m/s². */
export const FLY_THRUST = 24

/**
 * The siren sounds this long, held, and slows every other car within this
 * of it by this much; the shockwave stuns every car within this for this
 * long. A slowed car is held back this hard, in meters a second each
 * second at a full slow, and stays slowed this long after the siren has
 * passed it.
 */
export const SIREN_TICKS = 60 * 5
export const SIREN_RANGE = 30
export const SIREN_SLOW = 0.5
export const SHOCKWAVE_RANGE = 30
export const SHOCKWAVE_STUN_TICKS = 60 * 5
export const SLOW_DRAG = 9
export const SLOW_HOLD_TICKS = 2

/** What a bomb takes of what wrecks a car before its `DURABILITY`: all of it, for one won; a car's own take a share of that. */
export const BOMB_DAMAGE = 1

/**
 * A car in an oil slick has this share of its tires' grip for this long
 * after, at a full slick.
 */
export const OIL_GRIP = 0.2
export const OIL_SLIP_TICKS = 60 * 5

/** The shield keeps off everything the weapons do to a car, damage, stuns and slows, for this long. */
export const SHIELD_TICKS = 60 * 10

/** The magnet takes every banana within this of the car, for this long. */
export const MAGNET_REACH = 50
export const MAGNET_TICKS = 60 * 30

/**
 * The triple rocket fires this many rockets, fanned out by this much
 * either side of dead ahead, in radians, each with this much of a full
 * blast and each after a different car ahead where there are enough.
 */
export const TRIPLE_ROCKETS = 3
export const TRIPLE_ROCKET_FAN = 0.2
export const TRIPLE_ROCKET_POWER = 0.5

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
 * The grappling hook catches the nearest car within this far and this near
 * dead ahead, and holds on for this long, or until the line is stretched
 * past this. While it holds, it reels the car in toward the one it caught,
 * this hard past this much slack, in meters a second a second, and drags
 * the caught car back toward it by this share of that. With no car there
 * to catch, the line shoots out as far as it reaches and back in this
 * long, and catches nothing.
 */
export const GRAPPLE_RANGE = 60
export const GRAPPLE_COS = 0.6
export const GRAPPLE_TICKS = 60 * 4
export const GRAPPLE_MISS_TICKS = 60
export const GRAPPLE_BREAK = 90
export const GRAPPLE_SLACK = 6
export const GRAPPLE_PULL = 14
export const GRAPPLE_DRAG = 0.4

/**
 * A mine field is this many mines, each with this much of a bomb's blast,
 * laid behind the car in a spread this wide and this deep.
 */
export const MINES = 5
export const MINE_POWER = 0.3
export const MINES_WIDE = 8
export const MINES_DEEP = 4

/**
 * What a car does with its own key: something of the vehicle's own, had
 * besides whatever it carries, and as strong as the power-up it is like.
 * Nothing is mounted over the roof for it, and the HUD makes nothing of it.
 */
export type OwnActionKind = 'missile' | 'hop' | 'boost' | 'lights' | 'gun' | 'laser' | 'oil' | 'horn' | 'bomb' | 'tripleRocket' | 'fly'
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
  about: 'Turns the lights on or off. While they are on, every car within 30 meters is slowed by half.',
  activeTicks: 0,
  cooldownTicks: 0,
}
export const OWN_ACTIONS: Readonly<Record<VehicleProfileId, OwnAction>> = {
  tank: {
    kind: 'missile',
    label: 'Missile',
    about: 'Fires a missile with the blast of the rocket power-up, every eight seconds.',
    activeTicks: 0,
    cooldownTicks: 60 * 8,
  },
  goKart: { kind: 'hop', label: 'Hop', about: 'Jumps into the air whenever the kart is on the ground.', activeTicks: 6, cooldownTicks: 0 },
  duneBuggy: {
    kind: 'tripleRocket',
    label: 'Triple rocket',
    about: 'Fires three rockets in a fan, as the triple rocket power-up does, every thirty seconds.',
    activeTicks: 0,
    cooldownTicks: 60 * 30,
  },
  rocketShip: {
    kind: 'fly',
    label: 'Fly',
    about: 'Lifts off and flies while held: the pedals drive it along, and the steering banks it into a turn.',
    activeTicks: 0,
    cooldownTicks: 0,
  },
  raceCar: {
    kind: 'boost',
    label: 'Boost',
    about: 'Pushes with the force of the rocket engine power-up while held.',
    activeTicks: 0,
    cooldownTicks: 0,
  },
  police: LIGHTS,
  ambulance: LIGHTS,
  firetruck: LIGHTS,
  smallCar: {
    kind: 'gun',
    label: 'Machine gun',
    about: 'Fires at the car ahead while held, with the damage of the machine gun power-up.',
    activeTicks: 0,
    cooldownTicks: 0,
  },
  amphibian: {
    kind: 'laser',
    label: 'Laser',
    about: 'Burns the car ahead while held, with the bite of the laser power-up.',
    activeTicks: 0,
    cooldownTicks: 0,
  },
  sportsCar: {
    kind: 'oil',
    label: 'Oil slick',
    about: 'Drops an oil slick behind, as slippery as the oil slick power-up, every three seconds. Up to three can be out at once, and a fourth replaces the oldest.',
    activeTicks: 0,
    cooldownTicks: 60 * 3,
  },
  semi: {
    kind: 'horn',
    label: 'Horn',
    about: 'Stuns every car within 30 meters for five seconds, every five seconds.',
    activeTicks: 60,
    cooldownTicks: 60 * 5,
  },
  pickup: {
    kind: 'bomb',
    label: 'Bomb',
    about: 'Drops a bomb behind with the blast of the bomb power-up, every five seconds. Up to five can be out at once, and a sixth replaces the oldest.',
    activeTicks: 0,
    cooldownTicks: 60 * 5,
  },
}
/** The actions that go on while the key is held. */
const LASTING: readonly OwnActionKind[] = ['boost', 'gun', 'laser', 'fly']
/** The hop: this much speed straight up, from the ground, which carries the kart a few meters into the air. */
export const HOP_SPEED = 8
/** The race car's boost: the rocket engine's push. */
export const BOOST_PUSH = ENGINE_PUSH
/** The semi's horn stuns as the shockwave does; an emergency vehicle's lights slow every car within the siren's reach as the siren does. */
export const HORN_RANGE = SHOCKWAVE_RANGE
export const HORN_STUN_TICKS = SHOCKWAVE_STUN_TICKS
export const EMERGENCY_SLOW = SIREN_SLOW
/**
 * How much of what is won a car's own is: the tank's missile of a rocket's
 * blast, the sports car's gun of a shot's bite, the pickup's bomb of a
 * bomb's blast, and the small car's oil of an oil slick's slip. All of it.
 */
export const OWN_MISSILE_POWER = 1
export const OWN_GUN_POWER = 1
export const OWN_BOMB_POWER = 1
export const OWN_OIL_POWER = 1
/** The pickup has this many bombs out at once at most, and the small car this many oil slicks: past that, the oldest goes as the next is dropped. */
export const OWN_BOMBS_MOST = 5
export const OWN_OILS_MOST = 3

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
  duneBuggy: [],
  rocketShip: ['Hovers over the ground on its thrusters, with no wheels to grip it.'],
  amphibian: ['Floats, and drives on the water like a boat: it is never taken for lost there.'],
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
/** How much one shot takes of what wrecks a car before its `DURABILITY`. */
export const MACHINE_GUN_DAMAGE = 0.02
/**
 * The laser: how long it burns for, in ticks, how far it reaches, and what
 * each tick of its beam takes of what wrecks a car before its `DURABILITY`.
 */
export const LASER_AMMO_TICKS = 60 * 4
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

/** The keys the weapons read: the fire key, for what is carried, and the car's own. */
export type WeaponKeys = Pick<VehicleInput, 'fire' | 'ability'>

/** What of a seat the weapons read and write. */
export interface Gunner {
  readonly id: number
  readonly occupied: boolean
  /** A car nobody drives, which weapons hurt all the more. */
  readonly npc: boolean
  /** How many cars its weapons have wrecked since it sat down, and how many robots they have brought down. */
  kills: number
  robotKills: number
  readonly vehicle: Vehicle
  readonly tuning: VehicleTuning
  readonly profile: VehicleProfileId
  weapon: Weapon
  /** How many weapons it has won, counted around past 255: a new one is told from the last even when it is the same. */
  wins: number
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
  /** How much longer its shield holds, its magnet pulls, its plow shoves and its tires slip on oil, in ticks. */
  shieldTicks: number
  magnetTicks: number
  plowTicks: number
  slipTicks: number
  /** How much longer its grappling hook holds, and the seat it has caught, or none. */
  grappleTicks: number
  grappleTarget: number
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
    vcopy(out, spider.position)
    out.y += SPIDER_MIDDLE
    return out
  }
  if (target >= UFO_TARGET) {
    const ufo = arena.ufos[target - UFO_TARGET]
    return ufo === undefined ? null : vcopy(out, ufo.position)
  }
  if (target >= ROBOT_TARGET) {
    const robot = arena.robots[target - ROBOT_TARGET]
    if (robot === undefined) return null
    vcopy(out, robot.position)
    out.y += ROBOT_MIDDLE
    return out
  }
  const seat = arena.seats[target]
  if (seat === undefined || !seat.occupied || seat.vehicle.wrecked) return null
  return vcopy(out, seat.vehicle.frame.position)
}

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
  readonly map: TerrainMap
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
const { acos, atan2, cos: cosine, hypot, sin: sine } = exact

const muzzle = v3()
const toward = v3()
const desired = v3()
const heading = v3()
const spin = v3()
const aside = v3()
const shove = v3()

/**
 * The power-up each vehicle already has in its own key, and so is never
 * given: the tank's missile is a rocket, the race car's boost a rocket
 * engine, an emergency vehicle's lights a siren, and so on.
 */
export const NATIVE_POWER_UPS: Readonly<Record<VehicleProfileId, readonly Weapon[]>> = {
  tank: ['rocket'],
  raceCar: ['engine'],
  police: ['siren'],
  ambulance: ['siren'],
  firetruck: ['siren'],
  sportsCar: ['oil'],
  smallCar: ['machineGun'],
  semi: ['shockwave'],
  pickup: ['bomb'],
  goKart: [],
  duneBuggy: ['tripleRocket'],
  rocketShip: ['wings'],
  amphibian: ['laser'],
}

/** What a vehicle can win: everything but what it has of its own. */
export function weaponsFor(profile: VehicleProfileId): readonly Weapon[] {
  return WEAPON_POOLS.get(profile) ?? WEAPONS
}
const WEAPON_POOLS = new Map<VehicleProfileId, readonly Weapon[]>(
  VEHICLE_PROFILE_IDS.map((profile) => [profile, WEAPONS.filter((weapon) => !NATIVE_POWER_UPS[profile].includes(weapon))]),
)

/**
 * What a seat wins with its bananas: anyone's guess among what its vehicle
 * can win, but the same guess on every copy of the simulation, worked out
 * from the map, the seat, the tick and the score.
 */
export function weaponWon(mapSeed: number, seat: number, tick: number, score: number, profile: VehicleProfileId): Weapon {
  const hash = pickupSeed(mapSeed ^ Math.imul(score, 0x27d4eb2f), seat, tick)
  const pool = weaponsFor(profile)
  return pool[hash % pool.length] ?? 'none'
}

/** How long a weapon lasts, held down: none at all for one that goes all at once. */
export function ammoFor(weapon: Weapon): number {
  switch (weapon) {
    case 'machineGun':
      return MACHINE_GUN_AMMO_TICKS
    case 'laser':
      return LASER_AMMO_TICKS
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
 * Whether the car's own lasting action is going: the boost or the gun,
 * with its key held. It goes whatever the car carries. A wreck does
 * nothing.
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
  seat.wins = (seat.wins + 1) & 0xff
}

/**
 * Whether the car is being driven along by a weapon: the rocket engine
 * burning or the wings holding it up, or the car's own boost going.
 */
export function burning(seat: Gunner, keys: WeaponKeys = seat.vehicle.command): boolean {
  if (using(seat, 'engine', keys) || using(seat, 'wings', keys)) return true
  return acting(seat, keys) && (ownAction(seat).kind === 'boost' || ownAction(seat).kind === 'fly')
}

/** Whether the car is held up in the air: by the wings it has won, or, for a car that flies of its own, its own key. */
export function lifting(seat: Gunner, keys: WeaponKeys = seat.vehicle.command): boolean {
  return using(seat, 'wings', keys) || (acting(seat, keys) && ownAction(seat).kind === 'fly')
}

/**
 * Whether the car has wings out: the ones it has won, with time left of
 * them, whether or not the key is held, or its own, for a car that flies.
 * A wreck has none.
 */
export function winged(seat: Gunner): boolean {
  if (seat.vehicle.wrecked) return false
  return (seat.weapon === 'wings' && seat.ammoTicks > 0) || ownAction(seat).kind === 'fly'
}

/**
 * The push of the rocket engine and the lift of the wings, for the step:
 * the engine shoves the car the way its nose points, less and less as it
 * gets far past what its own engine could do, and the car's own boost
 * shoves it half as hard, with it if both are going; the wings push it up
 * toward a steady climb, arrest a fall, and turn it as it is steered. A
 * car carrying wings is steered the same way whenever it is in the air,
 * key or no key: gliding, it turns like a plane too.
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
    const climb = clamp(1 - vdot(frame.linearVelocity, vehicle.up) / WINGS_CLIMB_SPEED, 0, 1)
    addForceAlong(body, vehicle.up, tuning.mass * (gravity + WINGS_CLIMB_PUSH * climb))
    // The pedals drive it along, forward or back, wherever it is: harder for a car that flies of its own.
    const thrust = ownAction(seat).kind === 'fly' && !using(seat, 'wings', command) ? FLY_THRUST : WINGS_THRUST
    addForceAlong(body, frame.forward, tuning.mass * thrust * (command.throttle - command.brake))
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
  seat.shieldTicks = 0
  seat.magnetTicks = 0
  seat.plowTicks = 0
  seat.slipTicks = 0
  seat.grappleTicks = 0
  seat.grappleTarget = NO_TARGET
}

/** Whether a car's shield is up: nothing the weapons do reaches it. */
export function shielded(seat: Gunner): boolean {
  return seat.shieldTicks > 0
}

/**
 * Take this much of a car's life with a weapon, unless its shield is up. A
 * hit that wrecks it is a kill to whoever fired, if that is someone else.
 */
export function harm(seat: Gunner, damage: number, by?: Gunner): void {
  if (shielded(seat)) return
  const whole = !seat.vehicle.wrecked
  // A car nobody drives has its toughness cut by its fragility, which its armor already takes the root of.
  hurtVehicle(seat.vehicle, seat.tuning, damage * (seat.npc ? Math.sqrt(NPC_FRAGILITY) : 1))
  if (whole && seat.vehicle.wrecked && by !== undefined && by.id !== seat.id && by.occupied) by.kills += 1
}

/** How much of their grip a car's tires have: a share of it while they slip on oil. */
export function gripOf(seat: Gunner): number {
  return seat.slipTicks > 0 ? OIL_GRIP : 1
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
export function sightLine(map: TerrainMap, from: Vec3, to: Vec3): number {
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
  const consider = (id: number, at: Vec3): void => {
    vsub(toward, at, from)
    const distance = vlength(toward)
    if (distance === 0 || distance > nearest) return
    if (vdot(toward, forward) / distance < sweepCos) return
    target = id
    nearest = distance
  }
  for (const other of arena.seats) if (inPlay(seat, other)) consider(other.id, other.vehicle.frame.position)
  machinesOf(arena, consider)
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
  const carried = seat.weapon === 'machineGun' || seat.weapon === 'laser'
  const own = ownAction(seat).kind
  if (!carried && !((own === 'gun' || own === 'laser') && acting(seat))) {
    seat.aimTarget = NO_TARGET
    return
  }
  const laser = carried ? seat.weapon === 'laser' : own === 'laser'
  muzzlePoint(muzzle, seat, !carried)
  seat.aimTarget = pickOut(arena, seat, muzzle, laser ? LASER_RANGE : MACHINE_GUN_RANGE, MACHINE_GUN_SWEEP_COS)
}

/**
 * One shot from a car's gun, with this much of a full shot's bite: at the
 * car it is trained on, from the muzzle, hitting unless a hill is in the
 * way; or straight ahead at nothing when there is no such car. Either way
 * it is on the record for the tick, to be drawn.
 */
function shoot(arena: Battlefield, seat: Gunner, power: number, own: boolean, kind: Shot['kind'] = 'bullet'): void {
  muzzlePoint(muzzle, seat, own)
  const from = vcopy(v3(), muzzle)
  const to = v3()
  const at = aimPoint(arena, seat.aimTarget, aimed)
  if (at === null) {
    vaddScaled(to, muzzle, seat.vehicle.frame.forward, kind === 'laser' ? LASER_RANGE : MACHINE_GUN_RANGE)
    arena.shots.push({ owner: seat.id, from, to, hit: NO_TARGET, kind })
    return
  }
  const clear = sightLine(arena.map, muzzle, at)
  vsub(toward, at, muzzle)
  vaddScaled(to, muzzle, toward, clear)
  // A police car's armor turns bullets, not light.
  const car = seat.aimTarget < ROBOT_TARGET ? arena.seats[seat.aimTarget] : undefined
  const damage = kind === 'laser' ? LASER_DAMAGE : MACHINE_GUN_DAMAGE * (car === undefined ? 1 : shotShare(car.profile))
  if (clear === 1) strike(arena, seat.aimTarget, damage * power, seat)
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

/** Stun a car for this long, or longer if it already is, unless its shield is up. */
const stun =
  (ticks: number) =>
  (other: Gunner): void => {
    if (shielded(other)) return
    other.stunnedTicks = Math.max(other.stunnedTicks, ticks)
  }

/** Slow a car by this share for the moment, or more if it already is; an emergency vehicle is not slowed, nor a shielded one. */
const slow =
  (share: number) =>
  (other: Gunner): void => {
    if (!slowable(other.profile) || shielded(other)) return
    other.slowedTicks = SLOW_HOLD_TICKS
    other.slowedBy = Math.max(other.slowedBy, share)
  }

/**
 * A rocket goes, with this much of a full blast: from the muzzle, straight
 * ahead or turned this far off it, after this car or, left to itself,
 * whoever is there to go after.
 */
function launchRocket(arena: Battlefield, seat: Gunner, power: number, own: boolean, target?: number, turn = 0): void {
  muzzlePoint(muzzle, seat, own)
  const { forward } = seat.vehicle.frame
  const c = cosine(turn)
  const s = sine(turn)
  arena.rockets.push({
    id: rocketId(seat.id, seat.rocketsFired),
    owner: seat.id,
    target: target ?? pickOut(arena, seat, muzzle, ROCKET_LOCK_RANGE, ROCKET_LOCK_COS),
    position: vcopy(v3(), muzzle),
    velocity: vscale(v3(), v3(forward.x * c - forward.z * s, forward.y, forward.x * s + forward.z * c), ROCKET_SPEED),
    bornTick: arena.tick,
    power,
  })
  seat.rocketsFired = (seat.rocketsFired + 1) % ROCKETS_COUNTED
}

/** Every car within this far and this near dead ahead of a point, nearest first. */
function pickAll(arena: Battlefield, seat: Gunner, from: Vec3, range: number, sweepCos: number): number[] {
  const { forward } = seat.vehicle.frame
  const found: { id: number; distance: number }[] = []
  const consider = (id: number, at: Vec3): void => {
    vsub(toward, at, from)
    const distance = vlength(toward)
    if (distance === 0 || distance > range || vdot(toward, forward) / distance < sweepCos) return
    found.push({ id, distance })
  }
  for (const other of arena.seats) if (inPlay(seat, other)) consider(other.id, other.vehicle.frame.position)
  machinesOf(arena, consider)
  return found.sort((a, b) => a.distance - b.distance || a.id - b.id).map((one) => one.id)
}

/**
 * The triple rocket: its rockets fanned out either side of dead ahead,
 * each after a different car ahead, nearest first, and the ones there are
 * no more cars for after the nearest.
 */
function launchTriple(arena: Battlefield, seat: Gunner, own = false): void {
  muzzlePoint(muzzle, seat, own)
  const targets = pickAll(arena, seat, muzzle, ROCKET_LOCK_RANGE, ROCKET_LOCK_COS)
  for (let k = 0; k < TRIPLE_ROCKETS; k++) {
    const target = targets[k] ?? targets[0] ?? NO_TARGET
    launchRocket(arena, seat, TRIPLE_ROCKET_POWER, own, target, (k - (TRIPLE_ROCKETS - 1) / 2) * TRIPLE_ROCKET_FAN)
  }
}

/** How far over the ground each thing dropped lies: a bomb floats, a mine sits on it, and an oil slick lies flat on it, just clear of it to be drawn. */
const DROP_HEIGHT: Readonly<Record<LooseKind, number>> = { banana: PICKUP_HEIGHT, bomb: PICKUP_HEIGHT, mine: 0.1, oil: 0.05 }

/**
 * Something goes down behind the car, this far back and this far to its
 * right, with this much of a full one's power, over the ground there or
 * over the road the car is on where that is higher: a bomb to float until
 * a car runs into it, a mine to sit until one does, or an oil slick to lie
 * there. It is thrown out like a spilled banana, and cannot be run into
 * until it has landed, which gives the car that dropped it a moment to get
 * clear; after that it goes off on anyone, or oils anyone, that car too.
 */
function drop(arena: Battlefield, seat: Gunner, kind: LooseKind, power: number, back = BOMB_DROP_BACK, aside = 0): void {
  const { position, forward, right } = seat.vehicle.frame
  const x = position.x - forward.x * back + right.x * aside
  const z = position.z - forward.z * back + right.z * aside
  const level = Math.max(sampleHeight(arena.map.heightfield, x, z), position.y - seat.tuning.chassisHalfHeight)
  arena.loose.push({
    id: arena.looseNext,
    kind,
    owner: seat.id,
    power,
    from: vcopy(v3(), position),
    position: v3(x, level + DROP_HEIGHT[kind], z),
    bornTick: arena.tick,
  })
  arena.looseNext = (arena.looseNext + 1) % LOOSE_IDS
}

/** A mine field: its mines laid across behind the car, every other one further back. */
function layMines(arena: Battlefield, seat: Gunner): void {
  for (let k = 0; k < MINES; k++) {
    const aside = (k / (MINES - 1) - 0.5) * MINES_WIDE
    drop(arena, seat, 'mine', MINE_POWER, BOMB_DROP_BACK + (k % 2) * MINES_DEEP, aside)
  }
}

/** A car has only so many of its own of a kind out at once: before the next is dropped, the oldest go to make room for it. */
function harvest(arena: Battlefield, seat: Gunner, kind: LooseKind, most: number): void {
  for (;;) {
    let out = 0
    let oldest = -1
    arena.loose.forEach((loose, i) => {
      if (loose.kind !== kind || loose.owner !== seat.id) return
      out += 1
      if (oldest < 0 || loose.bornTick < arena.loose[oldest]!.bornTick) oldest = i
    })
    if (out < most || oldest < 0) return
    arena.loose.splice(oldest, 1)
  }
}

/**
 * The ram plow: every car and prop just in front of the car, that the car
 * is closing on, is thrown on ahead of it, faster than the plow is closing
 * on it, and a little up. A shielded car is not.
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
    if (!inPlay(seat, other) || shielded(other)) continue
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

/** Let go of whatever the grappling hook has caught. */
function unhook(seat: Gunner): void {
  seat.grappleTicks = 0
  seat.grappleTarget = NO_TARGET
}

/**
 * The grappling hook, for the step: while it holds, the line reels the car
 * in toward the one it caught, harder the more it is stretched past its
 * slack, and drags that one back toward it by a share of that, unless its
 * shield is up. It lets go when that car is gone or wrecked, or the line
 * is stretched too far. A line that caught nothing pulls on nothing.
 */
export function reel(arena: Battlefield, seat: Gunner): void {
  if (seat.grappleTicks <= 0 || seat.grappleTarget === NO_TARGET) return
  const caught = arena.seats[seat.grappleTarget]
  if (caught === undefined || !inPlay(seat, caught) || seat.vehicle.wrecked) {
    unhook(seat)
    return
  }
  vsub(toward, caught.vehicle.frame.position, seat.vehicle.frame.position)
  const distance = vlength(toward)
  if (distance > GRAPPLE_BREAK) {
    unhook(seat)
    return
  }
  if (distance <= GRAPPLE_SLACK) return
  const stretch = clamp((distance - GRAPPLE_SLACK) / GRAPPLE_SLACK, 0, 1)
  vscale(toward, toward, 1 / distance)
  addForceAlong(seat.vehicle.body, toward, seat.tuning.mass * GRAPPLE_PULL * stretch)
  if (!shielded(caught)) addForceAlong(caught.vehicle.body, toward, -caught.tuning.mass * GRAPPLE_PULL * GRAPPLE_DRAG * stretch)
}

/** Whether a grappling line is on a car, its own or someone else's, pulling it along. */
export function hooked(arena: Battlefield, seat: Gunner): boolean {
  if (seat.grappleTicks > 0 && seat.grappleTarget !== NO_TARGET) return true
  return arena.seats.some((other) => other.grappleTicks > 0 && other.grappleTarget === seat.id && !shielded(seat))
}

/** Whatever lasts of what a car has used runs down, and all of it ends when the car is wrecked. */
function wearOff(seat: Gunner): void {
  if (seat.vehicle.wrecked) {
    seat.shieldTicks = 0
    seat.magnetTicks = 0
    seat.plowTicks = 0
    seat.slipTicks = 0
    unhook(seat)
    return
  }
  if (seat.shieldTicks > 0) seat.shieldTicks -= 1
  if (seat.magnetTicks > 0) seat.magnetTicks -= 1
  if (seat.plowTicks > 0) seat.plowTicks -= 1
  if (seat.slipTicks > 0) seat.slipTicks -= 1
  if (seat.grappleTicks > 0 && --seat.grappleTicks === 0) unhook(seat)
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
    case 'tripleRocket':
      if (!ready) return
      launchTriple(arena, seat, true)
      seat.cooldownTicks = own.cooldownTicks
      return
    case 'bomb':
      if (!ready) return
      harvest(arena, seat, 'bomb', OWN_BOMBS_MOST)
      drop(arena, seat, 'bomb', OWN_BOMB_POWER)
      seat.cooldownTicks = own.cooldownTicks
      return
    case 'oil':
      if (!ready) return
      harvest(arena, seat, 'oil', OWN_OILS_MOST)
      drop(arena, seat, 'oil', OWN_OIL_POWER)
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
    case 'laser':
      if (acting(seat)) shoot(arena, seat, 1, true, 'laser')
      return
    default:
      // The boost and the flight are read off the key as the car is stepped.
      return
  }
}

/**
 * Fire whatever the fire key is held on, and do the car's own with its own
 * key. Most weapons go all at once and are spent: a rocket or three, a
 * bomb, a mine field or an oil slick dropped, the shockwave stunning every
 * car near, and the shield, the magnet and
 * the ram plow set going for a while, and the grappling hook shot at the
 * car ahead, or at nothing. The machine gun, trained on the nearest car
 * ahead whether or not it is firing, fires as long as the key is held and
 * the ammunition lasts, a shot every few ticks, and is gone when it runs
 * dry; the siren sounds as long as it is held, slowing every car near,
 * until it runs out. A cooldown runs down meanwhile, and so does whatever
 * lasts of what was used, the plow shoving all the while. A wreck holds
 * nothing and does nothing.
 */
export function fireWeapons(arena: Battlefield): void {
  arena.shots.length = 0
  for (const seat of arena.seats) {
    if (!seat.occupied) continue
    const { fire, ability } = seat.vehicle.command
    const pressed = ability && !seat.abilityHeld
    seat.abilityHeld = ability
    if (seat.cooldownTicks > 0) seat.cooldownTicks -= 1
    wearOff(seat)
    if (seat.vehicle.wrecked) {
      disarm(seat)
      seat.actionTicks = 0
      seat.lightsOn = false
      continue
    }
    if (seat.plowTicks > 0) plow(arena, seat)
    trainGun(arena, seat)
    act(arena, seat, pressed)
    if (seat.weapon === 'none' || !fire) continue
    if (useAtOnce(arena, seat)) continue
    // The rest last as long as the button is held: the gun firing, the
    // engine burning, the wings holding the car up, the siren sounding,
    // until they run out.
    if (seat.weapon === 'machineGun' && seat.ammoTicks % MACHINE_GUN_SHOT_TICKS === 0) shoot(arena, seat, 1, false)
    if (seat.weapon === 'laser') shoot(arena, seat, 1, false, 'laser')
    if (seat.weapon === 'siren') reach(arena, seat, SIREN_RANGE, slow(SIREN_SLOW))
    seat.ammoTicks -= 1
    if (seat.ammoTicks <= 0) disarm(seat)
  }
}

/** Use a weapon that goes all at once, and spend it; whether it was one. */
function useAtOnce(arena: Battlefield, seat: Gunner): boolean {
  switch (seat.weapon) {
    case 'rocket':
      launchRocket(arena, seat, 1, false)
      break
    case 'tripleRocket':
      launchTriple(arena, seat)
      break
    case 'bomb':
      drop(arena, seat, 'bomb', 1)
      break
    case 'mines':
      layMines(arena, seat)
      break
    case 'oil':
      drop(arena, seat, 'oil', 1)
      break
    case 'shockwave':
      reach(arena, seat, SHOCKWAVE_RANGE, stun(SHOCKWAVE_STUN_TICKS))
      break
    case 'shield':
      seat.shieldTicks = SHIELD_TICKS
      break
    case 'magnet':
      seat.magnetTicks = MAGNET_TICKS
      break
    case 'plow':
      seat.plowTicks = PLOW_TICKS
      break
    case 'grapple': {
      // With nothing ahead to catch, the line shoots out and back, and the hook is spent all the same.
      const target = pickOut(arena, seat, seat.vehicle.frame.position, GRAPPLE_RANGE, GRAPPLE_COS)
      seat.grappleTarget = target
      seat.grappleTicks = target === NO_TARGET ? GRAPPLE_MISS_TICKS : GRAPPLE_TICKS
      break
    }
    default:
      return false
  }
  disarm(seat)
  return true
}

/**
 * Every rocket in the air flies on: turning after its target if it still
 * has one, going off on any car it reaches, with whatever it has of a
 * full blast, and gone when it meets the ground, leaves the map or runs
 * out of time.
 */
export function flyRockets(arena: Battlefield, dt = FIXED_TIMESTEP): void {
  const { map, rockets, seats, tick } = arena
  const extent = mapExtent(map)
  for (let i = rockets.length - 1; i >= 0; i--) {
    const rocket = rockets[i]
    if (rocket === undefined) continue
    const at = aimPoint(arena, rocket.target, aimed)
    if (at !== null) {
      // Turn toward the middle of it, a little high, so it is the body that is met and not the wheels.
      vsub(desired, at, rocket.position)
      desired.y += 0.5
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
    const { x, y, z } = rocket.position
    let spent = tick - rocket.bornTick >= ROCKET_LIFE_TICKS
    spent ||= x < 0 || z < 0 || x > extent.x || z > extent.z || y <= sampleHeight(map.heightfield, x, z)
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
