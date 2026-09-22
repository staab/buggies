/**
 * What stands on the land: the buildings that fill a city's blocks and the
 * parks between them, the houses and gardens along the arterials through the
 * suburbs, the trees and the odd house along them out in the country, and the
 * woods over the open country and up the foothills of the mountains. All of
 * it is placed off the finished roads and the settled ground, and none of it
 * touches a road.
 */

import { createRng, randomInt, randomRange, type Rng } from '@buggies/physics'

import { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB } from './districts.ts'
import { sampleHeight } from './heightfield.ts'
import { interchangeZones, meetsInterchange } from './interchanges.ts'
import { orientedTriangle, signedDistanceToTriangle, triangleInradius, type Triangle } from './mountain.ts'
import { fbm2D, smoothstep } from './noise.ts'
import { RIVER_BANK_LAP } from './rivers.ts'
import { boreFloorAt, tunnelSegments } from './tunnels.ts'
import {
  cityFrame,
  footprintsOverlap,
  ROAD_BRIDGE,
  ROAD_GRADE,
  roadClearance,
  STREET_KERB,
  STREET_SPACING,
  STREET_WIDTH,
  type Footprint,
} from './roads.ts'
import type {Building, District, Heightfield, Lake, Mountain, Ramp, River, Road, Sidewalk, Tree} from './types.ts'

const BUILDING_SALT = 0x6b1d

/** Ground kept clear between a street's edge and the lots along it. */
const PAVEMENT = 2
/** How far in from the street's edge the sidewalk reaches, under the fronts of the buildings. */
const SIDEWALK_BAND = 2
/**
 * The most the ground under a sidewalk may rise or fall: across its band,
 * and from one sample to the next along it. A slab over steeper ground would
 * stand off it like a wall, so such a side is left out.
 */
const SIDEWALK_CROSS_RELIEF = 0.35
const SIDEWALK_ALONG_RELIEF = 0.5
const SIDEWALK_SAMPLE = 4
/** No lot narrower than this: a block is cut into as many lots as leave each this wide. */
const LOT_MIN = 9
/** A building stands this far inside its lot at most, on each side. */
const LOT_INSET = { min: 0.5, max: 2 } as const
/** Lots left as parks, one in this many. */
const PARK_LOT_ODDS = 7
/** Storeys are this tall, and every building is a whole number of them. */
const STOREY = 3
/** A block's building is at least this tall, and this much taller again at random. */
const BLOCK_HEIGHT = { min: 9, spread: 12 } as const
/**
 * The tallest a building rises over that at the heart of a city. It falls off
 * toward the edge, steeply, so the skyline is a cluster of towers in the
 * middle over a spread of mid-rise blocks.
 */
const TOWER_HEIGHT = 96
/** A tower in the heart of a city is at least this fraction of its full rise. */
const TOWER_FLOOR = 0.4
/** A footprint is buried this far below the lowest ground under it, so no corner hangs in the air. */
const BURY = 1
/** Ground that rises more than this across a footprint is too steep to build on. */
const BLOCK_RELIEF = 4
const HOUSE_RELIEF = 2.5
/** Every building keeps this clear of any road. */
const ROAD_MARGIN = 1.5
/**
 * And this far off a tunnel's centreline: the shell round a bore is built
 * far thicker than it is drawn, to roof over the ground cut away round the
 * bore, and near a portal it stands out of the hillside, so nothing is
 * planted where it would be buried in it.
 */
const TUNNEL_KEEP_OUT = 20
/** And this clear of any other building. */
const BUILDING_GAP = 1
/** Buildings are bucketed on this grid to find neighbours, in world units. */
const BUCKET = 32

/** Houses along a suburb's arterials: how far apart, how far from the road's edge, and how big. */
const SUBURB_SPACING = { min: 15, max: 22 } as const
const HOUSE_SETBACK = { min: 5, max: 9 } as const
const HOUSE_WIDTH = { min: 8, max: 12 } as const
const HOUSE_DEPTH = { min: 7, max: 10 } as const
const HOUSE_HEIGHT = { min: 3.5, max: 6.5 } as const
/** How far apart the ramps stand along a road, out of the cities. */
const RAMP_SPACING = { min: 140, max: 300 } as const
/** A ramp's run and rise: an arc ending near a quarter grade, enough to fly off at speed. */
const RAMP_LENGTH = 13
const RAMP_RISE = 3
const RAMP_WIDTH = 5
/** The shoulder past the lip is kept clear this far, for the car to come down on. */
const RAMP_LANDING = 50
/** The ramp's near edge stands this far out from the road's edge, on the shoulder. */
const RAMP_VERGE = 0.7
/** The ground under a ramp may not rise or fall more than this from foot to lip. */
const RAMP_RELIEF = 0.6

