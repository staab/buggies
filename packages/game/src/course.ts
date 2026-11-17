/**
 * A race's course: the worlds it runs through, the portals it keeps of
 * each, and the run of gates that leads from where a racer sets off or
 * comes out to the portal that leads to the next world, or to the line
 * that finishes it.
 *
 * It is made from the game's seed and how many worlds long the race is, and
 * from the worlds themselves, which are made from their ids: the same
 * arguments give the same course, every time. A race always starts on the
 * planet, and the worlds after it are drawn from the rest. The run between
 * two gates follows the roads where the world has them and the ground where
 * it has not, every gate it lays stands where a car can drive through it,
 * and the run down a tunnel keeps to the middle of it.
 *
 * Laying it is kept apart by what it is about: the roads of a world as a graph
 * (`road-graph.ts`), walking a world's ground (`ground-walk.ts`), the route a
 * leg is driven (`route-laying.ts`), and the gates along that route
 * (`gate-laying.ts`).
 */

import { FIXED_TIMESTEP, createRng, qrotate, v3, vdistance, vlength, type Rng, type Vec3 } from '@buggies/physics'
import {
  ROAD_GRADE,
  WORLD_KINDS,
  alongGround,
  atHeight,
  groundDistance,
  onLand,
  overSurface,
  tangentFrame,
  upOf,
  worldId,
  type World,
  type WorldDistrict,
  type WorldKind,
  type WorldPortal,
  type WorldRoad,
} from '@buggies/terrain'
import type { VehicleSpawn } from '@buggies/vehicle'
import { portalSpawn } from './portals.ts'
import { gridAlongRoute, gridDepth, nearestRoadSpotTo, spawnHere } from './spawns.ts'
import { groundRoute, stepOut, straightRoute, surfacePoint, unitOf } from './ground-walk.ts'
import { roadRoute } from './road-graph.ts'
import { laidRoute, routeFault } from './route-laying.ts'
import { CHECKPOINT_APART, layGates, type Checkpoint } from './gate-laying.ts'

export { corridorAt } from './route-laying.ts'
export { CHECKPOINT_APART, CHECKPOINT_LEAST, CHECKPOINT_MOST, CHECKPOINT_REACH, type Checkpoint } from './gate-laying.ts'

/** One world of a course: the way it is entered and left, and the gates between, in the order they are passed. */
export interface RaceLeg {
  /** The world's id, which is what a room of the race is made for. */
  readonly world: number
  /** The portals this world keeps for the race, in the order they are used, as indices into the world as it is made: the rest are gone. */
  readonly keep: readonly number[]
  /** The index into `keep` of the portal a racer comes out of, or `NO_PORTAL` on the first leg, which is a start on a grid. */
  readonly arrival: number
  /** The index into `keep` of the portal out, or `NO_PORTAL` on the last leg, which finishes at a line. */
  readonly exit: number
  /** The gates of the leg in the order they are passed: the last of them is the portal out, or the finish. */
  readonly checkpoints: readonly Checkpoint[]
  /** Where the racers line up on the first leg, a car's place in the line its index; nothing on the legs after it. */
  readonly grid: readonly VehicleSpawn[]
  /**
   * The way the leg is driven, from where it is entered to where it leaves,
   * a point every few metres along what is driven on and down the middle of
   * any corridor it runs through. The gates stand on it, and a bot follows it.
   */
  readonly route: readonly Vec3[]
}

/** A course of a race: the worlds it runs through, in the order it races them. */
export interface Course {
  /** The seed a host chose, which every world of the course is made from. */
  readonly seed: number
  readonly legs: readonly RaceLeg[]
}

/** A gate as the room and the client are told of it: the same gate, in the shape the wire carries. */
export type CheckpointView = Checkpoint

/** One world of a course as the client is told it, before it makes the world to drive. */
export interface RacePlan {
  /** The game the plan belongs to. */
  readonly game: number
  /** Which world of the course this is, from 1. */
  readonly world: number
  readonly ofWorlds: number
  /** The portals this world keeps, as indices into it as it is made. */
  readonly keep: readonly number[]
  readonly checkpoints: readonly CheckpointView[]
  /** The leg's exit portal, as an index into `keep`, or `null` on the last leg. */
  readonly exit: number | null
  /** The world the exit leads to, and the portal a car comes out of there; `null` on the last leg. */
  readonly next: { world: number; arrival: number } | null
  /** Every world of the course, in the order it is raced. */
  readonly worlds: readonly number[]
}

/** Where a leg has no portal: a start on a grid, or a finish at a line. */
export const NO_PORTAL = 0xff

