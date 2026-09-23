import { type Rng, createRng } from '@buggies/physics'
import type { Heightfield, Road, RoadPoint } from '../types.ts'
import {
  ARTERIAL_ACCESS_AVOID,
  ARTERIAL_BLOCK_COST,
  ARTERIAL_BRIDGE_CLEARANCE,
  ARTERIAL_BRIDGE_GRADE,
  ARTERIAL_DENSITY_COST,
  ARTERIAL_FIELD_SPACING,
  ARTERIAL_GRID,
  ARTERIAL_HIGHWAY_AVOID,
  ARTERIAL_LENS_COST,
  ARTERIAL_MAX_COUNT,
  ARTERIAL_MAX_EXPANSIONS,
  ARTERIAL_MAX_POINTS,
  ARTERIAL_MAX_TURN,
  ARTERIAL_MERGE_REACH,
  ARTERIAL_MIN_JUNCTION_ANGLE,
  ARTERIAL_MIN_RADIUS,
  ARTERIAL_NEIGHBOURS,
  ARTERIAL_PRUNE_TURN,
  ARTERIAL_SEA_COST,
  ARTERIAL_SLOPE_COST,
  ARTERIAL_STEP,
  ARTERIAL_WATER_COST,
  ARTERIAL_WAYPOINT_STRIDE,
  ARTERIAL_WIDTH,
  MAX_ARTERIAL_GRADE,
  ROAD_BRIDGE,
  ROAD_GRADE,
  TURN_WINDOW,
} from './constants.ts'
import { leavingDirection, roadBounds, segmentGap, segmentsCross } from './geometry.ts'
import { limitSweepGrade } from './grades.ts'
import { sampleTerrain } from './sampling.ts'

/**
 * Arterials: the roads between cities, routed cell by cell over a navigation
 * grid and smoothed into drivable runs.
 */

interface ArterialNode {
  x: number
  z: number
  y: number
  /** Cross road this node belongs to, shared by its two ends; -1 for field nodes. */
  cross: number
}

interface PathPoint {
  x: number
  y: number
  z: number
  wet: boolean
}

interface NavGrid {
  cell: number
  cols: number
  rows: number
  height: Float32Array
  wet: Uint8Array
  sea: Uint8Array
  charged: Uint8Array
}

/** Grid of terrain arterials route over, with highways charged extra to avoid. */
function buildNavGrid(
  field: Heightfield,
  seaLevel: number,
  surfaceAt: (x: number, z: number) => { wet: boolean; level: number },
  existing: Road[],
): NavGrid {
  const cell = ARTERIAL_GRID
  const cols = Math.ceil((field.width * field.cellSize) / cell)
  const rows = Math.ceil((field.depth * field.cellSize) / cell)
  const count = cols * rows
  const height = new Float32Array(count)
  const wet = new Uint8Array(count)
  const sea = new Uint8Array(count)
  const charged = new Uint8Array(count)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col + 0.5) * cell
      const z = (row + 0.5) * cell
      const ground = sampleTerrain(field, x, z)
      const water = surfaceAt(x, z)
      const index = row * cols + col
      sea[index] = ground <= seaLevel ? 1 : 0
      wet[index] = water.wet ? 1 : 0
      height[index] = water.wet ? Math.max(water.level + ARTERIAL_BRIDGE_CLEARANCE, ground) : ground
    }
  }

  const mark = (x: number, z: number, radius: number): void => {
    const minCol = Math.max(Math.floor((x - radius) / cell), 0)
    const maxCol = Math.min(Math.ceil((x + radius) / cell), cols - 1)
    const minRow = Math.max(Math.floor((z - radius) / cell), 0)
    const maxRow = Math.min(Math.ceil((z + radius) / cell), rows - 1)
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (Math.hypot((col + 0.5) * cell - x, (row + 0.5) * cell - z) > radius) continue
        charged[row * cols + col] = 1
      }
    }
  }

  // Every existing road is blocked, so the router goes around highways, ramps
  // and cross roads rather than crossing them. The highway keeps a wide berth;
  // ramps and cross roads a narrow one, so an arterial can still leave the cross
  // road end it starts from.
  for (const road of existing) {
    const radius = road.closed ? ARTERIAL_HIGHWAY_AVOID : ARTERIAL_ACCESS_AVOID
    for (const point of road.points) mark(point.x, point.z, radius)
  }

  return { cell, cols, rows, height, wet, sea, charged }
}

