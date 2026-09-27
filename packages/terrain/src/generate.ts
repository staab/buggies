import { createRng, randomInt, randomRange, type Rng } from '@buggies/physics'
import * as exact from '@buggies/physics'

import { generateBuildings } from './buildings.ts'
import { ISLAND_NONE, generateDistricts } from './districts.ts'
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

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos, hypot, sin } = exact

const DEFAULTS = {
  size: 1281,
  cellSize: 1,
  seaLevel: 0,
  oceanDepth: 10,
} as const

/**
 * The island is grown at a reference scale, then enlarged. Terrain features —
 * mountains, rivers, cities — scale with it and keep their proportions; roads
 * and the car are built afterward at full size, so they stay as they are.
 */
export const WORLD_SCALE = 3

/** The largest an island may be: the radius its land fades out over, as a fraction of the map. */
const ISLAND_RADIUS_MAX = (0.35 * 1025 * 1.2) / 1281
/**
 * The smallest, as a fraction of the map: a small island's coast comes in
 * to about three fifths of this, some 100 m across once the map is enlarged.
 */
const ISLAND_RADIUS_MIN = 28 / 1281
/** How many islands a map has. They may overlap into one land mass. */
const ISLAND_COUNT = { min: 1, max: 15 } as const
/**
 * The first island is drawn at least this fraction of the largest size, so
 * every map has room for its cities however small the rest come out.
 */
const FIRST_ISLAND_LEAST = 0.75
/** Land fades out to sea this far in from the map's edge, as a fraction of the map, so no coast is cut off by it. */
const EDGE_FRACTION = 30 / 1281
/**
 * How many mountains a map of the full size has. Mountains keep their size
 * while islands scale with the map, so a smaller map has fewer at most, in
 * proportion to its area.
 */
const MOUNTAIN_COUNT = { min: 1, max: 12 } as const
/** The map size, in world units, `MOUNTAIN_COUNT` is for. */
const MOUNTAIN_COUNT_MAP = 1281
/** A mountain stands within this fraction of its island's radius from the island's middle. */
const MOUNTAIN_REACH = 0.5
/** An island smaller than this, in world units, is too small to carry a mountain. */
const MOUNTAIN_ISLAND_LEAST = 60
/** The chance that a mountain has a river running off it. */
const RIVER_CHANCE = 0.5
/** How many cities a map has. */
const CITY_COUNT = { min: 3, max: 5 } as const
/** Mountains keep a fixed world size so a bigger island means more land around them. */
const MOUNTAIN_RADIUS = { min: 50, max: 80 } as const
const MOUNTAIN_SKIRT = { min: 22, max: 38 } as const
const MOUNTAIN_HEIGHT = { min: 26, max: 40 } as const
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
/** Each river point is drawn toward the run of this many neighbors either side, to take the trace's staircase out of the course. */
const RIVER_SMOOTHING = 2
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

/** An island: where its middle is, and how far its land reaches before the coast's wander. */
interface Island {
  cx: number
  cz: number
  radius: number
}

/**
 * Where the islands lie: each somewhere on the map, sized anywhere from a
 * speck to the largest the map holds, and kept far enough in from the edge
 * that its coast is not cut off there. Islands may overlap into one.
 */
/**
 * A map's extent in world units, across and down; the shorter of the two,
 * which its scale is taken from; and how far from its middle, north and
 * south, the land may reach.
 */
interface Extent {
  x: number
  z: number
  short: number
  band: number
}

