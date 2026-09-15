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
import { RIVER_BANK_LAP, traceRivers } from './rivers.ts'
import type {
  Heightfield,
  Lake,
  Mountain,
  River,
  RiverPoint,
  TerrainMap,
  TerrainOptions,
} from './types.ts'

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
/** River channels are cut this deep below the water surface. */
const CHANNEL_DEPTH = 1.4
/** The bank climbs from the channel back to the surrounding land over this width. */
const CHANNEL_BANK = 4
/**
 * Steepest a bank may be cut. The bed is worth no more than the banks can carry
 * at this slope, so a narrow river gets a shallow channel rather than a slot cut
 * to full depth across two cells, which the mesh can only draw as a staircase.
 */
const CHANNEL_SLOPE = 0.5
/**
 * The water surface is set this far below the lip of its channel, so the edges
 * of the ribbon are buried in the banks rather than left standing in the air.
 */
const RIVER_INSET = 0.35
/** Upper bound on how far a channel may cut into a steep bank. */
const CHANNEL_MAX_INCISION = 5
/**
 * How far a lake's surface reaches past its own cells. A river meeting a lake is
 * the same water, so it holds the lake's level right up to the shore instead of
 * stepping down to the ground the moment it leaves the last flooded cell.
 */
const LAKE_SHORE = 10
/**
 * How far a water line may be seated below the course the tracer laid down. The
 * traced surface is the one thing every body of water on the map agrees on —
 * flat across lakes, shared where courses join, always falling — so the water is
 * only ever let a little way off it, enough to sit in its banks.
 */
const RIVER_DROP_MAX = 0.25

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
 * Seat every river in the ground and cut its channel.
 *
 * A course is traced over the flow-filled surface, which stands above the land
 * wherever it had to fill a hollow, so the ribbon floats with daylight under it.
 * Each sample is dropped to the ground its own channel runs through, and the bed
 * is then cut below that.
 *
 * Three things have to agree once the water has moved. A river crossing a lake
 * is that lake, not a ribbon at its own height. Two courses running together are
 * one river and hold one surface. And water never stands lower than the water it
 * flows into, so a sample that has been dropped into a hollow is brought back up
 * to whatever lies downstream of it.
 */
