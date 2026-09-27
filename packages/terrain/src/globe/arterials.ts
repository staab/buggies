/**
 * A planet's arterials: the roads between its cities and out across its
 * country, routed over its own ground. Their ends are nodes: the ends of
 * the highway's cross roads, the middles of the cities the highway does
 * not run through, and points spread over the land. Each node is linked to
 * its nearest neighbors, each link routed so it never strays into the
 * ground nearer another node, and whatever dead ends or runs apart from the
 * rest is dropped, so what is left is a network of loops that the traffic
 * and the robots can go round.
 */

import * as exact from '@buggies/physics'
import { createRng, type Vec3 } from '@buggies/physics'

import {
  ARTERIAL_ACCESS_AVOID,
  ARTERIAL_BRIDGE_CLEARANCE,
  ARTERIAL_BRIDGE_GRADE,
  ARTERIAL_DENSITY_COST,
  ARTERIAL_FIELD_SPACING,
  ARTERIAL_HIGHWAY_AVOID,
  ARTERIAL_LENS_COST,
  ARTERIAL_MAX_COUNT,
  ARTERIAL_MAX_EXPANSIONS,
  ARTERIAL_MERGE_REACH,
  ARTERIAL_MIN_JUNCTION_ANGLE,
  ARTERIAL_MIN_RADIUS,
  ARTERIAL_NEIGHBORS,
  ARTERIAL_PRUNE_TURN,
  ARTERIAL_SEA_COST,
  ARTERIAL_SLOPE_COST,
  ARTERIAL_WATER_COST,
  ARTERIAL_WIDTH,
  MAX_ARTERIAL_GRADE,
  ROAD_BRIDGE,
  ROAD_GRADE,
  SAMPLE_STEP,
} from '../roads/constants.ts'
import { limitSweepGradeAlong } from '../roads/grades.ts'
import { sphereHeight } from '../sphere.ts'
import { tangentFrame } from '../sphere-heights.ts'
import { randomDirection } from '../world-queries.ts'
import type { WorldDistrict, WorldRoad } from '../world.ts'
import { DRY } from '../water.ts'
import { waterAt, type Planet } from './highway.ts'
import { along, angleBetween, easeTurns, lift, resample, runs, smooth, tangentAt, turnAt, unit } from './lines.ts'
import { navApart, navDirection, navPoint, route } from './nav.ts'

const { cos, sin } = exact

/** A node an arterial may end at: where it is, how high, and which cross road it is an end of, or whether it is a city's middle. */
interface Node {
  readonly direction: Vec3
  readonly height: number
  readonly cross: number
  readonly city: boolean
}

/** How far apart, along the ground, the points a city's middle is looked for dry ground out from are, and how many bearings on each ring. */
const CITY_NODE_STEP = 8
const CITY_NODE_BEARINGS = 16

/** The nodes: the cross roads' ends, the middles of the cities off the highway, and points spread over the land. */
function buildNodes(planet: Planet, crossRoads: readonly WorldRoad[], cities: readonly WorldDistrict[], seed: number): Node[] {
  const { ground, seaLevel } = planet
  const { radius } = ground
  const nodes: Node[] = []
  const heightAt = (point: Vec3): number => Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) - radius
  crossRoads.forEach((cross, id) => {
    for (const end of [cross.points[0]!, cross.points.at(-1)!]) nodes.push({ direction: unit(end), height: heightAt(end), cross: id, city: false })
  })
  const dry = (direction: Vec3): boolean => sphereHeight(ground, direction) > seaLevel && waterAt(planet, direction) === DRY
  // A city's node is at its middle, or where a river runs through that, on the nearest dry ground within the city.
  for (const city of cities) {
    let spot: Vec3 | null = dry(city.center) ? city.center : null
    const { east, north } = tangentFrame(city.center)
    for (let out = CITY_NODE_STEP; spot === null && out <= city.radius; out += CITY_NODE_STEP) {
      for (let k = 0; k < CITY_NODE_BEARINGS && spot === null; k++) {
        const angle = (k / CITY_NODE_BEARINGS) * Math.PI * 2
        const way = unit({ x: east.x * cos(angle) + north.x * sin(angle), y: east.y * cos(angle) + north.y * sin(angle), z: east.z * cos(angle) + north.z * sin(angle) })
        const at = along(city.center, way, out, radius)
        if (dry(at)) spot = at
      }
    }
    if (spot !== null) nodes.push({ direction: spot, height: sphereHeight(ground, spot), cross: -1, city: true })
  }
  // Points spread over the land, about the spacing apart.
  const rng = createRng(seed)
  const tries = Math.ceil((4 * Math.PI * radius * radius) / (ARTERIAL_FIELD_SPACING * ARTERIAL_FIELD_SPACING)) * 6
  const direction = { x: 0, y: 0, z: 0 }
  for (let attempt = 0; attempt < tries; attempt++) {
    randomDirection(rng, direction)
    if (!dry(direction)) continue
    if (nodes.some((node) => angleBetween(node.direction, direction) * radius < ARTERIAL_FIELD_SPACING * 0.45)) continue
    nodes.push({ direction: { ...direction }, height: sphereHeight(ground, direction), cross: -1, city: false })
  }
  return nodes
}

