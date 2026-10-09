/**
 * Water on a planet's own ground: where rain runs off every grid point of
 * the cube-sphere, the basins it fills into lakes, and the rivers from
 * springs on the mountains down to the sea. Faces are crossed as though
 * there were no seams, and the only way out is the sea.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { arcDistance, gridDirection, gridPlace, groundIndex, type GridPlace, type SphereGround } from './sphere.ts'
import { triangleInradius } from './mountain.ts'
import type { SphereMountain } from './sphere-heights.ts'

/** Every grid point's way out from the middle, three numbers a point. */
export function groundDirections(ground: SphereGround): Float64Array {
  const { n } = ground
  const directions = new Float64Array(ground.heights.length * 3)
  const direction = { x: 0, y: 0, z: 0 }
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        gridDirection(n, face, i, j, direction)
        const at = groundIndex(ground, face, i, j) * 3
        directions[at] = direction.x
        directions[at + 1] = direction.y
        directions[at + 2] = direction.z
      }
    }
  }
  return directions
}

/** How many neighbors a grid point keeps room for: the eight round it. */
const NEIGHBORS = 8

/**
 * The eight grid points round each one, -1 where there is none. Off a
 * face's edge they are found on the next face, by carrying the step on past
 * the edge and seeing where that way out meets the cube.
 */
export function groundNeighbors(ground: SphereGround): Int32Array {
  const { n } = ground
  const neighbors = new Int32Array(ground.heights.length * NEIGHBORS).fill(-1)
  const direction = { x: 0, y: 0, z: 0 }
  const place: GridPlace = { face: 0, i: 0, j: 0 }
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const at = groundIndex(ground, face, i, j)
        let k = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue
            const ni = i + di
            const nj = j + dj
            let next: number
            if (ni >= 0 && ni <= n && nj >= 0 && nj <= n) {
              next = groundIndex(ground, face, ni, nj)
            } else {
              gridPlace(n, gridDirection(n, face, ni, nj, direction), place)
              next = groundIndex(ground, place.face, Math.min(Math.max(Math.round(place.i), 0), n), Math.min(Math.max(Math.round(place.j), 0), n))
            }
            if (next !== at) neighbors[at * NEIGHBORS + k] = next
            k++
          }
        }
      }
    }
  }
  return neighbors
}

/** Where water goes on a planet's ground: the surface it stands at, and the grid point each one drains to. */
export interface SphereFlow {
  /** The water's surface at each grid point once every basin is filled to its brim: never below the ground or the sea. */
  readonly filled: Float32Array
  /** The grid point each drains to, or -1 where it is the sea. */
  readonly flow: Int32Array
}

/**
 * Fill every basin and route every grid point downhill, by a priority flood
 * out from the sea: starting from the deepest sea floor, each point reached
 * is raised to the level it spills over at, and drains to the point it was
 * reached from. Every point on land has a way down to the sea.
 */
export function routeSphereFlow(ground: SphereGround, neighbors: Int32Array, seaLevel: number): SphereFlow {
  const { heights } = ground
  const count = heights.length
  const filled = new Float32Array(count)
  const flow = new Int32Array(count).fill(-1)
  const visited = new Uint8Array(count)
  const heap = new MinHeap(filled)
  let deepest = 0
  for (let at = 1; at < count; at++) if (heights[at]! < heights[deepest]!) deepest = at
  visited[deepest] = 1
  filled[deepest] = Math.max(heights[deepest]!, seaLevel)
  heap.push(deepest)
  for (let at = heap.pop(); at >= 0; at = heap.pop()) {
    for (let k = 0; k < NEIGHBORS; k++) {
      const next = neighbors[at * NEIGHBORS + k]!
      if (next < 0 || visited[next]) continue
      visited[next] = 1
      filled[next] = Math.max(heights[next]!, filled[at]!)
      if (heights[next]! > seaLevel) flow[next] = at
      heap.push(next)
    }
  }
  return { filled, flow }
}

/** A lake on a planet's ground: the level it stands at, and the grid points under it. */
export interface SphereLake {
  readonly level: number
  readonly points: number[]
}

/** Every basin on the land the flood filled: grid points next to each other where the water stands over the ground. */
export function findSphereLakes(ground: SphereGround, neighbors: Int32Array, routing: SphereFlow, seaLevel: number): SphereLake[] {
  const { heights } = ground
  const { filled } = routing
  const visited = new Uint8Array(heights.length)
  const flooded = (at: number): boolean => heights[at]! > seaLevel && filled[at]! - heights[at]! > 1e-3
  const lakes: SphereLake[] = []
  const stack: number[] = []
  for (let start = 0; start < heights.length; start++) {
    if (visited[start] || !flooded(start)) continue
    const points: number[] = []
    let level = -Infinity
    visited[start] = 1
    stack.push(start)
    for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
      points.push(at)
      level = Math.max(level, filled[at]!)
      for (let k = 0; k < NEIGHBORS; k++) {
        const next = neighbors[at * NEIGHBORS + k]!
        if (next < 0 || visited[next] || !flooded(next)) continue
        visited[next] = 1
        stack.push(next)
      }
    }
    lakes.push({ level, points })
  }
  return lakes
}

