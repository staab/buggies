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
 * a headland.
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

/** The kinds a house comes in. */
export const HOUSE_KINDS: readonly BuildingKind[] = ['house', 'cottage', 'villa']

/** The kinds that are round towers rather than boxes, as wide as they are deep. */
export const ROUND_KINDS: readonly BuildingKind[] = ['observatory', 'silo', 'turbine', 'lighthouse', 'watertower', 'fountain']

/** Kinds that stand in the air on something else, a canopy on its posts, a lintel on its stones or a pyramid's tier on the one below, rather than on the ground. */
export const RAISED_KINDS: readonly BuildingKind[] = ['lintel', 'canopy', 'pyramid']

/** Kinds that stand in the water rather than on the land: the boats moored off the shore, and a dam across a river. */
export const WATER_KINDS: readonly BuildingKind[] = ['boat']

/** The kinds of thing a car can knock about. */
export type PropKind = 'crate' | 'barrel' | 'cone' | 'bale'
