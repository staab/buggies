import { createRng, v3, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { roadLift, type Road, type TerrainMap } from '@buggies/terrain'
import { addMover } from '@buggies/vehicle'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos, hypot, sin } = exact

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
/** Two road ends this near each other are the one junction, for a robot to turn off at. */
const JUNCTION_REACH = 6
const ROBOT_SALT = 0x0b07

/**
 * A robot: a slow machine patrolling the arterials, turning off at every
 * junction for another, and burning any car its laser eyes can see within
 * reach. Nothing stops it: it rolls through whatever is in its way, and
 * cars run into it as into a wall. Where it is follows from which road it
 * is on and how far along, so everyone with the map agrees.
 */
export interface Robot {
  readonly id: number
  /** The road it is on, by its place in the map's roads, how far along it, and which way it goes. */
  road: number
  along: number
  direction: number
  /** How many roads it has walked, which picks the next at a junction. */
  legs: number
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

/** One road a robot may walk, and how far along it each of its points is. */
interface Route {
  road: number
  lengths: Float32Array
  total: number
}

const routesOf = new WeakMap<TerrainMap, Route[]>()

/** The roads robots walk: the arterials, end to end. */
function routes(map: TerrainMap): Route[] {
  const known = routesOf.get(map)
  if (known !== undefined) return known
  const found: Route[] = []
  map.roads.forEach((road, index) => {
    if (road.kind !== 'arterial' || road.points.length < 2) return
    const lengths = new Float32Array(road.points.length)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!
      const b = road.points[i]!
      lengths[i] = lengths[i - 1]! + hypot(b.x - a.x, b.z - a.z)
    }
    const total = lengths[road.points.length - 1]!
    if (total > 1) found.push({ road: index, lengths, total })
  })
  routesOf.set(map, found)
  return found
}

function routeOf(map: TerrainMap, road: number): Route | undefined {
  return routes(map).find((route) => route.road === road)
}

/** Where a robot is on its road: its feet on the road surface, and its heading along it. */
export function placeRobot(map: TerrainMap, robot: Robot): void {
  const route = routeOf(map, robot.road)
  const road: Road | undefined = map.roads[robot.road]
  if (route === undefined || road === undefined) return
  const along = Math.min(Math.max(robot.along, 0), route.total)
  let low = 0
  let high = road.points.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (route.lengths[middle]! <= along) low = middle
    else high = middle
  }
  const a = road.points[low]!
  const b = road.points[high]!
  const span = route.lengths[high]! - route.lengths[low]! || 1
  const t = (along - route.lengths[low]!) / span
  robot.position.x = a.x + (b.x - a.x) * t
  robot.position.y = a.y + (b.y - a.y) * t + roadLift(road)
  robot.position.z = a.z + (b.z - a.z) * t
  robot.heading = atan2(-(b.x - a.x) * robot.direction, -(b.z - a.z) * robot.direction)
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
  const all = routes(map)
  if (all.length === 0) return []
  return Array.from({ length: ROBOTS }, (_, id) => {
    const rng = createRng((map.seed ^ ROBOT_SALT) + id * 7919)
    const route = all[Math.floor(rng() * all.length)]!
    const robot: Robot = {
      id,
      road: route.road,
      along: rng() * route.total,
      direction: rng() < 0.5 ? 1 : -1,
      legs: 0,
      target: -1,
      beamTicks: 0,
      cooldownTicks: 0,
      position: v3(),
      heading: 0,
      body: addMover(world, ROBOT_SIZE.halfWidth, ROBOT_SIZE.halfHeight, ROBOT_SIZE.halfDepth, { x: 0, y: -1000, z: 0 }),
    }
    placeRobot(map, robot)
    seatRobotBody(robot, true)
    return robot
  })
}

/**
 * Roll a robot on along its road, and off at the end onto another that
 * meets it there, picked by how many it has walked; back the way it came,
 * where nothing does.
 */
export function walkRobot(map: TerrainMap, robot: Robot, dt: number): void {
  const route = routeOf(map, robot.road)
  if (route === undefined) return
  robot.along += robot.direction * ROBOT_SPEED * dt
  if (robot.along >= 0 && robot.along <= route.total) {
    placeRobot(map, robot)
    return
  }
  const road = map.roads[robot.road]!
  const end = robot.along > route.total ? road.points.at(-1)! : road.points[0]!
  const turns: { road: number; start: boolean }[] = []
  for (const other of routes(map)) {
    if (other.road === robot.road) continue
    const points = map.roads[other.road]!.points
    if (hypot(points[0]!.x - end.x, points[0]!.z - end.z) < JUNCTION_REACH) turns.push({ road: other.road, start: true })
    else if (hypot(points.at(-1)!.x - end.x, points.at(-1)!.z - end.z) < JUNCTION_REACH) turns.push({ road: other.road, start: false })
  }
  robot.legs += 1
  const turn = turns[Math.floor(createRng((map.seed ^ ROBOT_SALT) + robot.id * 7919 + robot.legs)() * turns.length)]
  if (turn === undefined) {
    robot.direction = -robot.direction
    robot.along = Math.min(Math.max(robot.along, 0), route.total)
  } else {
    robot.road = turn.road
    robot.direction = turn.start ? 1 : -1
    robot.along = turn.start ? 0 : routeOf(map, turn.road)!.total
  }
  placeRobot(map, robot)
}

/** Where a robot's eyes are. */
export function robotEyes(out: Vec3, robot: Robot): Vec3 {
  out.x = robot.position.x
  out.y = robot.position.y + ROBOT_EYES
  out.z = robot.position.z
  return out
}
