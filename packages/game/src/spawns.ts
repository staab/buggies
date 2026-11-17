import { uprightRotation, v3, vdistance, vlength, vscale, type Vec3 } from '@buggies/physics'
import { ROAD_GRADE, ROAD_TUNNEL, alongGround, atHeight, overSurface, upOf, type World, type WorldRoad } from '@buggies/terrain'
import type { VehicleSpawn } from '@buggies/vehicle'

import { portalSpawn } from './portals.ts'

/** Nose to tail along the road, with room to pull out, and side to side, two abreast. */
const SPAWN_SPACING = 9
const SPAWN_ABREAST = 5

/** How far along a road to look for the next point when facing a vehicle. */
const FACING_REACH = 3

/** A sample of a road: the point, and where along the road it is. */
export interface RoadSpot {
  readonly road: WorldRoad
  readonly index: number
  readonly point: Vec3
}

/** A spawn at a point, standing upright there and facing along this way. */
export function spawnHere(position: Vec3, forward: Vec3): VehicleSpawn {
  const up = upOf(position)
  return { position: v3(position.x, position.y, position.z), up, rotation: uprightRotation(up, forward) }
}

/** A road's point, wrapped around a loop or held at an end. */
function pointOf(road: WorldRoad, i: number): Vec3 {
  const count = road.points.length
  return road.points[road.closed ? ((i % count) + count) % count : Math.min(Math.max(i, 0), count - 1)]!
}

function spawnAt(spot: RoadSpot): VehicleSpawn {
  const { road, index, point } = spot
  const ahead = pointOf(road, index + FACING_REACH)
  return spawnHere(point, v3(ahead.x - point.x, ahead.y - point.y, ahead.z - point.z))
}

/** A spawn at a spot, facing whichever way along the road is nearer to `forward`. */
export function spawnFacing(spot: RoadSpot, forward: Vec3): VehicleSpawn {
  const { road, index, point } = spot
  const ahead = pointOf(road, index + FACING_REACH)
  const behind = pointOf(road, index - FACING_REACH)
  // The way the road runs through the spot, from behind it to ahead of it, however near an end it is.
  const way = v3(ahead.x - behind.x, ahead.y - behind.y, ahead.z - behind.z)
  if (vlength(way) < 1e-6) return spawnAt(spot)
  if (way.x * forward.x + way.y * forward.y + way.z * forward.z < 0) vscale(way, way, -1)
  return spawnHere(point, way)
}

/**
 * How big a cell of the search for the road point nearest a place is, and how
 * many cells either way from the middle of the world a cell of it may stand: a
 * world's roads run over a ball a few hundred metres across.
 */
const ROAD_CELL = 30
const ROAD_CELLS_EITHER_WAY = 512

/** How many cells of the search the world's own reach from side to side: what a key of a cell is packed into. */
const ROAD_CELLS_SPAN = ROAD_CELLS_EITHER_WAY * 2

/**
 * The points of a world's roads a car drives on, each with the cell of the
 * search that holds it, kept for each world asked: a course asks where the
 * road nearest a place is for every point of every route it lays.
 */
interface RoadIndex {
  /** Every point of a road that is not a tunnel's, in the order of the roads, which is the order a tie is settled in. */
  readonly spots: readonly RoadSpot[]
  /** The points that lie in each cell of the search, by the cell's key. */
  readonly cells: ReadonlyMap<number, readonly number[]>
  /** How far the cells that hold a point reach either way from the middle of the world, as a bound to stop a search with. */
  readonly least: number
  readonly most: number
}

const roadIndexes = new WeakMap<World, RoadIndex>()

/** The key of the cell of the search a place in a cell stands in, three cells across the world packed into one number. */
function roadCellKey(x: number, y: number, z: number): number {
  return ((x + ROAD_CELLS_EITHER_WAY) * ROAD_CELLS_SPAN + (y + ROAD_CELLS_EITHER_WAY)) * ROAD_CELLS_SPAN + (z + ROAD_CELLS_EITHER_WAY)
}

/** The cell of the search a place along one of the world's axes stands in. */
function roadCellOf(value: number): number {
  return Math.floor(value / ROAD_CELL)
}