/** Grid cell containing a world point. */
function cellAt(grid: NavGrid, x: number, z: number): number {
  const col = Math.min(Math.max(Math.floor(x / grid.cell), 0), grid.cols - 1)
  const row = Math.min(Math.max(Math.floor(z / grid.cell), 0), grid.rows - 1)
  return row * grid.cols + col
}

/**
 * Nearest anchor for every nav cell, a grid Voronoi diagram. An edge routed
 * between two anchors is confined to their two cells (the lens), so different
 * edges cannot wander into each other's ground.
 */
function labelAnchors(grid: NavGrid, nodes: ArterialNode[]): Int16Array {
  const count = grid.cols * grid.rows
  const label = new Int16Array(count).fill(-1)
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = (col + 0.5) * grid.cell
      const z = (row + 0.5) * grid.cell
      let best = -1
      let bestDistance = Infinity
      for (let n = 0; n < nodes.length; n++) {
        const distance = Math.hypot(nodes[n]!.x - x, nodes[n]!.z - z)
        if (distance < bestDistance) {
          bestDistance = distance
          best = n
        }
      }
      label[row * grid.cols + col] = best
    }
  }
  return label
}

/**
 * Anchor pairs whose Voronoi cells share a border. This is the planar dual of
 * the grid Voronoi diagram, i.e. a Delaunay-like adjacency, so connecting two
 * such anchors cannot cut across a third.
 */
function voronoiAdjacency(grid: NavGrid, label: Int16Array, nodeCount: number): [number, number][] {
  const { cols, rows } = grid
  const seen = new Set<number>()
  const pairs: [number, number][] = []
  const record = (a: number, b: number): void => {
    if (a < 0 || b < 0 || a === b) return
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    const key = low * nodeCount + high
    if (seen.has(key)) return
    seen.add(key)
    pairs.push([low, high])
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const here = label[row * cols + col]!
      if (col + 1 < cols) record(here, label[row * cols + col + 1]!)
      if (row + 1 < rows) record(here, label[(row + 1) * cols + col]!)
    }
  }
  return pairs
}

/** Reusable A* scratch, so repeated routes do not churn the heap. */
interface SearchBuffers {
  gScore: Float32Array
  cameFrom: Int32Array
  closed: Uint8Array
  priority: Float32Array
  open: number[]
}

/**
 * A* across the nav grid, returning every cell from start to goal. Moves that
 * would break the grade limit are refused, water costs extra (bridges), highway
 * cells are blocked so a route only crosses at an interchange, leaving the
 * edge's Voronoi lens costs extra, and cells already carrying a road repel.
 */
