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
 */

import { FIXED_TIMESTEP, clamp, createRng, qrotate, v3, vcross, vdistance, vlength, vscale, type Rng, type Vec3 } from '@buggies/physics'
import {
  DRY,
  ROAD_GRADE,
  trunkRadius,
  ROOM_LEAST,
  WORLD_KINDS,
  WORLD_TRAITS,
  alongGround,
  atHeight,
  groundDistance,
  groundNeighbors,
  gridDirection,
  nearestGridPoint,
  onLand,
  overSurface,
  roofOver,
  roofedAt,
  sphereHeight,
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

/** A gate a car drives through: where it stands, the way through it, and how near a car must come to pass it. */
export interface Checkpoint {
  readonly at: Vec3
  readonly forward: Vec3
  readonly radius: number
}

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

export interface Course {
  /** The seed a host chose, which every world of the course is made from. */
  readonly seed: number
  readonly legs: readonly RaceLeg[]
}

/** A gate as the room and the client are told of it: the same checkpoint, in the shape the wire carries. */
export interface CheckpointView {
  readonly at: Vec3
  readonly forward: Vec3
  readonly radius: number
}

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

/** How many gates a leg runs through, from the fewest to the most the wire carries, and how near a car must come to pass one. */
export const CHECKPOINT_LEAST = 3
export const CHECKPOINT_MOST = 8
export const CHECKPOINT_REACH = 14

/** How far apart, round the ground, the gates of one leg must stand. */
export const CHECKPOINT_APART = 40

/** How far apart the points of a leg's route are laid, and the least step the last of them comes to. */
const ROUTE_STEP = 8
const ROUTE_LEAST = 4

/** How finely a leg's way is cut up before its route is spaced along it: near enough to follow a corridor's bends. */
const ROUTE_GRAIN = 2

/** How many points of that way to either side a point's shift into a corridor's middle is averaged over. */
const ROUTE_SMOOTH = 3

/** How far to either side of a point a corridor's walls are looked for, and how big a step is taken looking. */
const CORRIDOR_REACH = 30
const CORRIDOR_STEP = 0.5

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

/** How far along a run a gate stands from the one before it, on average, and how tall a gate is: the room it needs over its floor. */
const CHECKPOINT_SPACING = 220
const GATE_HEIGHT = 9

/** How high over the surface a gate on the ground stands, and how far along a road a finish line is looked for from the way out of the leg. */
const GATE_RISE = 0.5
const FINISH_RUN = 300

/** How many points of a road make a node of the routes across it, how near two roads must run to join, how big a cell of the search for them is, and how near their levels must be for a car to drive between them. */
const NODE_STEP = 4
const JOIN_REACH = 20
const JOIN_CELL = 24
const JOIN_LEVEL = 1.5

/** How high over the ground under it a road node may stand and still be at grade, rather than up on a bridge or a viaduct. */
const GRADE_REACH = 1.5

/**
 * How far by ground a road node may stand from an end of a leg and still be
 * joined to it: a portal stands out in the open country, and on some seeds the
 * nearest road down at grade is a kilometre off, on the far side of a town.
 */
const JOIN_GROUND_REACH = 2500

/** How many passes of easing a walk over the ground's grid takes before its staircase is a way a car can follow. */
const WALK_SMOOTH = 20

/** How near a tree, a boulder or a prop a walk keeps, and how near a building's wall: room for a car to pass either side. */
const WALK_CLEAR = 2
const WALK_WALL = 1

/** How many cells of the ground back from the water a walk keeps: a car that wanders off a way must not slip in. */
const SHORE_RINGS = 1

/**
 * How near the surface of what is driven on a route point must stand, and how
 * steep a step of a route may be: the rise over the run, up or down. Open
 * ground rolls and hills climb a few metres every step, which a car does; a
 * step down through the air, or off a cliff, is steeper than this.
 */
const ROUTE_CLEARANCE = 1.5
const ROUTE_GRADE = 1

/** How near a road a gate may stand and still be on it, rather than on the ground about it. */
const ROAD_REACH = 20

/** How far apart the points of a hop across a platform's top are laid, where two roads come up onto it and do not meet. */
const JOIN_STEP = 20

/** How many steps a route over open ground is walked in, and how many cells of the ground have neighbors. */
const ROUTE_STEPS = 48
const NEIGHBOURS = 8

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

/** The way out a distance along the ground from a way out, in a way along it, on a world this big. */
function stepOut(up: Vec3, way: Vec3, distance: number, radius: number): Vec3 {
  const angle = distance / radius
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return unitOf(v3(up.x * cos + way.x * sin, up.y * cos + way.y * sin, up.z * cos + way.z * sin))
}

/** A way across a world: points along what is driven on, and for each step from one point to the next whether it is a road's own. */
interface Route {
  readonly points: readonly Vec3[]
  readonly onRoad: readonly boolean[]
}

/**
 * The way a leg is driven, point by point: the way across it cut finely, on
 * what is driven on there and down the middle of any corridor it runs
 * through, then spaced out evenly from one end to the other.
 */
function laidRoute(world: World, way: Route, end: Vec3): Vec3[] {
  const path = [...way.points]
  const onRoad = [...way.onRoad]
  const last = path[path.length - 1]
  if (last === undefined || vdistance(last, end) > 1e-6) {
    path.push({ ...end })
    onRoad.push(onRoad[onRoad.length - 1] ?? false)
  }
  const dense = denseRoute(world, path, onRoad)
  // Points a route's step apart along the way, wherever that falls between the way's own points.
  const route: Vec3[] = [dense.points[0]!]
  let traveled = 0
  let next = ROUTE_STEP
  for (let index = 1; index < dense.points.length; index++) {
    const before = dense.points[index - 1]!
    const point = dense.points[index]!
    const length = vdistance(before, point)
    if (length < 1e-9) continue
    while (traveled + length >= next) {
      const t = (next - traveled) / length
      route.push(v3(before.x + (point.x - before.x) * t, before.y + (point.y - before.y) * t, before.z + (point.z - before.z) * t))
      next += ROUTE_STEP
    }
    traveled += length
  }
  const finish = dense.points[dense.points.length - 1]!
  // A stub of a last step is no step at all: the points before it go, and the way is a step longer instead.
  while (route.length > 1 && vdistance(route[route.length - 1]!, finish) < ROUTE_LEAST) route.pop()
  route.push(finish)
  return route
}

/** A way cut finely into points, every one of them on what is driven on and down the middle of any corridor it runs through. */
function denseRoute(world: World, path: readonly Vec3[], onRoad: readonly boolean[]): { points: Vec3[]; onRoad: boolean[] } {
  const points: Vec3[] = [path[0]!]
  const along: boolean[] = [onRoad[0] ?? false]
  for (let index = 1; index < path.length; index++) {
    const road = onRoad[index - 1] ?? false
    const before = path[index - 1]!
    const point = path[index]!
    const steps = Math.max(1, Math.round(vdistance(before, point) / ROUTE_GRAIN))
    for (let step = 1; step < steps; step++) {
      const t = step / steps
      const between = v3(before.x + (point.x - before.x) * t, before.y + (point.y - before.y) * t, before.z + (point.z - before.z) * t)
      points.push(road ? between : surfacePoint(world, upOf(between)))
      along.push(road)
    }
    points.push(point)
    along.push(road)
  }
  // Down the middle of the corridor each point of the way runs through; its two ends are the grid and the way out, and stay where they are.
  // A point's shift is taken with its neighbors', so where a corridor opens out or shuts in the way eases across to its middle rather than swerving.
  const shifts = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return v3()
    const before = points[index - 1]!
    const after = points[index + 1]!
    const way = alongGround(v3(after.x - before.x, after.y - before.y, after.z - before.z), upOf(point))
    if (vlength(way) < 1e-6) return v3()
    const corridor = corridorAt(world, point, unitOf(way))
    return corridor === null ? v3() : v3(corridor.center.x - point.x, corridor.center.y - point.y, corridor.center.z - point.z)
  })
  const density = points.map((point, index) => {
    let x = 0
    let y = 0
    let z = 0
    let count = 0
    for (let at = Math.max(0, index - ROUTE_SMOOTH); at <= Math.min(points.length - 1, index + ROUTE_SMOOTH); at++) {
      x += shifts[at]!.x
      y += shifts[at]!.y
      z += shifts[at]!.z
      count++
    }
    if (x === 0 && y === 0 && z === 0) return point
    // A shift long enough to carry a point past its neighbors would fold the way back on itself, so it goes no further than
    // half the run to the nearer of them: the way eases toward the middle of a corridor without doubling back into it.
    const shift = v3(x / count, y / count, z / count)
    const aside = Math.min(index > 0 ? vdistance(points[index - 1]!, point) : Infinity, index < points.length - 1 ? vdistance(points[index + 1]!, point) : Infinity)
    const length = vlength(shift)
    if (length > aside / 2) vscale(shift, shift, aside / 2 / length)
    const shifted = v3(point.x + shift.x, point.y + shift.y, point.z + shift.z)
    return along[index]! ? shifted : surfacePoint(world, upOf(shifted))
  })
  return { points: density, onRoad: along }
}

