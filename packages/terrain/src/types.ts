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
 * An elongated mountain ridge. The crest runs through `x`/`z` along `angle`
 * for `length` world units; `width` is the cross-ridge falloff scale and
 * `height` is the crest rise above the surrounding land.
 */
export interface Ridge {
  x: number
  z: number
  angle: number
  length: number
  width: number
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

export interface TerrainOptions {
  size?: number
  cellSize?: number
  seaLevel?: number
  oceanDepth?: number
  /** Radius of the island in world units. Defaults to a fraction of the map. */
  islandRadius?: number
  /** Number of mountain ridges. Defaults to 2. */
  ridgeCount?: number
  /** Number of rivers, 1 or 2. Defaults to one per ridge. */
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
  ridges: Ridge[]
  rivers: River[]
  lakes: Lake[]
}
