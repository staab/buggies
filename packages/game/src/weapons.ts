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
  type VehicleProfileId,
  type VehicleTuning,
} from '@buggies/vehicle'

import { PICKUP_HEIGHT, LOOSE_IDS, pickupSeed, type Loose } from './pickups.ts'

/** What a car can be carrying over its roof: nothing, or something won with bananas. */
export type Weapon = 'none' | 'rocket' | 'machineGun' | 'bomb' | 'engine' | 'wings'

/** What can be won, in the order the HUD rolls through them. */
export const WEAPONS: readonly Weapon[] = ['rocket', 'machineGun', 'bomb', 'engine', 'wings']

export const WEAPON_LABELS: Readonly<Record<Weapon, string>> = {
  none: '',
  rocket: 'Rocket',
  machineGun: 'Machine gun',
  bomb: 'Bomb',
  engine: 'Rocket engine',
  wings: 'Wings',
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
 * How long, held down, the machine gun fires for, the rocket engine burns
 * and the wings hold the car up, in ticks; the gun fires a shot every so
 * many of them.
 */
export const MACHINE_GUN_AMMO_TICKS = 60 * 10
export const ENGINE_BURN_TICKS = 60 * 10
export const WINGS_FLIGHT_TICKS = 60 * 10
export const MACHINE_GUN_SHOT_TICKS = 6

/** How hard the rocket engine pushes, in metres a second a second, fading out toward this many times the car's own top speed. */
export const ENGINE_PUSH = 12
export const ENGINE_TOP_SPEED = 1.8

/**
 * How fast the wings climb, in metres a second, and how hard they push up
 * toward that; and how hard they turn the car in the air, as a share of
 * what the pedals pitch it by.
 */
export const WINGS_CLIMB_SPEED = 8
export const WINGS_CLIMB_PUSH = 6
export const WINGS_TURN = 0.8
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

/** How often the line of a shot is checked against the ground, in metres. */
const SIGHT_STEP = 4
/** How high over the ground a line of fire has to stay. */
const SIGHT_CLEARANCE = 0.3

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
}

/** A rocket in the air: from whom, after whom, and where it is going. */
export interface Rocket {
  readonly id: number
  readonly owner: number
  /** The seat it is after, or none. */
  target: number
  readonly position: Vec3
  readonly velocity: Vec3
  readonly bornTick: number
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

const muzzle = v3()
const toward = v3()
const desired = v3()
const heading = v3()

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
    default:
      return 0
  }
}

/** Give a seat what it has won, with however long it lasts. */
export function arm(seat: Gunner, weapon: Weapon): void {
  seat.weapon = weapon
  seat.ammoTicks = ammoFor(weapon)
}

/**
 * Whether the car is being driven along by what it carries: the rocket
 * engine burning or the wings holding it up, the button down and something
 * left of them. A wreck burns nothing.
 */
export function burning(seat: Gunner, fire = seat.vehicle.command.fire): boolean {
  if (seat.weapon !== 'engine' && seat.weapon !== 'wings') return false
  return fire && seat.ammoTicks > 0 && !seat.vehicle.wrecked
}

/**
 * The push of the rocket engine and the lift of the wings, for the step:
 * the engine shoves the car the way its nose points, less and less as it
 * gets far past what its own engine could do; the wings push it up toward
 * a steady climb, arrest a fall, and turn it as it is steered.
 */
export function pushWithWeapons(seat: Gunner, gravity: number): void {
  if (!burning(seat)) return
  const { vehicle, tuning } = seat
  const { body, frame, command } = vehicle
  if (seat.weapon === 'engine') {
    const headroom = clamp(1 - vehicle.speed / (tuning.maxSpeed * ENGINE_TOP_SPEED), 0, 1)
    addForceAlong(body, frame.forward, tuning.mass * ENGINE_PUSH * headroom)
    return
  }
  const climb = clamp(1 - frame.linearVelocity.y / WINGS_CLIMB_SPEED, 0, 1)
  addForceAlong(body, WORLD_UP, tuning.mass * (gravity + WINGS_CLIMB_PUSH * climb))
  addTorqueAbout(body, frame.up, -command.steer * tuning.airPitchTorque * WINGS_TURN)
}

export function disarm(seat: Gunner): void {
  seat.weapon = 'none'
  seat.ammoTicks = 0
  seat.aimTarget = NO_TARGET
}

/** Where a car's weapon rides: over the middle of its roof. */
export function mountPoint(out: Vec3, vehicle: Vehicle, tuning: VehicleTuning): Vec3 {
  return vaddScaled(out, vehicle.frame.position, vehicle.frame.up, tuning.chassisHalfHeight + MOUNT_HEIGHT)
}