/** How many worlds a race runs through, at the fewest and at the most, and how many unless its host says otherwise. */
export const WORLDS_LEAST = 2
export const WORLDS_MOST = 4
export const WORLDS_DEFAULT = 3

/** How many racers a race seats: one member, one seat. */
export const RACERS_MOST = 8

/**
 * How long the racers are given to be seated before the start goes ahead
 * without them; how long the countdown runs, the cars held still through it;
 * how long the race runs on after its first finisher; and how long the
 * standings stand: in ticks.
 */
export const COUNTDOWN_TICKS = Math.round(3 / FIXED_TIMESTEP)
export const SEATING_TICKS = Math.round(20 / FIXED_TIMESTEP)
export const FINISH_GRACE_TICKS = Math.round(60 / FIXED_TIMESTEP)
export const STANDINGS_TICKS = Math.round(8 / FIXED_TIMESTEP)

/** The salt a course's own dice are seeded with, so it is not the world's. */
const COURSE_SALT = 0x5eed1e55

/** How many courses are tried before one is given up on, and how many kinds of world are tried for one leg. */
const COURSE_TRIES = 4
const KIND_TRIES = 8

/** How far along a road a finish line is looked for from the way out of the leg. */
const FINISH_RUN = 300

/**
 * A course for a race of this many worlds, starting on the planet, made of
 * the worlds `worldOf` gives for their ids. Thrown when no course can be
 * made at all, with the reason the last try gave.
 */