/**
 * The corridor a point stands in: how wide it is across, and the point on its
 * floor midway between its walls; or nothing where it stands in the open, or
 * in a room too wide to be a corridor.
 */
export function corridorAt(world: World, at: Vec3, forward: Vec3): { center: Vec3; width: number } | null {
  if (!Number.isFinite(roofOver(world, at))) return null
  const up = upOf(at)
  const side = sideOf(up, forward)
  if (side === null) return null
  const left = wallAlong(world, up, side, 1)
  const right = left === null ? null : wallAlong(world, up, side, -1)
  if (left === null || right === null) return null
  return { center: surfacePoint(world, stepOut(up, side, (left - right) / 2, world.radius)), width: left + right }
}

/** The way across a corridor, along the ground, from the way along it. */
function sideOf(up: Vec3, forward: Vec3): Vec3 | null {
  const way = alongGround(forward, up)
  const length = vlength(way)
  if (length < 1e-6) return null
  const unit = v3(way.x / length, way.y / length, way.z / length)
  return unitOf(vcross(v3(), up, unit))
}

/**
 * How far along the ground a corridor's wall stands from a point, in one way
 * across it: the first step where the roof comes down to less than a gate's
 * height, or where what is driven on runs out; or nothing where it stays open
 * that far, as a cavern does.
 */
function wallAlong(world: World, up: Vec3, side: Vec3, sign: 1 | -1): number | null {
  let open = 0
  for (let distance = CORRIDOR_STEP; distance <= CORRIDOR_REACH; distance += CORRIDOR_STEP) {
    const across = stepOut(up, side, sign * distance, world.radius)
    const floor = boredHeight(world, across)
    if (!(roofOver(world, atHeight(world, across, floor)) - floor >= GATE_HEIGHT)) return (open + distance) / 2
    if (!onLand(world, across)) return (open + distance) / 2
    open = distance
  }
  return null
}

