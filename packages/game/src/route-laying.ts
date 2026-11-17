/**
 * The way a leg is driven: the way across a world cut finely, every point of it
 * on what is driven on there and down the middle of any corridor it runs
 * through, then spaced out evenly from one end of the leg to the other; and why
 * a route laid that way is not one a car could drive after all.
 */

import { v3, vcross, vdistance, vlength, vscale, type Vec3 } from '@buggies/physics'
import { alongGround, atHeight, onLand, roofOver, upOf, type World } from '@buggies/terrain'

import { ROAD_REACH } from './road-graph.ts'
import { nearestRoadSpotTo } from './spawns.ts'
import { GATE_HEIGHT, boredHeight, stepOut, surfacePoint, unitOf, type Way } from './ground-walk.ts'

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
 * How near the surface of what is driven on a route point must stand, and how
 * steep a step of a route may be: the rise over the run, up or down. Open
 * ground rolls and hills climb a few metres every step, which a car does; a
 * step down through the air, or off a cliff, is steeper than this.
 */
const ROUTE_CLEARANCE = 1.5
const ROUTE_GRADE = 1

/**
 * The way a leg is driven, point by point: the way across it cut finely, on
 * what is driven on there and down the middle of any corridor it runs
 * through, then spaced out evenly from one end to the other.
 */
export function laidRoute(world: World, way: Way, end: Vec3): Vec3[] {
  const path = [...way.points]
  const onRoad = [...way.onRoad]
  const last = path[path.length - 1]
  if (last === undefined || vdistance(last, end) > 1e-6) {
    path.push({ ...end })
    onRoad.push(onRoad[onRoad.length - 1] ?? false)
  }
  const dense = denseRoute(world, { points: path, onRoad })
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
function denseRoute(world: World, way: Way): Way {
  const path = way.points
  const points: Vec3[] = [path[0]!]
  const along: boolean[] = [way.onRoad[0] ?? false]
  for (let index = 1; index < path.length; index++) {
    const road = way.onRoad[index - 1] ?? false
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
export function routeFault(world: World, route: readonly Vec3[]): string | null {
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
