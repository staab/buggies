/**
 * The roads of an island: a highway loop round its cities, arterials between
 * them, streets through them, interchanges where the highway is crossed,
 * and every one of them settled onto the terrain. Each stage is its own
 * module under `roads/`; this is the order they run in, and the names the
 * rest of the package knows them by.
 */

import * as exact from '@buggies/physics'

import { at } from './at.ts'
import { RIVER_BANK_LAP } from './rivers.ts'
import type { District, Heightfield, Lake, River, Road, RoadPoint } from './types.ts'
import { buildArterials } from './roads/arterials.ts'
import { carveRoadBeds, isSurfaceRoad, settleSurfaceRoads, surfaceRoadCells } from './roads/beds.ts'
import {
  ARTERIAL_SALT,
  BRIDGE_CLEARANCE,
  CROSS_WIDTH,
  DECK_HEIGHT,
  KIND_BRIDGE,
  KIND_TUNNEL,
  MAX_ROAD_CURVATURE,
  MAX_ROAD_GRADE,
  RAMP_DROP,
  RAMP_REACH,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  ROAD_WIDTH,
  TUNNEL_DEPTH,
  UNDERPASS_CLEARANCE,
  UNDERPASS_SPAN,
  WATER_PROBE_RADIUS,
} from './roads/constants.ts'
import { buildInterchanges, crossRoad, interchangeCenters, sampleOpen } from './roads/crossings.ts'
import { cumulativeLengths } from './roads/geometry.ts'
import { limitGrade, limitVerticalCurvature } from './roads/grades.ts'
import { routeLoop } from './roads/highway.ts'
import { alignJunctions } from './roads/junctions.ts'
import { sampleTerrain } from './roads/sampling.ts'
import {
  buildCityGrids,
  pruneStrandedStreets,
  streetKeepOut,
  connectStreetGrids,
  joinStreetsToRoads,
  trimStreetsAlongArterials,
} from './roads/streets.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

export {
  ROAD_SURFACE,
  ROAD_SKIRT,
  ROAD_GRADE,
  ROAD_BRIDGE,
  ROAD_TUNNEL,
  ROAD_WIDTH,
  MAX_ROAD_GRADE,
  MAX_ROAD_CURVATURE,
  MAX_RAMP_CURVATURE,
  MAX_RAMP_GRADE,
  RAMP_WIDTH,
  CROSS_WIDTH,
  INTERCHANGE_SEARCH,
  RAMP_PLATEAU,
  ARTERIAL_WIDTH,
  MAX_ARTERIAL_GRADE,
  ARTERIAL_BRIDGE_GRADE,
  SURFACE_SHOULDER,
  STREET_WIDTH,
  STREET_KERB,
  STREET_SPACING,
} from './roads/constants.ts'
export { isSurfaceRoad, roadLift, deckShouldered } from './roads/beds.ts'
export {
  type Footprint,
  footprintCorners,
  footprintsOverlap,
  roadClearance,
} from './roads/clearance.ts'
export { type CityFrame, STREET_GRID_LEAST, cityFrame } from './roads/streets.ts'

/**
 * Build the highway network: a single closed loop that visits every city, so
 * no road ends in a dead end. The horizontal route is shaped by `routeLoop`;
 * the vertical route is grade-limited, which forces a bridge where it crosses
 * water and a tunnel where it passes beneath a mountain. Interchanges branch
 * off the finished loop as open cross roads and ramps.
 */