function layIslands(rng: Rng, extent: Extent, largest: number, count: number): Island[] {
  const least = Math.min(extent.short * ISLAND_RADIUS_MIN, largest)
  const edge = extent.short * EDGE_FRACTION
  return Array.from({ length: count }, (_, i) => {
    const radius = randomRange(rng, i === 0 ? largest * FIRST_ISLAND_LEAST : least, largest)
    // The coast reaches about nine tenths of the radius at most.
    const reach = edge + radius * 0.9
    const marginX = Math.min(reach, extent.x / 2)
    // Its coast inside the band as well as the map, as far as it can be.
    const marginZ = Math.min(Math.max(reach, extent.z / 2 - extent.band + radius * 0.9), extent.z / 2)
    return {
      cx: randomRange(rng, marginX, extent.x - marginX),
      cz: randomRange(rng, marginZ, extent.z - marginZ),
      radius,
    }
  })
}

/**
 * Mountains scattered over the islands, each on an island picked in
 * proportion to its area among those big enough to carry one, and standing
 * anywhere within `MOUNTAIN_REACH` of that island's middle. On a map whose
 * islands are kept small, as a planet's are, the mountains are `scale` their
 * full width and its root their full height, so they leave room on the land
 * for its cities.
 */
function createMountains(rng: Rng, count: number, islands: Island[], scale = 1): Mountain[] {
  const hosts = islands.filter((island) => island.radius >= MOUNTAIN_ISLAND_LEAST * scale)
  const pool = hosts.length > 0 ? hosts : islands.slice(0, 1)
  const total = pool.reduce((sum, island) => sum + island.radius ** 2, 0)
  return Array.from({ length: count }, () => {
    let pick = rng() * total
    let island = pool[pool.length - 1]!
    for (const candidate of pool) {
      pick -= candidate.radius ** 2
      if (pick < 0) {
        island = candidate
        break
      }
    }
    const offsetAngle = randomRange(rng, 0, Math.PI * 2)
    const offset = island.radius * MOUNTAIN_REACH * Math.sqrt(rng())
    const cx = island.cx + cos(offsetAngle) * offset
    const cz = island.cz + sin(offsetAngle) * offset

    const radius = randomRange(rng, MOUNTAIN_RADIUS.min, MOUNTAIN_RADIUS.max) * scale
    const rotation = randomRange(rng, 0, Math.PI * 2)
    const corner = (k: number): { x: number; z: number } => {
      const angle = rotation + (k * Math.PI * 2) / 3 + randomRange(rng, -0.35, 0.35)
      const r = radius * randomRange(rng, 0.65, 1.05)
      return { x: cx + cos(angle) * r, z: cz + sin(angle) * r }
    }

    const a = corner(0)
    let b = corner(1)
    let c = corner(2)
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
      skirt: randomRange(rng, MOUNTAIN_SKIRT.min, MOUNTAIN_SKIRT.max) * scale,
      height: randomRange(rng, MOUNTAIN_HEIGHT.min, MOUNTAIN_HEIGHT.max) * Math.sqrt(scale),
    }
  })
}