/** A gate, moved to the middle of the corridor it stands in and facing along it; or left where it was, in the open. */
function centeredGate(world: World, at: Vec3, forward: Vec3): Checkpoint {
  const corridor = corridorAt(world, at, forward)
  if (corridor === null) return { at, forward, radius: CHECKPOINT_REACH }
  return { at: corridor.center, forward, radius: CHECKPOINT_REACH }
}

/**
 * The gates of a leg: one every few hundred metres of the way across it, the
 * first of them a gate's distance past `firstAhead` where the leg's field
 * lines up on it, and the gate that ends it.
 */
function layGates(world: World, route: readonly Vec3[], forward: Vec3, firstAhead = 0): Checkpoint[] {
  const reached: number[] = [0]
  for (let i = 1; i < route.length; i++) reached.push(reached[i - 1]! + vdistance(route[i - 1]!, route[i]!))
  const total = reached[reached.length - 1]!
  const count = clamp(Math.round(total / CHECKPOINT_SPACING), CHECKPOINT_LEAST, CHECKPOINT_MOST)
  // The run of gates starts far enough along the route to stand clear of the pole of the grid, as far as a gate's
  // distance from the one before it allows: a run too short to have both sets them as evenly as it can.
  const start = Math.min(Math.max(firstAhead, 0), Math.max(total - count * CHECKPOINT_APART, 0))
  const spacing = (total - start) / count
  if (spacing < CHECKPOINT_APART) throw new Error(`a run of ${Math.round(total)} m over ${world.kind} is too short for ${CHECKPOINT_LEAST} gates`)
  const pointAt = (distance: number): Vec3 => {
    const along = Math.min(Math.max(distance, 0), total)
    let piece = 0
    while (piece < route.length - 2 && reached[piece + 1]! < along) piece++
    const run = reached[piece + 1]! - reached[piece]!
    const t = run > 0 ? (along - reached[piece]!) / run : 0
    const a = route[piece]!
    const b = route[piece + 1]!
    // The points of a route are close enough that the line between two of them is on what is driven on just as they are.
    return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
  }
  const gates: Checkpoint[] = []
  for (let index = 1; index < count; index++) {
    const at = pointAt(start + spacing * index)
    const next = pointAt(start + spacing * (index + 1))
    const way = alongGround(v3(next.x - at.x, next.y - at.y, next.z - at.z), upOf(at))
    if (vlength(way) < 1e-6) throw new Error(`two gates of ${world.kind} stand on top of one another`)
    gates.push(centeredGate(world, at, unitOf(way)))
  }
  // The last gate is the way out, which stands where its portal does, or the line the leg finishes at: neither moves.
  const end = route[route.length - 1]!
  gates.push({ at: { ...end }, forward: unitOf(forward), radius: CHECKPOINT_REACH })
  for (const [index, gate] of gates.entries()) {
    const fault = gateFault(world, gate.at, index === 0 ? null : gates[index - 1]!)
    if (fault !== null) throw new Error(`gate ${index + 1} of ${gates.length} of ${world.kind} ${fault}`)
  }
  return gates
}

/** Why a gate does not stand where a car can drive through it, or nothing where it does: it must be on what is driven on there, under any roof, and clear of the gate before it. */
function gateFault(world: World, at: Vec3, before: Checkpoint | null): string | null {
  if (!drivesOn(world, at)) return `at ${at.x.toFixed(0)},${at.y.toFixed(0)},${at.z.toFixed(0)} is off the land`
  const room = roofOver(world, at) - boredHeight(world, upOf(at))
  if (room < GATE_HEIGHT) return `stands with only ${room.toFixed(1)} m of room under the roof`
  if (before !== null) {
    const apart = groundDistance(before.at, at)
    if (apart < CHECKPOINT_APART) return `stands ${apart.toFixed(0)} m from the one before it`
  }
  return null
}

/** Whether a car drives on what a gate stands on: its road, where it has one, the ground of a world it is out over, or the top of a platform in a world of nothing but platforms. */
function drivesOn(world: World, at: Vec3): boolean {
  if (onRoad(world, at)) return true
  if (WORLD_TRAITS[world.kind].platformsOnly) {
    for (const platform of world.platforms) if (groundDistance(atHeight(world, platform.center, 0), at) <= platform.radius) return true
    return false
  }
  return onLand(world, upOf(at))
}

/** Whether a gate stands on a road, which is driven on wherever it runs: over the water on a bridge, or over the air between Jupiter's platforms. */
function onRoad(world: World, at: Vec3): boolean {
  const spot = nearestRoadSpotTo(world, at)
  return spot !== null && vdistance(spot.point, at) <= ROAD_REACH
}

/** A point on the ground a car drives on in a way out, a little over it. */
function surfacePoint(world: World, direction: Vec3): Vec3 {
  return atHeight(world, direction, boredHeight(world, direction) + GATE_RISE)
}

/** How high over the planet's radius the ground is where it is driven on, with the tunnels bored out under it. */
function boredHeight(world: World, direction: Vec3): number {
  return sphereHeight({ n: world.ground.n, radius: world.radius, heights: world.bored }, direction)
}