export function generateRoads(
  field: Heightfield,
  seaLevel: number,
  districts: District[],
  rivers: River[],
  lakes: Lake[],
  seed = 0,
  districtOf?: Uint8Array,
): Road[] {
  const samples = routeLoop(districts, field, seaLevel)
  const count = samples.length
  if (count < 3) return []

  const { width, depth, cellSize } = field
  // Every cell the water is drawn over, at the highest level drawn there. A
  // sample's own cell is not enough: a road can cross a wide river far from any
  // centreline cell and read the ground as dry, and a deck built to clear one
  // sample can still finish under the sample beside it.
  const riverLevels = new Map<number, number>()
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
          const cell = row * width + col
          const known = riverLevels.get(cell)
          if (known === undefined || point.y > known) riverLevels.set(cell, point.y)
        }
      }
    }
  }
  const lakeLevels = new Map<number, number>()
  for (const lake of lakes) {
    for (const cell of lake.cells) lakeLevels.set(cell, lake.level)
  }

  /** Water surface at a point, or its ground height when it is dry. */
  const surfaceAt = (x: number, z: number): { wet: boolean; level: number } => {
    const centerCol = Math.round(x / cellSize)
    const centerRow = Math.round(z / cellSize)
    const probe = Math.max(1, Math.round(WATER_PROBE_RADIUS / cellSize))
    let level = 0
    let nearest = Infinity
    for (let dz = -probe; dz <= probe; dz++) {
      for (let dx = -probe; dx <= probe; dx++) {
        const col = centerCol + dx
        const row = centerRow + dz
        if (col < 0 || col >= width || row < 0 || row >= depth) continue
        const found = lakeLevels.get(row * width + col) ?? riverLevels.get(row * width + col)
        if (found === undefined) continue
        const distance = dx * dx + dz * dz
        if (distance < nearest) {
          nearest = distance
          level = found
        }
      }
    }
    if (nearest < Infinity) return { wet: true, level }

    const ground = sampleTerrain(field, x, z)
    return ground <= seaLevel ? { wet: true, level: seaLevel } : { wet: false, level: ground }
  }

  // Everything below is one value a sample, read by a sample's index: none of it comes back empty.
  const ground = new Float32Array(count)
  const wet = new Uint8Array(count)
  const surface = new Float32Array(count)
  for (const [i, point] of samples.entries()) {
    ground[i] = sampleTerrain(field, point.x, point.z)
    const water = surfaceAt(point.x, point.z)
    wet[i] = water.wet ? 1 : 0
    surface[i] = water.level
  }

  // Aim for an elevated deck over dry land or one clearing the water, then let
  // the grade limit decide how close it can get.
  const profile = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    profile[i] = wet[i]
      ? Math.max(surface[i]! + BRIDGE_CLEARANCE, ground[i]! + DECK_HEIGHT)
      : ground[i]! + DECK_HEIGHT
  }

  const cum = cumulativeLengths(samples)
  const total =
    cum[count - 1]! +
    hypot(samples[0]!.x - samples[count - 1]!.x, samples[0]!.z - samples[count - 1]!.z)
  // What the deck comes to before any crossing has had a say. Sites are judged
  // against this rather than against the raw aim above, which ignores the grade
  // limit and so says nothing about how high the highway really stands.
  const deck = Float32Array.from(profile)
  limitGrade(deck, samples, MAX_ROAD_GRADE)
  const crossings = interchangeCenters(
    field,
    seaLevel,
    samples,
    wet,
    (x, z) => surfaceAt(x, z).wet,
    cum,
    total,
    districts,
    deck,
  ).map((c) => ({ index: c, cross: crossRoad(field, samples, c) }))

  // Raise the deck over each crossing until it clears the cross road below;
  // the grade limit spreads each lift into approach ramps. Crossings where the
  // two constraints cannot both hold are dropped after a final grade pass.
  const bridgeSteps = Math.max(1, Math.round(UNDERPASS_SPAN / (total / count)))
  for (let pass = 0; pass < 20; pass++) {
    let raised = false
    for (const { index: c, cross } of crossings) {
      const required = at(cross.heights, cross.centerIndex, 'cross road centre') + UNDERPASS_CLEARANCE
      for (let j = -bridgeSteps; j <= bridgeSteps; j++) {
        const k = (c + j + count) % count
        if (profile[k]! < required) {
          profile[k] = required
          raised = true
        }
      }
    }
    if (!raised) break
    limitGrade(profile, samples, MAX_ROAD_GRADE)
    // Easing the hump over a crossing lowers its peak, so the deck is raised
    // again until a hump gentle enough to drive still clears the road below.
    limitVerticalCurvature(profile, samples, MAX_ROAD_CURVATURE, true)
  }
  limitGrade(profile, samples, MAX_ROAD_GRADE)
  limitVerticalCurvature(profile, samples, MAX_ROAD_CURVATURE, true)

  // A sample that stayed near its water is a bridge deck; one the grade limit
  // pushed beneath the ground is a tunnel, even beside a river: the bank of
  // a gorge stands over the deck there, and a bridge would run into it.
  const kind = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const buried = ground[i]! - profile[i]! > TUNNEL_DEPTH
    if (buried) kind[i] = KIND_TUNNEL
    else if (wet[i]) kind[i] = KIND_BRIDGE
  }

  const structure = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    if (kind[i] === KIND_BRIDGE || kind[next] === KIND_BRIDGE) structure[i] = ROAD_BRIDGE
    else if (kind[i] === KIND_TUNNEL || kind[next] === KIND_TUNNEL) structure[i] = ROAD_TUNNEL
    else structure[i] = ROAD_GRADE
  }

  const built = crossings.filter(({ index, cross }) => {
    if (kind[index] === KIND_TUNNEL) return false
    if (profile[index]! - at(cross.heights, cross.centerIndex, 'cross road centre') < UNDERPASS_CLEARANCE - 0.5) return false
    // A ramp lands ROAD_SURFACE below the cross road's centreline, on its ground.
    const drop =
      profile[index]! +
      ROAD_SURFACE -
      Math.min(sampleOpen(cross.heights, -RAMP_REACH), sampleOpen(cross.heights, RAMP_REACH))
    return drop <= RAMP_DROP
  })
  const points: RoadPoint[] = samples.map((point, i) => ({ x: point.x, y: profile[i]!, z: point.z }))
  const highway: Road = { id: 0, kind: 'highway', closed: true, width: ROAD_WIDTH, points, structure }
  const { roads: access, footprints } = buildInterchanges(
    samples,
    profile,
    built,
    bridgeSteps,
    structure,
    1,
  )
  const crossRoads = access.filter((road) => road.width === CROSS_WIDTH)
  const arterials = buildArterials(
    field,
    seaLevel,
    crossRoads,
    [highway, ...access],
    surfaceAt,
    (seed ^ ARTERIAL_SALT) >>> 0,
    access.length + 1,
  )
  // Arterials are numbered before pruning, so their count is not their last id.
  const nextId = Math.max(...arterials.map((road) => road.id), access.length) + 1
  const keepOut = streetKeepOut([highway, ...access], footprints)
  const streets = districtOf
    ? buildCityGrids(field, seaLevel, districts, districtOf, keepOut, nextId)
    : []
  const network = [highway, ...access, ...arterials, ...streets]
  alignJunctions(network)
  // Junction alignment moves roads, so only once every road is where it will
  // finally be drawn is it worth asking what a street runs into and reaches.
  const trimmed = trimStreetsAlongArterials(network, nextId + streets.length)
  joinStreetsToRoads(trimmed, keepOut)
  const connectors = connectStreetGrids(
    trimmed,
    field,
    (x, z) => surfaceAt(x, z).wet,
    keepOut,
    Math.max(...trimmed.map((road) => road.id)) + 1,
  )
  const roads = pruneStrandedStreets([...trimmed, ...connectors])
  // The highway cuts its bed first, clear of any ground a surface road is;
  // the surface roads are then settled into the ground.
  const painted = roads.filter(isSurfaceRoad)
  const structures = roads.filter((road) => !isSurfaceRoad(road))
  carveRoadBeds(field, structures, surfaceRoadCells(field, painted))
  settleSurfaceRoads(field, painted, structures)
  // A surface road's bridges are decks too. The ground under them is cut
  // clear only now, once the at-grade runs have shaped it: each run's
  // shoulder ends in a cap at the shore that would otherwise stand out over
  // the deck as a shelf the bridge runs into.
  carveRoadBeds(
    field,
    painted,
    surfaceRoadCells(field, painted),
    (structure) => structure === ROAD_BRIDGE,
  )
  return roads
}
