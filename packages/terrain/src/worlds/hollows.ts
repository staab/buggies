/**
 * Rooms closed in under a roof: a dome standing on the ground, a tube
 * laid along it or bored through rock, a cavern hollowed out of it. Each is
 * cut the same way, as a floor and a roof over every grid point of the
 * ground, so whatever is made of them is driven on, drawn and placed on by
 * the ground's own grid: the ground is its floor, and the world's `roof`
 * is what closes it in.
 *
 * Across a hollow, from its middle line out to its edge, the floor sinks
 * and the roof rises by a superellipse: an ellipse where its squareness is
 * 2, and flatter floored and steeper walled the squarer it is. At the edge
 * the two meet; round the edge a seam of the ground's grid has them meet
 * too, so the roof comes down onto the floor there with no gap; past that
 * the world is open, or, in a world of solid rock, the roof lies on the
 * ground everywhere.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { angleBetween, unit } from '../globe/lines.ts'
import { eachPointNear, nearestPoint, type Land } from '../globe/placing.ts'
import type { SphereGround } from '../sphere.ts'

/** What a hollow is: a room standing on the ground with a roof over it, or one cut into the rock round its middle. */
export type HollowKind = 'shell' | 'bore'

export interface Hollow {
  readonly kind: HollowKind
  /** The line along its middle, ways out: one point for a round room, two or more for a tube. */
  readonly line: readonly Vec3[]
  /** How high its middle stands over the radius at each point of its line: a bore's, from which its floor sinks and its roof rises. */
  readonly middle: readonly number[]
  /** How far it reaches out from its line along the ground: the same all along, or at each point of its line. */
  readonly reach: number | readonly number[]
  /** How high its roof rises over its middle, or over the ground for a shell: the same all along, or at each point of its line. */
  readonly above: number | readonly number[]
  /** How deep a bore's floor sinks under its middle. */
  readonly below: number
  /**
   * How round a bore's floor is at each point of its line: 1 for its
   * superellipse, sinking from the walls to its lowest at the middle, down
   * to 0 for flat right across at that lowest, as a tunnel's mouth is
   * where it opens onto a floor. Round all along where not given.
   */
  readonly round?: readonly number[]
  /** How square it is across: 2 for an ellipse. */
  readonly squareness: number
  /** Whether a tube's first and last ends are open: nothing seals the ground past an open end. */
  readonly open?: readonly [boolean, boolean]
}

/** How far round a hollow's edge the roof is brought down onto the floor: past a cell's diagonal, so no cell along the edge is left open. */
const SEAM = 1.6

/** How high over its floor a roof must be for there to be room under it. */
export const ROOM_LEAST = 2

const { exp, log } = exact

/** A number to a power, by the exact exp and log, so every machine raises it the same. */
function power(x: number, y: number): number {
  return x <= 0 ? 0 : exp(y * log(x))
}

/** The height of a superellipse of this squareness, 1 at its middle, this share of the way out. */
export function profile(share: number, squareness: number): number {
  if (share >= 1) return 0
  return power(1 - power(share, squareness), 1 / squareness)
}

/** Where a way out lies against a piece of a line: how far along it, 0 to 1 within it, and how far from it along the ground. */
function against(p: Vec3, a: Vec3, b: Vec3, radius: number): { t: number; distance: number } {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const vz = b.z - a.z
  const length = vx * vx + vy * vy + vz * vz
  if (length < 1e-18) return { t: 0, distance: angleBetween(p, a) * radius }
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy + (p.z - a.z) * vz) / length
  const held = Math.min(Math.max(t, 0), 1)
  const nearest = unit({ x: a.x + vx * held, y: a.y + vy * held, z: a.z + vz * held })
  return { t, distance: angleBetween(p, nearest) * radius }
}

/**
 * Hollow out a world's ground: a bore's floor cut into it, and the roof
 * over every hollow, brought down onto the ground round each. Where
 * `solid`, the world is rock outside its hollows, its roof on its ground.
 * Returns the roof, `NaN` wherever it is open.
 */