/** A point along a river on a planet: its way out, its water's surface over the planet's radius, and how wide it runs, in meters. */
export interface SphereRiverPoint {
  readonly direction: Vec3
  readonly level: number
  readonly width: number
}

/** Headwaters start almost thread-thin and widen as the river descends, in river cells. */
const MIN_WIDTH = 0.8
const MAX_WIDTH = 6.5
/** Springs sit this fraction of the mountain's rise below the summit. */
const SOURCE_DROP = 0.5

/**
 * A spring partway down a mountain rather than at its summit: the grid
 * point nearest half its rise, on land, not already a spring.
 */
function findSphereSource(
  ground: SphereGround,
  directions: Float64Array,
  mountain: SphereMountain,
  seaLevel: number,
  least: number,
  used: Set<number>,
): number {
  const { heights, radius } = ground
  const core = Math.max(triangleInradius(mountain.triangle), least)
  const reach = core + Math.max(mountain.skirt, least * (20 / 15))
  const near = exact.cos(reach / radius)
  const within: number[] = []
  const direction = { x: 0, y: 0, z: 0 }
  let summit = -Infinity
  for (let at = 0; at < heights.length; at++) {
    const d = at * 3
    if (directions[d]! * mountain.center.x + directions[d + 1]! * mountain.center.y + directions[d + 2]! * mountain.center.z < near) continue
    if (used.has(at) || heights[at]! <= seaLevel) continue
    direction.x = directions[d]!
    direction.y = directions[d + 1]!
    direction.z = directions[d + 2]!
    const distance = arcDistance(direction, mountain.center, radius)
    if (distance > reach) continue
    within.push(at)
    if (distance <= core) summit = Math.max(summit, heights[at]!)
  }
  if (summit === -Infinity) return -1
  const target = summit - mountain.height * SOURCE_DROP
  let best = -1
  let bestScore = Infinity
  for (const at of within) {
    const score = Math.abs(heights[at]! - target)
    if (score < bestScore) {
      bestScore = score
      best = at
    }
  }
  return best
}

/** From a spring down the routed way to the sea, widening as it drops. */
function traceSphereCourse(ground: SphereGround, directions: Float64Array, routing: SphereFlow, source: number, seaLevel: number, cell: number): SphereRiverPoint[] {
  const { heights } = ground
  const { filled, flow } = routing
  const top = filled[source]!
  const drop = Math.max(top - seaLevel, 1e-3)
  const points: SphereRiverPoint[] = []
  let at = source
  for (let step = 0; step < heights.length; step++) {
    const level = filled[at]!
    const progress = Math.min(Math.max((top - level) / drop, 0), 1)
    points.push({
      direction: { x: directions[at * 3]!, y: directions[at * 3 + 1]!, z: directions[at * 3 + 2]! },
      level,
      width: (MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * progress) * cell,
    })
    if (heights[at]! <= seaLevel) break
    const next = flow[at]!
    if (next < 0 || next === at) break
    at = next
  }
  return points
}

/**
 * One river from a spring on each mountain given, down to the sea, `count`
 * at most. `cell` is how wide a river cell is, in meters, which the
 * rivers' widths go by; `least` the smallest core a mountain is
 * searched for its spring in.
 */
export function traceSphereRivers(
  ground: SphereGround,
  directions: Float64Array,
  routing: SphereFlow,
  mountains: readonly SphereMountain[],
  count: number,
  seaLevel: number,
  cell: number,
  least: number,
): SphereRiverPoint[][] {
  const rivers: SphereRiverPoint[][] = []
  const used = new Set<number>()
  for (const mountain of mountains) {
    if (rivers.length >= count) break
    const source = findSphereSource(ground, directions, mountain, seaLevel, least, used)
    if (source < 0) continue
    used.add(source)
    const points = traceSphereCourse(ground, directions, routing, source, seaLevel, cell)
    if (points.length > 1) rivers.push(points)
  }
  return rivers
}

/** A binary heap of grid points, lowest water first, ties by index, so the flood is the same every time. */
class MinHeap {
  private readonly items: number[] = []
  constructor(private readonly key: Float32Array) {}

  private less(a: number, b: number): boolean {
    const difference = this.key[a]! - this.key[b]!
    return difference !== 0 ? difference < 0 : a < b
  }

  push(item: number): void {
    const { items } = this
    items.push(item)
    let at = items.length - 1
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (!this.less(item, items[parent]!)) break
      items[at] = items[parent]!
      at = parent
    }
    items[at] = item
  }

  /** The lowest, or -1 once there are none. */
  pop(): number {
    const { items } = this
    const last = items.pop()
    if (last === undefined) return -1
    const top = items[0]
    if (top === undefined) return last
    const length = items.length
    let at = 0
    for (;;) {
      const left = at * 2 + 1
      if (left >= length) break
      const right = left + 1
      const child = right < length && this.less(items[right]!, items[left]!) ? right : left
      if (!this.less(items[child]!, last)) break
      items[at] = items[child]!
      at = child
    }
    items[at] = last
    return top
  }
}
