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