function routeCells(
  grid: NavGrid,
  buffers: SearchBuffers,
  start: number,
  goal: number,
  label: Int16Array,
  density: Float32Array,
  block: Float32Array,
  strict: boolean,
  anchorA: number,
  anchorB: number,
): number[] | null {
  const { cell, cols, rows, height, wet, sea, charged } = grid
  const { gScore, cameFrom, closed, priority, open } = buffers
  gScore.fill(Infinity)
  cameFrom.fill(-1)
  closed.fill(0)
  priority.fill(Infinity)
  open.length = 0

  const push = (index: number): void => {
    open.push(index)
    let child = open.length - 1
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (priority[open[parent]!]! <= priority[open[child]!]!) break
      const swap = open[parent]!
      open[parent] = open[child]!
      open[child] = swap
      child = parent
    }
  }
  const pop = (): number => {
    const top = open[0]!
    const last = open.pop()!
    if (open.length > 0) {
      open[0] = last
      let parent = 0
      for (;;) {
        const left = parent * 2 + 1
        const right = left + 1
        if (left >= open.length) break
        let smallest = left
        if (right < open.length && priority[open[right]!]! < priority[open[left]!]!) smallest = right
        if (priority[open[parent]!]! <= priority[open[smallest]!]!) break
        const swap = open[parent]!
        open[parent] = open[smallest]!
        open[smallest] = swap
        parent = smallest
      }
    }
    return top
  }

  const heuristic = (index: number): number =>
    Math.hypot((index % cols) - (goal % cols), ((index / cols) | 0) - ((goal / cols) | 0)) * cell

  gScore[start] = 0
  priority[start] = heuristic(start)
  push(start)

  let expanded = 0
  while (open.length > 0) {
    if (++expanded > ARTERIAL_MAX_EXPANSIONS) return null
    const current = pop()
    if (current === goal) {
      const path: number[] = []
      for (let at = current; at !== -1; at = cameFrom[at]!) path.push(at)
      return path.reverse()
    }
    if (closed[current]) continue
    closed[current] = 1

    const col = current % cols
    const row = (current / cols) | 0
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue
        const ncol = col + dx
        const nrow = row + dz
        if (ncol < 0 || ncol >= cols || nrow < 0 || nrow >= rows) continue
        const next = nrow * cols + ncol
        if (closed[next]) continue

        const run = Math.hypot(dx, dz) * cell
        const grade = Math.abs(height[next]! - height[current]!) / run
        const wetMove = wet[current] === 1 || wet[next] === 1
        if (grade > (wetMove ? ARTERIAL_BRIDGE_GRADE : MAX_ARTERIAL_GRADE)) continue
        // Highway cells are blocked outright; the only way across is the cleared
        // corridor at an interchange, so arterials cannot cut through.
        if (charged[next] === 1 && next !== goal) continue

        let cost = run + grade * ARTERIAL_SLOPE_COST
        if (wetMove) {
          // Rivers and lakes are bridged; open sea is avoided strongly.
          cost += sea[current] === 1 || sea[next] === 1 ? ARTERIAL_SEA_COST : ARTERIAL_WATER_COST
        }
        let tag = label[next]!
        // The exact start and goal cells are always allowed, even if another
        // anchor is marginally nearer.
        if (next === start || next === goal) tag = anchorA
        // Stay inside the union of the two anchors' Voronoi cells: a road may
        // never wander into a third cell, so it cannot collide with another.
        // Dead-end repairs may bow outside the lens for a cost.
        if (tag !== anchorA && tag !== anchorB) {
          if (strict) continue
          cost += ARTERIAL_LENS_COST
        }
        cost += density[next]! * ARTERIAL_DENSITY_COST + block[next]! * ARTERIAL_BLOCK_COST

        const tentative = gScore[current]! + cost
        if (tentative >= gScore[next]!) continue
        gScore[next] = tentative
        cameFrom[next] = current
        priority[next] = tentative + heuristic(next)
        push(next)
      }
    }
  }

  return null
}

/**
 * Round every corner sharper than `maxTurn` to a fillet of about `minRadius`.
 * Each sharp vertex is replaced by a quadratic Bezier that is tangent to the
 * segments either side, so a switchback becomes a hairpin instead of a spike.
 * The fillet is trimmed inside the corner, so it never leaves the original
 * path's footprint.
 */
function roundCorners(points: PathPoint[], minRadius: number, maxTurn: number): PathPoint[] {
  const count = points.length
  if (count < 3) return points
  const result: PathPoint[] = [points[0]!]

  for (let i = 1; i < count - 1; i++) {
    if (result.length >= ARTERIAL_MAX_POINTS) {
      for (let k = i; k < count - 1; k++) result.push(points[k]!)
      result.push(points[count - 1]!)
      return result
    }
    const a = points[i - 1]!
    const b = points[i]!
    const c = points[i + 1]!
    const inX = b.x - a.x
    const inZ = b.z - a.z
    const outX = c.x - b.x
    const outZ = c.z - b.z
    const inLength = Math.hypot(inX, inZ)
    const outLength = Math.hypot(outX, outZ)
    if (inLength < 1e-6 || outLength < 1e-6) {
      result.push(b)
      continue
    }

    const inDx = inX / inLength
    const inDz = inZ / inLength
    const outDx = outX / outLength
    const outDz = outZ / outLength
    const turn = Math.acos(Math.min(Math.max(inDx * outDx + inDz * outDz, -1), 1))
    if (turn <= maxTurn) {
      result.push(b)
      continue
    }

    const trim = Math.min(minRadius * Math.tan(turn / 2), inLength * 0.5, outLength * 0.5)
    const startX = b.x - inDx * trim
    const startY = b.y - ((b.y - a.y) / inLength) * trim
    const startZ = b.z - inDz * trim
    const endX = b.x + outDx * trim
    const endY = b.y + ((c.y - b.y) / outLength) * trim
    const endZ = b.z + outDz * trim
    const steps = Math.max(
      4,
      Math.ceil((trim * turn) / ARTERIAL_STEP),
      Math.ceil(turn / maxTurn),
    )
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const u = 1 - t
      result.push({
        x: u * u * startX + 2 * u * t * b.x + t * t * endX,
        y: u * u * startY + 2 * u * t * b.y + t * t * endY,
        z: u * u * startZ + 2 * u * t * b.z + t * t * endZ,
        wet: b.wet,
      })
    }
  }

  result.push(points[count - 1]!)
  return result
}

