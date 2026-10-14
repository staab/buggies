/**
 * A grid of ground heights sampled on the XZ plane, row by row, `width *
 * depth` samples in all: the ground an interchange is laid out on in its
 * frame, or a level test ground for the physics.
 */
export interface Heightfield {
  width: number
  depth: number
  cellSize: number
  heights: Float32Array
}

/** A point of a road laid out in a frame: across it, how high, and down it. */
export interface RoadPoint {
  x: number
  y: number
  z: number
}

/**
 * What a road is, which decides how it is made. The highway is a structure
 * over the land: an embankment, a bridge, a tunnel. Everything else is the
 * land, shaped to it and painted on.
 */
export type RoadKind = 'highway' | 'ramp' | 'cross' | 'arterial' | 'street'

/**
 * A road laid out in a frame, as an interchange's cross road and ramps are
 * before they are stood on the planet. `structure` holds one `ROAD_*` code a
 * segment: segment `i` runs from `points[i]` to the next point, round to
 * the first on a closed road.
 */
export interface Road {
  id: number
  kind: RoadKind
  closed: boolean
  /** Full roadway width, in meters. */
  width: number
  points: RoadPoint[]
  structure: Uint8Array
}

/**
 * What a building is: a city block, one of three styles of house, an
 * observatory on a mountain top, a farm's barn or silo, a wind turbine, a
 * standing stone or the lintel laid across two of them, or a lighthouse on
 * a headland; and on the other worlds, a solar array, a radio dish, a
 * beacon at a platform's edge, a giant mushroom or a glowing crystal.
 */
export type BuildingKind =
  | 'block'
  | 'house'
  | 'cottage'
  | 'villa'
  | 'observatory'
  | 'barn'
  | 'silo'
  | 'turbine'
  | 'stone'
  | 'lintel'
  | 'lighthouse'
  | 'church'
  | 'steeple'
  | 'watertower'
  | 'shop'
  | 'canopy'
  | 'post'
  | 'sign'
  | 'tent'
  | 'camper'
  | 'firepit'
  | 'boat'
  | 'pylon'
  | 'station'
  | 'site'
  | 'crane'
  | 'fountain'
  | 'statue'
  | 'clocktower'
  | 'pyramid'
  | 'flag'
  | 'lander'
  | 'solar'
  | 'dish'
  | 'beacon'
  | 'mushroom'
  | 'crystal'
  | 'monolith'
  | 'spire'
  | 'screw'
  | 'arch'
  | 'headframe'
  | 'hoodoo'
  | 'rover'
  | 'pad'
  | 'rocket'
  | 'greenhouse'
  | 'anemone'
  | 'clam'
  | 'starfish'
  | 'urchin'
  | 'anchor'
  | 'amphora'
  | 'balloon'
  | 'windsock'
  | 'helipad'
  | 'log'
  | 'pitcher'
  | 'column'
  | 'pillar'
  | 'fungus'
  | 'lava'
  | 'stalactite'
  | 'track'
  | 'minecart'
  | 'lifeguard'
  | 'umbrella'

/** The kinds a house comes in. */
export const HOUSE_KINDS: readonly BuildingKind[] = ['house', 'cottage', 'villa']

/** The kinds that are round towers rather than boxes, as wide as they are deep. */
export const ROUND_KINDS: readonly BuildingKind[] = ['observatory', 'silo', 'turbine', 'lighthouse', 'watertower', 'fountain', 'screw', 'hoodoo', 'rocket', 'column', 'pillar']

/**
 * Kinds there is nothing to hit in: too small or soft to stop a car, flat
 * on the ground to drive over, hanging overhead, or out on a sea floor no
 * car comes to.
 */
export const PASSABLE_KINDS: readonly BuildingKind[] = [
  'pad',
  'helipad',
  'track',
  'lava',
  'fungus',
  'stalactite',
  'anemone',
  'clam',
  'starfish',
  'urchin',
  'anchor',
  'amphora',
  'balloon',
  'windsock',
  'umbrella',
]

/** Kinds that stand in the air on something else, a canopy on its posts, a lintel on its stones or a pyramid's tier on the one below, rather than on the ground. */
export const RAISED_KINDS: readonly BuildingKind[] = ['lintel', 'canopy', 'pyramid']

/** Kinds that stand in the water rather than on the land: the boats moored off the shore, and a dam across a river. */
export const WATER_KINDS: readonly BuildingKind[] = ['boat']

/** A giant mushroom's stem: how much of its height, up to the underside of its cap, and how thick, as a share of its cap's width. */
export const MUSHROOM_STEM = { height: 0.72, radius: 0.09 } as const

/** A filling station's sign: a panel this tall at the top of a pole this thick, and nothing round the pole below it. */
export const SIGN_PANEL = { height: 2.2, poleRadius: 0.15 } as const

/** A pitcher plant's stem, as shares of its height and width: all there is to hit of it, under its cup. */
export const PITCHER_STEM = { height: 0.45, radius: 0.12 } as const

/** An arch over a road: how thick each of its pillars is, square, and how deep its lintel, across them at its top. */
export const ARCH = { pillar: 4, lintel: 5 } as const

/** The kinds of thing a car can knock about. */
export type PropKind = 'crate' | 'barrel'
