import { createRng, randomRange, type Rng } from '@buggies/physics'

import { computeFlowRouting, findLakes } from './flow.ts'
import { fbm2D, ridged2D, smoothstep } from './noise.ts'
import { distanceToSegment, ridgeSegment } from './ridge.ts'
import { traceRivers } from './rivers.ts'
import type { Heightfield, Lake, Ridge, River, TerrainMap, TerrainOptions } from './types.ts'

const DEFAULTS = {
  size: 769,
  cellSize: 1,
  seaLevel: 0,
  oceanDepth: 10,
} as const

/** Island extent as a fraction of the map, leaving a ring of open sea. */
const ISLAND_RADIUS_FRACTION = 0.31
/** Ridges keep a fixed world size so a bigger island means more land around them. */
const RIDGE_LENGTH = { min: 150, max: 280 } as const
const RIDGE_WIDTH = { min: 12, max: 20 } as const
const RIDGE_HEIGHT = { min: 26, max: 40 } as const
/** How much two crossing ridges reinforce each other, 0 = max, 1 = pure sum. */
const RIDGE_OVERLAP = 0.6
/** River channels are cut this deep below the water surface at their centre. */
const CHANNEL_DEPTH = 1.4
/** Upper bound on how far a channel may cut into a steep bank. */
const CHANNEL_MAX_INCISION = 5

function createRidges(rng: Rng, count: number, worldSize: number, islandRadius: number): Ridge[] {
  const center = worldSize / 2

  // All ridges share one massif centre so they always cross. The centre can sit
  // anywhere on the island, and the long crests run off toward the water.
  const massifAngle = randomRange(rng, 0, Math.PI * 2)
  const massifDistance = islandRadius * randomRange(rng, 0, 0.5)
  const massifX = center + Math.cos(massifAngle) * massifDistance
  const massifZ = center + Math.sin(massifAngle) * massifDistance

  const baseAngle = randomRange(rng, 0, Math.PI * 2)
  return Array.from({ length: count }, (_, i) => ({
    x: massifX,
    z: massifZ,
    // Spread the crests evenly so they cross instead of stacking up.
    angle: baseAngle + (i * Math.PI) / Math.max(count, 1) + randomRange(rng, -0.25, 0.25),
    length: randomRange(rng, RIDGE_LENGTH.min, RIDGE_LENGTH.max),
    width: randomRange(rng, RIDGE_WIDTH.min, RIDGE_WIDTH.max),
    height: randomRange(rng, RIDGE_HEIGHT.min, RIDGE_HEIGHT.max),
  }))
}

function buildHeights(
  field: Heightfield,
  seed: number,
  ridges: Ridge[],
  seaLevel: number,
  oceanDepth: number,
  islandRadius: number,
): void {
  const { width, depth, cellSize, heights } = field
  const center = (width * cellSize) / 2
  const plainsAmplitude = islandRadius * 0.02
  const domeHeight = islandRadius * 0.032

  // Frequencies are in world units, so terrain detail does not grow with the map.
  const baseFrequency = 0.018
  const ridgeFrequency = 0.03
  const warpFrequency = 0.006
  const warpAmplitude = islandRadius * 0.45
  const segments = ridges.map(ridgeSegment)

  for (let row = 0; row < depth; row++) {
    for (let col = 0; col < width; col++) {
      const x = col * cellSize
      const z = row * cellSize

      // Warp the radial falloff with two octaves so the coastline gets bays,
      // peninsulas and inlets rather than a wobbly circle.
      const warpX =
        (fbm2D(x * warpFrequency + 11.3, z * warpFrequency + 7.1, seed + 101, 4) - 0.5) +
        (fbm2D(x * warpFrequency * 3.7 + 5.1, z * warpFrequency * 3.7 + 2.3, seed + 131, 3) - 0.5) * 0.5
      const warpZ =
        (fbm2D(x * warpFrequency + 3.7, z * warpFrequency + 19.2, seed + 211, 4) - 0.5) +
        (fbm2D(x * warpFrequency * 3.7 + 9.4, z * warpFrequency * 3.7 + 13.8, seed + 241, 3) - 0.5) * 0.5
      const distance = Math.hypot(x - center + warpX * warpAmplitude, z - center + warpZ * warpAmplitude)
      const mask = 1 - smoothstep(islandRadius * 0.55, islandRadius, distance)

      const base = fbm2D(x * baseFrequency, z * baseFrequency, seed + 1, 5)
      const roughness = ridged2D(x * ridgeFrequency, z * ridgeFrequency, seed + 2, 5)
      // A gentle central dome keeps water draining outward to the sea instead
      // of pooling into giant interior basins.
      const dome = 1 - smoothstep(0, islandRadius * 0.85, distance)
      const land = base * plainsAmplitude + domeHeight * dome

      let mountain = 0
      for (let i = 0; i < ridges.length; i++) {
        const ridge = ridges[i]!
        const segment = segments[i]!
        const { distance: across, along } = distanceToSegment(x, z, segment)
        const cross = Math.exp(-(across * across) / (2 * ridge.width * ridge.width))
        const taper = smoothstep(0, 0.18, along) * smoothstep(1, 0.82, along)
        // Tilt so one end of the crest is higher than the other.
        const tilt = 0.35 + 0.65 * along
        const contribution = ridge.height * cross * taper * tilt * (0.55 + 0.45 * roughness)

        // Combine additively at crossings, but damped, so the intersection
        // forms a higher massif without doubling into a spike.
        const high = Math.max(mountain, contribution)
        const low = Math.min(mountain, contribution)
        mountain = high + RIDGE_OVERLAP * low
      }

      const cell = row * width + col
      heights[cell] = (land + mountain) * mask - oceanDepth * (1 - mask)
    }
  }
}