/** The points of a world's roads, cell by cell, made once for each world asked. */
function roadIndexOf(world: World): RoadIndex {
  const known = roadIndexes.get(world)
  if (known !== undefined) return known
  const spots: RoadSpot[] = []
  const cells = new Map<number, number[]>()
  let least = Infinity
  let most = -Infinity
  for (const road of world.roads) {
    const segments = road.closed ? road.points.length : road.points.length - 1
    for (let index = 0; index < segments; index++) {
      if (road.structure[index] === ROAD_TUNNEL) continue
      const point = road.points[index]!
      spots.push({ road, index, point })
      const x = roadCellOf(point.x)
      const y = roadCellOf(point.y)
      const z = roadCellOf(point.z)
      const key = roadCellKey(x, y, z)
      const cell = cells.get(key)
      if (cell === undefined) cells.set(key, [spots.length - 1])
      else cell.push(spots.length - 1)
      least = Math.min(least, x, y, z)
      most = Math.max(most, x, y, z)
    }
  }
  const fresh = { spots, cells, least: least === Infinity ? 0 : least, most: most === -Infinity ? 0 : most }
  roadIndexes.set(world, fresh)
  return fresh
}

/**
 * The road point nearest a position, on any road that is not a tunnel: looked
 * for cell by cell of the search, the nearest cells first, and the nearest
 * point of them all. Of two points as near, the one first along the world's
 * roads wins.
 */
export function nearestRoadSpotTo(planet: World, at: Vec3): RoadSpot | null {
  const index = roadIndexOf(planet)
  if (index.spots.length === 0) return null
  const x = roadCellOf(at.x)
  const y = roadCellOf(at.y)
  const z = roadCellOf(at.z)
  // Every cell that holds a point stands within this many cells of the one the place stands in.
  const reach = Math.max(
    Math.abs(x - index.least),
    Math.abs(x - index.most),
    Math.abs(y - index.least),
    Math.abs(y - index.most),
    Math.abs(z - index.least),
    Math.abs(z - index.most),
  )
  let best: RoadSpot | null = null
  let bestSquare = Infinity
  // The points of one cell of the search, taken up where they come nearer than the nearest so far.
  const scan = (dx: number, dy: number, dz: number): void => {
    const cell = index.cells.get(roadCellKey(x + dx, y + dy, z + dz))
    if (cell === undefined) return
    for (const ordinal of cell) {
      const point = index.spots[ordinal]!.point
      const awayX = point.x - at.x
      const awayY = point.y - at.y
      const awayZ = point.z - at.z
      const square = awayX * awayX + awayY * awayY + awayZ * awayZ
      if (square >= bestSquare) continue
      bestSquare = square
      best = index.spots[ordinal]!
    }
  }
  for (let ring = 0; ring <= reach; ring++) {
    // A cell of this ring stands no nearer than the ring within it: once the nearest point is nearer than that, the search is done.
    const nearest = Math.max(ring - 1, 0) * ROAD_CELL
    if (bestSquare < nearest * nearest) break
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dz = -ring; dz <= ring; dz++) {
        // The cells of a ring are its four sides and the rows across it: a cell on a side is one of a run of them.
        if (Math.abs(dy) === ring || Math.abs(dz) === ring) {
          for (let dx = -ring; dx <= ring; dx++) scan(dx, dy, dz)
        } else {
          scan(-ring, dy, dz)
          scan(ring, dy, dz)
        }
      }
    }
  }
  return best
}

/**
 * The road point nearest the middle of the first city, at grade: on the
 * highway for preference, which loops and so never runs out ahead of a car
 * setting off, and on any road only where there is no highway to be had.
 */
function nearestGradeSpot(planet: World): RoadSpot | null {
  const highways = planet.roads.filter((road) => road.kind === 'highway')
  return nearestGradeSpotOn(planet, highways) ?? nearestGradeSpotOn(planet, planet.roads)
}

function nearestGradeSpotOn(planet: World, roads: readonly WorldRoad[]): RoadSpot | null {
  const target = atHeight(planet, planet.districts[0]?.center ?? { x: 0, y: 0, z: 1 }, 0)
  let best: RoadSpot | null = null
  let bestDistance = Infinity
  for (const road of roads) {
    const segmentCount = road.closed ? road.points.length : road.points.length - 1
    for (const [i, point] of road.points.entries()) {
      if (i >= segmentCount) break
      if (road.structure[i] !== ROAD_GRADE) continue
      const distance = vdistance(point, target)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = { road, index: i, point }
    }
  }
  return best
}