interface MountainShape {
  triangle: Triangle
  inradius: number
  skirt: number
  height: number
  /** The rectangle its skirt reaches no further than. */
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/** The height over which two islands' domes blend into one where they overlap. */
const DOME_BLEND = 2

/** The greater of two values, rounded off over `blend` where they come close, so the seam has no crease. */
function smoothMax(a: number, b: number, blend: number): number {
  const h = Math.max(blend - Math.abs(a - b), 0) / blend
  return Math.max(a, b) + (h * h * blend) / 4
}

/** Raise the islands out of the sea and the mountains on them. */
function buildHeights(
  field: Heightfield,
  seed: number,
  shapes: MountainShape[],
  oceanDepth: number,
  islands: Island[],
  largest: number,
  band: number,
): void {
  const { width, depth, cellSize, heights } = field
  const spanX = width * cellSize
  const spanZ = depth * cellSize
  const edge = Math.min(spanX, spanZ) * EDGE_FRACTION
  // The plains are all but flat: what relief they keep is long and low, so a
  // road across them needs no cutting and a car at speed feels nothing of it.
  // The hills are the mountains' skirts.
  const plainsAmplitude = largest * 0.002

  // Frequencies are in world units, so terrain detail does not grow with the map.
  const baseFrequency = 0.008
  const roughFrequency = 0.03
  const warpFrequency = 0.006

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
      // All land fades out before the map's edge, and before the edge of the band it keeps to.
      const inside = smoothstep(0, edge, Math.min(x, z, spanX - x, spanZ - z, band - Math.abs(z - spanZ / 2)))
      // Where islands overlap their land and their domes run together
      // smoothly: a plain maximum would leave a crease along the seam.
      let sea = 1
      let dome = 0
      for (const [i, island] of islands.entries()) {
        const warpAmplitude = island.radius * 0.45
        const distance = hypot(x - island.cx + warpX * warpAmplitude, z - island.cz + warpZ * warpAmplitude)
        sea *= smoothstep(island.radius * 0.55, island.radius, distance)
        // A gentle central dome keeps water draining outward to the sea instead
        // of pooling into giant interior basins. It follows the plain distance
        // from the center, not the warped one the coast is cut by: warping it
        // too would fold the coast's bays and headlands into slopes inland.
        const rise = island.radius * 0.032 * (1 - smoothstep(0, island.radius * 0.85, hypot(x - island.cx, z - island.cz)))
        dome = i === 0 ? rise : smoothMax(dome, rise, DOME_BLEND)
      }
      const mask = (1 - sea) * inside

      const base = fbm2D(x * baseFrequency, z * baseFrequency, seed + 1, 2)
      const land = base * plainsAmplitude + dome

      // Only a mountain whose skirt reaches this far counts, and only then is
      // the roughness it is shaped with worth working out.
      let mountain = 0
      let roughness = -1
      for (const shape of shapes) {
        if (x < shape.minX || x > shape.maxX || z < shape.minZ || z > shape.maxZ) continue
        const signed = signedDistanceToTriangle(x, z, shape.triangle)
        if (signed <= -shape.skirt) continue
        if (roughness < 0) roughness = ridged2D(x * roughFrequency, z * roughFrequency, seed + 2, 5)
        // Full height in the triangle core, decaying over the skirt outside.
        const factor = smoothstep(-shape.skirt, shape.inradius, signed)
        const contribution = shape.height * factor * (0.6 + 0.4 * roughness)

        // Overlaps reinforce, but damped, so a cluster reads as one massif
        // without stacking into a spike.
        const high = Math.max(mountain, contribution)
        const low = Math.min(mountain, contribution)
        mountain = high + MOUNTAIN_OVERLAP * low
      }

      heights[row * width + col] = (land + mountain) * mask - oceanDepth * (1 - mask)
    }
  }
}

/**
 * Number every land mass, largest first, and say which each cell is land
 * of: islands that overlap are one land mass. Past the last number a cell
 * can hold, the specks are left unnumbered.
 */
