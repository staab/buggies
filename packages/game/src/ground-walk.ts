/**
 * A world's ground as a walk over it: the grid of points the ground is made of,
 * what stands on them, the surface a point on it is put on, and the ways found
 * across it where the roads do not go: step by step through the rooms it has,
 * or as straight as its ground allows.
 */

import { v3, vlength, type Vec3 } from '@buggies/physics'
import {
  DRY,
  ROOM_LEAST,
  WORLD_TRAITS,
  atHeight,
  gridDirection,
  groundNeighbors,
  nearestGridPoint,
  onLand,
  roofedAt,
  sphereHeight,
  tangentFrame,
  trunkRadius,
  upOf,
  type World,
} from '@buggies/terrain'

/** How high over the surface a point on the ground stands: a car's wheels, a gate's floor and a route's points all a little over it. */
const SURFACE_RISE = 0.5

/** How many passes of easing a walk over the ground's grid takes before its staircase is a way a car can follow. */
const WALK_SMOOTH = 20

/** How near a tree, a boulder or a prop a walk keeps, and how near a building's wall: room for a car to pass either side. */
const WALK_CLEAR = 2
const WALK_WALL = 1

/** How many cells of the ground back from the water a walk keeps: a car that wanders off a way must not slip in. */
const SHORE_RINGS = 1

/** How many steps a route over open ground is walked in, and how many cells of the ground have neighbors. */
const ROUTE_STEPS = 48
const NEIGHBOURS = 8

/** How tall a gate stands: the room it needs over its floor, and so the room a way must keep over the ground it runs on. */
export const GATE_HEIGHT = 9

/** A way across a world: points along what is driven on, and for each step from one point to the next whether it is a road's own. */
export interface Way {
  readonly points: readonly Vec3[]
  readonly onRoad: readonly boolean[]
}

/** A way out from the planet's middle, of unit length. */
export function unitOf(point: Vec3): Vec3 {
  const length = vlength(point) || 1
  return v3(point.x / length, point.y / length, point.z / length)
}

/** The way out a distance along the ground from a way out, in a way along it, on a world this big. */
export function stepOut(up: Vec3, way: Vec3, distance: number, radius: number): Vec3 {
  const angle = distance / radius
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return unitOf(v3(up.x * cos + way.x * sin, up.y * cos + way.y * sin, up.z * cos + way.z * sin))
}

/** A point on the ground a car drives on in a way out, a little over it. */
export function surfacePoint(world: World, direction: Vec3): Vec3 {
  return atHeight(world, direction, boredHeight(world, direction) + SURFACE_RISE)
}

/** How high over the planet's radius the ground is where it is driven on, with the tunnels bored out under it. */
export function boredHeight(world: World, direction: Vec3): number {
  return sphereHeight({ n: world.ground.n, radius: world.radius, heights: world.bored }, direction)
}

/**
 * The ground's grid as a walk over it needs it: the grid points each point is
 * next to, and the points something stands on with room to pass a car either
 * side of it.
 */
interface GroundGrid {
  readonly neighbors: Int32Array
  readonly obstacles: Uint8Array
}

const groundGrids = new WeakMap<World, GroundGrid>()

/** The ground's grid of a world, made once for each world asked. */
function groundGridOf(world: World): GroundGrid {
  const known = groundGrids.get(world)
  if (known !== undefined) return known
  const neighbors = neighbourGridOf(world)
  const fresh = { neighbors, obstacles: obstacleGridOf(world, neighbors) }
  groundGrids.set(world, fresh)
  return fresh
}

/** Whether a cell of the ground's grid is land a car drives on: with this much room over it, dry, and, where the walk minds them, nothing standing in it. */
function landCell(world: World, grid: GroundGrid, at: number, clearance: number, obstacles: boolean): boolean {
  if (world.roof.length > 0) {
    const roof = world.roof[at]!
    if (!Number.isNaN(roof) && roof - world.bored[at]! < clearance) return false
  }
  // No fording a river either: a car in the water over the ground is as lost as one in the sea under it.
  if (world.water[at] !== DRY) return false
  if (obstacles && grid.obstacles[at] === 1) return false
  return roofedAt(world.roof, at) ? true : world.ground.heights[at]! > world.seaLevel
}