/**
 * Which node each point of the routing grid is nearest, and the pairs of
 * nodes whose ground meets: linking only those, the straight links never
 * cross, and a link routed within the ground of its two nodes cannot run
 * into another.
 */
function nearestNodes(planet: Planet, nodes: readonly Node[]): { label: Int16Array; adjacent: [number, number][] } {
  const { nav } = planet
  const count = nav.ground.length
  const label = new Int16Array(count).fill(-1)
  const direction = { x: 0, y: 0, z: 0 }
  for (let at = 0; at < count; at++) {
    navDirection(nav, at, direction)
    let best = -1
    let nearest = -Infinity
    for (let n = 0; n < nodes.length; n++) {
      const { direction: d } = nodes[n]!
      const toward = d.x * direction.x + d.y * direction.y + d.z * direction.z
      if (toward > nearest) {
        nearest = toward
        best = n
      }
    }
    label[at] = best
  }
  const seen = new Set<number>()
  const adjacent: [number, number][] = []
  for (let at = 0; at < count; at++) {
    for (let k = 0; k < 8; k++) {
      const next = nav.neighbors[at * 8 + k]!
      if (next < 0) continue
      const a = label[at]!
      const b = label[next]!
      if (a < 0 || b < 0 || a === b) continue
      const low = Math.min(a, b)
      const high = Math.max(a, b)
      const key = low * nodes.length + high
      if (seen.has(key)) continue
      seen.add(key)
      adjacent.push([low, high])
    }
  }
  return { label, adjacent }
}

/**
 * An even mesh over the nodes: each linked to its nearest neighbors first,
 * then lifted to at least two links so nothing dead-ends, then what is
 * still apart joined, and spare links closing extra loops.
 */
function linkNodes(nodes: readonly Node[], adjacent: readonly [number, number][], radius: number): [number, number][] {
  const count = nodes.length
  const pairs = adjacent
    .filter(([a, b]) => !(nodes[a]!.cross >= 0 && nodes[a]!.cross === nodes[b]!.cross))
    .map(([a, b]) => ({ a, b, d: angleBetween(nodes[a]!.direction, nodes[b]!.direction) * radius }))
    .sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b)
  const touching: number[][] = nodes.map(() => [])
  for (const [i, pair] of pairs.entries()) {
    touching[pair.a]!.push(i)
    touching[pair.b]!.push(i)
  }
  const edges: [number, number][] = []
  const degree = new Array<number>(count).fill(0)
  const used = new Set<number>()
  const add = (index: number): void => {
    if (used.has(index) || edges.length >= ARTERIAL_MAX_COUNT) return
    const pair = pairs[index]!
    used.add(index)
    edges.push([pair.a, pair.b])
    degree[pair.a]!++
    degree[pair.b]!++
  }
  for (let i = 0; i < count; i++) for (const index of touching[i]!.slice(0, ARTERIAL_NEIGHBORS)) add(index)
  for (let i = 0; i < count; i++) {
    for (const index of touching[i]!) {
      if (degree[i]! >= 2) break
      add(index)
    }
  }
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (start: number): number => {
    let root = start
    while (parent[root]! !== root) root = parent[root]!
    return root
  }
  for (const [a, b] of edges) parent[find(a)] = find(b)
  for (let i = 0; i < pairs.length && edges.length < ARTERIAL_MAX_COUNT; i++) {
    const pair = pairs[i]!
    if (find(pair.a) === find(pair.b)) continue
    parent[find(pair.a)] = find(pair.b)
    add(i)
  }
  for (let i = 0; i < pairs.length && edges.length < ARTERIAL_MAX_COUNT; i++) add(i)
  return edges
}