/** Drop samples closer together than `minDistance`, keeping the endpoints. */
function dedupePath(points: PathPoint[], minDistance: number): PathPoint[] {
  if (points.length < 2) return points
  const result: PathPoint[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!
    const last = result[result.length - 1]!
    if (Math.hypot(point.x - last.x, point.z - last.z) < minDistance) {
      if (i === points.length - 1) result[result.length - 1] = point
      continue
    }
    result.push(point)
  }
  // The tail replacement above can leave a stub; drop it so no segment is tiny.
  while (result.length >= 2 && Math.hypot(
    result[result.length - 1]!.x - result[result.length - 2]!.x,
    result[result.length - 1]!.z - result[result.length - 2]!.z,
  ) < minDistance) {
    result.splice(result.length - 2, 1)
  }
  while (result.length >= 2 && Math.hypot(
    result[1]!.x - result[0]!.x,
    result[1]!.z - result[0]!.z,
  ) < minDistance) {
    result.splice(1, 1)
  }
  return result
}

/** Keep every `stride`-th point (and the ends) as spline waypoints. */
function decimatePath(points: PathPoint[], stride: number): PathPoint[] {
  if (points.length <= 2) return points
  const result: PathPoint[] = [points[0]!]
  for (let i = stride; i < points.length - 1; i += stride) result.push(points[i]!)
  result.push(points[points.length - 1]!)
  return result
}

/**
 * Sample an open centripetal Catmull-Rom spline through the waypoints at a
 * fixed spacing. Running a spline through decimated grid cells turns the A*
 * staircase into long, gradual curves in one pass.
 */
function sampleOpenSpline(points: PathPoint[], step: number): PathPoint[] {
  const count = points.length
  if (count < 3) return points
  const alpha = 0.5
  const result: PathPoint[] = []

  for (let i = 0; i < count - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(i + 2, count - 1)]!

    const d1 = Math.max(Math.hypot(p1.x - p0.x, p1.z - p0.z), 1e-3) ** alpha
    const d2 = Math.max(Math.hypot(p2.x - p1.x, p2.z - p1.z), 1e-3) ** alpha
    const d3 = Math.max(Math.hypot(p3.x - p2.x, p3.z - p2.z), 1e-3) ** alpha
    const t1 = d1
    const t2 = t1 + d2
    const t3 = t2 + d3
    const span = Math.max(t2 - t1, 1e-6)
    const steps = Math.max(1, Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step))

    for (let k = 0; k < steps; k++) {
      const t = t1 + (k / steps) * span
      const a1x = ((t1 - t) / (t1 - 0)) * p0.x + ((t - 0) / (t1 - 0)) * p1.x
      const a1y = ((t1 - t) / (t1 - 0)) * p0.y + ((t - 0) / (t1 - 0)) * p1.y
      const a1z = ((t1 - t) / (t1 - 0)) * p0.z + ((t - 0) / (t1 - 0)) * p1.z
      const a2x = ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x
      const a2y = ((t2 - t) / (t2 - t1)) * p1.y + ((t - t1) / (t2 - t1)) * p2.y
      const a2z = ((t2 - t) / (t2 - t1)) * p1.z + ((t - t1) / (t2 - t1)) * p2.z
      const a3x = ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x
      const a3y = ((t3 - t) / (t3 - t2)) * p2.y + ((t - t2) / (t3 - t2)) * p3.y
      const a3z = ((t3 - t) / (t3 - t2)) * p2.z + ((t - t2) / (t3 - t2)) * p3.z
      const b1x = ((t2 - t) / (t2 - 0)) * a1x + ((t - 0) / (t2 - 0)) * a2x
      const b1y = ((t2 - t) / (t2 - 0)) * a1y + ((t - 0) / (t2 - 0)) * a2y
      const b1z = ((t2 - t) / (t2 - 0)) * a1z + ((t - 0) / (t2 - 0)) * a2z
      const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x
      const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y
      const b2z = ((t3 - t) / (t3 - t1)) * a2z + ((t - t1) / (t3 - t1)) * a3z

      result.push({
        x: ((t2 - t) / span) * b1x + ((t - t1) / span) * b2x,
        y: ((t2 - t) / span) * b1y + ((t - t1) / span) * b2y,
        z: ((t2 - t) / span) * b1z + ((t - t1) / span) * b2z,
        wet: p1.wet || p2.wet,
      })
    }
  }

  result.push(points[count - 1]!)
  return result
}

