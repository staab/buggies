/**
 * The portals of an island: rings standing on level open country beside the
 * arterials, each a way through to the island's moon; and the moon's one,
 * the way back.
 */

import { createRng, randomInt, type Rng } from '@buggies/physics'

import { DISTRICT_COUNTRY } from './districts.ts'
import { sampleHeight } from './heightfield.ts'
import type { Portal, TerrainMap } from './types.ts'
import { DRY, buildWaterLevels, waterLevelAt } from './water.ts'

/** How big round a portal's ring is: wide enough for anything to drive through. */
export const PORTAL_RADIUS = 7
/** How many portals an island has. */
const PORTALS = { min: 3, max: 5 } as const
/** How far off the middle of its road a portal stands, and how far apart two stand at the least. */
const OFF_ROAD = 28
const APART = 500
/** How level the ground must be for the run up to a portal and away from it: this far each way along it, and across it, no more than this high from low to high. */
const RUN = 24
const ACROSS = 10
const LEVEL = 2.5
/** How much wider than the ring the run through it is kept clear. */
const CLEAR = 16
const TRIES = 4000
const PORTAL_SALT = 0x9047

/** Which bit of a seed says it is a moon's: a moon's seed is its island's with this bit set. */
export const MOON_BIT = 0x8000_0000

/** The seed of an island's moon. */
export function moonOf(seed: number): number {
  return (seed | MOON_BIT) >>> 0
}

/** Whether a seed is a moon's. */
export function isMoon(seed: number): boolean {
  return (seed & MOON_BIT) !== 0
}

/** The seed of the island a map belongs to: its own, or its moon's island's. */
export function islandSeedOf(seed: number): number {
  return (seed & ~MOON_BIT) >>> 0
}

/** Whether the ground over the run through a spot, along a way, is level enough, dry and on the map. */
export function levelRun(map: TerrainMap, water: Float32Array | null, x: number, z: number, dx: number, dz: number, level = LEVEL): boolean {
  const run = RUN
  const extent = map.size * map.cellSize
  let low = Infinity
  let high = -Infinity
  for (let along = -run; along <= run; along += 4) {
    for (let across = -ACROSS; across <= ACROSS; across += 5) {
      const px = x + dx * along - dz * across
      const pz = z + dz * along + dx * across
      if (px < 0 || pz < 0 || px > extent || pz > extent) return false
      if (water !== null && waterLevelAt(map.heightfield, water, px, pz) !== DRY) return false
      const height = sampleHeight(map.heightfield, px, pz)
      if (height <= map.seaLevel + 0.5) return false
      low = Math.min(low, height)
      high = Math.max(high, height)
    }
  }
  return high - low < level
}

/** Whether a point is within the run through a spot, along `dx, dz`, widened by this much. */
function inRun(x: number, z: number, dx: number, dz: number, px: number, pz: number, widen: number): boolean {
  const along = (px - x) * dx + (pz - z) * dz
  const across = -(px - x) * dz + (pz - z) * dx
  return Math.abs(along) < RUN + widen && Math.abs(across) < PORTAL_RADIUS + CLEAR / 2 + widen
}

/** Whether nothing but trees stands in the run through a spot: no building, rock, prop or other road. */
function clearRun(map: TerrainMap, x: number, z: number, dx: number, dz: number): boolean {
  for (const building of map.buildings) {
    if (inRun(x, z, dx, dz, building.x, building.z, Math.hypot(building.width, building.depth) / 2)) return false
  }
  for (const rock of map.rocks) if (inRun(x, z, dx, dz, rock.x, rock.z, rock.size)) return false
  for (const prop of map.props) if (inRun(x, z, dx, dz, prop.x, prop.z, 1)) return false
  for (const road of map.roads) {
    for (const point of road.points) if (inRun(x, z, dx, dz, point.x, point.z, road.width / 2)) return false
  }
  return true
}

/** A portal standing at a spot, the way through it along `dx, dz`. */
export function portalAt(map: TerrainMap, x: number, z: number, dx: number, dz: number): Portal {
  return { x, z, y: sampleHeight(map.heightfield, x, z), dx, dz, radius: PORTAL_RADIUS }
}

/**
 * Stand an island's portals: on open country beside its arterials, off to
 * one side of the road and the way through them along it, where the ground
 * is level and clear for a run at them, and far apart. An island too rough
 * for enough of those takes rougher ground, and then open country away
 * from any road.
 */
export function placePortals(map: TerrainMap): Portal[] {
  const rng = createRng((map.seed ^ PORTAL_SALT) >>> 0)
  const roads = map.roads.filter((road) => road.kind === 'arterial')
  const water = buildWaterLevels(map)
  const wanted = randomInt(rng, PORTALS.min, PORTALS.max)
  const portals: Portal[] = []
  const passes = [
    { level: LEVEL, spot: () => roadsideSpot(map, roads, rng) },
    { level: LEVEL * 2, spot: () => roadsideSpot(map, roads, rng) },
    { level: LEVEL * 2, spot: () => openSpot(map, rng) },
  ]
  for (const [pass, { level, spot: pick }] of passes.entries()) {
    // Every pass but the first only makes up the fewest an island has.
    const most = pass === 0 ? wanted : PORTALS.min
    for (let attempt = 0; attempt < TRIES && portals.length < most; attempt++) {
      const spot = pick()
      if (spot === null) continue
      const { x, z, dx, dz } = spot
      if (portals.some((portal) => Math.hypot(portal.x - x, portal.z - z) < APART)) continue
      if (!levelRun(map, water, x, z, dx, dz, level) || !clearRun(map, x, z, dx, dz)) continue
      // The trees in the way are cleared for it.
      map.trees = map.trees.filter((tree) => !inRun(x, z, dx, dz, tree.x, tree.z, 2))
      portals.push(portalAt(map, x, z, dx, dz))
    }
  }
  return portals
}

/** A spot anywhere in the country, facing any way. */
function openSpot(map: TerrainMap, rng: Rng): { x: number; z: number; dx: number; dz: number } | null {
  const extent = map.size * map.cellSize
  const x = rng() * extent
  const z = rng() * extent
  const { width, cellSize } = map.heightfield
  if (map.districtOf[Math.floor(z / cellSize) * width + Math.floor(x / cellSize)] !== DISTRICT_COUNTRY) return null
  const turn = rng() * Math.PI * 2
  return { x, z, dx: Math.cos(turn), dz: Math.sin(turn) }
}

/** A spot off to one side of an arterial in the country, and the way the road runs there. */
function roadsideSpot(map: TerrainMap, roads: readonly TerrainMap['roads'][number][], rng: Rng): { x: number; z: number; dx: number; dz: number } | null {
  const road = roads[Math.floor(rng() * roads.length)]
  if (road === undefined || road.points.length < 3) return null
  const index = 1 + Math.floor(rng() * (road.points.length - 2))
  const before = road.points[index - 1]!
  const after = road.points[index + 1]!
  const point = road.points[index]!
  const length = Math.hypot(after.x - before.x, after.z - before.z)
  if (length < 1e-6) return null
  const dx = (after.x - before.x) / length
  const dz = (after.z - before.z) / length
  const side = rng() < 0.5 ? 1 : -1
  const x = point.x - dz * OFF_ROAD * side
  const z = point.z + dx * OFF_ROAD * side
  const { width, cellSize } = map.heightfield
  const cell = Math.floor(z / cellSize) * width + Math.floor(x / cellSize)
  if (map.districtOf[cell] !== DISTRICT_COUNTRY) return null
  return { x, z, dx, dz }
}
