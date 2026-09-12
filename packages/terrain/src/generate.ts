import { createRng, randomRange, type Rng } from '@buggies/physics'

import { generateDistricts } from './districts.ts'
import { computeFlowRouting, findLakes } from './flow.ts'
import {
  orientedTriangle,
  signedDistanceToTriangle,
  triangleInradius,
  type Triangle,
} from './mountain.ts'
import { fbm2D, ridged2D, smoothstep } from './noise.ts'
import { generateRoads } from './roads.ts'
import { traceRivers } from './rivers.ts'
import type { Heightfield, Lake, Mountain, River, TerrainMap, TerrainOptions } from './types.ts'

const DEFAULTS = {
  size: 1025,
  cellSize: 1,
  seaLevel: 0,
  oceanDepth: 10,
} as const

/**
 * The island is grown at a reference scale, then enlarged. Terrain features —
 * mountains, rivers, cities — scale with it and keep their proportions; roads
 * and the car are built afterwards at full size, so they stay as they are.
 */
export const WORLD_SCALE = 3

/** Island extent as a fraction of the map, leaving a ring of open sea. */
const ISLAND_RADIUS_FRACTION = 0.35
/** Mountains keep a fixed world size so a bigger island means more land around them. */
const MOUNTAIN_RADIUS = { min: 50, max: 80 } as const
const MOUNTAIN_SKIRT = { min: 22, max: 38 } as const
const MOUNTAIN_HEIGHT = { min: 26, max: 40 } as const
/** Default radius of the cluster the mountains are placed within. */
const MOUNTAIN_SPREAD = 120
/** How much overlapping mountains reinforce each other, 0 = max, 1 = pure sum. */
const MOUNTAIN_OVERLAP = 0.6
/** River channels are cut this deep below the water surface at their centre. */
const CHANNEL_DEPTH = 1.4
/** Upper bound on how far a channel may cut into a steep bank. */
const CHANNEL_MAX_INCISION = 5

function createMountains(
  rng: Rng,
  count: number,
  worldSize: number,
  islandRadius: number,
  spread: number,
): Mountain[] {
  const mapCenter = worldSize / 2

  // The massif cluster can sit anywhere on the island; the individual peaks are
  // scattered within it rather than pinned to a single crossing.
  const clusterAngle = randomRange(rng, 0, Math.PI * 2)
  const clusterDistance = islandRadius * randomRange(rng, 0, 0.5)
  const clusterX = mapCenter + Math.cos(clusterAngle) * clusterDistance
  const clusterZ = mapCenter + Math.sin(clusterAngle) * clusterDistance

  return Array.from({ length: count }, () => {
    const offsetAngle = randomRange(rng, 0, Math.PI * 2)
    const offset = spread * Math.sqrt(rng())
    const cx = clusterX + Math.cos(offsetAngle) * offset
    const cz = clusterZ + Math.sin(offsetAngle) * offset

    const radius = randomRange(rng, MOUNTAIN_RADIUS.min, MOUNTAIN_RADIUS.max)
    const rotation = randomRange(rng, 0, Math.PI * 2)
    const corners = Array.from({ length: 3 }, (_, k) => {
      const angle = rotation + (k * Math.PI * 2) / 3 + randomRange(rng, -0.35, 0.35)
      const r = radius * randomRange(rng, 0.65, 1.05)
      return { x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r }
    })

    const a = corners[0]!
    let b = corners[1]!
    let c = corners[2]!
    // Orient counter-clockwise for consistent edge distances.
    if ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) < 0) {
      const swap = b
      b = c
      c = swap
    }

    return {
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      cx: c.x,
      cz: c.z,
      skirt: randomRange(rng, MOUNTAIN_SKIRT.min, MOUNTAIN_SKIRT.max),
      height: randomRange(rng, MOUNTAIN_HEIGHT.min, MOUNTAIN_HEIGHT.max),
    }
  })
}

interface MountainShape {
  triangle: Triangle
  inradius: number
  skirt: number
  height: number
}