function seatRivers(field: Heightfield, rivers: River[], lakes: Lake[]): void {
  const { width, depth, cellSize, heights } = field

  // Bilinear, because the ground is drawn as an interpolated mesh: what the
  // water has to clear is the surface between the samples, not the samples.
  const groundAt = (x: number, z: number): number => {
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

  const lakeLevel = new Map<number, number>()
  for (const lake of lakes) {
    for (const cell of lake.cells) lakeLevel.set(cell, lake.level)
  }
  /** The surface of a lake covering this point, or standing within `reach` of it. */
  const lakeAt = (x: number, z: number, reach = 0): number | undefined => {
    const span = Math.ceil(reach / cellSize)
    const centreCol = Math.min(Math.max(Math.floor(x / cellSize), 0), width - 1)
    const centreRow = Math.min(Math.max(Math.floor(z / cellSize), 0), depth - 1)
    let found: number | undefined
    for (let row = centreRow - span; row <= centreRow + span; row++) {
      if (row < 0 || row >= depth) continue
      for (let col = centreCol - span; col <= centreCol + span; col++) {
        if (col < 0 || col >= width) continue
        const level = lakeLevel.get(row * width + col)
        if (level === undefined) continue
        if (Math.hypot((col + 0.5) * cellSize - x, (row + 0.5) * cellSize - z) > reach) continue
        if (found === undefined || level < found) found = level
      }
    }
    return found
  }

  /** Unit normal to the course at sample `i`, pointing across the channel. */
  const across = (points: RiverPoint[], i: number): { x: number; z: number } => {
    const prev = points[Math.max(0, i - 1)]!
    const next = points[Math.min(points.length - 1, i + 1)]!
    const dx = next.x - prev.x
    const dz = next.z - prev.z
    const length = Math.hypot(dx, dz) || 1
    return { x: -dz / length, z: dx / length }
  }

  // The surface as traced, before anything moved it.
  const traced = rivers.map((river) => river.points.map((point) => point.y))

  /** Drop every water line to the land its own channel runs through. */
  const seat = (): void => {
    for (let r = 0; r < rivers.length; r++) {
      const river = rivers[r]!
      for (let i = 0; i < river.points.length; i++) {
        const point = river.points[i]!
        // A lake is a body of water with a surface of its own; a river crossing
        // one, or running up to its shore, is that lake rather than a ribbon at
        // a height of its own.
        const lake = lakeAt(point.x, point.z, point.width / 2 + LAKE_SHORE)
        if (lake !== undefined) {
          point.y = lake
          continue
        }
        const normal = across(river.points, i)
        const half = point.width / 2
        // The lowest ground the channel touches, taken across the ribbon and out
        // to the foot of each bank: water standing above any of it would leave
        // that side of the ribbon hanging, and the cut can only take ground
        // away, never build it up to meet the water.
        let lip = groundAt(point.x, point.z)
        for (const offset of [half, half + CHANNEL_BANK]) {
          lip = Math.min(
            lip,
            groundAt(point.x + normal.x * offset, point.z + normal.z * offset),
            groundAt(point.x - normal.x * offset, point.z - normal.z * offset),
          )
        }
        point.y = Math.max(Math.min(point.y, lip) - RIVER_INSET, traced[r]![i]! - RIVER_DROP_MAX)
      }
    }
  }

  /** Give two courses that run together the one surface. */
  const share = (): void => {
    // Read from a snapshot, so levelling one river cannot drag another down
    // through it in the same pass.
    const before = rivers.map((river) => river.points.map((point) => point.y))
    for (let r = 0; r < rivers.length; r++) {
      for (const point of rivers[r]!.points) {
        if (lakeAt(point.x, point.z) !== undefined) continue
        for (let other = 0; other < rivers.length; other++) {
          if (other === r) continue
          const points = rivers[other]!.points
          for (let i = 0; i < points.length; i++) {
            const mate = points[i]!
            if (Math.hypot(mate.x - point.x, mate.z - point.z) > (point.width + mate.width) / 4) {
              continue
            }
            point.y = Math.min(point.y, before[other]![i]!)
          }
        }
      }
    }
  }

  /**
   * Hold the surface to one that only ever falls downstream. Seating samples
   * against their own ground, and holding others to a lake's surface, can leave
   * one standing above the one before it, which is water running uphill. The
   * drop is bounded, so bringing the upstream sample back up to meet it moves
   * the water very little.
   */
  const fall = (): void => {
    for (const river of rivers) {
      const points = river.points
      for (let i = points.length - 2; i >= 0; i--) {
        points[i]!.y = Math.max(points[i]!.y, points[i + 1]!.y)
      }
    }
  }

  /**
   * Cut the bed under each ribbon and the bank that closes it in.
   *
   * Stamps overlap heavily along a course, so the two halves of the profile are
   * gathered before anything is cut: the deepest bed any stamp asks for, and the
   * highest bank. Letting each stamp cut on its own lets one point's bank ramp
   * carve away the bank its neighbour needs, and the ribbon is left hanging over
   * the hole.
   */
  const carve = (): void => {
    const bedOf = new Map<number, number>()
    const bankOf = new Map<number, number>()

    for (const river of rivers) {
      for (const point of river.points) {
        const half = point.width / 2
        // The bed runs flat across the middle, and the bank climbs from it to
        // the water line at the ribbon's edge. It is only cut as deep as that
        // climb can carry at the bank slope, so the channel stays a channel and
        // never becomes a slot.
        const bed = half * 0.5
        const climbRun = Math.max(half - bed, cellSize)
        const cut = Math.min(CHANNEL_DEPTH, climbRun * CHANNEL_SLOPE)
        const outer = half + CHANNEL_BANK
        const minCol = Math.max(Math.floor((point.x - outer) / cellSize), 0)
        const maxCol = Math.min(Math.ceil((point.x + outer) / cellSize), width - 1)
        const minRow = Math.max(Math.floor((point.z - outer) / cellSize), 0)
        const maxRow = Math.min(Math.ceil((point.z + outer) / cellSize), depth - 1)

        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            const distance = Math.hypot(col * cellSize - point.x, row * cellSize - point.z)
            if (distance > outer) continue
            const cell = row * width + col
            if (distance <= half) {
              const climb = distance <= bed ? 0 : (distance - bed) / climbRun
              const level = point.y - cut * (1 - climb)
              const known = bedOf.get(cell)
              if (known === undefined || level < known) bedOf.set(cell, level)
            } else {
              // Past the ribbon the bank lifts at the same slope and its cut
              // fades out, reaching the land untouched at the far edge. Ending
              // the cut at a fixed level instead leaves a wall wherever the
              // ground stood higher, and the mesh can only draw that as a
              // staircase along the shore.
              const fade = (distance - half) / CHANNEL_BANK
              const bank = point.y + (distance - half) * CHANNEL_SLOPE
              const level = bank + (heights[cell]! - bank) * fade
              const known = bankOf.get(cell)
              if (known === undefined || level > known) bankOf.set(cell, level)
            }
          }
        }
      }
    }

    const cut = (cell: number, level: number): void => {
      const target = Math.max(level, heights[cell]! - CHANNEL_MAX_INCISION)
      if (target < heights[cell]!) heights[cell] = target
    }
    for (const [cell, level] of bedOf) cut(cell, level)
    // Ground under a ribbon belongs to the bed, however many banks reach it.
    for (const [cell, level] of bankOf) if (!bedOf.has(cell)) cut(cell, level)
  }

  // Stamps overlap along a course, so a bend's neighbours cut into banks the
  // first pass just shaped. Settle once more against the ground as it stands.
  for (let pass = 0; pass < 2; pass++) {
    seat()
    share()
    fall()
    carve()
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
  seatRivers(field, rivers, lakes)

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
  map.roads = generateRoads(
    map.heightfield,
    map.seaLevel,
    map.districts,
    map.rivers,
    map.lakes,
    seed,
    map.districtOf,
  )
  return map
}