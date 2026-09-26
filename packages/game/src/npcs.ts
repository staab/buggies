import type { VehicleProfileId } from '@buggies/vehicle'
import type { TerrainMap } from '@buggies/terrain'

import { advancePatrol, followPatrol, nearestPatrol, patrolLength, patrolPoint, startPatrol, type Patrol } from './patrol.ts'

/** How many cars nobody drives are out on an island, when there are seats enough. */
export const NPC_CARS = 3
/** How fast they go, in m/s: slower than anyone in a hurry. */
export const NPC_SPEED = 11
/** How many times what would hurt another car hurts one of them: a third of the life. */
export const NPC_FRAGILITY = 3
/** What they drive, picked in turn. */
export const NPC_PROFILES: readonly VehicleProfileId[] = ['smallCar', 'sportsCar', 'pickup']
/** How far down the road a driver looks to steer for. */
const LOOKAHEAD = 14
/** How far either way of where it was a driver looks for itself on its road, and how far off it can wander before it looks for a road afresh. */
const FOLLOW_WINDOW = 40
const LOST_REACH = 25
/** How near the end of a road it turns onto the next. */
const TURN_REACH = 3
/** How long it may sit stuck before it is put back on its road, in ticks. */
const STUCK_TICKS = 60 * 6
const NPC_SALT = 0x0c4a

/** What drives a car nobody drives: its round of the arterials, and how long it has been stuck. */
export interface Driver extends Patrol {
  /** What picks its turns at the junctions. */
  readonly seed: number
  stuckTicks: number
}

/** The seed a driver's rounds are picked by. */
function driverSeed(map: TerrainMap, seat: number): number {
  return (map.seed ^ NPC_SALT) + seat * 104729
}

/** A driver for this seat, on a round of the arterials; none on an island without them. */
export function createDriver(map: TerrainMap, seat: number): Driver | null {
  const seed = driverSeed(map, seat)
  const patrol = startPatrol(seed)(map)
  return patrol === null ? null : { ...patrol, seed, stuckTicks: 0 }
}

/** Where a driver starts: on its road, facing along it. */
export function driverSpawn(map: TerrainMap, driver: Driver): { position: { x: number; y: number; z: number }; yaw: number } {
  const position = { x: 0, y: 0, z: 0 }
  const yaw = patrolPoint(map, driver, position)
  return { position, yaw }
}

/** What a car nobody drives is doing: where it is and which way it faces, and how fast it goes. */
export interface DrivenCar {
  readonly position: { x: number; z: number }
  readonly forward: { x: number; z: number }
  readonly right: { x: number; z: number }
  readonly speed: number
}

/** What the driver asks of the car this tick. */
export interface DriverCommand {
  steer: number
  throttle: number
  brake: number
  /** Whether it has been stuck long enough to want putting back on its road. */
  stuck: boolean
}

/**
 * Drive a car nobody drives along its round: find it on its road, turn
 * onto the next at the end, steer for a point a little way down the road,
 * and hold a gentle speed, easing off for the bends.
 */
export function drive(map: TerrainMap, driver: Driver, car: DrivenCar, out: DriverCommand): DriverCommand {
  const { position, forward, right, speed } = car
  if (followPatrol(map, driver, position.x, position.z, FOLLOW_WINDOW) > LOST_REACH) nearestPatrol(map, driver, position.x, position.z)
  const length = patrolLength(map, driver)
  const left = driver.direction > 0 ? length - driver.along : driver.along
  if (left < TURN_REACH) advancePatrol(map, driver, left + TURN_REACH, driver.seed)

  const target = { x: 0, y: 0, z: 0 }
  patrolPoint(map, driver, target, LOOKAHEAD)
  const dx = target.x - position.x
  const dz = target.z - position.z
  const distance = Math.hypot(dx, dz) || 1
  const across = (dx * right.x + dz * right.z) / distance
  const ahead = (dx * forward.x + dz * forward.z) / distance
  // Behind it, the road is turned toward hard; ahead, as much as it bends away.
  out.steer = Math.min(Math.max(ahead < 0 ? Math.sign(across || 1) : across * 2.2, -1), 1)
  const wanted = NPC_SPEED * (1 - 0.5 * Math.abs(out.steer))
  out.throttle = speed < wanted ? 0.7 : 0
  out.brake = speed > wanted + 3 ? 0.5 : 0

  driver.stuckTicks = speed < 1 ? driver.stuckTicks + 1 : 0
  out.stuck = driver.stuckTicks > STUCK_TICKS
  if (out.stuck) driver.stuckTicks = 0
  return out
}
