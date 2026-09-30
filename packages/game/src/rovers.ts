import { createRng, v3, vdistance, vlength, type Vec3 } from '@buggies/physics'
import { alongGround, overSurface, randomDirection, upOf, type World } from '@buggies/terrain'
import type { VehicleSpawn } from '@buggies/vehicle'

import type { DrivenCar, DriverCommand } from './npcs.ts'
import { spawnHere } from './spawns.ts'

/** How many rovers wander each moon: none a planet. */
export const ROVERS = 1
/** How fast it goes, in m/s: an amble. */
export const ROVER_SPEED = 7
/** How far off its next waypoint may be, and how near it has to come to have reached it. */
const ROVER_RANGE = 250
const WAYPOINT_REACH = 12
/** How long it may go without getting this far, in ticks and meters, before it is stuck and set off for the next waypoint. */
const STUCK_TICKS = 60 * 5
const STUCK_REACH = 3
const ROVER_SALT = 0x2d7e

/**
 * What drives a moon rover: no roads on the moon, so it wanders from one
 * waypoint to the next somewhere not far off, over whatever is between.
 */
export interface Rover {
  /** What picks its waypoints. */
  readonly seed: number
  /** How many waypoints it has reached, which picks the next, and where that one is. */
  legs: number
  readonly target: Vec3
  /** How long since it was last this far from where it is. */
  stuckTicks: number
  readonly stuckFrom: Vec3
}

/** Where a rover goes next from here: a point on the moon within its range, picked by how many it has reached. */
function nextWaypoint(map: World, rover: Rover, from: Vec3): void {
  const rng = createRng(rover.seed + rover.legs * 131)
  const up = upOf(from)
  const way = alongGround(randomDirection(rng, v3()), up)
  const length = vlength(way) || 1
  const reach = (0.3 + 0.7 * rng()) * ROVER_RANGE
  const at = {
    x: from.x + (way.x / length) * reach,
    y: from.y + (way.y / length) * reach,
    z: from.z + (way.z / length) * reach,
  }
  overSurface(map, upOf(at), 0, rover.target)
}

/** A rover for this seat, somewhere on the moon; none on a planet. */
export function createRover(map: World, seat: number): Rover | null {
  if (map.kind !== 'moon') return null
  const seed = (map.seed ^ ROVER_SALT) + seat * 7919
  const rover: Rover = { seed, legs: 0, target: v3(), stuckTicks: 0, stuckFrom: v3(Number.POSITIVE_INFINITY, 0, 0) }
  const start = overSurface(map, randomDirection(createRng(seed), v3()), 0, v3())
  nextWaypoint(map, rover, start)
  return rover
}

/** Where a rover sets off from, or starts again from once stuck: here, or somewhere on the moon, facing its waypoint. */
export function roverSpawn(map: World, rover: Rover, from?: Vec3): VehicleSpawn {
  const position = overSurface(map, upOf(from ?? randomDirection(createRng(rover.seed), v3())), 0, v3())
  const facing = alongGround(v3(rover.target.x - position.x, rover.target.y - position.y, rover.target.z - position.z), upOf(position))
  return spawnHere(position, vlength(facing) > 1e-6 ? facing : v3(1, 0, 0))
}

/**
 * Drive a rover toward its waypoint, on to the next once there, steering
 * for it and holding a gentle speed; once stuck, off for the next.
 */
export function wander(map: World, rover: Rover, car: DrivenCar, out: DriverCommand): DriverCommand {
  const { position, forward, right, speed } = car
  if (vdistance(position, rover.target) < WAYPOINT_REACH) {
    rover.legs += 1
    nextWaypoint(map, rover, position)
  }
  const dx = rover.target.x - position.x
  const dy = rover.target.y - position.y
  const dz = rover.target.z - position.z
  const distance = vlength({ x: dx, y: dy, z: dz }) || 1
  const across = (dx * right.x + dy * right.y + dz * right.z) / distance
  const ahead = (dx * forward.x + dy * forward.y + dz * forward.z) / distance
  out.steer = Math.min(Math.max(ahead < 0 ? Math.sign(across || 1) : across * 2, -1), 1)
  const wanted = ROVER_SPEED * (1 - 0.5 * Math.abs(out.steer))
  out.throttle = speed < wanted ? 0.6 : 0
  out.brake = speed > wanted + 2 ? 0.4 : 0

  if (vdistance(position, rover.stuckFrom) > STUCK_REACH) {
    rover.stuckFrom.x = position.x
    rover.stuckFrom.y = position.y
    rover.stuckFrom.z = position.z
    rover.stuckTicks = 0
  } else rover.stuckTicks += 1
  out.stuck = rover.stuckTicks > STUCK_TICKS
  if (out.stuck) {
    rover.stuckTicks = 0
    rover.legs += 1
    nextWaypoint(map, rover, position)
  }
  return out
}
