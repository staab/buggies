import type { Heightfield } from '../types.ts'
import type { Vec2 } from './geometry.ts'

/**
 * Reading the terrain under a road, and nudging points inland off the water.
 */

/** Bilinear ground height at a world-space point. */
export function sampleTerrain(field: Heightfield, x: number, z: number): number {
  const { width, depth, cellSize, heights } = field
  const gx = Math.min(Math.max(x / cellSize, 0), width - 1)
  const gz = Math.min(Math.max(z / cellSize, 0), depth - 1)
  const col = Math.floor(gx)
  const row = Math.floor(gz)
  const col1 = Math.min(col + 1, width - 1)
  const row1 = Math.min(row + 1, depth - 1)
  const tx = gx - col
  const tz = gz - row

  const top = heights[row * width + col]! * (1 - tx) + heights[row * width + col1]! * tx
  const bottom = heights[row1 * width + col]! * (1 - tx) + heights[row1 * width + col1]! * tx
  return top * (1 - tz) + bottom * tz
}

/** Slide a point toward an anchor until it stands on dry land. */
export function pullInland(
  x: number,
  z: number,
  anchorX: number,
  anchorZ: number,
  field: Heightfield,
  seaLevel: number,
): Vec2 {
  for (let i = 0; i < 16; i++) {
    if (sampleTerrain(field, x, z) > seaLevel) break
    x += (anchorX - x) * 0.25
    z += (anchorZ - z) * 0.25
  }
  return { x, z }
}

/** Slide any point of a loop that sits in water toward the given anchor. */
export function pullAllInland(
  points: Vec2[],
  anchorX: number,
  anchorZ: number,
  field: Heightfield,
  seaLevel: number,
): Vec2[] {
  for (const point of points) {
    if (sampleTerrain(field, point.x, point.z) <= seaLevel) {
      const inland = pullInland(point.x, point.z, anchorX, anchorZ, field, seaLevel)
      point.x = inland.x
      point.z = inland.z
    }
  }
  return points
}