function riverCellSet(rivers: River[], width: number, depth: number, cellSize: number): Set<number> {
  const cells = new Set<number>()
  for (const river of rivers) {
    for (const point of river.points) {
      const col = Math.min(Math.max(Math.floor(point.x / cellSize), 0), width - 1)
      const row = Math.min(Math.max(Math.floor(point.z / cellSize), 0), depth - 1)
      cells.add(row * width + col)
    }
  }
  return cells
}

/**
 * Keep only pools that are a genuine part of a river: large and deep enough to
 * read as water, and actually traversed by a river. This stops the map filling
 * up with disconnected puddles that go nowhere.
 */
function selectLakes(
  field: Heightfield,
  lakes: Lake[],
  rivers: River[],
  minCells: number,
  minDepth: number,
): Lake[] {
  const traversed = riverCellSet(rivers, field.width, field.depth, field.cellSize)
  return lakes
    .filter((lake) => {
      if (lake.cells.length < minCells) return false
      let lowest = Infinity
      for (const cell of lake.cells) lowest = Math.min(lowest, field.heights[cell]!)
      if (lake.level - lowest < minDepth) return false
      return lake.cells.some((cell) => traversed.has(cell))
    })
    .map((lake, id) => ({ ...lake, id }))
}

/**
 * Cut a shallow channel along each river so the water ribbon sits in a groove
 * rather than clipping through terrain. Without this the flat ribbon vanishes
 * behind convex ground on steep sections, leaving the river looking broken.
 */
function carveRiverChannels(field: Heightfield, rivers: River[]): void {
  const { width, depth, cellSize, heights } = field

  for (const river of rivers) {
    for (const point of river.points) {
      const radius = point.width / 2 + 2 * cellSize
      const minCol = Math.max(Math.floor((point.x - radius) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((point.x + radius) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((point.z - radius) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((point.z + radius) / cellSize), depth - 1)

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const distance = Math.hypot(col * cellSize - point.x, row * cellSize - point.z)
          if (distance > radius) continue
          const falloff = 1 - distance / radius
          const cell = row * width + col
          const bed = Math.max(
            point.y - CHANNEL_DEPTH * falloff,
            heights[cell]! - CHANNEL_MAX_INCISION,
          )
          if (bed < heights[cell]!) heights[cell] = bed
        }
      }
    }
  }
}

/**
 * Generate a complete island from a seed. Deterministic: the same seed and
 * options always produce byte-identical output.
 */
export function generateTerrain(seed: number, options: TerrainOptions = {}): TerrainMap {
  const size = options.size ?? DEFAULTS.size
  const cellSize = options.cellSize ?? DEFAULTS.cellSize
  const seaLevel = options.seaLevel ?? DEFAULTS.seaLevel
  const oceanDepth = options.oceanDepth ?? DEFAULTS.oceanDepth
  const worldSize = size * cellSize
  const islandRadius = options.islandRadius ?? worldSize * ISLAND_RADIUS_FRACTION

  const rng = createRng(seed)
  const ridgeCount = options.ridgeCount ?? 2
  const ridges = createRidges(rng, ridgeCount, worldSize, islandRadius)

  const field: Heightfield = { width: size, depth: size, cellSize, heights: new Float32Array(size * size) }
  buildHeights(field, seed, ridges, seaLevel, oceanDepth, islandRadius)

  const routing = computeFlowRouting(field, seaLevel)
  const riverCount = options.riverCount ?? ridgeCount
  const rivers = traceRivers(field, routing, ridges, riverCount, seaLevel)
  const lakes = selectLakes(
    field,
    findLakes(field, routing, seaLevel),
    rivers,
    options.minLakeCells ?? 12,
    options.minLakeDepth ?? 1,
  )
  carveRiverChannels(field, rivers)

  return { seed, size, cellSize, seaLevel, heightfield: field, ridges, rivers, lakes }
}