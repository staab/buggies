import { vec3, type Vec3 } from '@buggies/physics'

import type { Heightfield } from './types.ts'

export function flatHeightfield(width: number, depth: number, cellSize = 1, height = 0): Heightfield {
  const heights = new Float32Array(width * depth)
  heights.fill(height)
  return { width, depth, cellSize, heights }
}

function index(field: Heightfield, x: number, z: number): number {
  const clampedX = Math.min(Math.max(x, 0), field.width - 1)
  const clampedZ = Math.min(Math.max(z, 0), field.depth - 1)
  return clampedZ * field.width + clampedX
}

/** Ground height at grid coordinates, clamped to the field edges. */
export function heightAt(field: Heightfield, x: number, z: number): number {
  return field.heights[index(field, x, z)] ?? 0
}

/** Ground height at a world-space position. */
export function groundHeight(field: Heightfield, position: Vec3): number {
  return heightAt(field, Math.floor(position.x / field.cellSize), Math.floor(position.z / field.cellSize))
}

/** World-space position of a point resting on the ground. */
export function onGround(field: Heightfield, position: Vec3): Vec3 {
  return vec3(position.x, groundHeight(field, position), position.z)
}

/**
 * Bilinear ground height at a world-space point. The ground is drawn as an
 * interpolated mesh, so anything driving on it has to read it the same way or
 * it rides a staircase of cell-sized steps.
 */
export function sampleHeight(field: Heightfield, x: number, z: number): number {
  const { width, depth, cellSize, heights } = field
  const gx = Math.min(Math.max(x / cellSize, 0), width - 1)
  const gz = Math.min(Math.max(z / cellSize, 0), depth - 1)
  const col = Math.floor(gx)
  const row = Math.floor(gz)
  const col1 = Math.min(col + 1, width - 1)
  const row1 = Math.min(row + 1, depth - 1)
  const tx = gx - col
  const tz = gz - row

  // The column and row are clamped into the field, so all four corners are there.
  const top = heights[row * width + col]! * (1 - tx) + heights[row * width + col1]! * tx
  const bottom = heights[row1 * width + col]! * (1 - tx) + heights[row1 * width + col1]! * tx
  return top * (1 - tz) + bottom * tz
}