/**
 * The grid points of the ground something stands on, with room to pass a car
 * either side of it: every building's walls, every tree's trunk, every boulder
 * and every prop. A way over the ground keeps clear of them, so a leg across a
 * town is driven down its streets rather than through its blocks.
 */
function obstacleGridOf(world: World, neighbors: Int32Array): Uint8Array {
  const fresh = new Uint8Array(world.ground.heights.length)
  const direction = { x: 0, y: 0, z: 0 }
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
        direction.x = x / length
        direction.y = y / length
        direction.z = z / length
        fresh[nearestGridPoint(world, direction)] = 1
      }
    }
  }
  for (const building of world.buildings) mark(building.at, Math.hypot(building.width, building.depth) / 2 + WALK_WALL)
  for (const tree of world.trees) mark(tree.at, trunkRadius(tree) + WALK_CLEAR)
  for (const rock of world.rocks) mark(rock.at, rock.size / 2 + WALK_CLEAR)
  for (const prop of world.props) mark(prop.at, WALK_CLEAR)
  // And the water's edge, since a car that slips off the shore is lost as surely as one that hits a wall: the water itself is
  // no way across, and the land as far back from it as a car may wander off a way without going in.
  let wet: number[] = []
  for (let cell = 0; cell < fresh.length; cell++) if (world.water[cell] !== DRY || world.ground.heights[cell]! <= world.seaLevel) wet.push(cell)
  const shore = new Uint8Array(fresh.length)
  for (const cell of wet) shore[cell] = 1
  for (let ring = 0; ring < SHORE_RINGS; ring++) {
    const grown: number[] = []
    for (const cell of wet) {
      fresh[cell] = 1
      for (let k = cell * NEIGHBOURS; k < cell * NEIGHBOURS + NEIGHBOURS; k++) {
        const next = neighbors[k]!
        if (next < 0 || shore[next] === 1) continue
        shore[next] = 1
        grown.push(next)
      }
    }
    for (const cell of grown) wet.push(cell)
  }
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

/**
 * The grid point each point of the ground's grid is next to, kept for each
 * fineness of grid asked: how the grid's points lie next to one another is the
 * grid's shape, which every world drawn on as fine a grid as another shares.
 */
const neighbourGrids = new Map<number, Int32Array>()

/** The ground's own neighbors, made once for each fineness of grid. */
function neighbourGridOf(world: World): Int32Array {
  const known = neighbourGrids.get(world.ground.n)
  if (known !== undefined) return known
  const fresh = groundNeighbors(world.ground)
  neighbourGrids.set(world.ground.n, fresh)
  return fresh
}

/** A walk over the ground's own grid: where it set out from, and the cell each cell it reached was reached from. */
interface GroundWalk {
  readonly world: World
  readonly start: number
  readonly came: Int32Array
}

/** The cells of the grid a walk has reached so far, and the queue of them it works through. */
interface WalkScratch {
  readonly came: Int32Array
  readonly queue: Int32Array
}

const walkScratches = new Map<number, WalkScratch>()

/** The keep of one walk's cells, made once for each size of the ground's grid. */
function walkScratchOf(cells: number): WalkScratch {
  const known = walkScratches.get(cells)
  if (known !== undefined) return known
  const fresh = { came: new Int32Array(cells), queue: new Int32Array(cells) }
  walkScratches.set(cells, fresh)
  return fresh
}

/**
 * Every cell of the ground's grid a car can reach from a point, through cells
 * with this much room over them and, unless it is told not to mind them, clear
 * of everything standing on the ground; or nothing where the cell the point
 * stands in is not one a car drives on. A walk that only has to reach one cell
 * stops there, and comes out the same as one that goes on to the end of it.
 */
