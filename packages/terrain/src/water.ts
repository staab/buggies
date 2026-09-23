import * as exact from '@buggies/physics'
import { RIVER_BANK_LAP } from './rivers.ts'
import type { Heightfield, TerrainMap } from './types.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

/** The level reported where no water reaches. Below every possible surface. */
export const DRY = Number.NEGATIVE_INFINITY

/**
 * The water surface over every cell of the map — sea, lakes and the full drawn
 * width of every river — at the highest level drawn there. Rivers are stamped
 * over their rendered footprint rather than their centreline: a wide river
 * covers cells no sample sits on, and reading only the centreline makes those
 * cells look dry.
 */
export function buildWaterLevels(map: TerrainMap): Float32Array {
  const { heightfield, seaLevel, rivers, lakes } = map
  const { width, depth, cellSize, heights } = heightfield
  const levels = new Float32Array(width * depth).fill(DRY)

  for (let cell = 0; cell < levels.length; cell++) {
    if (heights[cell]! <= seaLevel) levels[cell] = seaLevel
  }
  for (const lake of lakes) {
    for (const cell of lake.cells) levels[cell] = Math.max(levels[cell]!, lake.level)
  }
  for (const river of rivers) {
    for (const point of river.points) {
      const reach = (point.width / 2) * (1 + RIVER_BANK_LAP)
      const minCol = Math.max(Math.floor((point.x - reach) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((point.x + reach) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((point.z - reach) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((point.z + reach) / cellSize), depth - 1)
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (hypot(col * cellSize - point.x, row * cellSize - point.z) > reach) continue
          const cell = row * width + col
          if (point.y > levels[cell]!) levels[cell] = point.y
        }
      }
    }
  }
  return levels
}

/** Water surface at a world-space point, or `DRY` where the ground is dry. */
export function waterLevelAt(field: Heightfield, levels: Float32Array, x: number, z: number): number {
  const col = Math.min(Math.max(Math.round(x / field.cellSize), 0), field.width - 1)
  const row = Math.min(Math.max(Math.round(z / field.cellSize), 0), field.depth - 1)
  return levels[row * field.width + col] ?? DRY
}