/** A way out from the planet's middle, of unit length. */
function unitOf(point: Vec3): Vec3 {
  const length = vlength(point) || 1
  return v3(point.x / length, point.y / length, point.z / length)
}

/**
 * A way across a world along its roads: over the ground to a node at grade
 * near one end, along the roads to a node at grade near the other, and over
 * the ground to it. A road route never cuts a corner through the air: the
 * ground is walked over its own surface, and a road is only left where its
 * deck is on the ground, so a leg does not end up on a bridge it cannot get
 * down from.
 */
function roadRoute(world: World, from: Vec3, to: Vec3): Route | null {
  const graph = roadGraphOf(world)
  if (graph.nodes.length === 0) return null
  const head = joinRoads(world, graph, from, -1, to)
  // The road at the other end must be one the roads from this end reach: a knot of streets cut off from the rest is no way across.
  const tail = joinRoads(world, graph, to, head === null ? -1 : graph.components[head.node]!, from)
  if (head === null || tail === null) return null
  const way = shortestWay(graph, head.node, tail.node)
  if (way === null) return null
  const points: Vec3[] = [{ ...from }]
  const onRoad: boolean[] = [head.onRoad]
  for (const point of head.points) {
    points.push(point)
    onRoad.push(head.onRoad)
  }
  for (const edge of way) {
    for (const point of edge.inner) {
      points.push(point)
      onRoad.push(true)
    }
    points.push(graph.nodes[edge.to]!.point)
    onRoad.push(true)
  }
  // The way off the roads at the other end, walked from the end back to the node and so reversed.
  for (const point of [...tail.points].reverse()) {
    points.push(point)
    onRoad.push(tail.onRoad)
  }
  points.push({ ...to })
  onRoad.push(tail.onRoad)
  return { points, onRoad }
}

/** Where a leg's end joins the roads: the node it joins them at, the points that run from it to that node, and whether they are a road's own. */
interface Join {
  readonly node: number
  readonly points: readonly Vec3[]
  readonly onRoad: boolean
}

/**
 * Where an end of a leg meets the roads. On a road, it meets the node of that
 * road nearest it, along the deck itself. Off them, as out of a portal, it
 * walks over the ground to the nearest node at grade that the ground reaches:
 * a node up on a bridge is no use to a car coming across the fields, and a
 * step onto it would be a step through the air. Nothing where no road is near
 * enough, and the whole leg is driven over the ground instead.
 */
function joinRoads(world: World, graph: RoadGraph, at: Vec3, component = -1, toward: Vec3 | null = null): Join | null {
  const spot = nearestRoadSpotTo(world, at)
  if (spot !== null && vdistance(spot.point, at) <= ROAD_REACH && Math.abs(vlength(spot.point) - vlength(at)) <= GRADE_REACH) {
    const road = world.roads.indexOf(spot.road)
    const node = nearestNode(graph, at, road, toward === null ? null : roadRun(spot.road, spot.index, toward))
    if (node < 0) return null
    return { node, points: [graph.nodes[node]!.point], onRoad: true }
  }
  // A world of platforms floating over nothing has no ground to cross: its ends join the roads along the top of a platform.
  if (WORLD_TRAITS[world.kind].platformsOnly) {
    const node = nearestNode(graph, at)
    return node < 0 ? null : { node, points: [graph.nodes[node]!.point], onRoad: true }
  }
  // Off the roads: one walk of the ground says what it reaches, and the nearest node at grade it reaches is the one joined.
  // A walk that minds what stands on the ground is taken first, and one that only minds the water where that finds no road at all.
  for (const obstacles of [true, false]) {
    const walk = groundWalk(world, at, GATE_HEIGHT + 1, obstacles) ?? groundWalk(world, at, ROOM_LEAST, obstacles)
    if (walk === null) continue
    let node = -1
    let nearest = JOIN_GROUND_REACH
    for (const [index, each] of graph.nodes.entries()) {
      if (component >= 0 && graph.components[index] !== component) continue
      if (!atGrade(world, each.point)) continue
      const distance = groundDistance(at, each.point)
      if (distance >= nearest || !walkReaches(walk, each.point)) continue
      nearest = distance
      node = index
    }
    const points = node < 0 ? null : walkPoints(walk, at, graph.nodes[node]!.point)
    if (points !== null) return { node, points, onRoad: false }
  }
  return null
}

/** Whether a road node stands at grade: on the ground, rather than up on a bridge deck or a viaduct. */
function atGrade(world: World, at: Vec3): boolean {
  return Math.abs(vlength(at) - world.radius - boredHeight(world, upOf(at))) <= GRADE_REACH
}

/**
 * How far a point stands over the surface a car would be driving on there, or
 * under it: the deck of a road where it is on one, and the ground it is over
 * where it is not.
 */
function surfaceGap(world: World, at: Vec3): number {
  const ground = vlength(at) - world.radius - boredHeight(world, upOf(at))
  const spot = nearestRoadSpotTo(world, at)
  if (spot === null || vdistance(spot.point, at) > ROAD_REACH) return ground
  const road = vlength(at) - vlength(spot.point)
  return Math.abs(road) <= Math.abs(ground) ? road : ground
}

