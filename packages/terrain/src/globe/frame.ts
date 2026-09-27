/**
 * A small patch of a planet laid out flat: the plane touching it at a
 * middle, each point placed at its own distance from the middle along the
 * ground and in its own direction from it, so distances out from the
 * middle are exact and those across them stretch only a little, by the
 * angle over its sine: two parts in a hundred at 200 m on a 600 m planet.
 * For whatever is small enough to be built flat: an interchange.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { sphereHeight, type SphereGround } from '../sphere.ts'
import { tangentFrame } from '../sphere-heights.ts'
import type { Heightfield } from '../types.ts'

const { atan2, cos, sin } = exact

export interface Frame {
  readonly middle: Vec3
  readonly east: Vec3
  readonly north: Vec3
  readonly radius: number
}

/** The frame touching a planet this big at a way out from its middle. */
export function frameAt(middle: Vec3, radius: number): Frame {
  const length = Math.sqrt(middle.x * middle.x + middle.y * middle.y + middle.z * middle.z)
  const unit = { x: middle.x / length, y: middle.y / length, z: middle.z / length }
  const { east, north } = tangentFrame(unit)
  return { middle: unit, east, north, radius }
}

/** Where a point lies on a frame: meters east across it, and south down it, as a map is laid out. */
export function toFrame(frame: Frame, point: Vec3): { x: number; z: number } {
  const { middle, east, north, radius } = frame
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1
  const along = (point.x * middle.x + point.y * middle.y + point.z * middle.z) / length
  const e = (point.x * east.x + point.y * east.y + point.z * east.z) / length
  const n = (point.x * north.x + point.y * north.y + point.z * north.z) / length
  const aside = Math.sqrt(e * e + n * n)
  if (aside < 1e-12) return { x: 0, z: 0 }
  // How far round from the middle, laid out that far along the plane.
  const distance = atan2(aside, along) * radius
  return { x: (e / aside) * distance, z: -(n / aside) * distance }
}

/** The way out from the planet's middle through a point of a frame. */
export function fromFrame(frame: Frame, x: number, z: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const { middle, east, north, radius } = frame
  const distance = Math.sqrt(x * x + z * z)
  if (distance < 1e-9) {
    out.x = middle.x
    out.y = middle.y
    out.z = middle.z
    return out
  }
  const angle = distance / radius
  const c = cos(angle)
  const s = sin(angle) / distance
  // The way across is east by x and north by -z.
  out.x = middle.x * c + (east.x * x - north.x * z) * s
  out.y = middle.y * c + (east.y * x - north.y * z) * s
  out.z = middle.z * c + (east.z * x - north.z * z) * s
  return out
}

/** A point of a frame this high over the planet's radius. */
export function pointOnFrame(frame: Frame, x: number, z: number, height: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  fromFrame(frame, x, z, out)
  const r = frame.radius + height
  out.x *= r
  out.y *= r
  out.z *= r
  return out
}

/** How high a point stands over the planet's radius. */
export function heightOf(frame: Frame, point: Vec3): number {
  return Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) - frame.radius
}

/**
 * The planet's ground over a square of a frame, this far each way from its
 * middle, as a heightfield a flat builder can read: its corner at the
 * frame's `-reach`, so a frame point is `reach` on from the field's.
 */
export function fieldOnFrame(frame: Frame, ground: SphereGround, reach: number, cellSize: number): Heightfield {
  const size = Math.ceil((2 * reach) / cellSize) + 1
  const heights = new Float32Array(size * size)
  const direction = { x: 0, y: 0, z: 0 }
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      fromFrame(frame, col * cellSize - reach, row * cellSize - reach, direction)
      heights[row * size + col] = sphereHeight(ground, direction)
    }
  }
  return { width: size, depth: size, cellSize, heights }
}