/** Node set: both ends of every cross road, plus an even grid of inland sites. */
function buildArterialNodes(
  field: Heightfield,
  seaLevel: number,
  crossRoads: Road[],
  rng: Rng,
  wetAt: (x: number, z: number) => boolean,
): ArterialNode[] {
  const nodes: ArterialNode[] = []
  crossRoads.forEach((cross, id) => {
    nodes.push({ x: cross.points[0]!.x, z: cross.points[0]!.z, y: cross.points[0]!.y, cross: id })
    const end = cross.points[cross.points.length - 1]!
    nodes.push({ x: end.x, z: end.z, y: end.y, cross: id })
  })

  const worldX = field.width * field.cellSize
  const worldZ = field.depth * field.cellSize
  for (let gz = ARTERIAL_FIELD_SPACING / 2; gz < worldZ; gz += ARTERIAL_FIELD_SPACING) {
    for (let gx = ARTERIAL_FIELD_SPACING / 2; gx < worldX; gx += ARTERIAL_FIELD_SPACING) {
      const x = gx + (rng() - 0.5) * ARTERIAL_FIELD_SPACING * 0.35
      const z = gz + (rng() - 0.5) * ARTERIAL_FIELD_SPACING * 0.35
      const ground = sampleTerrain(field, x, z)
      if (ground <= seaLevel || wetAt(x, z)) continue
      if (nodes.some((node) => Math.hypot(node.x - x, node.z - z) < ARTERIAL_FIELD_SPACING * 0.45)) continue
      nodes.push({ x, z, y: ground, cross: -1 })
    }
  }
  return nodes
}

/**
 * An even mesh over the nodes, built only from Voronoi-adjacent anchors, so the
 * straight edges never cross (they are a Delaunay-like planar graph). Each node
 * links to its nearest neighbours first, then is lifted to at least two links so
 * nothing dead-ends, then the remaining components are joined and spare links
 * close extra loops.
 */
function buildArterialEdges(nodes: ArterialNode[], adjacency: [number, number][]): [number, number][] {
  const count = nodes.length
  const pairs: { a: number; b: number; d: number }[] = []
  for (const [a, b] of adjacency) {
    if (nodes[a]!.cross >= 0 && nodes[a]!.cross === nodes[b]!.cross) continue
    pairs.push({ a, b, d: Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.z - nodes[b]!.z) })
  }
  pairs.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b)

  const touching: number[][] = nodes.map(() => [])
  for (let i = 0; i < pairs.length; i++) {
    touching[pairs[i]!.a]!.push(i)
    touching[pairs[i]!.b]!.push(i)
  }

  const edges: [number, number][] = []
  const degree = new Array<number>(count).fill(0)
  const used = new Set<number>()
  const add = (index: number): void => {
    if (index < 0 || used.has(index) || edges.length >= ARTERIAL_MAX_COUNT) return
    const pair = pairs[index]!
    used.add(index)
    edges.push([pair.a, pair.b])
    degree[pair.a]!++
    degree[pair.b]!++
  }

  // Even local coverage.
  for (let i = 0; i < count; i++) {
    for (const index of touching[i]!.slice(0, ARTERIAL_NEIGHBOURS)) add(index)
  }
  // No dead ends: every node reaches degree two.
  for (let i = 0; i < count; i++) {
    for (const index of touching[i]!) {
      if (degree[i]! >= 2) break
      add(index)
    }
  }
  // Join anything still separate.
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (start: number): number => {
    let root = start
    while (parent[root]! !== root) root = parent[root]!
    let walk = start
    while (parent[walk]! !== root) {
      const next = parent[walk]!
      parent[walk] = root
      walk = next
    }
    return root
  }
  for (const [a, b] of edges) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < pairs.length && edges.length < ARTERIAL_MAX_COUNT; i++) {
    const pair = pairs[i]!
    const ra = find(pair.a)
    const rb = find(pair.b)
    if (ra === rb) continue
    parent[ra] = rb
    add(i)
  }
  // Spare shortest links close loops.
  for (let i = 0; i < pairs.length && edges.length < ARTERIAL_MAX_COUNT; i++) add(i)

  return edges
}

