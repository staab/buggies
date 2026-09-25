/**
 * What stands on the land: the buildings that fill a city's blocks and the
 * parks between them, the houses and gardens along the arterials through the
 * suburbs, the trees and the odd house along them out in the country, and the
 * woods over the open country and up the foothills of the mountains. All of
 * it is placed off the finished roads and the settled ground, and none of it
 * touches a road.
 */

import { createRng, randomInt, randomRange, type Rng } from '@buggies/physics'
import * as exact from '@buggies/physics'

import { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB } from './districts.ts'
import { sampleHeight } from './heightfield.ts'
import { insidePolygon, interchangeZones, meetsInterchange } from './interchanges.ts'
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
import { HOUSE_KINDS } from './types.ts'
import type {
  Building,
  District,
  Field,
  Heightfield,
  Lake,
  Mountain,
  Ramp,
  River,
  Road,
  RoadPoint,
  Sidewalk,
  Tree,
} from './types.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos: cosine, hypot, sin: sine } = exact

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
const LOT_INSET = { min: 0.5, max: 3.5 } as const
/** An open lot is this often a car park rather than a park. */
const CARPARK_ODDS = 0.35
/** Street trees along the sidewalks, this far apart, this big: the trunk on the sidewalk and the crown over the street. */
const STREET_TREE_SPACING = 14
const STREET_TREE_RADIUS = { min: 1.6, max: 2.2 } as const
const STREET_TREE_HEIGHT = { min: 6, max: 8 } as const
/** Trees along the verge of the main roads through a city, this far from the road, this far apart. */
const CITY_VERGE_SETBACK = 5.5
const CITY_VERGE_SPACING = 12
/** How thickly the ground an interchange's ramps enclose is planted, per hundred square metres. */
const INTERCHANGE_TREES = 0.6
const INTERCHANGE_SHRUBS = 0.9
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
/** A cottage is small and low under a steep roof; a villa is broad, and two storeys. */
const COTTAGE_WIDTH = { min: 6, max: 8.5 } as const
const COTTAGE_DEPTH = { min: 5, max: 7 } as const
const COTTAGE_HEIGHT = { min: 3, max: 3.6 } as const
const VILLA_WIDTH = { min: 11, max: 14 } as const
const VILLA_DEPTH = { min: 9, max: 12 } as const
const VILLA_HEIGHT = { min: 6, max: 7.5 } as const
/** Which style a house is, by the luck of the draw: the plain one half the time, the others a quarter each. */
const HOUSE_STYLES: readonly ('house' | 'cottage' | 'villa')[] = ['house', 'house', 'cottage', 'villa']

/**
 * As often as not an island has an observatory, one at most, on a mountain
 * top: a round tower this wide and this tall over the peak, on ground no
 * more uneven than this across it.
 */
const OBSERVATORY_ODDS = 0.5
const OBSERVATORY_SALT = 0x0b5e_4a70
const OBSERVATORY_SIZE = 12
const OBSERVATORY_HEIGHT = 11
const OBSERVATORY_RELIEF = 8

/**
 * Farms in the open country, this many at most out of this many tries: a
 * row of fields side by side, each this long and wide and no more uneven
 * than this across it, hedged about, with a barn and a silo or two off the
 * end of the row.
 */
const FARMS_MOST = 5
const FARM_TRIES = 150
const FIELDS_PER_FARM = { min: 2, max: 4 } as const
const FIELD_LENGTH = { min: 45, max: 75 } as const
const FIELD_WIDTH = { min: 28, max: 45 } as const
const FIELD_GAP = 3
const FIELD_RELIEF = 8
const FIELD_ROAD_MARGIN = 4
const HEDGE_SPACING = 3.5
/** How far outside the crop the hedge stands: a shrub's width, so it does not sit in the field it hedges. */
const HEDGE_OUT = 1.9
const BARN = { width: 14, depth: 9, height: 6.5 } as const
/** How far past the end of the row the barn stands: beyond the hedge, with room to walk round. */
const BARN_OFF = 6
const SILO = { radius: 2.4, height: 9 } as const
const SILOS = { min: 1, max: 2 } as const
const SILO_RELIEF = 5

/**
 * One wind farm an island, if the open country has room for a line of
 * turbines this far apart, at least this many of them, each a tower this
 * wide and tall standing on ground no more uneven than this.
 */
const WIND_FARM_TRIES = 120
const TURBINES = { min: 5, max: 7 } as const
const TURBINES_LEAST = 4
const TURBINE_SPACING = 48
const TURBINE = { radius: 1.3, height: 42 } as const
const TURBINE_RELIEF = 6
const TURBINE_ROAD_MARGIN = 6
const TURBINE_GAP = 8

/**
 * One ring of standing stones an island, on the highest open ground of
 * this many tries: this many stones round a ring this wide, each this big.
 */
const STONES_TRIES = 120
const STONES = 12
const STONE_RING = 14
const STONE = { width: 2.4, depth: 1.3, height: { min: 5.5, max: 8 } } as const
/** The altar in the middle of the ring: a slab lying this long, wide and high. */
const ALTAR = { width: 4.5, depth: 2.2, height: 1.1 } as const
/**
 * A lintel across two stones side by side, as often as not: this thick and
 * tall, reaching this far past each, and let this far into their tops. The
 * two under it are made the same height to carry it.
 */
const LINTEL_ODDS = 0.5
const LINTEL = { depth: 1.2, height: 1.1, overhang: 0.5, seat: 0.15 } as const
const STONES_RELIEF = 7
const STONES_ROAD_MARGIN = 6

/**
 * A lighthouse on a headland, one at most: a tower this wide and tall on a
 * shore this far above the sea, where at least this much of the ground
 * within this reach is sea. Were there more, they would keep this far apart.
 */
const LIGHTHOUSES_MOST = 1
const LIGHTHOUSE = { radius: 4.5, height: 34 } as const
const LIGHTHOUSE_APART = 400
const SHORE = { over: 1.5, under: 14 } as const
const HEADLAND_REACH = 30
const HEADLAND_SAMPLES = 16
const HEADLAND_SEA = 0.45
const COAST_STEP = 3
const LIGHTHOUSE_RELIEF = 7
const LIGHTHOUSE_ROAD_MARGIN = 6

/**
 * Boats moored off the shore: a few, at random, in water deep enough and
 * with the shore not far off, each turned as it lies at anchor. They throw
 * their own dice, like the observatory, so an island's boats stay put.
 */
const BOATS_MOST = 8
const BOAT_TRIES = 200
const BOAT_SALT = 0x0b0a_7e5d
/** A boat's length and beam, how deep it sits and how high it stands over the water. */
const BOAT = { length: { min: 7, max: 12 }, beam: { min: 2.6, max: 3.6 }, draft: 0.8, freeboard: 0.9 } as const
/** The water a boat lies in: this deep at least, with no land nearer than the one distance and some within the other. */
const BOAT_WATER = { depth: 2, offshore: 25, nearShore: 120 } as const
const BOATS_APART = 45

/** How far anything that stands about keeps from anything else that does. */
const FURNITURE_GAP = 2
/** How far apart two of the same thing keep, farm from farm, camp from camp; water towers further. */
const FEATURE_APART = 100
const WATER_TOWERS_APART = 300

/**
 * An orchard: a field planted with fruit trees on a grid instead of a crop,
 * the last field of a farm this often, and a couple more on their own. The
 * trees stand this far apart along a row and the rows this far apart.
 */
const ORCHARD_ODDS = 0.34
const ORCHARDS_ALONE = 2
const ORCHARD_TRIES = 60
const ORCHARD_SIZE = { width: 42, depth: 30 } as const
const ORCHARD_ALONG = 6
const ORCHARD_ROW = 7
const FRUIT_RADIUS = { min: 2, max: 2.8 } as const
const FRUIT_HEIGHT = { min: 3.5, max: 4.5 } as const

/**
 * A church wherever the houses along a road are thick enough to be a
 * village: this many within this reach of one of them, no other church
 * nearer than this. The nave and its tower are this big, set this far
 * back from the road behind a green with a few trees on it.
 */
