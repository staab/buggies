import {
  DRY,
  ROAD_SKIRT,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  buildWaterLevels,
  sampleHeight,
  waterLevelAt,
  type Heightfield,
  type TerrainMap,
} from '@buggies/terrain'

/** One span of carriageway, running from `a` to `b` at the height it is drawn. */
interface Deck {
  ax: number
  az: number
  bx: number
  bz: number
  ay: number
  by: number
  half: number
}

/**
 * Everything a vehicle can stand on or fall into. Derived wholly from a
 * generated map, so every peer can rebuild an identical one from the seed
 * rather than shipping it.
 */
export interface DriveSurface {
  field: Heightfield
  /** Water surface per cell, `DRY` where there is none. */
  water: Float32Array
  decks: Deck[]
  /** Deck indices by grid cell, so a lookup only tests spans that are close. */
  buckets: Map<number, number[]>
}

/** Grid the spans are bucketed on. Comfortably longer than one of them. */
const BUCKET_SIZE = 48

/** How far below a carriageway a vehicle can still be carried by it. */
const DECK_REACH = 1.5


function bucketKey(col: number, row: number): number {
  return row * 65536 + col
}

function bucketSpan(buckets: Map<number, number[]>, deck: Deck, index: number): void {
  const reach = deck.half + ROAD_SKIRT
  const minCol = Math.floor((Math.min(deck.ax, deck.bx) - reach) / BUCKET_SIZE)
  const maxCol = Math.floor((Math.max(deck.ax, deck.bx) + reach) / BUCKET_SIZE)
  const minRow = Math.floor((Math.min(deck.az, deck.bz) - reach) / BUCKET_SIZE)
  const maxRow = Math.floor((Math.max(deck.az, deck.bz) + reach) / BUCKET_SIZE)
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const key = bucketKey(col, row)
      const found = buckets.get(key)
      if (found) found.push(index)
      else buckets.set(key, [index])
    }
  }
}

/** How far a point sits from a span's centreline, and the span's height there. */
interface Straddle {
  distance: number
  height: number
}

/**
 * Where a point stands relative to one span: the carriageway itself, then the
 * shoulder falling away to `ground` — the same ramp the mesh draws. Without
 * that ramp the edge of every road is a step, and a step taken at speed reads
 * as a ramp and throws the vehicle. `null` once the point is past the shoulder.
 */
function straddle(deck: Deck, x: number, z: number, ground: number): Straddle | null {
  const vx = deck.bx - deck.ax
  const vz = deck.bz - deck.az
  const lengthSq = vx * vx + vz * vz
  if (lengthSq === 0) return null
  const t = Math.min(Math.max(((x - deck.ax) * vx + (z - deck.az) * vz) / lengthSq, 0), 1)
  const dx = x - (deck.ax + vx * t)
  const dz = z - (deck.az + vz * t)
  const reach = deck.half + ROAD_SKIRT
  const distanceSq = dx * dx + dz * dz
  if (distanceSq > reach * reach) return null

  const top = deck.ay + (deck.by - deck.ay) * t
  const distance = Math.sqrt(distanceSq)
  if (distance <= deck.half) return { distance, height: top }
  return { distance, height: top + (ground - top) * ((distance - deck.half) / ROAD_SKIRT) }
}

/**
 * The heightfield is not what a road actually is. A bed is cut below the
 * carriageway so the mesh has something to sit in, and a bridge has nothing
 * under it but the river it spans — a vehicle reading only the ground drives
 * every road buried to its axles and falls through every crossing. The spans
 * are collected here and stood on instead, at the height they are drawn.
 *
 * Tunnels are left out: their bore is cut from the mesh but not from the
 * heightfield, so there is no way to get into one to stand on it.
 */
export function createDriveSurface(map: TerrainMap): DriveSurface {
  const decks: Deck[] = []
  const buckets = new Map<number, number[]>()
  for (const road of map.roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] === ROAD_TUNNEL) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const deck: Deck = {
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        ay: a.y + ROAD_SURFACE,
        by: b.y + ROAD_SURFACE,
        half: road.width / 2,
      }
      bucketSpan(buckets, deck, decks.length)
      decks.push(deck)
    }
  }
  return { field: map.heightfield, water: buildWaterLevels(map), decks, buckets }
}

/** A surface with nothing on it but the ground, for tests and headless runs. */
export function flatDriveSurface(field: Heightfield): DriveSurface {
  return {
    field,
    water: new Float32Array(field.width * field.depth).fill(DRY),
    decks: [],
    buckets: new Map(),
  }
}

/**
 * The height a wheel rests at: the ground, or a bridge deck the vehicle is
 * level with. `above` is where the vehicle currently is, which is what keeps a
 * car passing underneath a bridge from being yanked onto it.
 */
export function groundAt(surface: DriveSurface, x: number, z: number, above: number): number {
  const ground = sampleHeight(surface.field, x, z)
  const nearby = surface.buckets.get(bucketKey(Math.floor(x / BUCKET_SIZE), Math.floor(z / BUCKET_SIZE)))
  if (!nearby) return ground

  // The nearest span wins, not the highest. Spans overlap heavily along a
  // curve, and each one reports its end height for anything past its end, so
  // taking the highest scallops the road into a chain of little crests that
  // throw a vehicle off every one. Two spans meeting agree at the point they
  // share, so choosing by distance leaves the road as smooth as it is drawn.
  let nearest = Infinity
  let height = ground
  for (const index of nearby) {
    const found = straddle(surface.decks[index]!, x, z, ground)
    if (found === null || found.distance >= nearest || found.height > above + DECK_REACH) continue
    nearest = found.distance
    height = found.height
  }
  return Math.max(ground, height)
}

/** Water surface at a point, or `DRY` where the ground is dry. */
export function waterAt(surface: DriveSurface, x: number, z: number): number {
  return waterLevelAt(surface.field, surface.water, x, z)
}