/** Nearest node to `index` that has not been tried yet, or `-1`. */
function nearestUntried(nodes: ArterialNode[], index: number, tried: Set<number>): number {
  let best = -1
  let bestDistance = Infinity
  for (let j = 0; j < nodes.length; j++) {
    if (j === index) continue
    if (nodes[index]!.cross >= 0 && nodes[index]!.cross === nodes[j]!.cross) continue
    const key = index < j ? index * nodes.length + j : j * nodes.length + index
    if (tried.has(key)) continue
    const distance = Math.hypot(nodes[index]!.x - nodes[j]!.x, nodes[index]!.z - nodes[j]!.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = j
    }
  }
  return best
}

/**
 * True when a would-be arterial runs into a road already built: it crosses one,
 * or its carriageway laps over one. Testing only for a crossing lets an arterial
 * lie along a highway without ever cutting across it, which reads as the two
 * roads merged into one.
 *
 * Its own two ends are exempt within `mergeReach`, since an arterial starts and
 * finishes on a cross road and has to reach the carriageway to join it. The
 * highway itself is never exempt: an arterial reaches the highway network
 * through an interchange's cross road, so it has no business touching the
 * carriageway anywhere.
 */
function clashesWithBuilt(points: RoadPoint[], roads: Road[], mergeReach: number): boolean {
  const head = points[0]!
  const tail = points[points.length - 1]!
  // Both roads carry hundreds of samples, so reject whole roads, then whole
  // segments, on their bounds before measuring anything.
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }
  const near: Road[] = []
  for (const road of roads) {
    const reach = (ARTERIAL_WIDTH + road.width) / 2
    const theirs = roadBounds(road, reach)
    if (maxX < theirs.minX || theirs.maxX < minX || maxZ < theirs.minZ || theirs.maxZ < minZ) {
      continue
    }
    near.push(road)
  }
  if (near.length === 0) return false

  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const midX = (a.x + b.x) / 2
    const midZ = (a.z + b.z) / 2
    const merging =
      Math.hypot(midX - head.x, midZ - head.z) < mergeReach ||
      Math.hypot(midX - tail.x, midZ - tail.z) < mergeReach
    for (const road of near) {
      const count = road.closed ? road.points.length : road.points.length - 1
      const clear = merging && !road.closed ? 0 : (ARTERIAL_WIDTH + road.width) / 2
      const margin = Math.max(clear, 0)
      for (let j = 0; j < count; j++) {
        const c = road.points[j]!
        const d = road.points[(j + 1) % road.points.length]!
        if (Math.min(a.x, b.x) - margin > Math.max(c.x, d.x)) continue
        if (Math.min(c.x, d.x) - margin > Math.max(a.x, b.x)) continue
        if (Math.min(a.z, b.z) - margin > Math.max(c.z, d.z)) continue
        if (Math.min(c.z, d.z) - margin > Math.max(a.z, b.z)) continue
        if (segmentsCross(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z)) return true
        if (clear > 0 && segmentGap(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z) < clear) return true
      }
    }
  }
  return false
}

/** Nearest node to `index` not in `exclude`, or `-1`. */
function nearestNode(nodes: ArterialNode[], index: number, exclude?: Set<number>): number {
  let best = -1
  let bestDistance = Infinity
  for (let j = 0; j < nodes.length; j++) {
    if (j === index || exclude?.has(j)) continue
    if (nodes[index]!.cross >= 0 && nodes[index]!.cross === nodes[j]!.cross) continue
    const distance = Math.hypot(nodes[index]!.x - nodes[j]!.x, nodes[index]!.z - nodes[j]!.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = j
    }
  }
  return best
}

/**
 * Sharpest heading change (radians) anywhere along a finished polyline,
 * between headings taken over at least TURN_WINDOW of road either side.
 */
export function sharpestTurn(points: RoadPoint[]): number {
  const marks: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const last = points[marks[marks.length - 1]!]!
    if (Math.hypot(points[i]!.x - last.x, points[i]!.z - last.z) >= TURN_WINDOW) marks.push(i)
  }
  if (marks.length < 3) return 0
  let sharpest = 0
  for (let k = 1; k + 1 < marks.length; k++) {
    const a = points[marks[k - 1]!]!
    const b = points[marks[k]!]!
    const c = points[marks[k + 1]!]!
    const inX = b.x - a.x
    const inZ = b.z - a.z
    const outX = c.x - b.x
    const outZ = c.z - b.z
    const inLength = Math.hypot(inX, inZ)
    const outLength = Math.hypot(outX, outZ)
    if (inLength < 1e-6 || outLength < 1e-6) continue
    const dot = (inX * outX + inZ * outZ) / (inLength * outLength)
    sharpest = Math.max(sharpest, Math.acos(Math.min(Math.max(dot, -1), 1)))
  }
  return sharpest
}

