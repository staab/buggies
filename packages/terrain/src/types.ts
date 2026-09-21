/**
 * A grid of ground heights sampled on the XZ plane. Heights are stored in
 * row-major order, `width * depth` samples total. This is the shared
 * representation both the client renderer and the server-side simulation read.
 */
export interface Heightfield {
  width: number
  depth: number
  cellSize: number
  heights: Float32Array
}

/**
 * A mountain with a triangular footprint. The three corners define the base;
 * elevation peaks in the middle and falls to `skirt` around the edges.
 */
export interface Mountain {
  ax: number
  az: number
  bx: number
  bz: number
  cx: number
  cz: number
  /** Foothill falloff scale around the triangle. */
  skirt: number
  /** Crest rise above the surrounding land. */
  height: number
}

/** A single sample along a river's course, in world units. */
export interface RiverPoint {
  x: number
  y: number
  z: number
  width: number
}

export interface River {
  id: number
  points: RiverPoint[]
}

/** A filled basin. Cells are row-major indices into the heightfield. */
export interface Lake {
  id: number
  level: number
  cells: number[]
}

/**
 * A city anchor. The core is `radius` wide; suburbs extend `suburbWidth`
 * further out, and everything beyond is country.
 */
export interface District {
  id: number
  /** City centre, in world units. */
  cx: number
  cz: number
  /** City core radius, in world units. */
  radius: number
  /** How far suburbs reach past the core, in world units. */
  suburbWidth: number
  /** Buildable land cells the district covers. */
  area: number
}

/** A sample along a road centreline, in world units. */
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
 * A carriageway. Highways form closed loops through every city; interchanges
 * add open cross roads and one-lane ramps. `structure` holds one `ROAD_*`
 * code per segment: segment `i` runs from `points[i]` to the next point,
 * wrapping for a closed road, so it is one shorter than `points` when open.
 */
export interface Road {
  id: number
  kind: RoadKind
  closed: boolean
  /** Full carriageway width, in world units. */
  width: number
  points: RoadPoint[]
  structure: Uint8Array
}

/**
 * A box standing on the ground: a city block's building, or a house. It is
 * turned by `yaw` about its centre, `width` along its local X and `depth`
 * along its local Z, and stands from `bottom`, buried below the lowest ground
 * under it, up to `top`.
 */
export interface Building {
  kind: 'block' | 'house'
  x: number
  z: number
  yaw: number
  width: number
  depth: number
  bottom: number
  top: number
  /** A shade for whoever draws it, 0 to 1. */
  tone: number
}

/**
 * A kicker on the shoulder of a road, running along it, for a car to swerve
 * onto at speed and fly off the lip of. Its top curves up from the ground in
 * an arc, gently at the foot and steepest at the lip, so a car meets it with
 * its wheels rather than its nose.
 */
export interface Ramp {
  /** The middle of the foot, where the wedge meets the ground. */
  x: number
  z: number
  /** Unit direction it climbs in, in plan: along the road, one way or the other. */
  dx: number
  dz: number
  width: number
  /** From the foot to the lip, in plan. */
  length: number
  /** Ground height at the foot, and the height of the lip. */
  bottom: number
  top: number
}

/**
 * A tree, or a shrub: on the ground at `bottom`, `radius` wide and `height`
 * tall in all. A tree has a trunk to run into; a shrub is only something to
 * drive through.
 */
export interface Tree {
  kind: 'tree' | 'shrub'
  x: number
  z: number
  bottom: number
  height: number
  radius: number
  /** A shade for whoever draws it, 0 to 1. */
  tone: number
}

export interface TerrainOptions {
  size?: number
  cellSize?: number
  seaLevel?: number
  oceanDepth?: number
  /** Radius of the island in world units. Defaults to a fraction of the map. */
  islandRadius?: number
  /** Number of triangular mountains. Defaults to 3. */
  mountainCount?: number
  /** Radius, in world units, of the cluster the mountains are placed within. */
  mountainSpread?: number
  /** Number of rivers. Defaults to two, or one per mountain if fewer. */
  riverCount?: number
  /** Depressions smaller than this are not treated as lakes. */
  minLakeCells?: number
  /** Depressions shallower than this are not treated as lakes. */
  minLakeDepth?: number
}

/** Everything needed to render or simulate a map. Pure data, fully serializable. */
export interface TerrainMap {
  seed: number
  size: number
  cellSize: number
  seaLevel: number
  heightfield: Heightfield
  mountains: Mountain[]
  rivers: River[]
  lakes: Lake[]
  districts: District[]
  /** Row-major district code (`DISTRICT_*`) for every cell. */
  districtOf: Uint8Array
  roads: Road[]
  buildings: Building[]
  trees: Tree[]
  ramps: Ramp[]
}
