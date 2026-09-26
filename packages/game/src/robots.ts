import { v3, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import type { TerrainMap } from '@buggies/terrain'
import { addMover } from '@buggies/vehicle'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import { advancePatrol, patrolPoint, startPatrol, type Patrol } from './patrol.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { cos, sin } = exact

/** How many robots walk each island. */
export const ROBOTS = 2
/** How fast a robot rolls along, in m/s: slower than anything anyone drives. */
export const ROBOT_SPEED = 3.5
/** Half its size across, up and along. */
export const ROBOT_SIZE = { halfWidth: 1.6, halfHeight: 3, halfDepth: 1.4 } as const
/** How high its eyes are over its feet. */
export const ROBOT_EYES = 5.2
/** How far its eyes reach. */
export const ROBOT_RANGE = 70
/** How long it holds its beam on a car, and how long its eyes then take to charge again, in ticks. */
export const ROBOT_BEAM_TICKS = 60
export const ROBOT_COOLDOWN_TICKS = 60 * 4
/** What a tick of the beam takes of what wrecks a car before its durability. */
export const ROBOT_DAMAGE = 0.012
const ROBOT_SALT = 0x0b07

/**
 * A robot: a slow machine patrolling the arterials, turning off at every
 * junction for another, and burning any car its laser eyes can see within
 * reach. Nothing stops it: it rolls through whatever is in its way, and
 * cars run into it as into a wall. Where it is follows from which road it
 * is on and how far along, so everyone with the map agrees.
 */
export interface Robot extends Patrol {
  readonly id: number
  /** How much of what brings it down it has taken, 0 to 1, and how many times it has been brought down, which picks where it comes back. */
  damage: number
  deaths: number
  /** The seat its eyes are on, while its beam is lit, or none. */
  target: number
  beamTicks: number
  cooldownTicks: number
  /** Where its feet are, and which way it faces, worked out from the road. */
  readonly position: Vec3
  heading: number
  /** What the cars run into. */
  readonly body: RAPIER.RigidBody
}

/** The seed a robot's rounds are picked by. */
function robotSeed(map: TerrainMap, id: number): number {
  return (map.seed ^ ROBOT_SALT) + id * 7919
}

/** Where a robot is on its road: its feet on the road surface, and its heading along it. */
export function placeRobot(map: TerrainMap, robot: Robot): void {
  robot.heading = patrolPoint(map, robot, robot.position)
}

/** Put a robot's body where the robot is: straight there, or moved there over the next step. */
export function seatRobotBody(robot: Robot, now: boolean): void {
  const at = { x: robot.position.x, y: robot.position.y + ROBOT_SIZE.halfHeight, z: robot.position.z }
  const turn = { x: 0, y: sin(robot.heading / 2), z: 0, w: cos(robot.heading / 2) }
  if (now) {
    robot.body.setTranslation(at, true)
    robot.body.setRotation(turn, true)
  } else {
    robot.body.setNextKinematicTranslation(at)
    robot.body.setNextKinematicRotation(turn)
  }
}

/** The island's robots, each on an arterial of the seed's choosing; none on an island with no arterials. */
export function createRobots(map: TerrainMap, world: RAPIER.World): Robot[] {
  const robots: Robot[] = []
  for (let id = 0; id < ROBOTS; id++) {
    const patrol = startPatrol(robotSeed(map, id))(map)
    if (patrol === null) return []
    const robot: Robot = {
      id,
      ...patrol,
      damage: 0,
      deaths: 0,
      target: -1,
      beamTicks: 0,
      cooldownTicks: 0,
      position: v3(),
      heading: 0,
      body: addMover(world, ROBOT_SIZE.halfWidth, ROBOT_SIZE.halfHeight, ROBOT_SIZE.halfDepth, { x: 0, y: -1000, z: 0 }),
    }
    placeRobot(map, robot)
    seatRobotBody(robot, true)
    robots.push(robot)
  }
  return robots
}

/** Roll a robot on along its round of the arterials. */
export function walkRobot(map: TerrainMap, robot: Robot, dt: number): void {
  advancePatrol(map, robot, ROBOT_SPEED * dt, robotSeed(map, robot.id))
  placeRobot(map, robot)
}

/** Where a robot's eyes are. */
export function robotEyes(out: Vec3, robot: Robot): Vec3 {
  out.x = robot.position.x
  out.y = robot.position.y + ROBOT_EYES
  out.z = robot.position.z
  return out
}

/**
 * A robot brought down comes back whole somewhere else on the arterials,
 * picked by how many times it has been brought down, its eyes charging.
 */
export function rebuildRobot(map: TerrainMap, robot: Robot): void {
  robot.deaths += 1
  robot.damage = 0
  const patrol = startPatrol(robotSeed(map, robot.id) + robot.deaths * 977)(map)
  if (patrol !== null) Object.assign(robot, patrol)
  robot.target = -1
  robot.beamTicks = 0
  robot.cooldownTicks = ROBOT_COOLDOWN_TICKS
  placeRobot(map, robot)
  seatRobotBody(robot, true)
}
