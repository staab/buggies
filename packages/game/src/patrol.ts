import { createRng, vdistance, type Vec3 } from '@buggies/physics'
import type { World } from '@buggies/terrain'


/** Two road ends this near each other are the one junction, to turn off at. */
const JUNCTION_REACH = 6

/**
 * A round of the arterials: which road, by its place in the map's roads,
 * how far along it, which way, and how many roads have been walked, which
 * picks the next at a junction. Whatever walks it, a robot or a car driven
 * by nobody, goes the same way given the same map, so everyone agrees.
 */
export interface Patrol {
  road: number
  along: number
  direction: number
  legs: number
}

/** One road a patrol may take, and how far along it each of its points is. */
interface Route {
  road: number
  lengths: Float32Array
  total: number
}

const routesOf = new WeakMap<World, Route[]>()

/** The roads patrols take: the arterials, end to end. */
function routes(map: World): Route[] {
  const known = routesOf.get(map)
  if (known !== undefined) return known
  const found: Route[] = []
  map.roads.forEach((road, index) => {
    if (road.kind !== 'arterial' || road.points.length < 2) return
    const lengths = new Float32Array(road.points.length)
    for (let i = 1; i < road.points.length; i++) lengths[i] = lengths[i - 1]! + vdistance(road.points[i]!, road.points[i - 1]!)
    const total = lengths[road.points.length - 1]!
    if (total > 1) found.push({ road: index, lengths, total })
  })
  routesOf.set(map, found)
  return found
}

function routeOf(map: World, road: number): Route | undefined {
  return routes(map).find((route) => route.road === road)
}

/** How long the road a patrol is on is. */
export function patrolLength(map: World, patrol: Patrol): number {
  return routeOf(map, patrol.road)?.total ?? 0
}

/** A patrol somewhere on the arterials, picked by this seed; none on an island without them. */
export function startPatrol(seed: number): (map: World) => Patrol | null {
  return (map) => {
    const all = routes(map)
    if (all.length === 0) return null
    const rng = createRng(seed)
    const route = all[Math.floor(rng() * all.length)]!
    return { road: route.road, along: rng() * route.total, direction: rng() < 0.5 ? 1 : -1, legs: 0 }
  }
}

/** Where a patrol is on its road, `ahead` further on the way it goes: the point on the road surface, and, if asked, the way along the road it goes, not of unit length. */
export function patrolPoint(map: World, patrol: Patrol, out: Vec3, ahead = 0, facing?: Vec3): void {
  const route = routeOf(map, patrol.road)
  const road = map.roads[patrol.road]
  if (route === undefined || road === undefined) return
  const along = Math.min(Math.max(patrol.along + patrol.direction * ahead, 0), route.total)
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
  out.x = a.x + (b.x - a.x) * t
  out.y = a.y + (b.y - a.y) * t
  out.z = a.z + (b.z - a.z) * t
  if (facing === undefined) return
  facing.x = (b.x - a.x) * patrol.direction
  facing.y = (b.y - a.y) * patrol.direction
  facing.z = (b.z - a.z) * patrol.direction
}

/**
 * Take a patrol on this far along its road, and off at the end onto
 * another that meets it there, picked by `seed` and how many roads it has
 * walked; back the way it came, where nothing does.
 */
export function advancePatrol(map: World, patrol: Patrol, distance: number, seed: number): void {
  const route = routeOf(map, patrol.road)
  if (route === undefined) return
  patrol.along += patrol.direction * distance
  if (patrol.along >= 0 && patrol.along <= route.total) return
  const road = map.roads[patrol.road]!
  const end = patrol.along > route.total ? road.points.at(-1)! : road.points[0]!
  const turns: { road: number; start: boolean }[] = []
  for (const other of routes(map)) {
    if (other.road === patrol.road) continue
    const points = map.roads[other.road]!.points
    if (vdistance(points[0]!, end) < JUNCTION_REACH) turns.push({ road: other.road, start: true })
    else if (vdistance(points.at(-1)!, end) < JUNCTION_REACH) turns.push({ road: other.road, start: false })
  }
  patrol.legs += 1
  const turn = turns[Math.floor(createRng(seed + patrol.legs)() * turns.length)]
  if (turn === undefined) {
    patrol.direction = -patrol.direction
    patrol.along = Math.min(Math.max(patrol.along, 0), route.total)
    return
  }
  patrol.road = turn.road
  patrol.direction = turn.start ? 1 : -1
  patrol.along = turn.start ? 0 : routeOf(map, turn.road)!.total
}

/**
 * Put a patrol on the arterial nearest a point, going whichever way it was,
 * at the point there nearest to it. How far that is.
 */
export function nearestPatrol(map: World, patrol: Patrol, at: Vec3): number {
  let nearest = Infinity
  for (const route of routes(map)) {
    const points = map.roads[route.road]!.points
    for (const [i, point] of points.entries()) {
      const distance = vdistance(point, at)
      if (distance >= nearest) continue
      nearest = distance
      patrol.road = route.road
      patrol.along = route.lengths[i]!
    }
  }
  return nearest
}

/**
 * Bring a patrol level with a point near its road: to the point of the road,
 * within `window` either way of where the patrol is, nearest it. How far off
 * the road the point is.
 */
export function followPatrol(map: World, patrol: Patrol, at: Vec3, window: number): number {
  const route = routeOf(map, patrol.road)
  const road = map.roads[patrol.road]
  if (route === undefined || road === undefined) return Infinity
  let nearest = Infinity
  let best = patrol.along
  for (let i = 0; i + 1 < road.points.length; i++) {
    if (route.lengths[i + 1]! < patrol.along - window || route.lengths[i]! > patrol.along + window) continue
    const a = road.points[i]!
    const b = road.points[i + 1]!
    const vx = b.x - a.x
    const vy = b.y - a.y
    const vz = b.z - a.z
    const t = Math.min(Math.max(((at.x - a.x) * vx + (at.y - a.y) * vy + (at.z - a.z) * vz) / (vx * vx + vy * vy + vz * vz || 1), 0), 1)
    const dx = at.x - a.x - vx * t
    const dy = at.y - a.y - vy * t
    const dz = at.z - a.z - vz * t
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (distance >= nearest) continue
    nearest = distance
    best = route.lengths[i]! + (route.lengths[i + 1]! - route.lengths[i]!) * t
  }
  patrol.along = best
  return nearest
}