/** Country: trees this far apart along the arterial, standing this far off it, and this big. */
const TREE_SPACING = { min: 4, max: 9 } as const
const TREE_SETBACK = { min: 4, max: 14 } as const
/** Behind the roadside trees a second row stands further back, at half the slots. */
const TREE_BACK_SETBACK = { min: 14, max: 30 } as const
const TREE_RADIUS = { min: 1.8, max: 3.5 } as const
const TREE_HEIGHT = { min: 6, max: 12 } as const
/** Not every slot along the road gets a tree, one in this many stays open. */
const TREE_GAP_ODDS = 4
/** A country house every so often along the road, with a clearing around it. */
const COUNTRY_HOUSE_SPACING = { min: 70, max: 160 } as const
const CLEARING = 12
/** Shrubs are this big. */
const SHRUB_RADIUS = { min: 0.7, max: 1.6 } as const
const SHRUB_HEIGHT = { min: 0.9, max: 2 } as const
/** A park gets this many trees and this many shrubs for every hundred square metres, at most. */
const PARK_TREES = 1.2
const PARK_SHRUBS = 1.8
/** How often a planting is tried before the park is called full. */
const PARK_TRIES = 3
/** A garden: shrubs along the front of a house, and trees beside and behind it. */
const GARDEN_SHRUBS = { min: 1, max: 3 } as const
const GARDEN_TREES = { min: 0, max: 2 } as const

/** The wilds are tried at spots this far apart, each nudged about at random. */
const WILD_SPACING = 5
/** Woods and clearings come from noise this coarse: features a few hundred metres across. */
const WOOD_FREQUENCY = 0.004
/** Below this the noise is open ground, above it deep wood, and it thickens between. */
const WOOD_EDGE = { open: 0.42, deep: 0.62 } as const
/** How likely a spot is to get a tree, or a shrub, in deep wood; scaled down toward open ground. */
const WOOD_TREES = 0.14
const WOOD_SHRUBS = 0.12
/** Open ground still gets the odd lone tree or bush. */
const LONE_TREES = 0.006
const LONE_SHRUBS = 0.012
/** The suburbs, between the gardens, get this fraction of the country's woods. */
const SUBURB_WOODS = 0.3
/**
 * The foothills: how far a mountain's rise has come, from nothing at the
 * foot of its skirt to full on its crest. Trees thicken on the lower slopes
 * and thin out above them, to a treeline on the bare upper mountain.
 */
const FOOTHILL = { from: 0.03, thickest: 0.3, treeline: 0.6 } as const
/** How much thicker than the woods the foothills are planted, at their thickest. */
const FOOTHILL_BOOST = 2.2
/** Ground steeper than this is rock, whatever the noise says. */
const WILD_MAX_SLOPE = 0.6
/** And nothing grows above this fraction of the way from the sea to the island's highest ground. */
const TREELINE = 0.65
const WILD_SALT = 0x7e11

/**
 * What has been placed so far, bucketed so a footprint is only ever tested
 * against its neighbours. Blocks never meet, but the houses along a road are
 * placed one road at a time and two roads can run near enough for theirs to.
 */
class Placed {
  private readonly buckets = new Map<number, Footprint[]>()

  private key(x: number, z: number): number {
    return Math.floor(x / BUCKET) * 0x10000 + Math.floor(z / BUCKET)
  }

  private cells(footprint: Footprint, reach: number): number[] {
    const keys: number[] = []
    const minX = Math.floor((footprint.x - reach) / BUCKET)
    const maxX = Math.floor((footprint.x + reach) / BUCKET)
    const minZ = Math.floor((footprint.z - reach) / BUCKET)
    const maxZ = Math.floor((footprint.z + reach) / BUCKET)
    for (let bx = minX; bx <= maxX; bx++) for (let bz = minZ; bz <= maxZ; bz++) keys.push(bx * 0x10000 + bz)
    return keys
  }

  /** Whether the footprint would stand on, or within `gap` of, anything placed. */
  meets(footprint: Footprint, gap: number): boolean {
    const reach = Math.hypot(footprint.width, footprint.depth) / 2 + gap
    for (const key of this.cells(footprint, reach)) {
      for (const other of this.buckets.get(key) ?? []) {
        if (footprintsOverlap(footprint, other, gap)) return true
      }
    }
    return false
  }

  add(footprint: Footprint): void {
    const reach = Math.hypot(footprint.width, footprint.depth) / 2
    for (const key of this.cells(footprint, reach)) {
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(footprint)
      else this.buckets.set(key, [footprint])
    }
  }
}

interface Ground {
  low: number
  high: number
  wet: boolean
}

