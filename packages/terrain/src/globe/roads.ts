/**
 * The roads of a planet: a highway loop through its cities with
 * interchanges where it is crossed, arterials out across the country,
 * streets through each city, and every one of them settled onto the
 * planet's own ground.
 */

import type { Vec3 } from '@buggies/physics'

import { ARTERIAL_SALT, ROAD_BRIDGE } from '../roads/constants.ts'
import type { SphereGround } from '../sphere.ts'
import { groundDirections, groundNeighbors } from '../sphere-water.ts'
import type { WorldDistrict, WorldRoad } from '../world.ts'
import { buildGlobeArterials } from './arterials.ts'
import { bedOf, carveRoadBeds, groundOf, rampLanePoints, roadOfBed, settleSurfaceRoads, surfaceRoadPoints } from './beds.ts'
import { buildHighway, type Planet } from './highway.ts'
import { angleBetween, unit } from './lines.ts'
import { buildNav } from './nav.ts'
import { buildGlobeStreets, type Grid } from './streets.ts'

/** A planet's roads, and the ground each interchange takes. */
export interface GlobeRoads {
  readonly roads: WorldRoad[]
  readonly footprints: Vec3[][]
  /** Each city's street grid, where it has one, for its blocks to be laid out on. */
  readonly grids: (Grid | null)[]
}

/**
 * Build a planet's roads and shape its ground to them. `water` is the
 * water's surface over each grid point of the ground, or `DRY`.
 */
export function buildGlobeRoads(
  ground: SphereGround,
  water: Float32Array,
  seaLevel: number,
  districts: readonly WorldDistrict[],
  districtOf: Uint8Array,
  seed: number,
): GlobeRoads {
  const nav = buildNav(ground, water, seaLevel)
  const planet: Planet = { ground, nav, water, seaLevel, districts }
  const made = buildHighway(planet, 0)
  if (made === null) return { roads: [], footprints: [], grids: [] }
  const { highway, access, footprints } = made
  // A city the highway runs through is served by its interchanges; any other is somewhere the arterials must reach.
  const offHighway = districts.filter(
    (city) => !made.cities.includes(city) && highway.points.every((point) => angleBetween(city.center, unit(point)) * ground.radius > city.radius),
  )
  const crossRoads = access.filter((road) => road.kind === 'cross')
  const arterials = buildGlobeArterials(planet, crossRoads, offHighway, [highway, ...access], (seed ^ ARTERIAL_SALT) >>> 0, access.length + 1)
  const network = [highway, ...access, ...arterials]
  const { streets, grids } = buildGlobeStreets(planet, districtOf, network, footprints, network.length)
  const on = groundOf(ground, groundNeighbors(ground), groundDirections(ground))
  const beds = [...network, ...streets].map((road) => bedOf(road, ground.radius))
  // The highway cuts its bed first, clear of the ground a surface road is; the surface roads are then settled into the ground.
  const painted = beds.filter((road) => road.kind !== 'highway')
  const structures = beds.filter((road) => road.kind === 'highway')
  carveRoadBeds(on, structures, surfaceRoadPoints(on, painted), undefined, rampLanePoints(on, painted))
  settleSurfaceRoads(on, painted, structures)
  // A surface road's bridges are decks too, the ground under them cut clear once the at-grade runs have shaped it.
  carveRoadBeds(on, painted, surfaceRoadPoints(on, painted), (structure) => structure === ROAD_BRIDGE)
  return { roads: beds.map((road) => roadOfBed(road, ground.radius)), footprints, grids }
}