const VILLAGE_HOUSES = 5
const VILLAGE_REACH = 80
const CHURCH_APART = 600
const CHURCHES_MOST = 4
const NAVE = { width: 26, depth: 12, height: 8 } as const
const TOWER = { size: 6, height: 16 } as const
const CHURCH_SETBACK = 14
const GREEN_TREES = 4

/** A water tower at the edge of each suburb: a column this wide carrying a tank this wide, this tall. */
const WATER_TOWER = { column: 2.4, tank: 8, height: 22 } as const
const WATER_TOWER_TRIES = 24
const WATER_TOWER_IN = 30

/**
 * A filling station every so far along the suburb stretches of the main
 * roads: a lot this big against the road, paved, with the shop at the back,
 * a canopy on posts over the pumps this high, and a sign by the road.
 */
const STATION_APART = 700
const STATION_LOT = { width: 30, depth: 20 } as const
const STATION_RELIEF = 5
const SHOP = { width: 10, depth: 6, height: 4 } as const
const CANOPY = { width: 16, depth: 10, over: 4.5, thick: 0.5 } as const
const POST = 0.4
const SIGN = { width: 0.5, depth: 2, height: 7 } as const

/**
 * Camp sites, this many at most: a clearing this wide in the country near
 * a road but off it, tents on a ring round a fire, caravans off to one side
 * and trees round the rim.
 */
const CAMPS_MOST = 3
const CAMP_TRIES = 80
const CAMP_SALT = 0x0ca3_9e51
const CAMP_NEAR_ROAD = { min: 28, max: 60 } as const
const CLEARING_RADIUS = 20
const TENTS = 6
const TENT_RING = 11
const TENT = { width: 3, depth: 2.5, height: 1.8 } as const
const CARAVANS = 2
const CARAVAN = { width: 6, depth: 2.4, height: 2.6 } as const
const FIRE_PIT = { size: 1.6, height: 0.4 } as const
const RIM_TREES = 24
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
    const reach = hypot(footprint.width, footprint.depth) / 2 + gap
    for (const key of this.cells(footprint, reach)) {
      for (const other of this.buckets.get(key) ?? []) {
        if (footprintsOverlap(footprint, other, gap)) return true
      }
    }
    return false
  }

  add(footprint: Footprint): void {
    const reach = hypot(footprint.width, footprint.depth) / 2
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
  const cos = cosine(footprint.yaw)
  const sin = sine(footprint.yaw)
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
          if (hypot(col * cellSize - point.x, row * cellSize - point.z) > reach) continue
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
    const [radii, heights] =
      kind === 'tree'
        ? [TREE_RADIUS, TREE_HEIGHT]
        : kind === 'fruit'
          ? [FRUIT_RADIUS, FRUIT_HEIGHT]
          : [SHRUB_RADIUS, SHRUB_HEIGHT]
    const radius = randomRange(rng, radii.min, radii.max)
    const height = randomRange(rng, heights.min, heights.max)
    const tone = rng()
    if (wet(x, z)) return false
    // A tree keeps its whole crown to itself; an orchard's trees stand close in rows, whichever
    // way the rows run, so they keep only the middle of theirs.
    const footing = kind === 'fruit' ? radius * 1.4 : radius * 2
    const footprint: Footprint = { x, z, yaw: 0, width: footing, depth: footing }
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
  streets: Road[],
  clear: (footprint: Footprint, margin: number) => boolean,
  clearOfRoads: (footprint: Footprint, margin: number) => boolean,
  wet: (x: number, z: number) => boolean,
  placed: Placed,
  buildings: Building[],
  sidewalks: Sidewalk[],
  fields: Field[],
  trees: Tree[],
  plant: Planter,
): void {
  const { width, cellSize } = field
  /** A street tree: its trunk on the sidewalk, needing only that much room, its crown over the street. */
  const plantStreetTree = (x: number, z: number): void => {
    const radius = randomRange(rng, STREET_TREE_RADIUS.min, STREET_TREE_RADIUS.max)
    const height = randomRange(rng, STREET_TREE_HEIGHT.min, STREET_TREE_HEIGHT.max)
    const tone = rng()
    if (wet(x, z)) return
    const footprint: Footprint = { x, z, yaw: 0, width: 1, depth: 1 }
    if (!clearOfRoads(footprint, 0) || placed.meets(footprint, 0)) return
    placed.add(footprint)
    trees.push({ kind: 'tree', x, z, bottom: sampleHeight(field, x, z), height, radius, tone })
  }
  /**
   * Trees and shrubs scattered over a park lot, as many as fit at random. Each
   * stands far enough inside the lot for its crown to stay in it, so the
   * park never crowds a building out of the lot next door.
   */
  const plantPark = (lot: Footprint): void => {
    const area = (lot.width * lot.depth) / 100
    const cos = cosine(lot.yaw)
    const sin = sine(lot.yaw)
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
  // The streets as straight lines, end to end, which is what they are: a
  // point is on a street when it lies within the carriageway of one.
  const lines = streets
    .filter((street) => street.points.length >= 2)
    .map((street) => {
      const a = street.points[0]!
      const b = street.points[street.points.length - 1]!
      return { ax: a.x, az: a.z, bx: b.x, bz: b.z, half: street.width / 2 }
    })
  const onStreet = (x: number, z: number): boolean =>
    lines.some((line) => {
      const dx = line.bx - line.ax
      const dz = line.bz - line.az
      const lengthSq = dx * dx + dz * dz || 1
      const t = Math.min(Math.max(((x - line.ax) * dx + (z - line.az) * dz) / lengthSq, 0), 1)
      return hypot(x - (line.ax + dx * t), z - (line.az + dz * t)) <= line.half + 1
    })

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
      const yaw = -atan2(sin, cos)
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
        // A side is laid only inside the city: a block cut off by the city's edge gets no kerb out into the grass.
        if (!inCity(cx + u * cos - v * sin, cz + u * sin + v * cos)) return false
        // And only along a street that is there, the whole side long: the
        // grid has gaps where a street was cut, and a kerb along one would
        // be a kerb along nothing.
        const street = STREET_SPACING / 2
        for (const t of [-(half - 1), 0, half - 1]) {
          const su = along ? u + t : Math.sign(du) * street
          const sv = along ? Math.sign(dv) * street : v + t
          const x = cx + (along ? su : blockU + su) * cos - (along ? blockV + sv : sv) * sin
          const z = cz + (along ? su : blockU + su) * sin + (along ? blockV + sv : sv) * cos
          if (!onStreet(x, z)) return false
        }
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
        // The ring is decided now, before the lots are cut, and laid only if something is built on the block.
        const sides = inCity(block.x, block.z) ? ringSides(blockU, blockV) : null
        let built = 0
        const lotsU = cutLots(rng, u0 + edge, u0 + STREET_SPACING - edge)
        const lotsV = cutLots(rng, v0 + edge, v0 + STREET_SPACING - edge)
        for (const [vFrom, vTo] of lotsV) {
          for (const [uFrom, uTo] of lotsU) {
            if (randomInt(rng, 1, PARK_LOT_ODDS) === 1) {
              const lot: Footprint = {
                x: cx + ((uFrom + uTo) / 2) * cos - ((vFrom + vTo) / 2) * sin,
                z: cz + ((uFrom + uTo) / 2) * sin + ((vFrom + vTo) / 2) * cos,
                yaw: -atan2(sin, cos),
                width: uTo - uFrom,
                depth: vTo - vFrom,
              }
              if (!inCity(lot.x, lot.z)) continue
              // An open lot: a car park with its bays marked out, or a park.
              if (rng() < CARPARK_ODDS && clear(lot, 0) && !placed.meets(lot, 0)) {
                const ground = groundUnder(field, wet, lot)
                if (!ground.wet && ground.high - ground.low <= BLOCK_RELIEF) {
                  placed.add(lot)
                  fields.push({ kind: 'carpark', ...lot, tone: 0 })
                  built += 1
                  continue
                }
              }
              plantPark(lot)
              continue
            }
            const insetU = randomRange(rng, LOT_INSET.min, LOT_INSET.max)
            const insetV = randomRange(rng, LOT_INSET.min, LOT_INSET.max)
            const u = (uFrom + uTo) / 2
            const v = (vFrom + vTo) / 2
            const footprint: Footprint = {
              x: cx + u * cos - v * sin,
              z: cz + u * sin + v * cos,
              yaw: -atan2(sin, cos),
              width: uTo - uFrom - 2 * insetU,
              depth: vTo - vFrom - 2 * insetV,
            }
            const core = Math.max(
              0,
              1 - hypot(footprint.x - district.cx, footprint.z - district.cz) / district.radius,
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
            built += 1
          }
        }
        if (sides === null || built === 0 || !sides.some((side) => side)) continue
        sidewalks.push({
          ...block,
          // The frame's own turn: the ring is placed the way the block is.
          yaw: atan2(sin, cos),
          half: STREET_SPACING / 2 - STREET_WIDTH / 2,
          band: SIDEWALK_BAND,
          sides,
        })
        // Street trees along each laid side of the ring, down the middle of the sidewalk.
        const half = STREET_SPACING / 2 - STREET_WIDTH / 2
        const mid = half - SIDEWALK_BAND / 2
        const reach = half - STREET_TREE_SPACING / 2
        for (const [k, laid] of sides.entries()) {
          if (!laid) continue
          for (let t = -reach; t <= reach + 1e-6; t += STREET_TREE_SPACING) {
            const u = blockU + (k === 0 || k === 2 ? t : k === 1 ? -mid : mid)
            const v = blockV + (k === 1 || k === 3 ? t : k === 0 ? mid : -mid)
            plantStreetTree(cx + u * cos - v * sin, cz + u * sin + v * cos)
          }
        }
      }
    }
  }
}