/** The ground under a footprint: its lowest and highest corner, and whether any is water. */
function groundUnder(
  field: Heightfield,
  wet: (x: number, z: number) => boolean,
  footprint: Footprint,
): Ground {
  const cos = Math.cos(footprint.yaw)
  const sin = Math.sin(footprint.yaw)
  let low = Infinity
  let high = -Infinity
  let anyWet = false
  for (const [su, sv] of [
    [0, 0],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const u = (su * footprint.width) / 2
    const v = (sv * footprint.depth) / 2
    const x = footprint.x + u * cos + v * sin
    const z = footprint.z - u * sin + v * cos
    const height = sampleHeight(field, x, z)
    low = Math.min(low, height)
    high = Math.max(high, height)
    if (wet(x, z)) anyWet = true
  }
  return { low, high, wet: anyWet }
}

/**
 * Ground nothing can stand on: every cell under water, the sea, the lakes,
 * and the rivers out to their banks, and the ground over and around every
 * tunnel.
 */
function wetTest(
  field: Heightfield,
  seaLevel: number,
  rivers: River[],
  lakes: Lake[],
  roads: Road[],
): (x: number, z: number) => boolean {
  const bores = tunnelSegments(roads)
  const { width, depth, cellSize } = field
  const wet = new Uint8Array(width * depth)
  for (const lake of lakes) for (const cell of lake.cells) wet[cell] = 1
  for (const river of rivers) {
    for (const point of river.points) {
      const reach = (point.width / 2) * (1 + RIVER_BANK_LAP)
      const minCol = Math.max(Math.floor((point.x - reach) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((point.x + reach) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((point.z - reach) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((point.z + reach) / cellSize), depth - 1)
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (Math.hypot(col * cellSize - point.x, row * cellSize - point.z) > reach) continue
          wet[row * width + col] = 1
        }
      }
    }
  }
  return (x, z) => {
    const col = Math.floor(x / cellSize)
    const row = Math.floor(z / cellSize)
    if (col < 0 || col >= width || row < 0 || row >= depth) return true
    if (wet[row * width + col] === 1 || sampleHeight(field, x, z) <= seaLevel + 0.5) return true
    return bores.length > 0 && boreFloorAt(bores, x, z, TUNNEL_KEEP_OUT) !== null
  }
}

/** Whole storeys, never fewer than the least. */
function storeys(height: number): number {
  return Math.max(STOREY * Math.round(height / STOREY), BLOCK_HEIGHT.min)
}

/**
 * Cut a span into lots, as many as leave each at least `LOT_MIN` wide, each
 * cut placed at random within the room it has.
 */
function cutLots(rng: Rng, from: number, to: number): [number, number][] {
  const span = to - from
  const most = Math.floor(span / LOT_MIN)
  if (most < 1) return []
  const count = randomInt(rng, Math.min(2, most), Math.min(3, most))
  const lots: [number, number][] = []
  let start = from
  for (let k = 0; k < count; k++) {
    const left = count - k - 1
    const end =
      k === count - 1 ? to : randomRange(rng, start + LOT_MIN, to - left * LOT_MIN)
    lots.push([start, end])
    start = end
  }
  return lots
}

/** Plants a tree or a shrub at a spot, if nothing is in the way there. Answers whether it did. */
type Planter = (x: number, z: number, kind: Tree['kind'], wet: (x: number, z: number) => boolean) => boolean

/**
 * A planter over the given ground. A tree keeps its crown clear of every
 * building and every other crown, and off the roads; a shrub only has to
 * find open ground.
 */
function planter(
  rng: Rng,
  field: Heightfield,
  placed: Placed,
  trees: Tree[],
  clear: (footprint: Footprint, margin: number) => boolean,
): Planter {
  return (x, z, kind, wet) => {
    const radius =
      kind === 'tree'
        ? randomRange(rng, TREE_RADIUS.min, TREE_RADIUS.max)
        : randomRange(rng, SHRUB_RADIUS.min, SHRUB_RADIUS.max)
    const height =
      kind === 'tree'
        ? randomRange(rng, TREE_HEIGHT.min, TREE_HEIGHT.max)
        : randomRange(rng, SHRUB_HEIGHT.min, SHRUB_HEIGHT.max)
    const tone = rng()
    if (wet(x, z)) return false
    const footprint: Footprint = { x, z, yaw: 0, width: radius * 2, depth: radius * 2 }
    if (!clear(footprint, 0) || placed.meets(footprint, 0)) return false
    placed.add(footprint)
    trees.push({ kind, x, z, bottom: sampleHeight(field, x, z), height, radius, tone })
    return true
  }
}

/**
 * Fill the blocks of every city. Blocks lie between the grid lines the streets
 * run on, a pavement in from each; each is cut into a few lots, and each lot
 * gets a building, taller toward the heart of the city, unless a road runs
 * through it, the ground under it is water or too steep, or it is left open.
 */
function fillCities(
  rng: Rng,
  field: Heightfield,
  districts: District[],
  districtOf: Uint8Array,
  clear: (footprint: Footprint, margin: number) => boolean,
  wet: (x: number, z: number) => boolean,
  placed: Placed,
  buildings: Building[],
  sidewalks: Sidewalk[],
  plant: Planter,
): void {
  const { width, cellSize } = field
  /**
   * Trees and shrubs scattered over a park lot, as many as fit at random. Each
   * stands far enough inside the lot for its crown to stay in it, so the
   * park never crowds a building out of the lot next door.
   */
  const plantPark = (lot: Footprint): void => {
    const area = (lot.width * lot.depth) / 100
    const cos = Math.cos(lot.yaw)
    const sin = Math.sin(lot.yaw)
    const somewhere = (inset: number): { x: number; z: number } | null => {
      if (lot.width < 2 * inset || lot.depth < 2 * inset) return null
      const u = randomRange(rng, -lot.width / 2 + inset, lot.width / 2 - inset)
      const v = randomRange(rng, -lot.depth / 2 + inset, lot.depth / 2 - inset)
      return { x: lot.x + u * cos + v * sin, z: lot.z - u * sin + v * cos }
    }
    for (let k = 0; k < Math.round(area * PARK_TREES) * PARK_TRIES; k++) {
      const at = somewhere(TREE_RADIUS.max)
      if (at) plant(at.x, at.z, 'tree', wet)
    }
    for (let k = 0; k < Math.round(area * PARK_SHRUBS) * PARK_TRIES; k++) {
      const at = somewhere(SHRUB_RADIUS.max)
      if (at) plant(at.x, at.z, 'shrub', wet)
    }
  }
  const inCity = (x: number, z: number): boolean => {
    const col = Math.floor(x / cellSize)
    const row = Math.floor(z / cellSize)
    if (col < 0 || col >= width || row < 0 || row >= field.depth) return false
    return districtOf[row * width + col] === DISTRICT_CITY
  }

  for (const district of districts) {
    const frame = cityFrame(field, districtOf, district)
    if (frame === null) continue
    const { cx, cz, cos, sin } = frame
    // The lots are laid out from the old kerb, whatever the street's width
    // now: the sidewalk fills the difference, under the buildings' fronts.
    const edge = STREET_KERB + PAVEMENT
    /**
     * Which sides of a block's sidewalk ring have only the block's own
     * streets beside them, round from the side at +v. A kerb across an
     * arterial or a ramp cutting through the block would be a step in that
     * road, so a side one crosses is left out.
     */
    const ringSides = (blockU: number, blockV: number): [boolean, boolean, boolean, boolean] => {
      const half = STREET_SPACING / 2 - STREET_WIDTH / 2
      const band = SIDEWALK_BAND
      const yaw = -Math.atan2(sin, cos)
      const groundAt = (u: number, v: number): number =>
        sampleHeight(field, cx + u * cos - v * sin, cz + u * sin + v * cos)
      /** Whether the ground under a side is level enough to lay a slab on. */
      const gentle = (u: number, v: number, along: boolean): boolean => {
        let lastMiddle = Number.NaN
        for (let t = -half; t <= half; t += SIDEWALK_SAMPLE) {
          const su = along ? u + t : u
          const sv = along ? v : v + t
          const outer = groundAt(along ? su : su + band / 2, along ? sv + band / 2 : sv)
          const inner = groundAt(along ? su : su - band / 2, along ? sv - band / 2 : sv)
          const middle = groundAt(su, sv)
          if (Math.abs(outer - inner) > SIDEWALK_CROSS_RELIEF) return false
          if (!Number.isNaN(lastMiddle) && Math.abs(middle - lastMiddle) > SIDEWALK_ALONG_RELIEF) return false
          lastMiddle = middle
        }
        return true
      }
      const sideClear = (du: number, dv: number, along: boolean): boolean => {
        const u = blockU + du
        const v = blockV + dv
        return (
          gentle(u, v, along) &&
          clear(
            {
              x: cx + u * cos - v * sin,
              z: cz + u * sin + v * cos,
              yaw,
              width: along ? 2 * half : band,
              depth: along ? band : 2 * half,
            },
            0,
          )
        )
      }
      const inset = half - band / 2
      return [
        sideClear(0, inset, true),
        sideClear(-inset, 0, false),
        sideClear(0, -inset, true),
        sideClear(inset, 0, false),
      ]
    }
    const first = (value: number): number => Math.floor(value / STREET_SPACING) * STREET_SPACING

    for (let v0 = first(frame.vMin); v0 < frame.vMax; v0 += STREET_SPACING) {
      for (let u0 = first(frame.uMin); u0 < frame.uMax; u0 += STREET_SPACING) {
        const blockU = u0 + STREET_SPACING / 2
        const blockV = v0 + STREET_SPACING / 2
        const block = { x: cx + blockU * cos - blockV * sin, z: cz + blockU * sin + blockV * cos }
        if (inCity(block.x, block.z)) {
          const sides = ringSides(blockU, blockV)
          if (sides.some((side) => side)) {
            sidewalks.push({
              ...block,
              // The frame's own turn: the ring is placed the way the block is.
              yaw: Math.atan2(sin, cos),
              half: STREET_SPACING / 2 - STREET_WIDTH / 2,
              band: SIDEWALK_BAND,
              sides,
            })
          }
        }
        const lotsU = cutLots(rng, u0 + edge, u0 + STREET_SPACING - edge)
        const lotsV = cutLots(rng, v0 + edge, v0 + STREET_SPACING - edge)
        for (const [vFrom, vTo] of lotsV) {
          for (const [uFrom, uTo] of lotsU) {
            if (randomInt(rng, 1, PARK_LOT_ODDS) === 1) {
              const lot: Footprint = {
                x: cx + ((uFrom + uTo) / 2) * cos - ((vFrom + vTo) / 2) * sin,
                z: cz + ((uFrom + uTo) / 2) * sin + ((vFrom + vTo) / 2) * cos,
                yaw: -Math.atan2(sin, cos),
                width: uTo - uFrom,
                depth: vTo - vFrom,
              }
              if (inCity(lot.x, lot.z)) plantPark(lot)
              continue
            }
            const insetU = randomRange(rng, LOT_INSET.min, LOT_INSET.max)
            const insetV = randomRange(rng, LOT_INSET.min, LOT_INSET.max)
            const u = (uFrom + uTo) / 2
            const v = (vFrom + vTo) / 2
            const footprint: Footprint = {
              x: cx + u * cos - v * sin,
              z: cz + u * sin + v * cos,
              yaw: -Math.atan2(sin, cos),
              width: uTo - uFrom - 2 * insetU,
              depth: vTo - vFrom - 2 * insetV,
            }
            const core = Math.max(
              0,
              1 - Math.hypot(footprint.x - district.cx, footprint.z - district.cz) / district.radius,
            )
            const height = storeys(
              BLOCK_HEIGHT.min +
                rng() * BLOCK_HEIGHT.spread +
                core ** 1.5 * (TOWER_FLOOR + (1 - TOWER_FLOOR) * rng()) * TOWER_HEIGHT,
            )
            const tone = rng()
            if (!inCity(footprint.x, footprint.z)) continue
            if (!clear(footprint, ROAD_MARGIN)) continue
            const ground = groundUnder(field, wet, footprint)
            if (ground.wet || ground.high - ground.low > BLOCK_RELIEF) continue
            if (placed.meets(footprint, BUILDING_GAP)) continue
            placed.add(footprint)
            buildings.push({
              kind: 'block',
              ...footprint,
              bottom: ground.low - BURY,
              top: ground.high + height,
              tone,
            })
          }
        }
      }
    }
  }
}

/** A road's heading and left-hand normal at a sample. */
function frameAlong(road: Road, index: number): { dx: number; dz: number; nx: number; nz: number } {
  const points = road.points
  const prev = points[Math.max(index - 1, 0)]!
  const next = points[Math.min(index + 1, points.length - 1)]!
  const dx = next.x - prev.x
  const dz = next.z - prev.z
  const length = Math.hypot(dx, dz) || 1
  return { dx: dx / length, dz: dz / length, nx: -dz / length, nz: dx / length }
}

/**
 * Line the arterials with what belongs beside them: houses through the
 * suburbs, and trees with the occasional house through the country. Slots are
 * walked along each road at the spacing of what stands there, on both sides;
 * a slot that lands on another road, in water, on ground too steep, in a
 * city, or in the clearing round a country house stays empty.
 */
function lineArterials(
  rng: Rng,
  field: Heightfield,
  districtOf: Uint8Array,
  roads: Road[],
  clear: (footprint: Footprint, margin: number) => boolean,
  wet: (x: number, z: number) => boolean,
  placed: Placed,
  buildings: Building[],
  plant: Planter,
): void {
  const { width, cellSize } = field
  const districtAt = (x: number, z: number): number => {
    const col = Math.floor(x / cellSize)
    const row = Math.floor(z / cellSize)
    if (col < 0 || col >= width || row < 0 || row >= field.depth) return -1
    return districtOf[row * width + col]!
  }
  const clearings: { x: number; z: number }[] = []
  const inClearing = (x: number, z: number): boolean =>
    clearings.some((house) => Math.hypot(house.x - x, house.z - z) < CLEARING)

  /** A house beside the road at this sample, facing it, if it fits there in `zone`. */
  const placeHouse = (road: Road, index: number, side: number, zone: number): boolean => {
    const point = road.points[index]!
    const { dx, dz, nx, nz } = frameAlong(road, index)
    const houseWidth = randomRange(rng, HOUSE_WIDTH.min, HOUSE_WIDTH.max)
    const houseDepth = randomRange(rng, HOUSE_DEPTH.min, HOUSE_DEPTH.max)
    const height = randomRange(rng, HOUSE_HEIGHT.min, HOUSE_HEIGHT.max)
    const tone = rng()
    const setback = road.width / 2 + randomRange(rng, HOUSE_SETBACK.min, HOUSE_SETBACK.max) + houseDepth / 2
    const footprint: Footprint = {
      x: point.x + nx * side * setback,
      z: point.z + nz * side * setback,
      // Broadside to the road: local X along it.
      yaw: -Math.atan2(dz, dx),
      width: houseWidth,
      depth: houseDepth,
    }
    if (districtAt(footprint.x, footprint.z) !== zone) return false
    if (!clear(footprint, ROAD_MARGIN)) return false
    const ground = groundUnder(field, wet, footprint)
    if (ground.wet || ground.high - ground.low > HOUSE_RELIEF) return false
    if (placed.meets(footprint, BUILDING_GAP)) return false
    placed.add(footprint)
    buildings.push({
      kind: 'house',
      ...footprint,
      bottom: ground.low - BURY,
      top: ground.high + height,
      tone,
    })
    // A garden: shrubs along the front, between the house and the road, and
    // a tree or two behind it, within its own width so the house next door
    // is not crowded out of its lot.
    const front = side * (houseDepth / 2 + 1.5)
    for (let k = randomInt(rng, GARDEN_SHRUBS.min, GARDEN_SHRUBS.max); k > 0; k--) {
      const along = randomRange(rng, -houseWidth / 2, houseWidth / 2)
      plant(footprint.x + dx * along - nx * front, footprint.z + dz * along - nz * front, 'shrub', wet)
    }
    for (let k = randomInt(rng, GARDEN_TREES.min, GARDEN_TREES.max); k > 0; k--) {
      const along = randomRange(rng, -houseWidth / 2, houseWidth / 2)
      const back = side * (houseDepth / 2 + TREE_RADIUS.max + randomRange(rng, 1, 6))
      plant(footprint.x + dx * along + nx * back, footprint.z + dz * along + nz * back, 'tree', wet)
    }
    return true
  }

  /** A tree beside the road at this sample, `setback` from its edge, if the ground there is free. */
  const placeTree = (road: Road, index: number, side: number, setback: number): void => {
    const point = road.points[index]!
    const { nx, nz } = frameAlong(road, index)
    const x = point.x + nx * side * (road.width / 2 + setback)
    const z = point.z + nz * side * (road.width / 2 + setback)
    if (districtAt(x, z) !== DISTRICT_COUNTRY) return
    if (inClearing(x, z)) return
    plant(x, z, 'tree', wet)
  }

  for (const road of roads) {
    if (road.kind !== 'arterial' && road.kind !== 'cross') continue
    const points = road.points
    for (const side of [1, -1]) {
      let travelled = 0
      let nextSlot = 0
      let nextHouse = randomRange(rng, COUNTRY_HOUSE_SPACING.min, COUNTRY_HOUSE_SPACING.max)
      for (let i = 1; i < points.length; i++) {
        travelled += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z)
        if (travelled < nextSlot) continue
        // Nothing beside a bridge: there is a river or a valley there.
        if (road.structure[i - 1] === ROAD_BRIDGE || road.structure[Math.min(i, points.length - 2)] === ROAD_BRIDGE) {
          nextSlot = travelled + TREE_SPACING.min
          continue
        }
        const { nx, nz } = frameAlong(road, i)
        const beside = districtAt(points[i]!.x + nx * side * road.width, points[i]!.z + nz * side * road.width)
        if (beside === DISTRICT_SUBURB) {
          placeHouse(road, i, side, DISTRICT_SUBURB)
          nextSlot = travelled + randomRange(rng, SUBURB_SPACING.min, SUBURB_SPACING.max)
        } else if (beside === DISTRICT_COUNTRY) {
          if (travelled >= nextHouse) {
            if (placeHouse(road, i, side, DISTRICT_COUNTRY)) {
              const house = buildings[buildings.length - 1]!
              clearings.push({ x: house.x, z: house.z })
            }
            nextHouse = travelled + randomRange(rng, COUNTRY_HOUSE_SPACING.min, COUNTRY_HOUSE_SPACING.max)
            nextSlot = travelled + TREE_SPACING.max
          } else {
            if (randomInt(rng, 1, TREE_GAP_ODDS) !== 1) {
              placeTree(road, i, side, randomRange(rng, TREE_SETBACK.min, TREE_SETBACK.max))
            }
            if (randomInt(rng, 1, 2) === 1) {
              placeTree(road, i, side, randomRange(rng, TREE_BACK_SETBACK.min, TREE_BACK_SETBACK.max))
            }
            nextSlot = travelled + randomRange(rng, TREE_SPACING.min, TREE_SPACING.max)
          }
        } else {
          nextSlot = travelled + TREE_SPACING.max
        }
      }
    }
  }
}

/**
 * Stand ramps on the shoulders of the arterials and cross roads, out of the
 * cities: every so often, on one side or the other, running along the road
 * one way or the other, so a car going by can swerve onto one and fly off
 * its lip. A ramp claims its ground first, before the houses and trees, and
 * only where the shoulder is level enough to stand it on and nothing else
 * is in the way.
 */
function lineRamps(
  rng: Rng,
  field: Heightfield,
  districtOf: Uint8Array,
  roads: Road[],
  clear: (footprint: Footprint, margin: number) => boolean,
  wet: (x: number, z: number) => boolean,
  placed: Placed,
  ramps: Ramp[],
): void {
  const { width, cellSize } = field
  const districtAt = (x: number, z: number): number => {
    const col = Math.floor(x / cellSize)
    const row = Math.floor(z / cellSize)
    if (col < 0 || col >= width || row < 0 || row >= field.depth) return -1
    return districtOf[row * width + col]!
  }
  for (const road of roads) {
    if (road.kind !== 'arterial' && road.kind !== 'cross') continue
    const points = road.points
    let travelled = 0
    let next = randomRange(rng, RAMP_SPACING.min / 2, RAMP_SPACING.max / 2)
    for (let i = 1; i < points.length; i++) {
      travelled += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z)
      if (travelled < next) continue
      next = travelled + randomRange(rng, RAMP_SPACING.min, RAMP_SPACING.max)
      if (road.structure[i - 1] !== ROAD_GRADE || road.structure[Math.min(i, points.length - 2)] !== ROAD_GRADE) continue
      const side = randomInt(rng, 1, 2) === 1 ? 1 : -1
      const along = randomInt(rng, 1, 2) === 1 ? 1 : -1
      const { dx, dz, nx, nz } = frameAlong(road, i)
      const out = road.width / 2 + RAMP_VERGE + RAMP_WIDTH / 2
      const point = points[i]!
      const middle = { x: point.x + nx * side * out, z: point.z + nz * side * out }
      if (districtAt(middle.x, middle.z) === DISTRICT_CITY) continue
      const foot = { x: middle.x - dx * along * (RAMP_LENGTH / 2), z: middle.z - dz * along * (RAMP_LENGTH / 2) }
      const lip = { x: middle.x + dx * along * (RAMP_LENGTH / 2), z: middle.z + dz * along * (RAMP_LENGTH / 2) }
      if (wet(foot.x, foot.z) || wet(lip.x, lip.z)) continue
      const bottom = sampleHeight(field, foot.x, foot.z)
      if (Math.abs(sampleHeight(field, lip.x, lip.z) - bottom) > RAMP_RELIEF) continue
      const footprint: Footprint = {
        x: middle.x,
        z: middle.z,
        // Local X along the road.
        yaw: -Math.atan2(dz, dx),
        width: RAMP_LENGTH,
        depth: RAMP_WIDTH,
      }
      // The landing strip: the shoulder beyond the lip, kept free of houses
      // and trees. A road crossing it is fine to come down on.
      const landing: Footprint = {
        x: lip.x + dx * along * (RAMP_LANDING / 2),
        z: lip.z + dz * along * (RAMP_LANDING / 2),
        yaw: footprint.yaw,
        width: RAMP_LANDING,
        depth: RAMP_WIDTH + 2,
      }
      if (!clear(footprint, 0) || placed.meets(footprint, BUILDING_GAP)) continue
      if (placed.meets(landing, 0)) continue
      placed.add(footprint)
      placed.add(landing)
      ramps.push({
        x: foot.x,
        z: foot.z,
        dx: dx * along,
        dz: dz * along,
        width: RAMP_WIDTH,
        length: RAMP_LENGTH,
        bottom,
        top: bottom + RAMP_RISE,
      })
    }
  }
}

