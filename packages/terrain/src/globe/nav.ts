/**
 * The grid roads are routed over on a planet: a coarse copy of its
 * cube-sphere, each point knowing the ground under it and whether it is
 * wet, and a search for the cheapest way from one point to another, or to
 * any of several, over it.
 */

import type { Vec3 } from '@buggies/physics'

import { DRY } from '../world.ts'
import { createSphereGround, gridPlace, groundIndex, sphereHeight, type GridPlace, type SphereGround } from '../sphere.ts'
import { groundDirections, groundNeighbors } from '../sphere-water.ts'

/** How many cells a side each face of the routing grid has: about ten meters a cell on a 600 m planet. */
const NAV_CELLS = 96

export interface Nav {
  readonly grid: SphereGround
  readonly neighbors: Int32Array
  readonly directions: Float64Array
  /** The ground at each point, over the planet's radius. */
  readonly ground: Float32Array
  /** The water's surface at each point, or `DRY`. */
  readonly water: Float32Array
  /** Whether each point is under the sea. */
  readonly sea: Uint8Array
}

/**
 * The routing grid over a planet's ground: the ground at each point read off
 * the planet's own, and the water as the fine grid has it at the nearest of
 * its points.
 */
export function buildNav(ground: SphereGround, water: Float32Array, seaLevel: number): Nav {
  const grid = createSphereGround(NAV_CELLS, ground.radius)
  const neighbors = groundNeighbors(grid)
  const directions = groundDirections(grid)
  const count = grid.heights.length
  const heights = new Float32Array(count)
  const levels = new Float32Array(count)
  const sea = new Uint8Array(count)
  const place: GridPlace = { face: 0, i: 0, j: 0 }
  const direction = { x: 0, y: 0, z: 0 }
  for (let at = 0; at < count; at++) {
    direction.x = directions[at * 3]!
    direction.y = directions[at * 3 + 1]!
    direction.z = directions[at * 3 + 2]!
    heights[at] = sphereHeight(ground, direction)
    gridPlace(ground.n, direction, place)
    levels[at] = water[groundIndex(ground, place.face, Math.round(place.i), Math.round(place.j))] ?? DRY
    sea[at] = heights[at]! <= seaLevel ? 1 : 0
  }
  return { grid, neighbors, directions, ground: heights, water: levels, sea }
}

/** The way out from the planet's middle through a routing point. */
export function navDirection(nav: Nav, at: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = nav.directions[at * 3]!
  out.y = nav.directions[at * 3 + 1]!
  out.z = nav.directions[at * 3 + 2]!
  return out
}

const place: GridPlace = { face: 0, i: 0, j: 0 }

/** The routing point nearest a point. */
export function navPoint(nav: Nav, point: Vec3): number {
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1
  gridPlace(nav.grid.n, { x: point.x / length, y: point.y / length, z: point.z / length }, place)
  return groundIndex(nav.grid, place.face, Math.round(place.i), Math.round(place.j))
}

/** How far apart two routing points are, straight through, on the planet's radius. */
export function navApart(nav: Nav, a: number, b: number): number {
  const { directions } = nav
  const dx = directions[a * 3]! - directions[b * 3]!
  const dy = directions[a * 3 + 1]! - directions[b * 3 + 1]!
  const dz = directions[a * 3 + 2]! - directions[b * 3 + 2]!
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * nav.grid.radius
}

/** What a step from one routing point to the next costs, how far it runs, or `Infinity` where it may not be taken. */
export type StepCost = (from: number, to: number, run: number) => number

/**
 * The cheapest way over the routing grid from a point to the goal, or to
 * the nearest of `goals` where those are given: every point on the way, or
 * `null` where there is none within `most` expansions.
 */
export function route(nav: Nav, start: number, goal: number, cost: StepCost, goals: Uint8Array | null = null, most = 200_000): number[] | null {
  const count = nav.ground.length
  const best = new Float64Array(count).fill(Infinity)
  const from = new Int32Array(count).fill(-1)
  const closed = new Uint8Array(count)
  const priority = new Float64Array(count).fill(Infinity)
  const open: number[] = []
  const push = (index: number): void => {
    open.push(index)
    let child = open.length - 1
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (priority[open[parent]!]! < priority[open[child]!]! || (priority[open[parent]!] === priority[open[child]!] && open[parent]! < open[child]!)) break
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
  const heuristic = (at: number): number => (goals !== null ? 0 : navApart(nav, at, goal))
  best[start] = 0
  priority[start] = heuristic(start)
  push(start)
  let expanded = 0
  while (open.length > 0) {
    if (++expanded > most) return null
    const current = pop()
    if (current === goal || (goals !== null && goals[current] === 1)) {
      const path: number[] = []
      for (let at = current; at !== -1; at = from[at]!) path.push(at)
      return path.reverse()
    }
    if (closed[current]) continue
    closed[current] = 1
    for (let k = 0; k < 8; k++) {
      const next = nav.neighbors[current * 8 + k]!
      if (next < 0 || closed[next]) continue
      const run = navApart(nav, current, next)
      const step = cost(current, next, run)
      if (!Number.isFinite(step)) continue
      const tentative = best[current]! + step
      if (tentative >= best[next]!) continue
      best[next] = tentative
      from[next] = current
      priority[next] = tentative + heuristic(next)
      push(next)
    }
  }
  return null
}