/** Why a laid route is not one a car can drive, or nothing where it is: it must keep to the surface and step no higher or lower than a car can. */
function routeFault(world: World, route: readonly Vec3[]): string | null {
  for (const [index, point] of route.entries()) {
    const gap = surfaceGap(world, point)
    if (Math.abs(gap) > ROUTE_CLEARANCE) return `point ${index + 1} of ${route.length} stands ${gap.toFixed(1)} m off the surface`
    if (index === 0) continue
    const before = route[index - 1]!
    const rise = vlength(point) - vlength(before)
    const run = vdistance(before, point)
    if (Math.abs(rise) > ROUTE_GRADE * Math.max(run, 1e-6)) return `${rise > 0 ? 'climbs' : 'drops'} ${Math.abs(rise).toFixed(1)} m at point ${index + 1} of ${route.length}`
  }
  return null
}

/** A way across a world over its ground, cell by cell of the ground's grid, through whatever rooms it has; nothing on a world of platforms, whose ground is no ground at all. */
function groundRoute(world: World, from: Vec3, to: Vec3): Route | null {
  if (WORLD_TRAITS[world.kind].platformsOnly) return null
  // A gate stands as tall as the room under a roof, so the way goes where there is that much of it; failing that, wherever a car fits.
  const roomy = groundWay(world, from, to, GATE_HEIGHT + 1)
  return roomy ?? groundWay(world, from, to, ROOM_LEAST)
}

/** A way over the ground's own grid from one point to another, through cells with this much room over them, or nothing where none joins them. */
function groundWay(world: World, from: Vec3, to: Vec3, clearance: number): Route | null {
  // A way that keeps clear of everything standing on the ground for preference, and one that only keeps out of the water where that cannot be found.
  for (const obstacles of [true, false]) {
    const walk = groundWalk(world, from, clearance, obstacles)
    const points = walk === null ? null : walkPoints(walk, from, to)
    if (points !== null) return { points, onRoad: points.map(() => false) }
  }
  return null
}

/** A walk over the ground's own grid: where it set out from, and the cell each cell it reached was reached from. */
interface GroundWalk {
  readonly world: World
  readonly start: number
  readonly came: Int32Array
}

/**
 * Every cell of the ground's grid a car can reach from a point, through cells
 * with this much room over them and, unless it is told not to mind them, clear
 * of everything standing on the ground; or nothing where the cell the point
 * stands in is not one a car drives on.
 */
function groundWalk(world: World, from: Vec3, clearance: number, obstacles: boolean): GroundWalk | null {
  const start = walkStart(world, from, clearance, obstacles)
  if (start < 0) return null
  const neighbors = neighbourGridOf(world)
  const cells = world.ground.heights.length
  const came = new Int32Array(cells).fill(-1)
  const queue = new Int32Array(cells)
  let head = 0
  let tail = 0
  queue[tail++] = start
  came[start] = start
  while (head < tail) {
    const at = queue[head++]!
    for (let k = 0; k < NEIGHBOURS; k++) {
      const next = neighbors[at * NEIGHBOURS + k]!
      if (next < 0 || came[next]! >= 0 || !landCell(world, next, clearance, obstacles)) continue
      came[next] = at
      queue[tail++] = next
    }
  }
  return { world, start, came }
}

/** Where a walk of the ground sets out from a point: the cell it stands over where a car drives on it, or the nearest cell around it that one does. */
function walkStart(world: World, from: Vec3, clearance: number, obstacles: boolean): number {
  const cell = nearestGridPoint(world, from)
  if (landCell(world, cell, clearance, obstacles)) return cell
  const neighbors = neighbourGridOf(world)
  for (let k = 0; k < NEIGHBOURS; k++) {
    const next = neighbors[cell * NEIGHBOURS + k]!
    if (next >= 0 && landCell(world, next, clearance, obstacles)) return next
  }
  return -1
}

/** Whether a walk of the ground reaches the cell a point stands over. */
function walkReaches(walk: GroundWalk, at: Vec3): boolean {
  return walk.came[nearestGridPoint(walk.world, at)]! >= 0
}

/** The cell a walk of the ground ends at a point: the cell it stands over where the walk reached it, or the nearest cell around it that it reached. */
function walkGoal(walk: GroundWalk, at: Vec3): number {
  const cell = nearestGridPoint(walk.world, at)
  if (walk.came[cell]! >= 0) return cell
  const neighbors = neighbourGridOf(walk.world)
  for (let k = 0; k < NEIGHBOURS; k++) {
    const next = neighbors[cell * NEIGHBOURS + k]!
    if (next >= 0 && walk.came[next]! >= 0) return next
  }
  return -1
}

/**
 * The way from one point to another a walk of the ground reaches, smoothed
 * into one a car can follow; or nothing where it does not reach it. Its ends
 * are the points themselves, so the way is joined to what it leads from and
 * to without a step at either end.
 */
function walkPoints(walk: GroundWalk, from: Vec3, to: Vec3): Vec3[] | null {
  const goal = walkGoal(walk, to)
  if (goal < 0) return null
  const cells: Vec3[] = []
  for (let at = goal; at !== walk.start; at = walk.came[at]!) cells.push(surfacePoint(walk.world, cellDirection(walk.world, at)))
  cells.reverse()
  return smoothedWay(walk.world, [{ ...from }, ...cells, { ...to }])
}

/**
 * A walk over the ground's grid smoothed into a way a car can follow: the
 * walk steps a cell at a time, so it comes out as a staircase of square
 * turns, and a car chasing it would swing from one side of the way to the
 * other. Each point is eased toward the middle of its neighbors, over and
 * over, its two ends held where they are.
 */
