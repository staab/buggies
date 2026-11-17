/**
 * A world's roads as a graph to find a way along: a node every few points of
 * each road, a step along each road between its nodes, a step between the roads
 * that run near one another and the platform tops that join them, and the
 * shortest way from one node to another. And how an end of a leg joins the
 * graph: on a road along its deck, or over the ground to the nearest node at
 * grade that the ground reaches.
 */

import { v3, vdistance, vlength, type Vec3 } from '@buggies/physics'
import { ROOM_LEAST, WORLD_TRAITS, atHeight, groundDistance, upOf, type World, type WorldRoad } from '@buggies/terrain'

import { nearestRoadSpotTo } from './spawns.ts'
import { GATE_HEIGHT, boredHeight, groundWalk, stepBetween, walkPoints, walkReaches, type Way } from './ground-walk.ts'

/** How many points of a road make a node of the graph, how near two roads must run to join, how big a cell of the search for them is, and how near their levels must be for a car to drive between them. */
const NODE_STEP = 4
const JOIN_REACH = 20
const JOIN_CELL = 24
const JOIN_LEVEL = 1.5

/** How many cells of the search for two roads that meet may stand either way from the middle of the world, and how far that is from side to side. */
const JOIN_CELLS_EITHER_WAY = 512
const JOIN_CELLS_SPAN = JOIN_CELLS_EITHER_WAY * 2

/** The nodes in no cell of the search: what a look at an empty cell finds. */
const NO_NODES: readonly number[] = []

/** How high over the ground under it a road node may stand and still be at grade, rather than up on a bridge or a viaduct. */
const GRADE_REACH = 1.5

/**
 * How far by ground a road node may stand from an end of a leg and still be
 * joined to it: a portal stands out in the open country, and on some seeds the
 * nearest road down at grade is a kilometre off, on the far side of a town.
 */
const JOIN_GROUND_REACH = 2500

/** How near a road a place may stand and still be on it, rather than on the ground about it. */
export const ROAD_REACH = 20

/** How far apart the points of a hop across a platform's top are laid, where two roads come up onto it and do not meet. */
const JOIN_STEP = 20

/** The cell of the search for two roads that meet a place along one of the world's axes stands in. */
function joinCellOf(value: number): number {
  return Math.floor(value / JOIN_CELL)
}

/** The key of the cell of that search at three cells across the world, packed into one number. */
function joinCellKey(x: number, y: number, z: number): number {
  return ((x + JOIN_CELLS_EITHER_WAY) * JOIN_CELLS_SPAN + (y + JOIN_CELLS_EITHER_WAY)) * JOIN_CELLS_SPAN + (z + JOIN_CELLS_EITHER_WAY)
}

/**
 * A way across a world along its roads: over the ground to a node at grade
 * near one end, along the roads to a node at grade near the other, and over
 * the ground to it. A road route never cuts a corner through the air: the
 * ground is walked over its own surface, and a road is only left where its
 * deck is on the ground, so a leg does not end up on a bridge it cannot get
 * down from.
 */
export function roadRoute(world: World, from: Vec3, to: Vec3): Way | null {
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
      if (!each.grade) continue
      if (component >= 0 && graph.components[index] !== component) continue
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

/** A node of the routes across a world: a point of a road, where along that road it stands, and whether it is at grade: on the ground, not up on a deck. */
interface GraphNode {
  readonly point: Vec3
  readonly road: number
  readonly index: number
  readonly grade: boolean
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

/** The roads of a world as a graph, made the first time a leg asks to go along them. */
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
    nodes.push({ point, road, index, grade: atGrade(world, point) })
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
  const cells = new Map<number, number[]>()
  for (const [index, node] of nodes.entries()) {
    const key = joinCellKey(joinCellOf(node.point.x), joinCellOf(node.point.y), joinCellOf(node.point.z))
    const cell = cells.get(key)
    if (cell === undefined) cells.set(key, [index])
    else cell.push(index)
  }
  for (const [index, node] of nodes.entries()) {
    const x = joinCellOf(node.point.x)
    const y = joinCellOf(node.point.y)
    const z = joinCellOf(node.point.z)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const other of cells.get(joinCellKey(x + dx, y + dy, z + dz)) ?? NO_NODES) {
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
