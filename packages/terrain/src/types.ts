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
}