/** Where a car's rockets and shots leave from: the muzzle of its own gun if it has one, else over the roof. */
export function muzzlePoint(out: Vec3, seat: Gunner): Vec3 {
  const gun = BUILT_IN_GUNS[seat.profile]
  if (gun === undefined) return mountPoint(out, seat.vehicle, seat.tuning)
  const { position, forward, up } = seat.vehicle.frame
  vaddScaled(out, position, forward, gun.ahead)
  return vaddScaled(out, out, up, gun.up)
}

/** A rocket's number: the tick it went and whose it is, so every copy of the simulation numbers it the same. */
export function rocketId(tick: number, seat: number): number {
  return ((tick << 3) | (seat & 7)) & 0xffff
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
 * One shot from a car's gun: at the car it is trained on, from over the
 * roof, hitting unless a hill is in the way; or straight ahead at nothing
 * when there is no such car. Either way it is on the record for the tick,
 * to be drawn.
 */
function shoot(arena: Battlefield, seat: Gunner): void {
  muzzlePoint(muzzle, seat)
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
  if (clear === 1) hurtVehicle(target.vehicle, target.tuning, MACHINE_GUN_DAMAGE)
  arena.shots.push({ owner: seat.id, from, to, hit: clear === 1 ? target.id : NO_TARGET })
}

/** A rocket goes: from over the roof, straight ahead, after whoever is there to go after. */
function launch(arena: Battlefield, seat: Gunner): void {
  muzzlePoint(muzzle, seat)
  arena.rockets.push({
    id: rocketId(arena.tick, seat.id),
    owner: seat.id,
    target: pickOut(arena, seat, muzzle, ROCKET_LOCK_RANGE, ROCKET_LOCK_COS),
    position: vcopy(v3(), muzzle),
    velocity: vscale(v3(), seat.vehicle.frame.forward, ROCKET_SPEED),
    bornTick: arena.tick,
  })
  disarm(seat)
}

/**
 * A bomb goes down behind the car, to float over the ground there, or
 * over the road the car is on where that is higher, until a car runs into
 * it. It is thrown out like a spilled banana, and cannot go off until it
 * has landed, which gives the car that dropped it a moment to get clear;
 * after that it goes off on anyone, that car too.
 */
function drop(arena: Battlefield, seat: Gunner): void {
  const { position, forward } = seat.vehicle.frame
  const x = position.x - forward.x * BOMB_DROP_BACK
  const z = position.z - forward.z * BOMB_DROP_BACK
  const level = Math.max(sampleHeight(arena.map.heightfield, x, z), position.y - seat.tuning.chassisHalfHeight)
  arena.loose.push({
    id: arena.looseNext,
    kind: 'bomb',
    from: vcopy(v3(), position),
    position: v3(x, level + PICKUP_HEIGHT, z),
    bornTick: arena.tick,
  })
  arena.looseNext = (arena.looseNext + 1) % LOOSE_IDS
  disarm(seat)
}

/**
 * Fire whatever the button is held on. A rocket goes the moment it is
 * asked for, and a bomb is dropped the moment it is; the machine gun,
 * trained on the nearest car ahead whether or not it is firing, fires as
 * long as the button is held and the ammunition lasts, a shot every few
 * ticks, and is gone when it runs dry. A wreck holds nothing.
 */
export function fireWeapons(arena: Battlefield): void {
  arena.shots.length = 0
  for (const seat of arena.seats) {
    if (!seat.occupied || seat.weapon === 'none') continue
    if (seat.vehicle.wrecked) {
      disarm(seat)
      continue
    }
    if (seat.weapon === 'machineGun') {
      muzzlePoint(muzzle, seat)
      seat.aimTarget = pickOut(arena, seat, muzzle, MACHINE_GUN_RANGE, MACHINE_GUN_SWEEP_COS)
    }
    if (!seat.vehicle.command.fire) continue
    if (seat.weapon === 'rocket') {
      launch(arena, seat)
      continue
    }
    if (seat.weapon === 'bomb') {
      drop(arena, seat)
      continue
    }
    // The rest last as long as the button is held: the gun firing, the
    // engine burning, the wings holding the car up, until they run out.
    if (seat.weapon === 'machineGun' && seat.ammoTicks % MACHINE_GUN_SHOT_TICKS === 0) shoot(arena, seat)
    seat.ammoTicks -= 1
    if (seat.ammoTicks <= 0) disarm(seat)
  }
}

/**
 * Every rocket in the air flies on: turning after its target if it still
 * has one, going off on any car it reaches, and gone when it meets the
 * ground, leaves the map or runs out of time.
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
        hurtVehicle(other.vehicle, other.tuning, ROCKET_DAMAGE)
        spent = true
        break
      }
    }
    if (spent) rockets.splice(i, 1)
  }
}