function labelLandMasses(field: Heightfield, seaLevel: number): Uint8Array {
  const { width, depth, heights } = field
  const count = width * depth
  const component = new Int32Array(count).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let start = 0; start < count; start++) {
    if (component[start] !== -1 || heights[start]! <= seaLevel) continue
    const id = sizes.length
    let size = 0
    component[start] = id
    stack.push(start)
    for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
      size++
      const col = cell % width
      const row = (cell / width) | 0
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nc = col + dc
        const nr = row + dr
        if (nc < 0 || nc >= width || nr < 0 || nr >= depth) continue
        const next = nr * width + nc
        if (component[next] !== -1 || heights[next]! <= seaLevel) continue
        component[next] = id
        stack.push(next)
      }
    }
    sizes.push(size)
  }
  const ranked = sizes.map((_, id) => id).sort((a, b) => sizes[b]! - sizes[a]! || a - b)
  const number = new Uint8Array(sizes.length)
  for (const [rank, id] of ranked.entries()) number[id] = rank + 1 <= 255 ? rank + 1 : ISLAND_NONE
  const islandOf = new Uint8Array(count)
  for (let cell = 0; cell < count; cell++) {
    const id = component[cell]!
    if (id >= 0) islandOf[cell] = number[id]!
  }
  return islandOf
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
      // A lake's cells are cells of the field.
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
  // The column and row are clamped into the field, so all four corners are there.
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
    const centerCol = Math.min(Math.max(Math.floor(x / cellSize), 0), width - 1)
    const centerRow = Math.min(Math.max(Math.floor(z / cellSize), 0), depth - 1)
    let found: number | undefined
    for (let row = centerRow - span; row <= centerRow + span; row++) {
      if (row < 0 || row >= depth) continue
      for (let col = centerCol - span; col <= centerCol + span; col++) {
        if (col < 0 || col >= width) continue
        const level = lakeLevel.get(row * width + col)
        if (level === undefined) continue
        if (hypot((col + 0.5) * cellSize - x, (row + 0.5) * cellSize - z) > reach) continue
        if (found === undefined || level < found) found = level
      }
    }
    return found
  }

  /** Unit normal to the course at sample `i`, pointing across the channel. */
  const across = (points: RiverPoint[], i: number, point: RiverPoint): { x: number; z: number } => {
    const prev = points[i - 1] ?? point
    const next = points[i + 1] ?? point
    const dx = next.x - prev.x
    const dz = next.z - prev.z
    const length = hypot(dx, dz) || 1
    return { x: -dz / length, z: dx / length }
  }

  /**
   * Take the staircase out of each course. The trace steps from cell to
   * cell, so the line it draws turns through right angles and diagonals
   * every few meters; each point is drawn toward the run of its
   * neighbors, the spring and the mouth held where they are, and the
   * surface smoothed the same way, so the ribbon, and the channel cut for
   * it, wind rather than zigzag.
   */
  const smooth = (): void => {
    for (const river of rivers) {
      const { points } = river
      const before = points.map((point) => ({ x: point.x, y: point.y, z: point.z }))
      for (let i = 1; i < points.length - 1; i++) {
        let x = 0
        let y = 0
        let z = 0
        let count = 0
        for (let k = -RIVER_SMOOTHING; k <= RIVER_SMOOTHING; k++) {
          const p = before[Math.min(Math.max(i + k, 0), before.length - 1)]!
          x += p.x
          y += p.y
          z += p.z
          count += 1
        }
        const point = points[i]!
        point.x = x / count
        point.y = y / count
        point.z = z / count
      }
    }
  }
  smooth()

  // The surface as traced, before anything moved it.
  const traced = rivers.map((river) => river.points.map((point) => point.y))

  /** Drop every water line to the land its own channel runs through. */
  const seat = (): void => {
    for (const [r, river] of rivers.entries()) {
      for (const [i, point] of river.points.entries()) {
        // A lake is a body of water with a surface of its own; a river crossing
        // one, or running up to its shore, is that lake rather than a ribbon at
        // a height of its own. Running by a lake on a bank higher than a
        // channel can be cut, it is not.
        const lake = lakeAt(point.x, point.z, point.width / 2 + LAKE_SHORE)
        if (
          lake !== undefined &&
          (lakeAt(point.x, point.z) !== undefined || groundAt(point.x, point.z) - lake <= CHANNEL_MAX_INCISION)
        ) {
          point.y = lake
          continue
        }
        const normal = across(river.points, i, point)
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
        // The trace was taken from these rivers, point for point.
        point.y = Math.max(Math.min(point.y, lip) - RIVER_INSET, traced[r]![i]! - RIVER_DROP_MAX)
      }
    }
  }

  /** Give two courses that run together the one surface. */
  const share = (): void => {
    // Read from a snapshot, so leveling one river cannot drag another down
    // through it in the same pass.
    const before = rivers.map((river) => river.points.map((point) => point.y))
    for (const river of rivers) {
      for (const point of river.points) {
        if (lakeAt(point.x, point.z) !== undefined) continue
        for (const [other, otherRiver] of rivers.entries()) {
          if (otherRiver === river) continue
          for (const [i, mate] of otherRiver.points.entries()) {
            if (hypot(mate.x - point.x, mate.z - point.z) > (point.width + mate.width) / 4) {
              continue
            }
            // The snapshot was taken from these rivers, point for point.
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
        const point = points[i]
        const downstream = points[i + 1]
        if (point === undefined || downstream === undefined) continue
        point.y = Math.max(point.y, downstream.y)
      }
    }
  }

  /**
   * Cut the bed under each ribbon and the bank that closes it in.
   *
   * Stamps overlap heavily along a course, so the two halves of the profile are
   * gathered before anything is cut: the deepest bed any stamp asks for, and the
   * highest bank. Letting each stamp cut on its own lets one point's bank ramp
   * carve away the bank its neighbor needs, and the ribbon is left hanging over
   * the hole.
   */
  const carve = (): void => {
    const bedOf = new Map<number, number>()
    const bankOf = new Map<number, number>()
    // Every cell stamped or cut is within the field: the stamp is clamped to it.

    for (const river of rivers) {
      // Stamped along the course, between the points as well as at them, so
      // the bed is one channel and not a string of pits.
      const stamps: RiverPoint[] = []
      for (const [i, point] of river.points.entries()) {
        stamps.push(point)
        const next = river.points[i + 1]
        if (next === undefined) continue
        stamps.push({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2, z: (point.z + next.z) / 2, width: (point.width + next.width) / 2 })
      }
      for (const point of stamps) {
        const half = point.width / 2
        // The bed runs flat across the middle, and the bank climbs from it to
        // the water line at the ribbon's edge. It is only cut as deep as that
        // climb can carry at the bank slope, so the channel stays a channel and
        // never becomes a slot.
        const bed = half * 0.5
        const climbRun = Math.max(half - bed, cellSize)
        const cut = Math.min(CHANNEL_DEPTH, climbRun * CHANNEL_SLOPE)
        // A thread of a headwater can be narrower than a cell and pass between
        // the samples; the nearest one is under its water all the same, so
        // the bed reaches at least that far, at the water line out there.
        const reach = Math.max(half, cellSize * Math.SQRT1_2)
        const outer = reach + CHANNEL_BANK
        const minCol = Math.max(Math.floor((point.x - outer) / cellSize), 0)
        const maxCol = Math.min(Math.ceil((point.x + outer) / cellSize), width - 1)
        const minRow = Math.max(Math.floor((point.z - outer) / cellSize), 0)
        const maxRow = Math.min(Math.ceil((point.z + outer) / cellSize), depth - 1)

        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            const distance = hypot(col * cellSize - point.x, row * cellSize - point.z)
            if (distance > outer) continue
            const cell = row * width + col
            if (distance <= reach) {
              const climb = distance <= bed ? 0 : Math.min((distance - bed) / climbRun, 1)
              const level = point.y - cut * (1 - climb)
              const known = bedOf.get(cell)
              if (known === undefined || level < known) bedOf.set(cell, level)
            } else {
              // Past the ribbon the bank lifts at the same slope and its cut
              // fades out, reaching the land untouched at the far edge. Ending
              // the cut at a fixed level instead leaves a wall wherever the
              // ground stood higher, and the mesh can only draw that as a
              // staircase along the shore.
              const fade = (distance - reach) / CHANNEL_BANK
              const bank = point.y + (distance - reach) * CHANNEL_SLOPE
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

  // Stamps overlap along a course, so a bend's neighbors cut into banks the
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
  for (const [i, height] of heights.entries()) heights[i] = height * scale

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
 * Generate a complete map of islands from a seed. Deterministic: the same
 * seed and options always produce byte-identical output.
 */
export function generateTerrain(seed: number, options: TerrainOptions = {}): TerrainMap {
  const size = options.size ?? DEFAULTS.size
  const depth = options.depth ?? size
  const cellSize = options.cellSize ?? DEFAULTS.cellSize
  const seaLevel = options.seaLevel ?? DEFAULTS.seaLevel
  const oceanDepth = options.oceanDepth ?? DEFAULTS.oceanDepth
  const band = (options.landBand ?? 0.5) * depth * cellSize
  const extent: Extent = { x: size * cellSize, z: depth * cellSize, short: Math.min(size, depth, (band * 2) / cellSize) * cellSize, band }
  const largest = options.islandRadius ?? extent.short * ISLAND_RADIUS_MAX

  const rng = createRng(seed)
  const islandCount = options.islandCount ?? randomInt(rng, ISLAND_COUNT.min, options.islandsMost ?? ISLAND_COUNT.max)
  const islands = layIslands(rng, extent, largest, islandCount)
  const mountains = createMountains(
    rng,
    options.mountainCount ??
      randomInt(
        rng,
        MOUNTAIN_COUNT.min,
        Math.max(MOUNTAIN_COUNT.min, Math.round(MOUNTAIN_COUNT.max * Math.min((extent.x * Math.min(extent.z, band * 2)) / MOUNTAIN_COUNT_MAP ** 2, 1))),
      ),
    islands,
    options.mountainScale ?? 1,
  )
  // Up to one river a mountain, and always at least one.
  const springs = mountains.filter(() => rng() < RIVER_CHANCE)
  if (springs.length === 0 && mountains.length > 0) springs.push(mountains[0]!)
  const cityCount = options.cityCount ?? randomInt(rng, CITY_COUNT.min, CITY_COUNT.max)
  const shapes: MountainShape[] = mountains.map((mountain) => {
    const triangle = orientedTriangle(mountain)
    const xs = [mountain.ax, mountain.bx, mountain.cx]
    const zs = [mountain.az, mountain.bz, mountain.cz]
    return {
      triangle,
      inradius: Math.max(triangleInradius(triangle), 1e-3),
      skirt: mountain.skirt,
      height: mountain.height,
      minX: Math.min(...xs) - mountain.skirt,
      minZ: Math.min(...zs) - mountain.skirt,
      maxX: Math.max(...xs) + mountain.skirt,
      maxZ: Math.max(...zs) + mountain.skirt,
    }
  })

  const field: Heightfield = { width: size, depth, cellSize, heights: new Float32Array(size * depth) }
  buildHeights(field, seed, shapes, oceanDepth, islands, largest, band)
  const islandOf = labelLandMasses(field, seaLevel)

  const routing = computeFlowRouting(field, seaLevel)
  const rivers = traceRivers(field, routing, springs, options.riverCount ?? springs.length, seaLevel)
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
  const { districts, districtOf } = generateDistricts(field, seed, seaLevel, water, islandOf, cityCount)

  const map: TerrainMap = {
    seed,
    size,
    depth,
    cellSize,
    seaLevel,
    heightfield: field,
    mountains,
    rivers,
    lakes,
    districts,
    districtOf,
    roads: [],
    buildings: [],
    trees: [],
    rocks: [],
    props: [],
    ramps: [],
    sidewalks: [],
    fields: [],
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
    map.mountains,
  )
  Object.assign(
    map,
    generateBuildings(
      map.heightfield,
      map.seaLevel,
      map.districts,
      map.districtOf,
      map.roads,
      map.rivers,
      map.lakes,
      map.mountains,
      seed,
    ),
  )
  return map
}
/**
 * A planet's map: once round its equator across, pole to pole down, and its
 * land kept to a band across the middle, where the map is stretched least
 * over the sphere.
 */
export const PLANET_TERRAIN = { size: 1281, depth: 641, landBand: 0.28, islandRadius: 160, mountainScale: 0.37 } as const satisfies TerrainOptions
