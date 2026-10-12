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
import type { WorldKind } from './worlds/kinds.ts'

export type { WorldKind } from './worlds/kinds.ts'

/** The level reported where no water reaches: below every possible surface. */
export const DRY = Number.NEGATIVE_INFINITY

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

/**
 * A road: the middle of its surface as it is driven on at every point along it, and how wide
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
}

/** A building, standing from its foot, buried below the lowest ground under it, `height` up; `width` along its x, `depth` along its z. */
export interface WorldBuilding extends Stand {
  readonly kind: BuildingKind
  readonly width: number
  readonly depth: number
  readonly height: number
  readonly tone: number
}

/** A tree, a shrub, a fruit tree, or a strand of kelp swaying up from a sea floor. Only a tree's or a fruit tree's trunk is anything to hit. */
export interface WorldTree {
  readonly kind: 'tree' | 'shrub' | 'fruit' | 'kelp'
  readonly at: Vec3
  readonly height: number
  readonly radius: number
  readonly tone: number
}

/** How thick a tree's trunk is: a sapling's for most, and thicker as a giant's height is. */
export function trunkRadius(tree: Pick<WorldTree, 'height'>): number {
  return Math.max(0.35, tree.height * 0.025)
}

/** A rock: a boulder to hit, scree to drive over, or a coral head on a sea floor. */
export interface WorldRock extends Stand {
  readonly kind: 'boulder' | 'scree' | 'coral'
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

/** The sidewalk round a block: its middle, half its outer width along its x and half its outer depth along its z, how wide its ring is, and which of its four sides are built, round from the one at +z. */
export interface WorldSidewalk extends Stand {
  readonly halfWidth: number
  readonly halfDepth: number
  readonly band: number
  readonly sides: readonly [boolean, boolean, boolean, boolean]
}

export interface WorldField extends Stand {
  readonly kind: 'crop' | 'asphalt' | 'parkingLot' | 'square'
  readonly width: number
  readonly depth: number
  readonly tone: number
}

/** A solid built on the ground, as triangles in the world. */
export interface WorldMesh {
  readonly positions: Float32Array
  readonly indices: Uint32Array
}

/** The built roadways, and what each vertex of them is: a `ROAD_*` structure for the roadway, or `DECK_SKIRT` for a shoulder. */
export interface WorldDecks extends WorldMesh {
  readonly surfaces: Uint8Array
}

/**
 * A portal: a ring sunk halfway into the ground, its middle where it
 * stands, facing along its z, which a car drives through to another world
 * under the arch it makes.
 */
export interface WorldPortal extends Stand {
  readonly radius: number
}

/** A platform floating over a world with nothing under it, its top the ground there: the way out to its middle, how far it reaches and how high its top stands. */
export interface WorldPlatform {
  readonly center: Vec3
  readonly radius: number
  readonly height: number
}

/** A planet's map, every part of it where it is on the planet. */
export interface World {
  /** Which world this is: its planet's seed, with its kind over it (`worldId`). */
  readonly seed: number
  readonly kind: WorldKind
  readonly radius: number
  readonly seaLevel: number
  readonly ground: SphereGround
  /** The ground's heights with every tunnel bored out of it: what is driven on, where the drawn hill runs on over the bore. */
  readonly bored: Float32Array
  /**
   * Over a world with rooms closed in under a roof, a dome's, a tube's or
   * a cavern's: the roof's height over the radius at every grid point of
   * the ground, `NaN` where it is open to the sky, and the ground's own
   * height where the roof comes down onto it and nothing is between the
   * two. Empty where the world has no roof anywhere.
   */
  readonly roof: Float32Array
  /**
   * The platforms floating over the world, where it has them. A world that
   * has them stands on them alone: each is driven on and drawn by its own
   * round top (`platformTop`), and its ground's grid, which is as high as
   * their tops under them, is only for asking how high a place is.
   */
  readonly platforms: readonly WorldPlatform[]
  /** The ground's grid points a tunnel's bore takes, where the ground is not drawn: 1 for each. */
  readonly holes: Uint8Array
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
  /** The built roadways, the decks of the highway and every bridge, with their shoulders. */
  readonly decks: WorldDecks
  /** The gravel paths round the parks the interchanges enclose, each a loop. */
  readonly paths: readonly (readonly Vec3[])[]
  /** The walls and roof round each tunnel. */
  readonly shells: readonly WorldMesh[]
  /** Every guardrail, as one wall. */
  readonly rails: WorldMesh
  /** The sidewalks round the blocks, a curb's step up off the street. */
  readonly curbs: WorldMesh
  /** The portals over to the planet's other worlds. */
  readonly portals: readonly WorldPortal[]
  /** Each ramp's facets, slice by slice from its foot to its lip, as the eight corners of a solid. */
  readonly kickers: readonly Float32Array[]
}