function smoothedWay(world: World, points: readonly Vec3[]): Vec3[] {
  // A world of tunnels and caverns is driven down walls that are never far off, so its walk is left as it is.
  if (points.length < 3 || world.roof.length > 0) return points.map((point) => surfacePoint(world, upOf(point)))
  let way: Vec3[] = points.map((point) => ({ ...point }))
  for (let pass = 0; pass < WALK_SMOOTH; pass++) {
    const eased = way.map((point) => ({ ...point }))
    for (let index = 1; index < way.length - 1; index++) {
      const before = way[index - 1]!
      const point = way[index]!
      const after = way[index + 1]!
      eased[index] = v3((before.x + 2 * point.x + after.x) / 4, (before.y + 2 * point.y + after.y) / 4, (before.z + 2 * point.z + after.z) / 4)
    }
    way = eased
  }
  return way.map((point) => surfacePoint(world, upOf(point)))
}

/**
 * A way across a world as straight as its ground allows: a great circle from
 * one end to the other, over ground a car drives on the whole way: no water,
 * and nothing standing in the way.
 */
function straightRoute(world: World, from: Vec3, to: Vec3): Route | null {
  const start = upOf(from)
  const end = upOf(to)
  const points: Vec3[] = []
  for (let step = 0; step <= ROUTE_STEPS; step++) {
    const direction = stepBetween(start, end, step / ROUTE_STEPS)
    if (!onLand(world, direction)) return null
    if (!landCell(world, nearestGridPoint(world, direction), ROOM_LEAST)) return null
    points.push(surfacePoint(world, direction))
  }
  return { points, onRoad: points.map(() => false) }
}

/** The way out this far along the great circle from one way out to another, as the straight line between them points. */
function stepBetween(from: Vec3, to: Vec3, t: number): Vec3 {
  return unitOf(v3(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t))
}

/** Whether a cell of the ground's grid is land a car drives on: with this much room over it, dry, and, where the walk minds them, nothing standing in it. */
function landCell(world: World, at: number, clearance: number, obstacles = true): boolean {
  if (world.roof.length > 0) {
    const roof = world.roof[at]!
    if (!Number.isNaN(roof) && roof - world.bored[at]! < clearance) return false
  }
  // No fording a river either: a car in the water over the ground is as lost as one in the sea under it.
  if (world.water[at] !== DRY) return false
  if (obstacles && obstacleGridOf(world)[at] === 1) return false
  return roofedAt(world.roof, at) ? true : world.ground.heights[at]! > world.seaLevel
}

/** The grid points of the ground a car cannot drive across, kept for each world asked. */
const obstacleGrids = new WeakMap<World, Uint8Array>()

/**
 * The grid points of the ground something stands on, with room to pass a car
 * either side of it: every building's walls, every tree's trunk, every boulder
 * and every prop. A way over the ground keeps clear of them, so a leg across a
 * town is driven down its streets rather than through its blocks.
 */
function obstacleGridOf(world: World): Uint8Array {
  const known = obstacleGrids.get(world)
  if (known !== undefined) return known
  const fresh = new Uint8Array(world.ground.heights.length)
  const mark = (at: Vec3, reach: number): void => {
    const up = upOf(at)
    const frame = tangentFrame(up)
    const steps = Math.max(1, Math.ceil(reach / CELL_STEP))
    for (let side = -steps; side <= steps; side++) {
      for (let ahead = -steps; ahead <= steps; ahead++) {
        if (side * side + ahead * ahead > steps * steps) continue
        const x = up.x + (frame.east.x * side + frame.north.x * ahead) * (CELL_STEP / world.radius)
        const y = up.y + (frame.east.y * side + frame.north.y * ahead) * (CELL_STEP / world.radius)
        const z = up.z + (frame.east.z * side + frame.north.z * ahead) * (CELL_STEP / world.radius)
        const length = Math.sqrt(x * x + y * y + z * z) || 1
        fresh[nearestGridPoint(world, v3(x / length, y / length, z / length))] = 1
      }
    }
  }
  for (const building of world.buildings) mark(building.at, Math.hypot(building.width, building.depth) / 2 + WALK_WALL)
  for (const tree of world.trees) mark(tree.at, trunkRadius(tree) + WALK_CLEAR)
  for (const rock of world.rocks) mark(rock.at, rock.size / 2 + WALK_CLEAR)
  for (const prop of world.props) mark(prop.at, WALK_CLEAR)
  // And the water's edge, since a car that slips off the shore is lost as surely as one that hits a wall: as far back from
  // the water as a car may wander off a way without going in.
  const wet = new Uint8Array(fresh.length)
  for (let cell = 0; cell < wet.length; cell++) if (world.water[cell] !== DRY || world.ground.heights[cell]! <= world.seaLevel) wet[cell] = 1
  const neighbors = neighbourGridOf(world)
  for (let ring = 0; ring < SHORE_RINGS; ring++) {
    const grown = new Uint8Array(wet)
    for (let cell = 0; cell < wet.length; cell++) {
      if (wet[cell] === 0) continue
      fresh[cell] = 1
      for (let k = 0; k < NEIGHBOURS; k++) {
        const next = neighbors[cell * NEIGHBOURS + k]!
        if (next >= 0) grown[next] = 1
      }
    }
    wet.set(grown)
  }
  obstacleGrids.set(world, fresh)
  return fresh
}

/** How far apart the grid points of the ground stand, near enough for marking out what stands on them. */
const CELL_STEP = 2.5