function buildHeights(
  field: Heightfield,
  seed: number,
  shapes: MountainShape[],
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
  const roughFrequency = 0.03
  const warpFrequency = 0.006
  const warpAmplitude = islandRadius * 0.45

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
      const roughness = ridged2D(x * roughFrequency, z * roughFrequency, seed + 2, 5)
      // A gentle central dome keeps water draining outward to the sea instead
      // of pooling into giant interior basins.
      const dome = 1 - smoothstep(0, islandRadius * 0.85, distance)
      const land = base * plainsAmplitude + domeHeight * dome

      let mountain = 0
      for (const shape of shapes) {
        const signed = signedDistanceToTriangle(x, z, shape.triangle)
        // Full height in the triangle core, decaying over the skirt outside.
        const factor = smoothstep(-shape.skirt, shape.inradius, signed)
        const contribution = shape.height * factor * (0.6 + 0.4 * roughness)

        // Overlaps reinforce, but damped, so a cluster reads as one massif
        // without stacking into a spike.
        const high = Math.max(mountain, contribution)
        const low = Math.min(mountain, contribution)
        mountain = high + MOUNTAIN_OVERLAP * low
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

/** Enlarge a finished map in place, preserving every terrain proportion. */
function scaleWorld(map: TerrainMap, scale: number): void {
  map.seaLevel *= scale
  map.cellSize *= scale
  map.heightfield.cellSize = map.cellSize

  const { heights } = map.heightfield
  for (let i = 0; i < heights.length; i++) heights[i] = heights[i]! * scale

  for (const mountain of map.mountains) {
    mountain.ax *= scale
    mountain.az *= scale
    mountain.bx *= scale
    mountain.bz *= scale
    mountain.cx *= scale
    mountain.cz *= scale
    mountain.skirt *= scale
    mountain.height *= scale
  }

  for (const river of map.rivers) {
    for (const point of river.points) {
      point.x *= scale
      point.y *= scale
      point.z *= scale
      point.width *= scale
    }
  }

  for (const lake of map.lakes) lake.level *= scale

  for (const district of map.districts) {
    district.cx *= scale
    district.cz *= scale
    district.radius *= scale
    district.suburbWidth *= scale
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
  const mountainCount = options.mountainCount ?? 3
  const mountains = createMountains(
    rng,
    mountainCount,
    worldSize,
    islandRadius,
    options.mountainSpread ?? MOUNTAIN_SPREAD,
  )
  const shapes: MountainShape[] = mountains.map((mountain) => {
    const triangle = orientedTriangle(mountain)
    return {
      triangle,
      inradius: Math.max(triangleInradius(triangle), 1e-3),
      skirt: mountain.skirt,
      height: mountain.height,
    }
  })

  const field: Heightfield = { width: size, depth: size, cellSize, heights: new Float32Array(size * size) }
  buildHeights(field, seed, shapes, seaLevel, oceanDepth, islandRadius)

  const routing = computeFlowRouting(field, seaLevel)
  const riverCount = options.riverCount ?? Math.min(2, mountainCount)
  const rivers = traceRivers(field, routing, mountains, riverCount, seaLevel)
  const lakes = selectLakes(
    field,
    findLakes(field, routing, seaLevel),
    rivers,
    options.minLakeCells ?? 12,
    options.minLakeDepth ?? 1,
  )
  carveRiverChannels(field, rivers)

  const water = riverCellSet(rivers, field.width, field.depth, cellSize)
  for (const lake of lakes) {
    for (const cell of lake.cells) water.add(cell)
  }
  const { districts, districtOf } = generateDistricts(field, seed, seaLevel, water)

  const map: TerrainMap = {
    seed,
    size,
    cellSize,
    seaLevel,
    heightfield: field,
    mountains,
    rivers,
    lakes,
    districts,
    districtOf,
    roads: [],
  }
  scaleWorld(map, WORLD_SCALE)
  map.roads = generateRoads(map.heightfield, map.seaLevel, map.districts, map.rivers, map.lakes)
  return map
}