/**
 * Arterial network built as a graph: the nodes are the cross road ends plus an
 * even grid of inland sites, and the edges are routed as smooth splines by A*
 * over a terrain grid. Nearby nodes link first for even coverage, every node is
 * lifted to at least two roads so nothing dead-ends, then spare links close
 * loops. Highway cells are impassable, so arterials only meet the highway at an
 * interchange, and the grade limit keeps every climb gradual. Deterministic.
 */
export function buildArterials(
  field: Heightfield,
  seaLevel: number,
  crossRoads: Road[],
  existing: Road[],
  surfaceAt: (x: number, z: number) => { wet: boolean; level: number },
  seed: number,
  nextId: number,
): Road[] {
  const rng: Rng = createRng(seed)
  const nodes = buildArterialNodes(field, seaLevel, crossRoads, rng, (x, z) => surfaceAt(x, z).wet)
  if (nodes.length < 2) return []
  const grid = buildNavGrid(field, seaLevel, surfaceAt, existing)
  const label = labelAnchors(grid, nodes)
  const adjacency = voronoiAdjacency(grid, label, nodes.length)
  const edges = buildArterialEdges(nodes, adjacency)
  const density = new Float32Array(grid.cols * grid.rows)
  const block = new Float32Array(grid.cols * grid.rows)
  const buffers: SearchBuffers = {
    gScore: new Float32Array(grid.cols * grid.rows),
    cameFrom: new Int32Array(grid.cols * grid.rows),
    closed: new Uint8Array(grid.cols * grid.rows),
    priority: new Float32Array(grid.cols * grid.rows),
    open: [],
  }
  // Everything already on the map is an obstacle: an arterial may meet a road
  // at a shared endpoint, but must never cross one.
  const obstacles: Road[] = [...existing]
  const roads: Road[] = []
  const endpoints: [number, number][] = []
  const degree = new Array<number>(nodes.length).fill(0)
  const tried = new Set<number>()
  let id = nextId

  const buildRoad = (a: number, b: number, relaxed = false): boolean => {
    const start = nodes[a]!
    const goal = nodes[b]!

    const makeRoad = (cells: number[]): { points: RoadPoint[]; structure: Uint8Array } | null => {
      const raw: PathPoint[] = cells.map((index) => {
        const col = index % grid.cols
        const row = (index / grid.cols) | 0
        return {
          x: (col + 0.5) * grid.cell,
          y: grid.height[index]!,
          z: (row + 0.5) * grid.cell,
          wet: grid.wet[index] === 1,
        }
      })
      // Pin the real ends so the arterial meets the cross road exactly.
      raw[0] = { x: start.x, y: start.y, z: start.z, wet: raw[0]!.wet }
      raw[raw.length - 1] = { x: goal.x, y: goal.y, z: goal.z, wet: raw[raw.length - 1]!.wet }
      let path = dedupePath(sampleOpenSpline(decimatePath(raw, ARTERIAL_WAYPOINT_STRIDE), ARTERIAL_STEP), 2)
      path = roundCorners(path, ARTERIAL_MIN_RADIUS, ARTERIAL_MAX_TURN)
      path = roundCorners(path, ARTERIAL_MIN_RADIUS, ARTERIAL_MAX_TURN)
      path = dedupePath(path, 0.05)
      if (path.length < 2) return null

      // The spline and the corner fillets move the path in plan while carrying
      // the nav grid's coarse cell heights along with them, so by here `y` is a
      // smoothed average of ground the road no longer runs over: it sails
      // across a dip instead of dropping through it. Take the height from the
      // ground under the finished path, the way a city street does, so the two
      // sit at the same level where they meet. Only the pinned ends keep their
      // height, since those have to meet the cross road where it stands.
      const heights = Float32Array.from(
        path.map((point, index) => {
          if (index === 0 || index === path.length - 1) return point.y
          const ground = sampleTerrain(field, point.x, point.z)
          const water = surfaceAt(point.x, point.z)
          return water.wet ? Math.max(water.level + ARTERIAL_BRIDGE_CLEARANCE, ground) : ground
        }),
      )
      limitSweepGrade(heights, path, MAX_ARTERIAL_GRADE)

      const structure = new Uint8Array(path.length - 1)
      const points: RoadPoint[] = path.map((point, index) => ({
        x: point.x,
        y: heights[index]!,
        z: point.z,
      }))
      for (let i = 0; i < structure.length; i++) {
        const wet =
          surfaceAt(points[i]!.x, points[i]!.z).wet || surfaceAt(points[i + 1]!.x, points[i + 1]!.z).wet
        structure[i] = wet ? ROAD_BRIDGE : ROAD_GRADE
      }
      return { points, structure }
    }

    /**
     * True when this road would leave `node` too close to the heading of one
     * already joined there. Two arterials parting at a sliver of an angle run
     * along each other rather than making a junction anyone can read.
     */
    const sharpAt = (node: number, points: RoadPoint[], fromStart: boolean): boolean => {
      const heading = leavingDirection(points, fromStart)
      for (let k = 0; k < roads.length; k++) {
        const [from, to] = endpoints[k]!
        if (from !== node && to !== node) continue
        const other = leavingDirection(roads[k]!.points, from === node)
        const apart = Math.acos(
          Math.min(Math.max(heading.x * other.x + heading.z * other.z, -1), 1),
        )
        if (apart < ARTERIAL_MIN_JUNCTION_ANGLE) return true
      }
      return false
    }

    const unusable = (candidate: { points: RoadPoint[] }): boolean =>
      clashesWithBuilt(candidate.points, obstacles, ARTERIAL_MERGE_REACH) ||
      sharpAt(a, candidate.points, true) ||
      sharpAt(b, candidate.points, false)

    const startCell = cellAt(grid, start.x, start.z)
    const goalCell = cellAt(grid, goal.x, goal.z)
    let cells = routeCells(grid, buffers, startCell, goalCell, label, density, block, !relaxed, a, b)
    if (cells === null) return false
    let road = makeRoad(cells)
    if (road === null) return false

    // A route that runs into a road already on the map is retried with those
    // cells blocked, so arterials merge into junctions instead of colliding.
    const touched: number[] = []
    for (let attempt = 0; attempt < 4 && road !== null && unusable(road); attempt++) {
      for (const index of cells) {
        if (block[index] === 0) touched.push(index)
        block[index] = 1
      }
      const retry = routeCells(grid, buffers, startCell, goalCell, label, density, block, !relaxed, a, b)
      if (retry === null) {
        road = null
        break
      }
      cells = retry
      road = makeRoad(cells)
    }
    for (const index of touched) block[index] = 0
    if (road === null || unusable(road)) return false

    for (const index of cells) density[index] = density[index]! + 1
    const built: Road = {
      id: id++,
      kind: 'arterial',
      closed: false,
      width: ARTERIAL_WIDTH,
      points: road.points,
      structure: road.structure,
    }
    roads.push(built)
    obstacles.push(built)
    endpoints.push([a, b])
    degree[a]!++
    degree[b]!++
    return true
  }

  for (const [a, b] of edges) {
    tried.add(a < b ? a * nodes.length + b : b * nodes.length + a)
    buildRoad(a, b)
  }

  // Any node the router left with fewer than two roads gets another, where the
  // terrain allows. Whatever is still a dead end is pruned below.
  for (let i = 0; i < nodes.length && roads.length < ARTERIAL_MAX_COUNT * 2; i++) {
    let attempts = 0
    while (degree[i]! < 2 && attempts < 12) {
      const j = nearestUntried(nodes, i, tried)
      if (j < 0) break
      attempts++
      tried.add(i < j ? i * nodes.length + j : j * nodes.length + i)
      buildRoad(i, j, true)
    }
  }

  // Prune dangling branches, and any road whose smoothing left a sharp knot,
  // until every remaining road joins two others and runs clean. What is left is
  // a network of loops, so there are no dead ends and no stray spikes.
  const alive = new Array<boolean>(roads.length).fill(true)
  for (;;) {
    const join = new Array<number>(nodes.length).fill(0)
    for (let i = 0; i < roads.length; i++) {
      if (!alive[i]) continue
      join[endpoints[i]![0]]!++
      join[endpoints[i]![1]]!++
    }
    let pruned = false
    for (let i = 0; i < roads.length; i++) {
      if (!alive[i]) continue
      const [a, b] = endpoints[i]!
      // A leaf at a cross road end is fine: the cross road is its second link.
      const leafA = join[a] === 1 && nodes[a]!.cross < 0
      const leafB = join[b] === 1 && nodes[b]!.cross < 0
      if (leafA || leafB || sharpestTurn(roads[i]!.points) > ARTERIAL_PRUNE_TURN) {
        alive[i] = false
        pruned = true
      }
    }
    if (!pruned) break
  }
  return roads.filter((_, index) => alive[index]!)
}