export function groundWalk(world: World, from: Vec3, clearance: number, obstacles: boolean, stopAt = -1): GroundWalk | null {
  const grid = groundGridOf(world)
  const start = walkStart(world, grid, from, clearance, obstacles)
  if (start < 0) return null
  const cells = world.ground.heights.length
  // A walk is read out before the next one of the same size begins, so its cells are kept and swept rather than made again.
  const scratch = walkScratchOf(cells)
  const came = scratch.came.fill(-1)
  const queue = scratch.queue
  let head = 0
  let tail = 0
  queue[tail++] = start
  came[start] = start
  while (head < tail) {
    const cell = queue[head++]!
    if (cell === stopAt) break
    for (let k = cell * NEIGHBOURS; k < cell * NEIGHBOURS + NEIGHBOURS; k++) {
      const next = grid.neighbors[k]!
      if (next < 0 || came[next]! >= 0 || !landCell(world, grid, next, clearance, obstacles)) continue
      came[next] = cell
      queue[tail++] = next
    }
  }
  return { world, start, came }
}

/** Where a walk of the ground sets out from a point: the cell it stands over where a car drives on it, or the nearest cell around it that one does. */
function walkStart(world: World, grid: GroundGrid, from: Vec3, clearance: number, obstacles: boolean): number {
  const cell = nearestGridPoint(world, from)
  if (landCell(world, grid, cell, clearance, obstacles)) return cell
  for (let k = cell * NEIGHBOURS; k < (cell + 1) * NEIGHBOURS; k++) {
    const next = grid.neighbors[k]!
    if (next >= 0 && landCell(world, grid, next, clearance, obstacles)) return next
  }
  return -1
}

/** Whether a walk of the ground reaches the cell a point stands over. */
export function walkReaches(walk: GroundWalk, at: Vec3): boolean {
  return walk.came[nearestGridPoint(walk.world, at)]! >= 0
}

/** The cell a walk of the ground ends at a point: the cell it stands over where the walk reached it, or the nearest cell around it that it reached. */
function walkGoal(walk: GroundWalk, at: Vec3): number {
  const cell = nearestGridPoint(walk.world, at)
  if (walk.came[cell]! >= 0) return cell
  const neighbors = groundGridOf(walk.world).neighbors
  for (let k = cell * NEIGHBOURS; k < (cell + 1) * NEIGHBOURS; k++) {
    const next = neighbors[k]!
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
export function walkPoints(walk: GroundWalk, from: Vec3, to: Vec3): Vec3[] | null {
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

/** A way over the ground's own grid from one point to another, through cells with this much room over them, or nothing where none joins them. */
function groundWay(world: World, from: Vec3, to: Vec3, clearance: number): Way | null {
  // A way that keeps clear of everything standing on the ground for preference, and one that only keeps out of the water where that cannot be found.
  for (const obstacles of [true, false]) {
    const walk = groundWalk(world, from, clearance, obstacles, nearestGridPoint(world, to))
    const points = walk === null ? null : walkPoints(walk, from, to)
    if (points !== null) return { points, onRoad: points.map(() => false) }
  }
  return null
}

/** A way across a world over its ground, cell by cell of the ground's grid, through whatever rooms it has; nothing on a world of platforms, whose ground is no ground at all. */
export function groundRoute(world: World, from: Vec3, to: Vec3): Way | null {
  if (WORLD_TRAITS[world.kind].platformsOnly) return null
  // A gate stands as tall as the room under a roof, so the way goes where there is that much of it; failing that, wherever a car fits.
  const roomy = groundWay(world, from, to, GATE_HEIGHT + 1)
  return roomy ?? groundWay(world, from, to, ROOM_LEAST)
}

/**
 * A way across a world as straight as its ground allows: a great circle from
 * one end to the other, over ground a car drives on the whole way: no water,
 * and nothing standing in the way.
 */
export function straightRoute(world: World, from: Vec3, to: Vec3): Way | null {
  const start = upOf(from)
  const end = upOf(to)
  const points: Vec3[] = []
  for (let step = 0; step <= ROUTE_STEPS; step++) {
    const direction = stepBetween(start, end, step / ROUTE_STEPS)
    if (!onLand(world, direction)) return null
    if (!landCell(world, groundGridOf(world), nearestGridPoint(world, direction), ROOM_LEAST, true)) return null
    points.push(surfacePoint(world, direction))
  }
  return { points, onRoad: points.map(() => false) }
}

/** The way out this far along the great circle from one way out to another, as the straight line between them points. */
export function stepBetween(from: Vec3, to: Vec3, t: number): Vec3 {
  return unitOf(v3(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t))
}
