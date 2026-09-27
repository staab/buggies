/**
 * A planet's map as the world has it: every road, river, building, tree,
 * rock and prop where it stands on the planet, in meters, round its middle
 * at the origin with its north pole up the y axis. What needs a plane of
 * its own stands in one: a point at its foot, and a turn whose y is the
 * way up there.
 */

import type { Quat, Vec3 } from '@buggies/physics'

import type { SphereGround } from './sphere.ts'
import type { SphereMountain } from './sphere-heights.ts'
import type { BuildingKind, PropKind, RoadKind } from './types.ts'

/** Where something stands: the point at its foot, and how it is turned, its y the way up there. */
export interface Stand {
  readonly at: Vec3
  readonly turn: Quat
}

/** A river's course: the middle of its water's surface, and how wide it runs there. */
export interface WorldRiverPoint {
  readonly at: Vec3
  readonly width: number
}

export interface WorldRiver {
  readonly id: number
  readonly points: readonly WorldRiverPoint[]
}

/** A lake: the level it stands at, over the planet's radius, and the ground's grid points under it. */
export interface WorldLake {
  readonly id: number
  readonly level: number
  readonly points: readonly number[]
}

/** A city: the way out through its middle, its core's reach along the ground, and its suburbs' past that. */
export interface WorldDistrict {
  readonly id: number
  readonly center: Vec3
  readonly radius: number
  readonly suburbWidth: number
  readonly area: number
  readonly island: number
}

/** A level rectangle terraced into the ground, `width` along its x and `depth` along its z. */
export interface WorldLot extends Stand {
  readonly width: number
  readonly depth: number
}

/**
 * A road: the middle of its surface at every point along it, and how wide
 * it is there. `structure` holds a `ROAD_*` code for each segment, from a
 * point to the next, round again to the first on a closed road.
 */
export interface WorldRoad {
  readonly id: number
  readonly kind: RoadKind
  readonly closed: boolean
  readonly points: readonly Vec3[]
  readonly widths: Float32Array
  readonly structure: Uint8Array
  readonly lot?: WorldLot
}

/** A building, standing from its foot, buried below the lowest ground under it, `height` up; `width` along its x, `depth` along its z. */
export interface WorldBuilding extends Stand {
  readonly kind: BuildingKind
  readonly width: number
  readonly depth: number
  readonly height: number
  readonly tone: number
}

export interface WorldTree {
  readonly kind: 'tree' | 'shrub' | 'fruit'
  readonly at: Vec3
  readonly height: number
  readonly radius: number
  readonly tone: number
}

export interface WorldRock extends Stand {
  readonly kind: 'boulder' | 'scree'
  readonly size: number
  readonly tone: number
}

export interface WorldProp extends Stand {
  readonly kind: PropKind
}

/** A kicker, its foot at the middle where it meets the ground, climbing along its z for `length` and `rise` up to its lip. */
export interface WorldRamp extends Stand {
  readonly width: number
  readonly length: number
  readonly rise: number
  readonly straight?: true
}

/** The sidewalk round a block: its middle, half its outer side, how wide its ring is, and which of its four sides are built. */
export interface WorldSidewalk extends Stand {
  readonly half: number
  readonly band: number
  readonly sides: readonly [boolean, boolean, boolean, boolean]
}

export interface WorldField extends Stand {
  readonly kind: 'crop' | 'asphalt' | 'parkingLot' | 'square'
  readonly width: number
  readonly depth: number
  readonly tone: number
}

/** A planet's map, every part of it where it is on the planet. */
export interface World {
  readonly radius: number
  readonly seaLevel: number
  readonly ground: SphereGround
  /** The water's surface over every grid point of the ground, or `DRY`. */
  readonly water: Float32Array
  /** Which district (`DISTRICT_*`) every grid point of the ground lies in. */
  readonly districtOf: Uint8Array
  readonly mountains: readonly SphereMountain[]
  readonly rivers: readonly WorldRiver[]
  readonly lakes: readonly WorldLake[]
  readonly districts: readonly WorldDistrict[]
  readonly roads: readonly WorldRoad[]
  readonly buildings: readonly WorldBuilding[]
  readonly trees: readonly WorldTree[]
  readonly rocks: readonly WorldRock[]
  readonly props: readonly WorldProp[]
  readonly ramps: readonly WorldRamp[]
  readonly sidewalks: readonly WorldSidewalk[]
  readonly fields: readonly WorldField[]
}