/**
 * Plant the wilds: woods and clearings over the open country and up the
 * foothills of the mountains, thinning to nothing on the bare heights, and
 * a lighter scatter through the suburbs. Every spot is tried at random
 * against a density that follows the lie of the land, so the woods clump
 * rather than dust the map evenly.
 */
function plantWilds(
  rng: Rng,
  field: Heightfield,
  seaLevel: number,
  mountains: Mountain[],
  districtOf: Uint8Array,
  seed: number,
  clear: (footprint: Footprint, margin: number) => boolean,
  wet: (x: number, z: number) => boolean,
  plant: Planter,
): void {
  const { width, depth, cellSize } = field
  const shapes = mountains.map((mountain) => {
    const triangle = orientedTriangle(mountain)
    return { triangle, inradius: Math.max(triangleInradius(triangle), 1e-3), skirt: mountain.skirt }
  })
  /** How far up a mountain a spot is, 0 clear of every skirt to 1 on a crest. */
  const rise = (x: number, z: number): number => {
    let most = 0
    for (const shape of shapes) {
      const signed = signedDistanceToTriangle(x, z, shape.triangle as Triangle)
      most = Math.max(most, smoothstep(-shape.skirt, shape.inradius, signed))
    }
    return most
  }
  const slopeAt = (x: number, z: number): number => {
    const step = cellSize
    const dx = sampleHeight(field, x + step, z) - sampleHeight(field, x - step, z)
    const dz = sampleHeight(field, x, z + step) - sampleHeight(field, x, z - step)
    return Math.hypot(dx, dz) / (2 * step)
  }
  const districtAt = (x: number, z: number): number => {
    const col = Math.floor(x / cellSize)
    const row = Math.floor(z / cellSize)
    if (col < 0 || col >= width || row < 0 || row >= depth) return -1
    return districtOf[row * width + col]!
  }

  const noiseSeed = (seed ^ WILD_SALT) >>> 0
  const spanX = width * cellSize
  const spanZ = depth * cellSize
  let highest = -Infinity
  for (const height of field.heights) highest = Math.max(highest, height)
  const treeline = seaLevel + TREELINE * (highest - seaLevel)
  for (let z0 = WILD_SPACING / 2; z0 < spanZ; z0 += WILD_SPACING) {
    for (let x0 = WILD_SPACING / 2; x0 < spanX; x0 += WILD_SPACING) {
      const x = x0 + randomRange(rng, -WILD_SPACING / 2, WILD_SPACING / 2)
      const z = z0 + randomRange(rng, -WILD_SPACING / 2, WILD_SPACING / 2)
      const roll = rng()
      const district = districtAt(x, z)
      if (district !== DISTRICT_COUNTRY && district !== DISTRICT_SUBURB) continue
      const height = sampleHeight(field, x, z)
      if (height <= seaLevel || height >= treeline) continue
      const up = rise(x, z)
      if (up >= FOOTHILL.treeline) continue
      // Woods where the noise runs high; the foothills thicken them, and thin
      // them again toward the treeline.
      const wood = smoothstep(WOOD_EDGE.open, WOOD_EDGE.deep, fbm2D(x * WOOD_FREQUENCY, z * WOOD_FREQUENCY, noiseSeed, 3))
      const foothill =
        up < FOOTHILL.thickest
          ? smoothstep(FOOTHILL.from, FOOTHILL.thickest, up)
          : 1 - smoothstep(FOOTHILL.thickest, FOOTHILL.treeline, up)
      const thickness = Math.min(1, wood + foothill * FOOTHILL_BOOST) * (district === DISTRICT_SUBURB ? SUBURB_WOODS : 1)
      const trees = LONE_TREES + (WOOD_TREES - LONE_TREES) * thickness
      const shrubs = LONE_SHRUBS + (WOOD_SHRUBS - LONE_SHRUBS) * thickness
      if (roll >= trees + shrubs) continue
      if (slopeAt(x, z) > WILD_MAX_SLOPE) continue
      plant(x, z, roll < trees ? 'tree' : 'shrub', wet)
    }
  }
}