export async function buildCourse(seed: number, length: number, worldOf: (world: number) => World | Promise<World>): Promise<Course> {
  if (!Number.isInteger(length) || length < WORLDS_LEAST || length > WORLDS_MOST) {
    throw new Error(`a race runs through ${WORLDS_LEAST} to ${WORLDS_MOST} worlds, not ${length}`)
  }
  const rng = createRng((seed ^ COURSE_SALT) >>> 0)
  const worldAt = memoWorlds(worldOf)
  let fault = 'nothing was tried'
  for (let attempt = 0; attempt < COURSE_TRIES; attempt++) {
    try {
      return await layCourse(seed, length, rng, worldAt)
    } catch (error) {
      fault = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`no course could be made through ${length} worlds of seed ${seed}: ${fault}`)
}

/** A world for its id, made once however many legs ask for it. */
function memoWorlds(worldOf: (world: number) => World | Promise<World>): (world: number) => Promise<World> {
  const made = new Map<number, Promise<World>>()
  return (world) => {
    let known = made.get(world)
    if (known === undefined) {
      known = Promise.resolve(worldOf(world))
      made.set(world, known)
    }
    return known
  }
}

/** One try at a whole course: a leg for each world of it, the first on the planet and each leg of a kind no other leg has. */
async function layCourse(seed: number, length: number, rng: Rng, worldAt: (world: number) => Promise<World>): Promise<Course> {
  const used: WorldKind[] = []
  const legs: RaceLeg[] = []
  for (let index = 0; index < length; index++) {
    const first = index === 0
    const last = index === length - 1
    const tried: WorldKind[] = []
    let fault = `${WORLD_KINDS.length} worlds are not enough for ${length} legs`
    let leg: RaceLeg | null = null
    for (let attempt = 0; attempt < KIND_TRIES && leg === null; attempt++) {
      const kind = first ? 'planet' : drawKind(rng, used, tried)
      if (kind === null) break
      tried.push(kind)
      try {
        leg = layLeg(await worldAt(worldId(seed, kind)), first, last, rng)
        used.push(kind)
      } catch (error) {
        fault = error instanceof Error ? error.message : String(error)
      }
    }
    if (leg === null) throw new Error(`world ${index + 1}: ${fault}`)
    legs.push(leg)
  }
  return { seed, legs }
}

/** A kind of world no leg of this course has yet, drawn from the dice; or nothing when every kind has been. */
function drawKind(rng: Rng, used: readonly WorldKind[], tried: readonly WorldKind[]): WorldKind | null {
  const left = WORLD_KINDS.filter((kind) => !used.includes(kind) && !tried.includes(kind))
  if (left.length === 0) return null
  return left[Math.min(Math.floor(rng() * left.length), left.length - 1)]!
}

/** One world of a course: the portals it keeps, the way across it, the gates along that way, and the way itself. */
function layLeg(world: World, first: boolean, last: boolean, rng: Rng): RaceLeg {
  const { keep, arrival, exit } = drawPortals(world, first, last, rng)
  const kept = withPortals(world, keep)
  const start = first ? courseStart(world) : atOutOf(kept)
  const portal = exit === NO_PORTAL ? null : kept.portals[exit]!
  const end = portal?.at ?? courseFinish(world, start)
  if (end === null) throw new Error(`nowhere across ${world.kind} to finish a race`)
  // Along the roads, else over the ground where a gate's height of room is, else as straight as the ground allows.
  const way = roadRoute(world, start, end) ?? groundRoute(world, start, end) ?? straightRoute(world, start, end)
  if (way === null) throw new Error(`no way across ${world.kind} from one end of the leg to the other`)
  const route = laidRoute(world, way, end)
  // A route a car cannot drive is no route at all: the course is laid again rather than given a leg that cannot be finished.
  const fault = routeFault(world, route)
  if (fault !== null) throw new Error(`${world.kind}'s route ${fault}`)
  const forward = portal === null ? finishForward(route, end) : throughOf(portal)
  // The field lines up on the route itself, and the first gate stands well clear of its pole.
  const grid = first ? gridAlongRoute(route, RACERS_MOST) : []
  const checkpoints = layGates(world, route, forward, first ? gridDepth(RACERS_MOST) + CHECKPOINT_APART : 0)
  return { world: world.seed, keep, arrival, exit, checkpoints, grid, route }
}

/** Where a leg is entered by, out of the portal it arrives by: a car's length past the ring, on the ground. */
function atOutOf(world: World): Vec3 {
  const spawn = portalSpawn(world, 0)
  if (spawn === null) throw new Error(`${world.kind} has no portal to come out of`)
  return spawn.position
}

/** The portal a car drives through on its way out of a world, and so the way through the last gate of the leg. */
function throughOf(portal: WorldPortal): Vec3 {
  return qrotate(v3(), portal.turn, { x: 0, y: 0, z: 1 })
}

/** Which portals a leg keeps: the two it drives between, drawn from the world's own, or the one it starts or finishes by. */
function drawPortals(world: World, first: boolean, last: boolean, rng: Rng): { keep: readonly number[]; arrival: number; exit: number } {
  const portals = world.portals.length
  if (portals < (first || last ? 1 : 2)) throw new Error(`${world.kind} has ${portals === 1 ? 'one portal' : `${portals} portals`}, too few to race through`)
  const draw = (): number => Math.min(Math.floor(rng() * portals), portals - 1)
  const out = last ? NO_PORTAL : draw()
  const into = first ? NO_PORTAL : draw()
  if (first) return { keep: [out], arrival: NO_PORTAL, exit: 0 }
  if (last) return { keep: [into], arrival: 0, exit: NO_PORTAL }
  // In by one portal and out of another: two portals leave no choice, and more leave the one drawn unless it is the out's.
  return { keep: [into === out ? (into + 1) % portals : into, out], arrival: 0, exit: 1 }
}

/** A world with only the portals a leg keeps, in the order it keeps them: a copy, so the world it came from is untouched. */
export function withPortals(world: World, keep: readonly number[]): World {
  return { ...world, portals: keep.map((index) => world.portals[index]!) }
}

/** Where a leg sets off from on a world it starts: on a road near the middle of the first town, or on the ground there where it has no roads. */
function courseStart(world: World): Vec3 {
  const middle = overSurface(world, world.districts[0]?.center ?? { x: 0, y: 1, z: 0 }, 0)
  return nearestRoadSpotTo(world, middle)?.point ?? middle
}

/** A road point this far along its road from a spot, one way or the other, or nothing where the road runs out first. */
function alongRoad(road: WorldRoad, index: number, distance: number): Vec3 | null {
  const segments = road.closed ? road.points.length : road.points.length - 1
  for (const step of [1, -1] as const) {
    let at = index
    let traveled = 0
    let point = road.points[index]!
    while (traveled < distance) {
      const next = at + step
      if (next < 0 || next >= segments) break
      if (road.structure[Math.min(at, next)] !== ROAD_GRADE) break
      const ahead = road.points[next]!
      traveled += vdistance(ahead, point)
      at = next
      point = ahead
    }
    if (traveled >= distance / 2) return point
  }
  return null
}

/** Where a leg finishes on a world it ends: a few hundred metres along a road, or over the ground where it has none. */
function courseFinish(world: World, from: Vec3): Vec3 | null {
  const spot = nearestRoadSpotTo(world, from)
  const run = spot === null ? null : alongRoad(spot.road, spot.index, FINISH_RUN)
  if (run !== null) return run
  const room = anotherRoom(world, from)
  if (room !== null) return room
  return aheadOnGround(world, from)
}

/** The way out of a leg's last gate, where the leg finishes at a line rather than a portal: the way along the road there, or along the ground. */
function finishForward(route: readonly Vec3[], end: Vec3): Vec3 {
  const before = route[route.length - 2] ?? end
  const way = alongGround(v3(end.x - before.x, end.y - before.y, end.z - before.z), upOf(end))
  return vlength(way) > 1e-6 ? unitOf(way) : upOf(end)
}

/** The middle of the room nearest to a point that is not the one it is in: where a leg finishes in a world of rooms and no roads, as inside Mercury. */
function anotherRoom(world: World, from: Vec3): Vec3 | null {
  let nearest: WorldDistrict | null = null
  let nearestDistance = Infinity
  let next: WorldDistrict | null = null
  let nextDistance = Infinity
  for (const district of world.districts) {
    const distance = groundDistance(from, atHeight(world, district.center, 0))
    if (distance < nearestDistance) {
      next = nearest
      nextDistance = nearestDistance
      nearest = district
      nearestDistance = distance
    } else if (distance < nextDistance) {
      next = district
      nextDistance = distance
    }
  }
  if (next === null || nextDistance < FINISH_RUN / 2) return null
  return surfacePoint(world, next.center)
}

/** The first way round from a point whose ground runs clear for a finish line's length, or nothing where every way is blocked within it. */
function aheadOnGround(world: World, from: Vec3): Vec3 | null {
  const up = upOf(from)
  const frame = tangentFrame(up)
  const steps = 12
  for (let turn = 0; turn < 8; turn++) {
    const angle = (turn * Math.PI) / 4
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const way = unitOf(v3(frame.east.x * cos + frame.north.x * sin, frame.east.y * cos + frame.north.y * sin, frame.east.z * cos + frame.north.z * sin))
    let clear = true
    for (let step = 1; step <= steps && clear; step++) clear = onLand(world, stepOut(up, way, (FINISH_RUN * step) / steps, world.radius))
    if (clear) return surfacePoint(world, stepOut(up, way, FINISH_RUN, world.radius))
  }
  return null
}

/** Where a car is put back on a leg: at the last gate it passed, facing the next; or at the leg's start before any. */
export function checkpointSpawn(course: Course, world: World, leg: number, checkpoint: number, place: number): VehicleSpawn {
  const courseLeg = course.legs[Math.min(Math.max(leg, 0), course.legs.length - 1)]
  if (courseLeg === undefined) throw new Error('this course has no world to put a car on')
  const gates = courseLeg.checkpoints
  const first = gates[0]
  if (first === undefined) throw new Error(`world ${courseLeg.world} of this course has no gates`)
  if (checkpoint > 0) {
    const passed = gates[Math.min(checkpoint, gates.length) - 1]!
    const next = gates[Math.min(checkpoint, gates.length - 1)]!
    const way = alongGround(v3(next.at.x - passed.at.x, next.at.y - passed.at.y, next.at.z - passed.at.z), upOf(passed.at))
    return spawnHere(passed.at, vlength(way) > 1e-6 ? way : passed.forward)
  }
  if (courseLeg.arrival !== NO_PORTAL) return portalSpawn(world, courseLeg.arrival, place) ?? spawnHere(first.at, first.forward)
  return courseLeg.grid[place] ?? courseLeg.grid[courseLeg.grid.length - 1] ?? spawnHere(first.at, first.forward)
}

/** The world of a course an id names, and how many worlds into the course it is; or nothing where the course does not run through it. */
export function legOf(course: Course, world: number): { leg: RaceLeg; index: number } | null {
  const index = course.legs.findIndex((leg) => leg.world === world)
  const leg = course.legs[index]
  return leg === undefined ? null : { leg, index }
}

/** The world after a leg and the portal a car comes out of there; or nothing on the last leg. */
export function nextWorld(course: Course, leg: number): { world: number; arrival: number } | null {
  const next = course.legs[leg + 1]
  return next === undefined ? null : { world: next.world, arrival: next.arrival }
}

/** A leg of a course as the room and the client are told it: the portals it keeps, its gates, and the way out. */
export function planOf(course: Course, leg: number, game: number): RacePlan {
  const courseLeg = course.legs[leg]
  if (courseLeg === undefined) throw new Error(`this course has no world ${leg + 1}`)
  return {
    game,
    world: leg + 1,
    ofWorlds: course.legs.length,
    keep: keepOf(courseLeg),
    checkpoints: courseLeg.checkpoints,
    exit: courseLeg.exit === NO_PORTAL ? null : courseLeg.exit,
    next: nextWorld(course, leg),
    worlds: course.legs.map((each) => each.world),
  }
}

/** The portals a leg keeps, as the world it is made from has them: a room is made of these and no others. */
export function keepOf(leg: RaceLeg): readonly number[] {
  return leg.keep
}