/** The way out through a cell of the ground's grid. */
function cellDirection(world: World, at: number): Vec3 {
  const side = world.ground.n + 1
  const face = Math.floor(at / (side * side))
  const rest = at - face * side * side
  const j = Math.floor(rest / side)
  return gridDirection(world.ground.n, face, rest - j * side, j, v3())
}

/** The grid point each point of the ground's grid is next to, kept for each world asked. */
const neighbourGrids = new WeakMap<World, Int32Array>()

/** The ground's own neighbors, made once for each world asked. */
function neighbourGridOf(world: World): Int32Array {
  const known = neighbourGrids.get(world)
  if (known !== undefined) return known
  const fresh = groundNeighbors(world.ground)
  neighbourGrids.set(world, fresh)
  return fresh
}

/** A node of the routes across a world: a point of a road, and where along that road it stands. */
interface GraphNode {
  readonly point: Vec3
  readonly road: number
  readonly index: number
}

/** A step of a route between two nodes: the road points passed between them, and how far it runs. */
interface GraphEdge {
  readonly to: number
  readonly length: number
  readonly inner: readonly Vec3[]
}

/** Every road of a world as a graph to find a way along: its points, a few to a node, joined along their road and to any road that runs near. */
interface RoadGraph {
  readonly nodes: readonly GraphNode[]
  readonly ways: readonly (readonly GraphEdge[])[]
  /** Which knot of roads each node is joined to the rest by: two nodes a way joins are of one knot. */
  readonly components: Int32Array
}

/** The graph of each world's roads, made once for however many legs ask for it. */
const graphs = new WeakMap<World, RoadGraph>()

function roadGraphOf(world: World): RoadGraph {
  const known = graphs.get(world)
  if (known !== undefined) return known
  const fresh = buildGraph(world)
  graphs.set(world, fresh)
  return fresh
}

/** The graph of one world's roads: a node every few points of each, a step along each road, and a step between the roads that meet and the platform tops that join them. */
function buildGraph(world: World): RoadGraph {
  const nodes: GraphNode[] = []
  const ways: GraphEdge[][] = []
  const node = (point: Vec3, road: number, index: number): number => {
    nodes.push({ point, road, index })
    ways.push([])
    return nodes.length - 1
  }
  const join = (from: number, to: number, inner: readonly Vec3[], length: number): void => {
    ways[from]!.push({ to, inner, length })
  }
  // A node every few points of every road, and the road's own end.
  const chains: number[][] = []
  for (const [road, way] of world.roads.entries()) {
    const chain: number[] = []
    for (let index = 0; index < way.points.length; index += NODE_STEP) chain.push(node(way.points[index]!, road, index))
    const end = way.points.length - 1
    if (chain.length === 0 || nodes[chain[chain.length - 1]!]!.index !== end) chain.push(node(way.points[end]!, road, end))
    chains.push(chain)
  }
  // Along each road, from a node to the next, the points it passes between them.
  for (const [road, way] of world.roads.entries()) {
    const chain = chains[road]!
    for (let at = 1; at < chain.length; at++) {
      const from = chain[at - 1]!
      const to = chain[at]!
      const first = nodes[from]!.index
      const last = nodes[to]!.index
      const inner: Vec3[] = []
      let length = 0
      let point = nodes[from]!.point
      for (let index = first + 1; index <= last; index++) {
        const ahead = way.points[index]!
        length += vdistance(point, ahead)
        if (index < last) inner.push(ahead)
        point = ahead
      }
      join(from, to, inner, length)
      join(to, from, [...inner].reverse(), length)
    }
  }
  // And where two roads run within reach of one another, which is where they meet.
  const cells = new Map<string, number[]>()
  const cellOf = (x: number, y: number, z: number): string => `${x},${y},${z}`
  for (const [index, node] of nodes.entries()) {
    const key = cellOf(Math.floor(node.point.x / JOIN_CELL), Math.floor(node.point.y / JOIN_CELL), Math.floor(node.point.z / JOIN_CELL))
    const cell = cells.get(key)
    if (cell === undefined) cells.set(key, [index])
    else cell.push(index)
  }
  for (const [index, node] of nodes.entries()) {
    const x = Math.floor(node.point.x / JOIN_CELL)
    const y = Math.floor(node.point.y / JOIN_CELL)
    const z = Math.floor(node.point.z / JOIN_CELL)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const other of cells.get(cellOf(x + dx, y + dy, z + dz)) ?? []) {
            if (other === index || nodes[other]!.road === node.road) continue
            const length = vdistance(node.point, nodes[other]!.point)
            if (length > JOIN_REACH) continue
            // Roads at different levels are not joined: a viaduct over a street, or a bridge deck over the road beneath it,
            // is a step a car cannot drive, and a way across the world that takes it drives off the edge of the deck.
            if (Math.abs(vlength(node.point) - vlength(nodes[other]!.point)) > JOIN_LEVEL) continue
            join(index, other, [], length)
          }
        }
      }
    }
  }
  // And across the top of a platform, where the roads that end on it do not meet: a car drives over it between them.
  const across = (from: number, to: number): void => {
    const a = nodes[from]!.point
    const b = nodes[to]!.point
    const length = vdistance(a, b)
    if (length < JOIN_REACH) return
    const steps = Math.max(1, Math.round(length / JOIN_STEP))
    const rise = vlength(a) - world.radius
    const climb = vlength(b) - world.radius - rise
    const inner: Vec3[] = []
    for (let step = 1; step < steps; step++) {
      const t = step / steps
      inner.push(atHeight(world, stepBetween(upOf(a), upOf(b), t), rise + climb * t))
    }
    join(from, to, inner, length)
    join(to, from, [...inner].reverse(), length)
  }
  for (const platform of world.platforms) {
    const middle = atHeight(world, platform.center, 0)
    const on: number[] = []
    for (const [index, node] of nodes.entries()) if (groundDistance(middle, node.point) <= platform.radius) on.push(index)
    for (const [at, from] of on.entries()) {
      for (const to of on.slice(at + 1)) across(from, to)
    }
  }
  return { nodes, ways, components: knotsOf(ways) }
}