/** How far apart an arterial's points are laid, in meters, and how tight it may turn. */
const ARTERIAL_POINT_STEP = SAMPLE_STEP

/**
 * Build the arterials: the nodes linked as evenly as the ground allows,
 * each link routed across the grid within its two nodes' ground, around
 * the highway and every road already built, bridging rivers and lakes and
 * climbing no steeper than an arterial may; every dead end and knot then
 * dropped, and whatever cannot be joined to the highway's network dropped
 * with it.
 */
export function buildGlobeArterials(
  planet: Planet,
  crossRoads: readonly WorldRoad[],
  cities: readonly WorldDistrict[],
  existing: readonly WorldRoad[],
  seed: number,
  firstId: number,
): WorldRoad[] {
  const { nav, ground } = planet
  const { radius } = ground
  const nodes = buildNodes(planet, crossRoads, cities, seed)
  if (nodes.length < 2) return []
  const { label, adjacent } = nearestNodes(planet, nodes)
  const edges = linkNodes(nodes, adjacent, radius)

  // Every road already on the map is kept off: the highway by a wide berth, what branches off it by a narrow one.
  const charged = new Uint8Array(nav.ground.length)
  const markNear = (point: Vec3, reach: number): void => {
    const start = navPoint(nav, point)
    const stack = [start]
    const seen = new Set([start])
    for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
      if (angleBetween(navDirection(nav, at), unit(point)) * radius > reach) continue
      charged[at] = 1
      for (let k = 0; k < 8; k++) {
        const next = nav.neighbors[at * 8 + k]!
        if (next < 0 || seen.has(next)) continue
        seen.add(next)
        stack.push(next)
      }
    }
  }
  for (const road of existing) {
    const reach = road.kind === 'highway' ? ARTERIAL_HIGHWAY_AVOID : ARTERIAL_ACCESS_AVOID
    for (const point of road.points) markNear(point, reach)
  }
  const density = new Float32Array(nav.ground.length)
  const heightOf = (at: number): number => {
    const level = nav.water[at]!
    return level === DRY ? nav.ground[at]! : Math.max(level + ARTERIAL_BRIDGE_CLEARANCE, nav.ground[at]!)
  }

  const roads: WorldRoad[] = []
  const endpoints: [number, number][] = []
  let id = firstId

  /** The road a routed way comes to: eased, walked at even steps, its ends on its nodes, following the ground, bridging the water. */
  const makeRoad = (a: number, b: number, way: readonly number[]): WorldRoad | null => {
    const line = way.map((at) => navDirection(nav, at))
    line[0] = nodes[a]!.direction
    line[line.length - 1] = nodes[b]!.direction
    let course = smooth(resample(line, ARTERIAL_POINT_STEP * 3, radius, false), 6, false)
    course = resample(easeTurns(course, ARTERIAL_MIN_RADIUS, radius, false, 300), ARTERIAL_POINT_STEP, radius, false)
    if (course.length < 2) return null
    const lengths = runs(course, radius, false)
    const wet = course.map((direction) => waterAt(planet, direction) !== DRY || sphereHeight(ground, direction) <= planet.seaLevel)
    const heights = Float32Array.from(course, (direction, index) => {
      if (index === 0) return nodes[a]!.height
      if (index === course.length - 1) return nodes[b]!.height
      const level = waterAt(planet, direction)
      const floor = sphereHeight(ground, direction)
      return level !== DRY ? Math.max(level + ARTERIAL_BRIDGE_CLEARANCE, floor) : wet[index] ? Math.max(planet.seaLevel + ARTERIAL_BRIDGE_CLEARANCE, floor) : floor
    })
    limitSweepGradeAlong(heights, lengths, MAX_ARTERIAL_GRADE)
    const structure = new Uint8Array(course.length - 1)
    for (let i = 0; i < structure.length; i++) structure[i] = wet[i] || wet[i + 1] ? ROAD_BRIDGE : ROAD_GRADE
    return {
      id,
      kind: 'arterial',
      closed: false,
      points: course.map((direction, index) => lift(direction, radius, heights[index]!)),
      widths: new Float32Array(course.length).fill(ARTERIAL_WIDTH),
      structure,
    }
  }

  /** Whether a road would run into one already built, anywhere but at its own ends. */
  const clashes = (road: WorldRoad): boolean => {
    const ends = [unit(road.points[0]!), unit(road.points.at(-1)!)]
    for (const point of road.points) {
      const here = unit(point)
      if (ends.some((end) => angleBetween(end, here) * radius < ARTERIAL_MERGE_REACH)) continue
      for (const other of [...existing, ...roads]) {
        for (const there of other.points) if (angleBetween(unit(there), here) * radius < ARTERIAL_WIDTH) return true
      }
    }
    return false
  }
  /** Whether a road would leave a node too near the heading of one already joined there. */
  const sharpAt = (node: number, road: WorldRoad, fromStart: boolean): boolean => {
    const heading = tangentAt(road.points, fromStart ? 0 : road.points.length - 1, false)
    const way = fromStart ? heading : { x: -heading.x, y: -heading.y, z: -heading.z }
    for (const [k, [from, to]] of endpoints.entries()) {
      if (from !== node && to !== node) continue
      const other = roads[k]!
      const otherHeading = tangentAt(other.points, from === node ? 0 : other.points.length - 1, false)
      const otherWay = from === node ? otherHeading : { x: -otherHeading.x, y: -otherHeading.y, z: -otherHeading.z }
      if (angleBetween(way, otherWay) < ARTERIAL_MIN_JUNCTION_ANGLE) return true
    }
    return false
  }

  const buildRoad = (a: number, b: number, relaxed: boolean, openSea: boolean): boolean => {
    const start = navPoint(nav, nodes[a]!.direction)
    const goal = navPoint(nav, nodes[b]!.direction)
    const way = route(
      nav,
      start,
      goal,
      (from, to, run) => {
        const arrives = to === goal
        const wetStep = nav.water[from] !== DRY || nav.water[to] !== DRY
        const grade = Math.abs(heightOf(to) - heightOf(from)) / run
        if (grade > (wetStep ? ARTERIAL_BRIDGE_GRADE : MAX_ARTERIAL_GRADE)) return Infinity
        if (charged[to] && navApart(nav, to, start) > ARTERIAL_MERGE_REACH && navApart(nav, to, goal) > ARTERIAL_MERGE_REACH) return Infinity
        if (nav.sea[to] && !arrives && !openSea) return Infinity
        let cost = run + grade * ARTERIAL_SLOPE_COST
        if (wetStep) cost += ARTERIAL_WATER_COST
        if (nav.sea[to]) cost += ARTERIAL_SEA_COST
        const tag = to === start || arrives ? a : label[to]!
        if (!openSea && tag !== a && tag !== b) {
          if (!relaxed) return Infinity
          cost += ARTERIAL_LENS_COST
        }
        return cost + density[to]! * ARTERIAL_DENSITY_COST
      },
      null,
      ARTERIAL_MAX_EXPANSIONS,
    )
    if (way === null) return false
    const road = makeRoad(a, b, way)
    if (road === null || clashes(road) || sharpAt(a, road, true) || sharpAt(b, road, false)) return false
    for (const at of way) density[at] = density[at]! + 1
    roads.push(road)
    endpoints.push([a, b])
    id++
    return true
  }

  const degree = (node: number): number => endpoints.filter(([a, b]) => a === node || b === node).length
  const tried = new Set<number>()
  for (const [a, b] of edges) {
    tried.add(a * nodes.length + b)
    buildRoad(a, b, false, false)
  }
  // A node left with fewer than two roads gets another, to the nearest node not tried, where the ground allows.
  for (let i = 0; i < nodes.length; i++) {
    for (let attempt = 0; attempt < 6 && degree(i) < 2; attempt++) {
      let j = -1
      let nearest = Infinity
      for (let k = 0; k < nodes.length; k++) {
        if (k === i || tried.has(Math.min(i, k) * nodes.length + Math.max(i, k))) continue
        if (nodes[i]!.cross >= 0 && nodes[i]!.cross === nodes[k]!.cross) continue
        const distance = navApart(nav, navPoint(nav, nodes[i]!.direction), navPoint(nav, nodes[k]!.direction))
        if (distance < nearest) {
          nearest = distance
          j = k
        }
      }
      if (j < 0) break
      tried.add(Math.min(i, j) * nodes.length + Math.max(i, j))
      buildRoad(Math.min(i, j), Math.max(i, j), true, false)
    }
  }

  // Dangling branches and knotted roads go, until every road left joins others at both ends and runs clean.
  const alive = roads.map(() => true)
  for (;;) {
    const joins = new Array<number>(nodes.length).fill(0)
    for (const [k, [a, b]] of endpoints.entries()) {
      if (!alive[k]) continue
      joins[a]!++
      joins[b]!++
    }
    let pruned = false
    for (const [k, [a, b]] of endpoints.entries()) {
      if (!alive[k]) continue
      // A leaf at a cross road's end has the cross road for its second link; one at a city's middle, the streets.
      const leaf = (node: number): boolean => joins[node] === 1 && nodes[node]!.cross < 0 && !nodes[node]!.city
      let sharpest = 0
      const road = roads[k]!
      for (let i = 1; i < road.points.length - 1; i++) sharpest = Math.max(sharpest, turnAt(road.points.map(unit), i, radius, false) * ARTERIAL_POINT_STEP)
      if (leaf(a) || leaf(b) || sharpest > ARTERIAL_PRUNE_TURN) {
        alive[k] = false
        pruned = true
      }
    }
    if (!pruned) break
  }

  // Whatever does not reach the highway's network through the cross roads is joined to it where it can be, over the sea if it must, or dropped.
  const parent = nodes.map((_, index) => index)
  const find = (start: number): number => {
    let root = start
    while (parent[root]! !== root) root = parent[root]!
    return root
  }
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b)
  }
  const firstCross = nodes.findIndex((node) => node.cross >= 0)
  for (const [index, node] of nodes.entries()) if (node.cross >= 0) union(index, firstCross)
  for (const [k, [a, b]] of endpoints.entries()) if (alive[k]) union(a, b)
  if (firstCross >= 0) {
    for (let a = 0; a < nodes.length; a++) {
      if (find(a) === find(firstCross)) continue
      const onRoad = endpoints.some(([x, y], k) => alive[k] && (x === a || y === a)) || nodes[a]!.city
      if (!onRoad) continue
      let b = -1
      let nearest = Infinity
      for (let k = 0; k < nodes.length; k++) {
        if (find(k) !== find(firstCross)) continue
        const distance = angleBetween(nodes[a]!.direction, nodes[k]!.direction)
        if (distance < nearest) {
          nearest = distance
          b = k
        }
      }
      if (b >= 0 && buildRoad(Math.min(a, b), Math.max(a, b), true, true)) {
        alive.push(true)
        union(a, b)
      }
    }
    for (const [k, [a]] of endpoints.entries()) if (find(a) !== find(firstCross)) alive[k] = false
  }
  return roads.filter((_, k) => alive[k]).map((road, index) => ({ ...road, id: firstId + index }))
}