/**
 * Points along a road from a starting index, one every `spacing` meters,
 * walking in one direction until the road ends or leaves the ground. Road
 * points can be centimeters apart, so distance is measured, not counted.
 */
function spotsAlong(from: RoadSpot, spacing: number, step: 1 | -1, wanted: number): RoadSpot[] {
  const { road } = from
  const segmentCount = road.closed ? road.points.length : road.points.length - 1
  const spots: RoadSpot[] = []
  let traveled = 0
  let index = from.index
  let point = from.point
  while (spots.length < wanted) {
    const next = index + step
    if (next < 0 || next >= segmentCount) break
    if (road.structure[Math.min(index, next)] !== ROAD_GRADE) break
    const ahead = road.points[next]
    if (ahead === undefined) break
    traveled += vdistance(ahead, point)
    index = next
    point = ahead
    if (traveled < spacing) continue
    spots.push({ road, index, point })
    traveled = 0
  }
  return spots
}

/**
 * Somewhere worth starting, for each of `count` vehicles: on a road, at
 * grade, as near the middle of the first city as one runs, lined up one
 * behind the other. Cities are where the map is densest, so that is the most
 * interesting place to be dropped.
 */
export function findSpawns(planet: World, count: number): VehicleSpawn[] {
  const first = nearestGradeSpot(planet)
  if (first === null) {
    // No road at all, as on a moon: out of its portal, side by side, where it has one.
    if (planet.portals.length > 0) return Array.from({ length: count }, (_, place) => portalSpawn(planet, 0, place)!)
    // Or on the ground over the middle of the first city.
    const middle = planet.districts[0]?.center ?? { x: 0, y: 0, z: 1 }
    return Array.from({ length: count }, () => spawnHere(overSurface(planet, middle, 1), { x: 1, y: 0, z: 0 }))
  }

  // Two abreast, staggered a half length apart, behind the first spot for
  // preference, so the front car is the one nearest the city; ahead of it
  // when the road behind runs out.
  const half = SPAWN_SPACING / 2
  const behind = spotsAlong(first, half, -1, count - 1)
  const ahead = spotsAlong(first, half, 1, count - 1 - behind.length)
  const lined = [
    spawnAside(first, 0),
    ...behind.map((spot, i) => spawnAside(spot, i + 1)),
    ...ahead.map((spot, i) => spawnAside(spot, i + 1)),
  ]
  // A road too short for the field seats the rest on the nearest road spots clear of everyone.
  if (lined.length < count) lined.push(...clearSpots(planet, first, lined, count - lined.length))
  while (lined.length < count) lined.push(lined.at(-1) ?? spawnAt(first))
  return lined
}

/**
 * How far along a route the pole of a grid of `count` cars stands: the
 * depth of the field's rows, and so how much route the grid takes up from
 * the start of a leg before the pole, which is the furthest car on.
 */
export function gridDepth(count: number): number {
  return Math.max(Math.ceil(count / 2) - 1, 0) * SPAWN_SPACING
}

/**
 * Where `count` cars line up on a leg's route: two abreast across the way the
 * route runs there, a row every `SPAWN_SPACING` metres from the pole back
 * toward the start of the route, the pole furthest along, everyone facing
 * along the route. Each spot keeps the level of the route point it stands
 * off, so a grid laid on a bridge stays on the bridge's deck, and a spot is
 * never more than half a field's width off the way it will be driving.
 */
export function gridAlongRoute(route: readonly Vec3[], count: number): VehicleSpawn[] {
  const grid: VehicleSpawn[] = []
  if (route.length === 0) return grid
  const run = routeRun(route)
  const pole = Math.min(gridDepth(count), run)
  for (let place = 0; place < count; place++) {
    const row = Math.floor(place / 2)
    const along = Math.max(pole - row * SPAWN_SPACING, 0)
    const { point, way } = pointAway(route, along)
    const up = upOf(point)
    const side = sideOf(up, way)
    if (side === null) {
      grid.push(spawnHere(point, way))
      continue
    }
    const aside = (SPAWN_ABREAST / 2) * (place % 2 === 0 ? 1 : -1)
    const shifted = v3(point.x + side.x * aside, point.y + side.y * aside, point.z + side.z * aside)
    const held = vscale(v3(), shifted, vlength(point) / (vlength(shifted) || 1))
    grid.push(spawnHere(held, way))
  }
  return grid
}