/**
 * The ground an interchange's ramps enclose, as a park: trees and shrubs
 * scattered over it, as many as will stand, off the ramps themselves.
 */
function plantInterchanges(
  rng: Rng,
  zones: { x: number; z: number }[][],
  wet: (x: number, z: number) => boolean,
  plant: Planter,
): void {
  for (const zone of zones) {
    if (zone.length < 3) continue
    const minX = Math.min(...zone.map((point) => point.x))
    const maxX = Math.max(...zone.map((point) => point.x))
    const minZ = Math.min(...zone.map((point) => point.z))
    const maxZ = Math.max(...zone.map((point) => point.z))
    const area = ((maxX - minX) * (maxZ - minZ)) / 100
    for (const [kind, thick] of [
      ['tree', INTERCHANGE_TREES],
      ['shrub', INTERCHANGE_SHRUBS],
    ] as const) {
      for (let k = 0; k < Math.round(area * thick) * PARK_TRIES; k++) {
        const x = randomRange(rng, minX, maxX)
        const z = randomRange(rng, minZ, maxZ)
        if (insidePolygon(zone, x, z)) plant(x, z, kind, wet)
      }
    }
  }
}

/** A road's heading and left-hand normal at one of its samples. */
function frameAlong(road: Road, index: number, point: RoadPoint): { dx: number; dz: number; nx: number; nz: number } {
  const points = road.points
  const prev = points[index - 1] ?? point
  const next = points[index + 1] ?? point
  const dx = next.x - prev.x
  const dz = next.z - prev.z
  const length = hypot(dx, dz) || 1
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
    return districtOf[row * width + col] ?? -1
  }
  const clearings: { x: number; z: number }[] = []
  const inClearing = (x: number, z: number): boolean =>
    clearings.some((house) => hypot(house.x - x, house.z - z) < CLEARING)

  /** A house beside the road at this sample, facing it, if it fits there in `zone`. */
  const placeHouse = (road: Road, index: number, point: RoadPoint, side: number, zone: number): Building | null => {
    const { dx, dz, nx, nz } = frameAlong(road, index, point)
    const kind = HOUSE_STYLES[Math.floor(rng() * HOUSE_STYLES.length)] ?? 'house'
    const [widths, depths, heights] =
      kind === 'cottage'
        ? [COTTAGE_WIDTH, COTTAGE_DEPTH, COTTAGE_HEIGHT]
        : kind === 'villa'
          ? [VILLA_WIDTH, VILLA_DEPTH, VILLA_HEIGHT]
          : [HOUSE_WIDTH, HOUSE_DEPTH, HOUSE_HEIGHT]
    const houseWidth = randomRange(rng, widths.min, widths.max)
    const houseDepth = randomRange(rng, depths.min, depths.max)
    const height = randomRange(rng, heights.min, heights.max)
    const tone = rng()
    const setback = road.width / 2 + randomRange(rng, HOUSE_SETBACK.min, HOUSE_SETBACK.max) + houseDepth / 2
    const footprint: Footprint = {
      x: point.x + nx * side * setback,
      z: point.z + nz * side * setback,
      // Broadside to the road: local X along it.
      yaw: -atan2(dz, dx),
      width: houseWidth,
      depth: houseDepth,
    }
    if (districtAt(footprint.x, footprint.z) !== zone) return null
    if (!clear(footprint, ROAD_MARGIN)) return null
    const ground = groundUnder(field, wet, footprint)
    if (ground.wet || ground.high - ground.low > HOUSE_RELIEF) return null
    if (placed.meets(footprint, BUILDING_GAP)) return null
    placed.add(footprint)
    const house: Building = {
      kind,
      ...footprint,
      bottom: ground.low - BURY,
      top: ground.high + height,
      tone,
    }
    buildings.push(house)
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
    return house
  }

  /** A tree beside the road at this sample, `setback` from its edge, if the ground there is free. */
  const placeTree = (road: Road, index: number, point: RoadPoint, side: number, setback: number): void => {
    const { nx, nz } = frameAlong(road, index, point)
    const x = point.x + nx * side * (road.width / 2 + setback)
    const z = point.z + nz * side * (road.width / 2 + setback)
    if (districtAt(x, z) !== DISTRICT_COUNTRY) return
    if (inClearing(x, z)) return
    plant(x, z, 'tree', wet)
  }

  for (const road of roads) {
    if (road.kind !== 'arterial' && road.kind !== 'cross' && road.kind !== 'highway') continue
    // A highway gets verge trees through the cities and nothing else beside it.
    const highway = road.kind === 'highway'
    const points = road.points
    for (const side of [1, -1]) {
      let travelled = 0
      let nextSlot = 0
      let nextHouse = randomRange(rng, COUNTRY_HOUSE_SPACING.min, COUNTRY_HOUSE_SPACING.max)
      let previous: RoadPoint | undefined
      for (const [i, point] of points.entries()) {
        const behind = previous
        previous = point
        if (behind === undefined) continue
        travelled += hypot(point.x - behind.x, point.z - behind.z)
        if (travelled < nextSlot) continue
        // Nothing beside a bridge: there is a river or a valley there.
        if (road.structure[i - 1] === ROAD_BRIDGE || road.structure[Math.min(i, points.length - 2)] === ROAD_BRIDGE) {
          nextSlot = travelled + TREE_SPACING.min
          continue
        }
        const { nx, nz } = frameAlong(road, i, point)
        const beside = districtAt(point.x + nx * side * road.width, point.z + nz * side * road.width)
        if (beside === DISTRICT_CITY) {
          // Through the city: trees along the verge, on the open ground beside the road.
          const out = road.width / 2 + CITY_VERGE_SETBACK
          plant(point.x + nx * side * out, point.z + nz * side * out, 'tree', wet)
          nextSlot = travelled + CITY_VERGE_SPACING
        } else if (highway) {
          nextSlot = travelled + TREE_SPACING.max
        } else if (beside === DISTRICT_SUBURB) {
          placeHouse(road, i, point, side, DISTRICT_SUBURB)
          nextSlot = travelled + randomRange(rng, SUBURB_SPACING.min, SUBURB_SPACING.max)
        } else if (beside === DISTRICT_COUNTRY) {
          if (travelled >= nextHouse) {
            const house = placeHouse(road, i, point, side, DISTRICT_COUNTRY)
            if (house !== null) clearings.push({ x: house.x, z: house.z })
            nextHouse = travelled + randomRange(rng, COUNTRY_HOUSE_SPACING.min, COUNTRY_HOUSE_SPACING.max)
            nextSlot = travelled + TREE_SPACING.max
          } else {
            if (randomInt(rng, 1, TREE_GAP_ODDS) !== 1) {
              placeTree(road, i, point, side, randomRange(rng, TREE_SETBACK.min, TREE_SETBACK.max))
            }
            if (randomInt(rng, 1, 2) === 1) {
              placeTree(road, i, point, side, randomRange(rng, TREE_BACK_SETBACK.min, TREE_BACK_SETBACK.max))
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
    return districtOf[row * width + col] ?? -1
  }
  for (const road of roads) {
    if (road.kind !== 'arterial' && road.kind !== 'cross') continue
    const points = road.points
    let travelled = 0
    let next = randomRange(rng, RAMP_SPACING.min / 2, RAMP_SPACING.max / 2)
    let previous: RoadPoint | undefined
    for (const [i, point] of points.entries()) {
      const behind = previous
      previous = point
      if (behind === undefined) continue
      travelled += hypot(point.x - behind.x, point.z - behind.z)
      if (travelled < next) continue
      next = travelled + randomRange(rng, RAMP_SPACING.min, RAMP_SPACING.max)
      if (road.structure[i - 1] !== ROAD_GRADE || road.structure[Math.min(i, points.length - 2)] !== ROAD_GRADE) continue
      const side = randomInt(rng, 1, 2) === 1 ? 1 : -1
      const along = randomInt(rng, 1, 2) === 1 ? 1 : -1
      const { dx, dz, nx, nz } = frameAlong(road, i, point)
      const out = road.width / 2 + RAMP_VERGE + RAMP_WIDTH / 2
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
        yaw: -atan2(dz, dx),
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
    return hypot(dx, dz) / (2 * step)
  }
  const districtAt = (x: number, z: number): number => {
    const col = Math.floor(x / cellSize)
    const row = Math.floor(z / cellSize)
    if (col < 0 || col >= width || row < 0 || row >= depth) return -1
    return districtOf[row * width + col] ?? -1
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
): { buildings: Building[]; trees: Tree[]; ramps: Ramp[]; sidewalks: Sidewalk[]; fields: Field[] } {
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
  const fields: Field[] = []
  fillCities(
    rng,
    field,
    districts,
    districtOf,
    roads.filter((road) => road.kind === 'street'),
    clear,
    clearOfRoads,
    wet,
    placed,
    buildings,
    sidewalks,
    fields,
    trees,
    plant,
  )
  plantInterchanges(rng, zones, wet, plant)
  lineRamps(rng, field, districtOf, roads, clear, wet, placed, ramps)
  const stands: Stands = {
    rng,
    field,
    seaLevel,
    districts,
    districtOf,
    roads,
    clear,
    wet,
    placed,
    buildings,
    land: countryLand(field, seaLevel, districtOf),
    stood: new Map(),
  }
  // The stations take their lots before the houses line the roads, or the houses would leave them none.
  raiseStations(stands, fields)
  lineArterials(rng, field, districtOf, roads, clear, wet, placed, buildings, plant)
  // The observatory throws its own dice, so which islands have one does
  // not change whenever something else in here draws a number more or less.
  raiseObservatory(createRng((seed ^ OBSERVATORY_SALT) >>> 0), field, mountains, clear, wet, placed, buildings)
  plantFarms(stands, fields, plant)
  plantOrchards(stands, plant)
  raiseWindFarm(stands)
  raiseStones(stands)
  raiseLighthouses(stands)
  moorBoats({ ...stands, rng: createRng((seed ^ BOAT_SALT) >>> 0) })
  raiseChurches(stands, plant)
  raiseWaterTowers(stands)
  // The camps throw their own dice too, for the same reason as the observatory.
  pitchCamps({ ...stands, rng: createRng((seed ^ CAMP_SALT) >>> 0) }, plant)
  plantWilds(rng, field, seaLevel, mountains, districtOf, seed, clear, wet, plant)
  return { buildings, trees, ramps, sidewalks, fields }
}

/** What everything that stands about the country is placed with. */
interface Stands {
  rng: Rng
  field: Heightfield
  seaLevel: number
  districts: District[]
  districtOf: Uint8Array
  roads: Road[]
  clear: (footprint: Footprint, margin: number) => boolean
  wet: (x: number, z: number) => boolean
  placed: Placed
  buildings: Building[]
  /** Every cell of dry land in the open country, to pick spots from. */
  land: { x: number; z: number }[]
  /** Where each kind of thing stands already, so the next of its kind keeps its distance. */
  stood: Map<string, { x: number; z: number }[]>
}

/** Whether nothing of this kind stands within reach of a spot. */
function farFromKind(stands: Stands, kind: string, x: number, z: number, apart: number): boolean {
  return !(stands.stood.get(kind) ?? []).some((other) => hypot(other.x - x, other.z - z) < apart)
}

function noteStood(stands: Stands, kind: string, x: number, z: number): void {
  const list = stands.stood.get(kind) ?? []
  list.push({ x, z })
  stands.stood.set(kind, list)
}

/** Every cell of land in the open country that is not down at the shore: what the furniture picks its spots from. */
function countryLand(field: Heightfield, seaLevel: number, districtOf: Uint8Array): { x: number; z: number }[] {
  const { width, depth, cellSize, heights } = field
  const land: { x: number; z: number }[] = []
  for (let row = 0; row < depth; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col
      if (districtOf[cell] !== DISTRICT_COUNTRY) continue
      if ((heights[cell] ?? -Infinity) < seaLevel + 2) continue
      land.push({ x: col * cellSize, z: row * cellSize })
    }
  }
  return land
}

/** The directions of a footprint's own axes: along its width, and along its depth. */
function axesOf(yaw: number): { ux: number; uz: number; vx: number; vz: number } {
  const cos = cosine(yaw)
  const sin = sine(yaw)
  return { ux: cos, uz: -sin, vx: sin, vz: cos }
}

/** Somewhere on the land in the open country, taken at random, or nothing on an island with none. */
function countrySpot(stands: Stands): { x: number; z: number } | null {
  const { rng, land } = stands
  return land[Math.floor(rng() * land.length)] ?? null
}

/** Whether a footprint can stand here: off the roads by the margin, on dry ground no more uneven than the relief, and clear of everything else. */
function standsHere(stands: Stands, footprint: Footprint, roadMargin: number, relief: number, gap: number): Ground | null {
  if (!stands.clear(footprint, roadMargin)) return null
  const ground = groundUnder(stands.field, stands.wet, footprint)
  if (ground.wet || ground.high - ground.low > relief) return null
  if (stands.placed.meets(footprint, gap)) return null
  return ground
}

/** A round tower of a kind, this wide and tall, standing on the ground found for it. */
function tower(stands: Stands, kind: Building['kind'], footprint: Footprint, ground: Ground, height: number): void {
  stands.placed.add(footprint)
  stands.buildings.push({ kind, ...footprint, bottom: ground.low - BURY, top: ground.high + height, tone: stands.rng() })
}

/**
 * Farms in the open country: a row of fields side by side, each hedged
 * round with shrubs, and off one end of the row a barn with a silo or two
 * beside it. A farm is at least two fields, on ground flat enough to plough.
 */
function plantFarms(stands: Stands, fields: Field[], plant: Planter): void {
  const { rng, placed } = stands
  let farms = 0
  for (let attempt = 0; attempt < FARM_TRIES && farms < FARMS_MOST; attempt++) {
    const spot = countrySpot(stands)
    if (spot === null || !farFromKind(stands, 'farm', spot.x, spot.z, FEATURE_APART)) continue
    const yaw = randomRange(rng, 0, Math.PI)
    const count = randomInt(rng, FIELDS_PER_FARM.min, FIELDS_PER_FARM.max)
    const length = randomRange(rng, FIELD_LENGTH.min, FIELD_LENGTH.max)
    const width = randomRange(rng, FIELD_WIDTH.min, FIELD_WIDTH.max)
    const { ux, uz, vx, vz } = axesOf(yaw)
    const laid: Footprint[] = []
    for (let k = 0; k < count; k++) {
      const across = k * (width + FIELD_GAP)
      const footprint: Footprint = { x: spot.x + vx * across, z: spot.z + vz * across, yaw, width: length, depth: width }
      // The row stops where the country does.
      if (!inCountry(stands, footprint)) break
      if (standsHere(stands, footprint, FIELD_ROAD_MARGIN, FIELD_RELIEF, FURNITURE_GAP) === null) break
      laid.push(footprint)
    }
    if (laid.length < 2) continue
    noteStood(stands, 'farm', spot.x, spot.z)
    for (const [k, footprint] of laid.entries()) {
      // The last field of a farm is sometimes an orchard instead of a crop, where one will take.
      if (k === laid.length - 1 && rng() < ORCHARD_ODDS && plantOrchard(stands, footprint, plant)) continue
      placed.add(footprint)
      fields.push({ kind: 'crop', ...footprint, tone: rng() })
      hedge(stands, footprint, plant)
    }
    // The barn off the end of the first field, broadside to the row, and the silos beside it.
    const first = laid[0]
    if (first === undefined) continue
    const out = first.width / 2 + BARN.width / 2 + BARN_OFF
    const barn: Footprint = { x: first.x + ux * out, z: first.z + uz * out, yaw, width: BARN.width, depth: BARN.depth }
    const ground = standsHere(stands, barn, ROAD_MARGIN, HOUSE_RELIEF, FURNITURE_GAP)
    if (ground !== null) {
      placed.add(barn)
      stands.buildings.push({ kind: 'barn', ...barn, bottom: ground.low - BURY, top: ground.high + BARN.height, tone: rng() })
      for (let k = randomInt(rng, SILOS.min, SILOS.max), n = 0; n < k; n++) {
        const beside = BARN.width / 2 + SILO.radius + 3.5 + n * (SILO.radius * 2 + 2)
        const silo: Footprint = {
          x: barn.x + ux * beside,
          z: barn.z + uz * beside,
          yaw: 0,
          width: SILO.radius * 2,
          depth: SILO.radius * 2,
        }
        const under = standsHere(stands, silo, ROAD_MARGIN, SILO_RELIEF, FURNITURE_GAP)
        if (under !== null) tower(stands, 'silo', silo, under, SILO.height)
      }
    }
    farms += 1
  }
}

/** A hedge round a footprint: shrubs a step apart along each side, just outside it. */
function hedge(stands: Stands, footprint: Footprint, plant: Planter): void {
  const { ux, uz, vx, vz } = axesOf(footprint.yaw)
  const halfU = footprint.width / 2 + HEDGE_OUT
  const halfV = footprint.depth / 2 + HEDGE_OUT
  for (let u = -halfU; u <= halfU; u += HEDGE_SPACING) {
    for (const v of [-halfV, halfV]) plant(footprint.x + ux * u + vx * v, footprint.z + uz * u + vz * v, 'shrub', stands.wet)
  }
  for (let v = -halfV + HEDGE_SPACING; v < halfV; v += HEDGE_SPACING) {
    for (const u of [-halfU, halfU]) plant(footprint.x + ux * u + vx * v, footprint.z + uz * u + vz * v, 'shrub', stands.wet)
  }
}

/** How far in from an orchard's edge the outermost trees stand: a crown's width, clear of the hedge. */
const ORCHARD_IN = 3.5

/** Where an orchard's trees would stand on a footprint: a grid along its rows, in from the hedge. */
function orchardGrid(footprint: Footprint): { x: number; z: number }[] {
  const { ux, uz, vx, vz } = axesOf(footprint.yaw)
  const halfU = footprint.width / 2 - ORCHARD_IN
  const halfV = footprint.depth / 2 - ORCHARD_IN
  const grid: { x: number; z: number }[] = []
  for (let v = -halfV; v <= halfV + 1e-6; v += ORCHARD_ROW) {
    for (let u = -halfU; u <= halfU + 1e-6; u += ORCHARD_ALONG) {
      grid.push({ x: footprint.x + ux * u + vx * v, z: footprint.z + uz * u + vz * v })
    }
  }
  return grid
}

/** Whether an orchard would take on a footprint: nearly all of its trees on dry ground away from any road. */
function orchardTakes(stands: Stands, footprint: Footprint): boolean {
  const grid = orchardGrid(footprint)
  const crown = FRUIT_RADIUS.max
  const fine = grid.filter(
    (spot) => !stands.wet(spot.x, spot.z) && stands.clear({ ...spot, yaw: 0, width: crown * 2, depth: crown * 2 }, 4),
  )
  return fine.length >= grid.length * 0.9
}

/**
 * An orchard on a footprint: fruit trees on its grid, hedged about, and
 * the ground kept for them. Nothing, if the ground would not take one.
 */
function plantOrchard(stands: Stands, footprint: Footprint, plant: Planter): boolean {
  if (!farFromKind(stands, 'orchard', footprint.x, footprint.z, FEATURE_APART)) return false
  if (!orchardTakes(stands, footprint)) return false
  for (const spot of orchardGrid(footprint)) plant(spot.x, spot.z, 'fruit', stands.wet)
  stands.placed.add(footprint)
  hedge(stands, footprint, plant)
  noteStood(stands, 'orchard', footprint.x, footprint.z)
  return true
}

/** A couple of orchards on their own in the open country, where a field's worth of gentle ground is free. */
function plantOrchards(stands: Stands, plant: Planter): void {
  const { rng } = stands
  let orchards = 0
  for (let attempt = 0; attempt < ORCHARD_TRIES && orchards < ORCHARDS_ALONE; attempt++) {
    const spot = countrySpot(stands)
    if (spot === null) continue
    const footprint: Footprint = { ...spot, yaw: randomRange(rng, 0, Math.PI), ...ORCHARD_SIZE }
    if (!inCountry(stands, footprint)) continue
    if (standsHere(stands, footprint, FIELD_ROAD_MARGIN, FIELD_RELIEF, FURNITURE_GAP) === null) continue
    if (plantOrchard(stands, footprint, plant)) orchards += 1
  }
}

/** The main roads: what runs between and through the towns, as opposed to the streets of a city. */
function mainRoads(roads: Road[]): Road[] {
  return roads.filter((road) => road.kind === 'arterial' || road.kind === 'cross' || road.kind === 'highway')
}

/** The nearest point of any of these roads to a spot, at grade, and how far off it is. */
function nearestRoadPoint(
  roads: Road[],
  x: number,
  z: number,
): { road: Road; index: number; point: RoadPoint; distance: number } | null {
  let best: { road: Road; index: number; point: RoadPoint; distance: number } | null = null
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (const [i, point] of road.points.entries()) {
      if (i >= segmentCount) break
      if (road.structure[i] !== ROAD_GRADE) continue
      const distance = hypot(point.x - x, point.z - z)
      if (best !== null && distance >= best.distance) continue
      best = { road, index: i, point, distance }
    }
  }
  return best
}

/** Whether a footprint lies in the open country to its corners, not over an edge into a suburb. */
function inCountry(stands: Stands, footprint: Footprint): boolean {
  const { ux, uz, vx, vz } = axesOf(footprint.yaw)
  for (const [su, sv] of [
    [0, 0],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const u = (su * footprint.width) / 2
    const v = (sv * footprint.depth) / 2
    if (districtAt(stands, footprint.x + ux * u + vx * v, footprint.z + uz * u + vz * v) !== DISTRICT_COUNTRY) return false
  }
  return true
}

function districtAt(stands: Stands, x: number, z: number): number {
  const { width, depth, cellSize } = stands.field
  const col = Math.floor(x / cellSize)
  const row = Math.floor(z / cellSize)
  if (col < 0 || col >= width || row < 0 || row >= depth) return -1
  return stands.districtOf[row * width + col] ?? -1
}

/**
 * A church for every village: where the houses along a road stand thickest,
 * a nave broadside to the road, set back behind a green with trees on it,
 * and a tower with a spire at one end of the nave. The thickest cluster
 * first, then the next that is far enough from every church so far.
 */
function raiseChurches(stands: Stands, plant: Planter): void {
  const { rng, buildings, placed } = stands
  const houses = buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
  const clusters = houses
    .map((house) => ({
      house,
      near: houses.filter((other) => hypot(other.x - house.x, other.z - house.z) < VILLAGE_REACH).length,
    }))
    .filter((cluster) => cluster.near >= VILLAGE_HOUSES)
    .sort((a, b) => b.near - a.near || a.house.x - b.house.x || a.house.z - b.house.z)
  const roads = mainRoads(stands.roads)
  const churches: { x: number; z: number }[] = []
  for (const { house } of clusters) {
    if (churches.length >= CHURCHES_MOST) break
    if (churches.some((church) => hypot(church.x - house.x, church.z - house.z) < CHURCH_APART)) continue
    const beside = nearestRoadPoint(roads, house.x, house.z)
    if (beside === null) continue
    const { road, index, point } = beside
    const { dx, dz, nx, nz } = frameAlong(road, index, point)
    const yaw = -atan2(dz, dx)
    for (const side of [1, -1]) {
      const back = road.width / 2 + CHURCH_SETBACK + NAVE.depth / 2
      const nave: Footprint = { x: point.x + nx * side * back, z: point.z + nz * side * back, yaw, ...NAVE }
      const naveGround = standsHere(stands, nave, ROAD_MARGIN, HOUSE_RELIEF + 1, FURNITURE_GAP)
      if (naveGround === null) continue
      const along = NAVE.width / 2 + TOWER.size / 2 + 0.2
      const tower: Footprint = { x: nave.x + dx * along, z: nave.z + dz * along, yaw, width: TOWER.size, depth: TOWER.size }
      const towerGround = standsHere(stands, tower, ROAD_MARGIN, HOUSE_RELIEF + 1, FURNITURE_GAP)
      if (towerGround === null) continue
      placed.add(nave)
      placed.add(tower)
      const tone = rng()
      buildings.push({ kind: 'church', ...nave, bottom: naveGround.low - BURY, top: naveGround.high + NAVE.height, tone })
      buildings.push({ kind: 'steeple', ...tower, bottom: towerGround.low - BURY, top: towerGround.high + TOWER.height, tone })
      // The green between the road and the nave, kept open, with trees at its ends.
      const greenBack = road.width / 2 + CHURCH_SETBACK / 2
      const green: Footprint = {
        x: point.x + nx * side * greenBack,
        z: point.z + nz * side * greenBack,
        yaw,
        width: NAVE.width + TOWER.size,
        depth: CHURCH_SETBACK - 2,
      }
      for (let k = 0; k < GREEN_TREES; k++) {
        const end = (k % 2 === 0 ? 1 : -1) * (green.width / 2 - 1)
        const off = (k < 2 ? -1 : 1) * (green.depth / 4)
        plant(green.x + dx * end + nx * off, green.z + dz * end + nz * off, 'tree', stands.wet)
      }
      if (!placed.meets(green, 0)) placed.add(green)
      churches.push({ x: nave.x, z: nave.z })
      break
    }
  }
}

/** A water tower at the edge of each suburb, on the first spot of a few tried that will take one. */
function raiseWaterTowers(stands: Stands): void {
  const { rng, placed } = stands
  for (const district of stands.districts) {
    const ring = district.radius + district.suburbWidth - WATER_TOWER_IN
    for (let attempt = 0; attempt < WATER_TOWER_TRIES; attempt++) {
      const angle = randomRange(rng, 0, Math.PI * 2)
      const x = district.cx + cosine(angle) * ring
      const z = district.cz + sine(angle) * ring
      if (districtAt(stands, x, z) !== DISTRICT_SUBURB) continue
      if (!farFromKind(stands, 'watertower', x, z, WATER_TOWERS_APART)) continue
      // Nothing under the tank, though only the column is anything to hit.
      const under: Footprint = { x, z, yaw: 0, width: WATER_TOWER.tank, depth: WATER_TOWER.tank }
      const ground = standsHere(stands, under, ROAD_MARGIN, HOUSE_RELIEF, FURNITURE_GAP)
      if (ground === null) continue
      placed.add(under)
      stands.buildings.push({
        kind: 'watertower',
        x,
        z,
        yaw: 0,
        width: WATER_TOWER.column,
        depth: WATER_TOWER.column,
        bottom: ground.low - BURY,
        top: ground.high + WATER_TOWER.height,
        tone: rng(),
      })
      noteStood(stands, 'watertower', x, z)
      break
    }
  }
}

/**
 * Filling stations along the suburb stretches of the main roads, one every
 * so far: a paved lot against the road, the shop at the back of it, a
 * canopy on four posts over the pumps, and a sign at the roadside corner.
 */
function raiseStations(stands: Stands, fields: Field[]): void {
  const { rng, placed, buildings } = stands
  const stations: { x: number; z: number }[] = []
  for (const road of mainRoads(stands.roads)) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    let travelled = randomRange(rng, 0, STATION_APART)
    let previous = road.points[0]
    for (const [index, point] of road.points.entries()) {
      if (index >= segmentCount || previous === undefined) break
      travelled += hypot(point.x - previous.x, point.z - previous.z)
      previous = point
      if (travelled < STATION_APART || road.structure[index] !== ROAD_GRADE) continue
      if (districtAt(stands, point.x, point.z) !== DISTRICT_SUBURB) continue
      if (stations.some((station) => hypot(station.x - point.x, station.z - point.z) < STATION_APART)) continue
      const { dx, dz, nx, nz } = frameAlong(road, index, point)
      const yaw = -atan2(dz, dx)
      for (const side of [1, -1]) {
        const back = road.width / 2 + STATION_LOT.depth / 2 + 0.5
        const lot: Footprint = { x: point.x + nx * side * back, z: point.z + nz * side * back, yaw, ...STATION_LOT }
        // The whole lot in the suburb, not over its edge into the country.
        if (districtAt(stands, lot.x, lot.z) !== DISTRICT_SUBURB) continue
        const ground = standsHere(stands, lot, 0.5, STATION_RELIEF, FURNITURE_GAP)
        if (ground === null) continue
        placed.add(lot)
        fields.push({ kind: 'asphalt', ...lot, tone: 0 })
        // Whatever stands on the lot is buried like a house; whatever floats over it, the canopy,
        // floats that far over the highest ground under the lot, and its posts reach up to it.
        const stand = (kind: Building['kind'], footprint: Footprint, over: number, height: number): void => {
          const bottom = over > 0 ? ground.high + over : ground.low - BURY
          const top = over > 0 ? bottom + height : ground.high + height
          buildings.push({ kind, ...footprint, bottom, top, tone: rng() })
        }
        // In from the road: the lot's own depth axis runs away from it on this side.
        const at = (along: number, inward: number): { x: number; z: number } => ({
          x: lot.x + dx * along + nx * side * inward,
          z: lot.z + dz * along + nz * side * inward,
        })
        stand('shop', { ...at(0, STATION_LOT.depth / 2 - SHOP.depth / 2 - 1), yaw, width: SHOP.width, depth: SHOP.depth }, 0, SHOP.height)
        const canopyAt = at(0, -2)
        stand('canopy', { ...canopyAt, yaw, width: CANOPY.width, depth: CANOPY.depth }, CANOPY.over, CANOPY.thick)
        for (const cu of [-1, 1]) {
          for (const cv of [-1, 1]) {
            const corner = at(cu * (CANOPY.width / 2 - 0.6), -2 + cv * (CANOPY.depth / 2 - 0.6))
            stand('post', { ...corner, yaw, width: POST, depth: POST }, 0, CANOPY.over)
          }
        }
        stand('sign', { ...at(STATION_LOT.width / 2 - 2, -(STATION_LOT.depth / 2 - 1.5)), yaw, width: SIGN.width, depth: SIGN.depth }, 0, SIGN.height)
        stations.push({ x: lot.x, z: lot.z })
        travelled = 0
        break
      }
    }
  }
}

/**
 * Camp sites in the country near a road: a clearing with a fire in the
 * middle, tents on a ring round it turned to face it, a couple of caravans
 * off to one side, and trees round the rim so it reads as cut out of the
 * woods.
 */
function pitchCamps(stands: Stands, plant: Planter): void {
  const { rng, placed, buildings, field, wet } = stands
  const roads = mainRoads(stands.roads)
  let camps = 0
  for (let attempt = 0; attempt < CAMP_TRIES && camps < CAMPS_MOST; attempt++) {
    const spot = countrySpot(stands)
    if (spot === null || !farFromKind(stands, 'camp', spot.x, spot.z, FEATURE_APART)) continue
    const beside = nearestRoadPoint(roads, spot.x, spot.z)
    if (beside === null || beside.distance < CAMP_NEAR_ROAD.min || beside.distance > CAMP_NEAR_ROAD.max) continue
    const clearing: Footprint = { ...spot, yaw: 0, width: CLEARING_RADIUS * 2, depth: CLEARING_RADIUS * 2 }
    if (standsHere(stands, clearing, 1, FIELD_RELIEF, FURNITURE_GAP) === null) continue
    const pit: Footprint = { ...spot, yaw: rng() * Math.PI, width: FIRE_PIT.size, depth: FIRE_PIT.size }
    const pitGround = groundUnder(field, wet, pit)
    buildings.push({ kind: 'firepit', ...pit, bottom: pitGround.low - BURY, top: pitGround.high + FIRE_PIT.height, tone: rng() })
    for (let k = 0; k < TENTS; k++) {
      const angle = (k * Math.PI * 2) / TENTS + randomRange(rng, -0.2, 0.2)
      const tent: Footprint = {
        x: spot.x + cosine(angle) * TENT_RING,
        z: spot.z + sine(angle) * TENT_RING,
        // Its door to the fire: broadside to the middle.
        yaw: -(angle + Math.PI / 2),
        width: TENT.width,
        depth: TENT.depth,
      }
      const ground = groundUnder(field, wet, tent)
      if (ground.wet) continue
      buildings.push({ kind: 'tent', ...tent, bottom: ground.low - BURY, top: ground.high + TENT.height, tone: rng() })
    }
    // The caravans parked side by side along the rim, nose to the fire.
    const parking = randomRange(rng, 0, Math.PI * 2)
    for (let k = 0; k < CARAVANS; k++) {
      const angle = parking + k * 0.8
      const caravan: Footprint = {
        x: spot.x + cosine(angle) * (CLEARING_RADIUS - 5),
        z: spot.z + sine(angle) * (CLEARING_RADIUS - 5),
        yaw: -(angle + Math.PI / 2),
        width: CARAVAN.width,
        depth: CARAVAN.depth,
      }
      const ground = groundUnder(field, wet, caravan)
      if (ground.wet) continue
      buildings.push({ kind: 'caravan', ...caravan, bottom: ground.low - BURY, top: ground.high + CARAVAN.height, tone: rng() })
    }
    for (let k = 0; k < RIM_TREES; k++) {
      const angle = (k * Math.PI * 2) / RIM_TREES
      plant(spot.x + cosine(angle) * (CLEARING_RADIUS - 1), spot.z + sine(angle) * (CLEARING_RADIUS - 1), 'tree', wet)
    }
    placed.add(clearing)
    noteStood(stands, 'camp', spot.x, spot.z)
    camps += 1
  }
}

/**
 * The island's wind farm: a line of turbines across the open country, all
 * facing the same way, wherever the first place tried has room for enough
 * of them in a row.
 */
function raiseWindFarm(stands: Stands): void {
  const { rng } = stands
  for (let attempt = 0; attempt < WIND_FARM_TRIES; attempt++) {
    const spot = countrySpot(stands)
    if (spot === null) continue
    const line = randomRange(rng, 0, Math.PI)
    const facing = randomRange(rng, 0, Math.PI * 2)
    const wanted = randomInt(rng, TURBINES.min, TURBINES.max)
    const dx = cosine(line)
    const dz = sine(line)
    const standing: { footprint: Footprint; ground: Ground }[] = []
    for (let k = 0; k < wanted; k++) {
      const footprint: Footprint = {
        x: spot.x + dx * k * TURBINE_SPACING,
        z: spot.z + dz * k * TURBINE_SPACING,
        yaw: facing,
        width: TURBINE.radius * 2,
        depth: TURBINE.radius * 2,
      }
      const ground = standsHere(stands, footprint, TURBINE_ROAD_MARGIN, TURBINE_RELIEF, TURBINE_GAP)
      if (ground === null) break
      standing.push({ footprint, ground })
    }
    if (standing.length < TURBINES_LEAST) continue
    for (const { footprint, ground } of standing) tower(stands, 'turbine', footprint, ground, TURBINE.height)
    return
  }
}

/**
 * The island's ring of standing stones, on the highest open ground of a
 * few tries: the stones round the ring, each turned to face its middle.
 */
function raiseStones(stands: Stands): void {
  const { rng, field, placed, buildings } = stands
  let best: { x: number; z: number; height: number } | null = null
  for (let attempt = 0; attempt < STONES_TRIES; attempt++) {
    const spot = countrySpot(stands)
    if (spot === null) continue
    const height = sampleHeight(field, spot.x, spot.z)
    if (best !== null && height <= best.height) continue
    const ring: Footprint = { ...spot, yaw: 0, width: (STONE_RING + 2) * 2, depth: (STONE_RING + 2) * 2 }
    if (standsHere(stands, ring, STONES_ROAD_MARGIN, STONES_RELIEF, FURNITURE_GAP) === null) continue
    best = { ...spot, height }
  }
  if (best === null) return
  placed.add({ x: best.x, z: best.z, yaw: 0, width: (STONE_RING + 2) * 2, depth: (STONE_RING + 2) * 2 })
  // The altar in the middle, lying down.
  const altar: Footprint = { x: best.x, z: best.z, yaw: rng() * Math.PI, width: ALTAR.width, depth: ALTAR.depth }
  const under = groundUnder(field, stands.wet, altar)
  if (!under.wet) {
    buildings.push({ kind: 'stone', ...altar, bottom: under.low - BURY, top: under.high + ALTAR.height, tone: rng() })
  }
  // Which pairs of neighbours carry a lintel, and how tall each stone is:
  // the same as its neighbour where a lintel joins them.
  const lintels = Array.from({ length: STONES }, () => rng() < LINTEL_ODDS)
  const heights = Array.from({ length: STONES }, () => randomRange(rng, STONE.height.min, STONE.height.max))
  for (let k = 0; k < STONES; k++) {
    if (lintels[k]) heights[(k + 1) % STONES] = heights[k] ?? STONE.height.min
  }
  const standing: (Building | null)[] = []
  for (let k = 0; k < STONES; k++) {
    const angle = (k * Math.PI * 2) / STONES + randomRange(rng, -0.12, 0.12)
    const x = best.x + cosine(angle) * STONE_RING
    const z = best.z + sine(angle) * STONE_RING
    // Broadside to the middle of the ring.
    const stone: Footprint = { x, z, yaw: -(angle + Math.PI / 2), width: STONE.width, depth: STONE.depth }
    const ground = groundUnder(field, stands.wet, stone)
    if (ground.wet) {
      standing.push(null)
      continue
    }
    const raised: Building = {
      kind: 'stone',
      ...stone,
      bottom: ground.low - BURY,
      top: ground.high + (heights[k] ?? STONE.height.min),
      tone: rng(),
    }
    buildings.push(raised)
    standing.push(raised)
  }
  // Stones joined by lintels, however many in a row, are brought to one
  // top, the tallest of them, so that every lintel lies level on both.
  const joined = (k: number): (Building | null)[] => {
    const run: (Building | null)[] = [standing[k] ?? null]
    for (let n = 0; n < STONES && lintels[(k + n) % STONES]; n++) run.push(standing[(k + n + 1) % STONES] ?? null)
    return run
  }
  for (let k = 0; k < STONES; k++) {
    if (lintels[(k + STONES - 1) % STONES] && !lintels.every(Boolean)) continue
    const run = joined(k)
    if (run.length < 2) continue
    const top = Math.max(...run.map((stone) => stone?.top ?? -Infinity))
    for (const stone of run) if (stone !== null) stone.top = top
    if (lintels.every(Boolean)) break
  }
  // The lintels, laid from each stone across to its neighbour, resting on both.
  for (let k = 0; k < STONES; k++) {
    if (!lintels[k]) continue
    const a = standing[k]
    const b = standing[(k + 1) % STONES]
    if (a === null || b === null || a === undefined || b === undefined) continue
    const dx = b.x - a.x
    const dz = b.z - a.z
    const span = hypot(dx, dz)
    const rest = Math.min(a.top, b.top) - LINTEL.seat
    buildings.push({
      kind: 'lintel',
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      // Along the line from the one to the other.
      yaw: -atan2(dz, dx),
      width: span + STONE.width + LINTEL.overhang * 2,
      depth: LINTEL.depth,
      bottom: rest,
      top: rest + LINTEL.height,
      tone: rng(),
    })
  }
}

/**
 * The island's lighthouse: the shore is walked for the spots with the most
 * sea about them, and the most seaward whose ground will take a tower gets
 * it.
 */
function raiseLighthouses(stands: Stands): void {
  const raised: { x: number; z: number }[] = []
  for (const spot of shoreSpots(stands)) {
    if (raised.length >= LIGHTHOUSES_MOST) break
    if (raised.some((other) => hypot(other.x - spot.x, other.z - spot.z) < LIGHTHOUSE_APART)) continue
    const footprint: Footprint = {
      x: spot.x,
      z: spot.z,
      yaw: 0,
      width: LIGHTHOUSE.radius * 2,
      depth: LIGHTHOUSE.radius * 2,
    }
    const ground = standsHere(stands, footprint, LIGHTHOUSE_ROAD_MARGIN, LIGHTHOUSE_RELIEF, FURNITURE_GAP)
    if (ground === null) continue
    tower(stands, 'lighthouse', footprint, ground, LIGHTHOUSE.height)
    noteStood(stands, 'lighthouse', spot.x, spot.z)
    raised.push(spot)
  }
}

/** A spot on the shore with the sea about it: how much of the ground round it is sea, and which way the sea mostly lies. */
interface ShoreSpot {
  x: number
  z: number
  sea: number
  /** Unit direction out to sea. */
  outX: number
  outZ: number
}

/**
 * The shore, walked for the spots that stand just above the sea with
 * plenty of sea about them, the most seaward first and among equals in the
 * order they were walked in. The lighthouse, the harbour and the wrecks
 * all pick from these.
 */
function shoreSpots(stands: Stands): ShoreSpot[] {
  const { field, seaLevel } = stands
  const { width, depth, cellSize } = field
  const spots: ShoreSpot[] = []
  for (let row = 0; row < depth; row += COAST_STEP) {
    for (let col = 0; col < width; col += COAST_STEP) {
      const x = col * cellSize
      const z = row * cellSize
      const height = sampleHeight(field, x, z)
      if (height < seaLevel + SHORE.over || height > seaLevel + SHORE.under) continue
      let sea = 0
      let outX = 0
      let outZ = 0
      for (let k = 0; k < HEADLAND_SAMPLES; k++) {
        const angle = (k * Math.PI * 2) / HEADLAND_SAMPLES
        if (sampleHeight(field, x + cosine(angle) * HEADLAND_REACH, z + sine(angle) * HEADLAND_REACH) >= seaLevel) continue
        sea += 1
        outX += cosine(angle)
        outZ += sine(angle)
      }
      sea /= HEADLAND_SAMPLES
      const reach = hypot(outX, outZ)
      if (sea < HEADLAND_SEA || reach === 0) continue
      spots.push({ x, z, sea, outX: outX / reach, outZ: outZ / reach })
    }
  }
  spots.sort((a, b) => b.sea - a.sea || a.z - b.z || a.x - b.x)
  return spots
}

/**
 * A few boats moored off the shore, wherever the sea is a couple of metres
 * deep with the shore in sight but not close: the coast's sea cells are
 * walked for such water, and boats are set down on it at random, each
 * turned as it lies at anchor and none too near another.
 */
function moorBoats(stands: Stands): void {
  const { rng, field, seaLevel, placed, buildings } = stands
  const { width, depth, cellSize } = field
  const water: { x: number; z: number }[] = []
  const landWithin = (x: number, z: number, reach: number): boolean => {
    for (let k = 0; k < HEADLAND_SAMPLES; k++) {
      const angle = (k * Math.PI * 2) / HEADLAND_SAMPLES
      if (sampleHeight(field, x + cosine(angle) * reach, z + sine(angle) * reach) >= seaLevel) return true
    }
    return false
  }
  for (let row = 0; row < depth; row += COAST_STEP) {
    for (let col = 0; col < width; col += COAST_STEP) {
      const x = col * cellSize
      const z = row * cellSize
      if (sampleHeight(field, x, z) > seaLevel - BOAT_WATER.depth) continue
      if (landWithin(x, z, BOAT_WATER.offshore) || !landWithin(x, z, BOAT_WATER.nearShore)) continue
      water.push({ x, z })
    }
  }
  let moored = 0
  for (let attempt = 0; attempt < BOAT_TRIES && moored < BOATS_MOST && water.length > 0; attempt++) {
    const spot = water[Math.floor(rng() * water.length)]!
    const length = randomRange(rng, BOAT.length.min, BOAT.length.max)
    const beam = randomRange(rng, BOAT.beam.min, BOAT.beam.max)
    const yaw = rng() * Math.PI * 2
    const tone = rng()
    if (!farFromKind(stands, 'boat', spot.x, spot.z, BOATS_APART)) continue
    const boat: Footprint = { x: spot.x, z: spot.z, yaw, width: length, depth: beam }
    if (placed.meets(boat, FURNITURE_GAP)) continue
    placed.add(boat)
    buildings.push({ kind: 'boat', ...boat, bottom: seaLevel - BOAT.draft, top: seaLevel + BOAT.freeboard, tone })
    noteStood(stands, 'boat', spot.x, spot.z)
    moored += 1
  }
}

/** The highest ground inside a triangle, at a cell of the field, or nothing if the triangle covers none. */
function highestWithin(field: Heightfield, triangle: Triangle): { x: number; z: number } | null {
  const { width, depth, cellSize, heights } = field
  const cols = [triangle.ax, triangle.bx, triangle.cx].map((x) => x / cellSize)
  const rows = [triangle.az, triangle.bz, triangle.cz].map((z) => z / cellSize)
  const colFrom = Math.max(Math.floor(Math.min(...cols)), 0)
  const colTo = Math.min(Math.ceil(Math.max(...cols)), width - 1)
  const rowFrom = Math.max(Math.floor(Math.min(...rows)), 0)
  const rowTo = Math.min(Math.ceil(Math.max(...rows)), depth - 1)
  let best: { x: number; z: number } | null = null
  let top = -Infinity
  for (let row = rowFrom; row <= rowTo; row++) {
    for (let col = colFrom; col <= colTo; col++) {
      const x = col * cellSize
      const z = row * cellSize
      if (signedDistanceToTriangle(x, z, triangle) < 0) continue
      const height = heights[row * width + col] ?? -Infinity
      if (height <= top) continue
      top = height
      best = { x, z }
    }
  }
  return best
}

/**
 * The island's one observatory, if it has one: a round tower under a dome
 * on the highest ground within a mountain's own triangle, where no road
 * runs and nothing else stands. The mountains are tried from one chosen at
 * random, and the first whose peak will take it gets it.
 */
function raiseObservatory(
  rng: Rng,
  field: Heightfield,
  mountains: Mountain[],
  clear: (footprint: Footprint, margin: number) => boolean,
  wet: (x: number, z: number) => boolean,
  placed: Placed,
  buildings: Building[],
): void {
  if (mountains.length === 0 || rng() >= OBSERVATORY_ODDS) return
  const first = Math.floor(rng() * mountains.length)
  const tone = rng()
  for (let tried = 0; tried < mountains.length; tried++) {
    const mountain = mountains[(first + tried) % mountains.length]
    if (mountain === undefined) continue
    const peak = highestWithin(field, orientedTriangle(mountain))
    if (peak === null) continue
    const footprint: Footprint = { x: peak.x, z: peak.z, yaw: 0, width: OBSERVATORY_SIZE, depth: OBSERVATORY_SIZE }
    if (!clear(footprint, ROAD_MARGIN)) continue
    const ground = groundUnder(field, wet, footprint)
    if (ground.wet || ground.high - ground.low > OBSERVATORY_RELIEF) continue
    if (placed.meets(footprint, BUILDING_GAP)) continue
    placed.add(footprint)
    buildings.push({
      kind: 'observatory',
      ...footprint,
      bottom: ground.low - BURY,
      top: ground.high + OBSERVATORY_HEIGHT,
      tone,
    })
    return
  }
}
