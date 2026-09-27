import type { Heightfield } from './types.ts'

/** A level heightfield, this many cells across and down, this big a cell, all at one height: a test ground for the physics. */
export function flatHeightfield(width: number, depth: number, cellSize = 1, height = 0): Heightfield {
  const heights = new Float32Array(width * depth)
  heights.fill(height)
  return { width, depth, cellSize, heights }
}