/** Everything that stands on the land of a map. */
export function generateBuildings(
  field: Heightfield,
  seaLevel: number,
  districts: District[],
  districtOf: Uint8Array,
  roads: Road[],
  rivers: River[],
  lakes: Lake[],
  mountains: Mountain[],
  seed: number,
): { buildings: Building[]; trees: Tree[]; ramps: Ramp[]; sidewalks: Sidewalk[] } {
  const rng = createRng((seed ^ BUILDING_SALT) >>> 0)
  // Buildings stand against the old kerb, on the sidewalk; what grows keeps
  // off the sidewalk as well as the street. Nothing is built at all on the
  // ground an interchange's ramps enclose.
  const zones = interchangeZones(roads)
  const clearOfRoads = roadClearance(roads, STREET_KERB)
  const clear = (footprint: Footprint, margin: number): boolean =>
    clearOfRoads(footprint, margin) && !meetsInterchange(zones, footprint)
  const clearOfStreets = roadClearance(roads, STREET_WIDTH / 2 + SIDEWALK_BAND)
  const wet = wetTest(field, seaLevel, rivers, lakes, roads)
  const placed = new Placed()
  const buildings: Building[] = []
  const trees: Tree[] = []
  const ramps: Ramp[] = []
  const sidewalks: Sidewalk[] = []
  const plant = planter(rng, field, placed, trees, clearOfStreets)
  fillCities(rng, field, districts, districtOf, clear, wet, placed, buildings, sidewalks, plant)
  lineRamps(rng, field, districtOf, roads, clear, wet, placed, ramps)
  lineArterials(rng, field, districtOf, roads, clear, wet, placed, buildings, plant)
  plantWilds(rng, field, seaLevel, mountains, districtOf, seed, clear, wet, plant)
  return { buildings, trees, ramps, sidewalks }
}