/** How far a route runs from one end to the other. */
function routeRun(route: readonly Vec3[]): number {
  let run = 0
  for (let index = 1; index < route.length; index++) run += vdistance(route[index - 1]!, route[index]!)
  return run
}

/**
 * The point of a route that stands this far from its start as a car would
 * drive it, and the way it runs there: the furthest point of it still that
 * near, and the way on to the next. A route that doubles back over itself at
 * its start still puts the field a field's depth along it, rather than folding
 * the rows onto one another.
 */
function pointAway(route: readonly Vec3[], distance: number): { point: Vec3; way: Vec3 } {
  const start = route[0]!
  let at = 0
  for (let index = 1; index < route.length; index++) {
    if (vdistance(start, route[index]!) > distance) break
    at = index
  }
  const point = route[at]!
  const next = route[Math.min(at + 1, route.length - 1)]!
  const way = alongGround(v3(next.x - point.x, next.y - point.y, next.z - point.z), upOf(point))
  return { point: { ...point }, way: vlength(way) > 1e-6 ? way : alongGround(v3(point.x - start.x, point.y - start.y, point.z - start.z), upOf(point)) }
}

/** The way across a way along the ground, to the left of it: the way up crossed with the way along. */
function sideOf(up: Vec3, way: Vec3): Vec3 | null {
  const x = up.y * way.z - up.z * way.y
  const y = up.z * way.x - up.x * way.z
  const z = up.x * way.y - up.y * way.x
  const length = Math.sqrt(x * x + y * y + z * z)
  return length < 1e-6 ? null : v3(x / length, y / length, z / length)
}

/** A spawn at a spot, in the lane its place in the line puts it in: the right for even places, the left for odd; facing along the road, or the way along it nearer `forward` where one is given. */
function spawnAside(spot: RoadSpot, place: number, forward?: Vec3): VehicleSpawn {
  const spawn = forward === undefined ? spawnAt(spot) : spawnFacing(spot, forward)
  const { road, index, point } = spot
  const next = road.points[Math.min(index + 1, road.points.length - 1)]!
  const prev = road.points[Math.max(index - 1, 0)]!
  const up = spawn.up
  // Across the road: its run crossed with the way up.
  const tx = next.x - prev.x
  const ty = next.y - prev.y
  const tz = next.z - prev.z
  const ax = ty * up.z - tz * up.y
  const ay = tz * up.x - tx * up.z
  const az = tx * up.y - ty * up.x
  const length = Math.sqrt(ax * ax + ay * ay + az * az) || 1
  const aside = Math.min((road.widths[index] ?? SPAWN_ABREAST) / 4, SPAWN_ABREAST / 2) * (place % 2 === 0 ? 1 : -1)
  return { ...spawn, position: v3(point.x + (ax / length) * aside, point.y + (ay / length) * aside, point.z + (az / length) * aside) }
}

/** Spots at grade on any road, nearest the first, each a spawn's length clear of the others and of those already had. */
function clearSpots(planet: World, first: RoadSpot, had: VehicleSpawn[], wanted: number): VehicleSpawn[] {
  const candidates: { spot: RoadSpot; distance: number }[] = []
  for (const road of planet.roads) {
    const segmentCount = road.closed ? road.points.length : road.points.length - 1
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const point = road.points[i]!
      candidates.push({ spot: { road, index: i, point }, distance: vdistance(point, first.point) })
    }
  }
  candidates.sort((a, b) => a.distance - b.distance)
  const forward = forwardOf(had[0])
  const found: VehicleSpawn[] = []
  const taken = [...had]
  for (const { spot } of candidates) {
    if (found.length >= wanted) break
    if (taken.some(({ position }) => vdistance(position, spot.point) < SPAWN_SPACING)) continue
    const spawn = spawnFacing(spot, forward)
    found.push(spawn)
    taken.push(spawn)
  }
  return found
}

/** The way a spawn faces: its turn's -z, as a car faces its own -z. */
export function forwardOf(spawn: VehicleSpawn | undefined): Vec3 {
  if (spawn === undefined) return v3(0, 0, -1)
  const { x, y, z, w } = spawn.rotation
  return v3(-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y)))
}