export function hollowOut(land: Land, hollows: readonly Hollow[], solid: boolean): Float32Array {
  const { ground } = land
  const heights = ground.heights
  const count = heights.length
  const cell = (land.radius * Math.PI) / 2 / ground.n
  const seam = cell * SEAM
  const floors = new Float32Array(count).fill(Infinity)
  const roofs = new Float32Array(count).fill(-Infinity)
  const seamOff = new Float32Array(count).fill(Infinity)
  const seamAt = new Float32Array(count)
  for (const hollow of hollows) {
    const { line, middle, reach, above, below, squareness } = hollow
    const pieces = Math.max(line.length - 1, 1)
    // This hollow's own floor and roof at each point, as the piece of its line nearest the point has them:
    // on a slope, a piece further along would cut under the floor by as much as it is lower.
    const own = new Map<number, { distance: number; floor: number; roof: number }>()
    for (let k = 0; k < pieces; k++) {
      const a = line[k]!
      const b = line[Math.min(k + 1, line.length - 1)]!
      const middleA = middle[k]!
      const middleB = middle[Math.min(k + 1, line.length - 1)]!
      const roundA = hollow.round?.[k] ?? 1
      const roundB = hollow.round?.[Math.min(k + 1, line.length - 1)] ?? 1
      const topA = typeof above === 'number' ? above : above[k]!
      const topB = typeof above === 'number' ? above : above[Math.min(k + 1, line.length - 1)]!
      const reachA = typeof reach === 'number' ? reach : reach[k]!
      const reachB = typeof reach === 'number' ? reach : reach[Math.min(k + 1, line.length - 1)]!
      const center = unit({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
      const span = (angleBetween(a, b) * land.radius) / 2
      eachPointNear(land, center, span + Math.max(reachA, reachB) + seam, (at, p) => {
        const { t, distance } = against(p, a, b, land.radius)
        // Past an open end there is nothing of the tube: not even its seam.
        if ((k === 0 && t < 0 && hollow.open?.[0]) || (k === pieces - 1 && t > 1 && hollow.open?.[1])) return
        const held = Math.min(Math.max(t, 0), 1)
        const level = hollow.kind === 'bore' ? middleA + (middleB - middleA) * held : heights[at]!
        const out = reachA + (reachB - reachA) * held
        if (distance < out) {
          const rise = profile(distance / out, squareness)
          const round = roundA + (roundB - roundA) * held
          const top = topA + (topB - topA) * held
          const floor = hollow.kind === 'bore' ? level - below * (1 - round + round * rise) : level
          const known = own.get(at)
          if (known === undefined || distance < known.distance) own.set(at, { distance, floor, roof: level + top * rise })
        } else if (distance - out < seamOff[at]! && distance < out + seam) {
          seamOff[at] = distance - out
          seamAt[at] = level
        }
      })
    }
    for (const [at, { floor, roof }] of own) {
      floors[at] = Math.min(floors[at]!, floor)
      roofs[at] = Math.max(roofs[at]!, roof)
    }
  }
  const roof = new Float32Array(count).fill(Number.NaN)
  for (let at = 0; at < count; at++) {
    if (roofs[at]! > -Infinity) {
      heights[at] = floors[at]!
      roof[at] = roofs[at]!
    } else if (seamOff[at]! < Infinity) {
      heights[at] = seamAt[at]!
      roof[at] = seamAt[at]!
    } else if (solid) roof[at] = heights[at]!
  }
  return roof
}

/** The roof's height over the radius at the grid point nearest a way out: `NaN` where it is open. */
export function roofNear(ground: SphereGround, roof: Float32Array, p: Vec3): number {
  return roof[nearestPoint(ground, p)]!
}

/** Whether a grid point has room under its roof: open to the sky, or closed in with space between floor and roof. */
export function roomAt(roof: Float32Array, heights: Float32Array, at: number): boolean {
  if (roof.length === 0) return true
  const over = roof[at]!
  return Number.isNaN(over) || over - heights[at]! >= ROOM_LEAST
}

/** Whether a grid point is shut in: the roof down on the ground there, with nothing between. */
export function sealedAt(roof: Float32Array, heights: Float32Array, at: number): boolean {
  if (roof.length === 0) return false
  const over = roof[at]!
  return !Number.isNaN(over) && over - heights[at]! < 1e-3
}

const solids = new WeakMap<Float32Array, boolean>()

/** Whether a world is solid rock outside its rooms: its roof is down on its ground wherever it is not over a room, and open nowhere. */
function solidRock(roof: Float32Array): boolean {
  const known = solids.get(roof)
  if (known !== undefined) return known
  const solid = roof.length > 0 && !roof.some(Number.isNaN)
  solids.set(roof, solid)
  return solid
}

/**
 * Whether a cell of the ground's grid is buried in rock, with nothing to
 * see or drive on: its roof down on its ground at every corner, in a world
 * of solid rock. Round the edge of a dome or a tube under open sky the
 * roof comes down on the ground just the same, but the ground there is
 * the open ground outside it.
 */
export function buriedCell(roof: Float32Array, heights: Float32Array, corners: readonly number[]): boolean {
  return solidRock(roof) && corners.every((at) => sealedAt(roof, heights, at))
}

/** Whether a grid point is under a roof at all. */
export function roofedAt(roof: Float32Array, at: number): boolean {
  return roof.length > 0 && !Number.isNaN(roof[at]!)
}