/** Which knot of roads each node is joined to the rest by, numbered from nought: a walk over the ways from each node not yet placed. */
function knotsOf(ways: readonly (readonly GraphEdge[])[]): Int32Array {
  const components = new Int32Array(ways.length).fill(-1)
  let knots = 0
  for (let start = 0; start < ways.length; start++) {
    if (components[start]! >= 0) continue
    components[start] = knots
    const queue = [start]
    while (queue.length > 0) {
      const at = queue.pop()!
      for (const edge of ways[at]!) {
        if (components[edge.to]! >= 0) continue
        components[edge.to] = knots
        queue.push(edge.to)
      }
    }
    knots++
  }
  return components
}

/**
 * The node of a road graph nearest a point, on any road or on one road of the
 * world if it is named; or nothing where there is none. A leg standing on a
 * road joins the node of it ahead of where it stands, along the way the road
 * runs toward the other end of the leg, rather than the node behind: a way
 * that sets off by going back down the road it is about to drive up doubles
 * back over its own start.
 */
function nearestNode(graph: RoadGraph, at: Vec3, road = -1, ahead: Vec3 | null = null): number {
  let best = -1
  let bestDistance = Infinity
  let nearest = -1
  let nearestDistance = Infinity
  for (const [index, node] of graph.nodes.entries()) {
    if (road >= 0 && node.road !== road) continue
    const distance = vdistance(node.point, at)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = index
    }
    if (ahead !== null && (node.point.x - at.x) * ahead.x + (node.point.y - at.y) * ahead.y + (node.point.z - at.z) * ahead.z < -1) continue
    if (distance >= bestDistance) continue
    bestDistance = distance
    best = index
  }
  return best >= 0 ? best : nearest
}

/** The way a road runs at one of its points, taken the way that leads toward a place the leg is going. */
function roadRun(road: WorldRoad, index: number, toward: Vec3): Vec3 {
  const now = road.points[index]!
  const next = road.points[Math.min(index + 1, road.points.length - 1)]!
  const way = v3(next.x - now.x, next.y - now.y, next.z - now.z)
  const to = v3(toward.x - now.x, toward.y - now.y, toward.z - now.z)
  if (vlength(way) < 1e-6) return v3()
  if (vlength(to) < 1e-6) return way
  return way.x * to.x + way.y * to.y + way.z * to.z < 0 ? v3(-way.x, -way.y, -way.z) : way
}

/** The shortest way from one node of a road graph to another, step by step; or nothing where no way joins them. */
function shortestWay(graph: RoadGraph, start: number, goal: number): GraphEdge[] | null {
  const costs = new Float64Array(graph.nodes.length).fill(Infinity)
  const came = new Int32Array(graph.nodes.length).fill(-1)
  const edges: (GraphEdge | null)[] = graph.nodes.map(() => null)
  const queue = new Costs()
  costs[start] = 0
  queue.push(0, start)
  while (!queue.empty()) {
    const { cost, node } = queue.pop()
    if (cost > costs[node]!) continue
    if (node === goal) break
    for (const edge of graph.ways[node]!) {
      const next = cost + edge.length
      if (next >= costs[edge.to]!) continue
      costs[edge.to] = next
      came[edge.to] = node
      edges[edge.to] = edge
      queue.push(next, edge.to)
    }
  }
  const way: GraphEdge[] = []
  for (let node = goal; node !== start; ) {
    const edge = edges[node]
    if (edge === null || edge === undefined) return null
    way.push(edge)
    node = came[node]!
  }
  return way.reverse()
}

/** A heap of the ways to reach a node, the cheapest first: a road graph has a few thousand nodes, so a plain binary heap is enough. */
class Costs {
  private readonly heap: { cost: number; node: number }[] = []

  empty(): boolean {
    return this.heap.length === 0
  }

  push(cost: number, node: number): void {
    const heap = this.heap
    heap.push({ cost, node })
    for (let at = heap.length - 1; at > 0; ) {
      const up = (at - 1) >> 1
      if (heap[up]!.cost <= heap[at]!.cost) break
      const kept = heap[up]!
      heap[up] = heap[at]!
      heap[at] = kept
      at = up
    }
  }

  pop(): { cost: number; node: number } {
    const heap = this.heap
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length === 0) return top
    heap[0] = last
    for (let at = 0; ; ) {
      const left = at * 2 + 1
      const right = left + 1
      let down = at
      if (left < heap.length && heap[left]!.cost < heap[down]!.cost) down = left
      if (right < heap.length && heap[right]!.cost < heap[down]!.cost) down = right
      if (down === at) break
      const kept = heap[down]!
      heap[down] = heap[at]!
      heap[at] = kept
      at = down
    }
    return top
  }
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
