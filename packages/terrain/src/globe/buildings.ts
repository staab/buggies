/**
 * Everything that stands on a planet's land: the cities' blocks and parks,
 * what lines the main roads, the parks inside the interchanges, the
 * furniture of the open country and its coasts, and the wilds. All of it is
 * placed off the finished roads and the settled ground, and none of it
 * touches a road.
 */

import { createRng } from '@buggies/physics'

import { STREET_CURB, STREET_WIDTH } from '../roads/constants.ts'
import type { SphereGround } from '../sphere.ts'
import type { SphereMountain } from '../sphere-heights.ts'
import { groundDirections, groundNeighbors } from '../sphere-water.ts'
import type { WorldBuilding, WorldDistrict, WorldField, WorldProp, WorldRamp, WorldRiver, WorldRoad, WorldRock, WorldSidewalk, WorldTree } from '../world.ts'
import { fillCities } from './city.ts'
import {
  countryLand,
  moorBoats,
  pitchCamps,
  plantFarms,
  plantOrchards,
  raiseChurches,
  raiseLifts,
  raiseLighthouses,
  raiseObservatory,
  raisePyramid,
  raiseStones,
  raiseWaterTowers,
  raiseWindFarm,
} from './country.ts'
import { Placed, interchangeRings, meetsRings, railClearance, roadClearance, wetTest, type Land } from './placing.ts'
import { globeRailRuns } from './rails.ts'
import { coneOffRoadworks, lineArterials, lineRamps, plantInterchanges, raiseStations } from './roadside.ts'
import { planter, worldBuilding, type Site } from './site.ts'
import { BOAT_SALT, BUILDING_SALT, CAMP_SALT, OBSERVATORY_SALT, PROP_SALT, SIDEWALK_BAND } from './sizes.ts'
import type { Grid } from './streets.ts'
import { plantWilds } from './wilds.ts'

/** What stands on a planet's land. */
export interface GlobeStands {
  readonly buildings: WorldBuilding[]
  readonly trees: WorldTree[]
  readonly rocks: WorldRock[]
  readonly props: WorldProp[]
  readonly ramps: WorldRamp[]
  readonly sidewalks: WorldSidewalk[]
  readonly fields: WorldField[]
}

/**
 * Place everything that stands on a planet's land, and level the ground
 * where anything needs it level. `grids` are the cities' street grids, one
 * for each of `cities`.
 */
export function buildGlobeStands(
  ground: SphereGround,
  water: Float32Array,
  districtOf: Uint8Array,
  seaLevel: number,
  cities: readonly WorldDistrict[],
  grids: readonly (Grid | null)[],
  roads: readonly WorldRoad[],
  rivers: readonly WorldRiver[],
  mountains: readonly SphereMountain[],
  seed: number,
): GlobeStands {
  const { radius } = ground
  const land: Land = { ground, neighbors: groundNeighbors(ground), directions: groundDirections(ground), water, districtOf, seaLevel, radius }
  const zones = interchangeRings(roads, radius)
  // Buildings stand against the old curb, on the sidewalk; what grows keeps off the sidewalk as well as the street.
  const clearOfRoads = roadClearance(roads, radius, STREET_CURB)
  const clearOfStreets = roadClearance(roads, radius, STREET_WIDTH / 2 + SIDEWALK_BAND)
  const streets = roads.filter((road) => road.kind === 'street')
  const offStreets = roadClearance(streets, radius, STREET_WIDTH / 2)
  const site: Site = {
    land,
    radius,
    rng: createRng((seed ^ BUILDING_SALT) >>> 0),
    propRng: createRng((seed ^ PROP_SALT) >>> 0),
    roads,
    // Nothing is built at all on the ground an interchange's ramps enclose.
    clear: (spot, margin) => clearOfRoads(spot, margin) && !meetsRings(zones, spot, radius),
    clearOfRoads,
    offStreets,
    wet: wetTest(land, rivers, roads),
    offRails: railClearance(globeRailRuns(roads, radius), radius),
    placed: new Placed(radius),
    zones,
    buildings: [],
    trees: [],
    rocks: [],
    props: [],
    ramps: [],
    sidewalks: [],
    fields: [],
    stood: new Map(),
  }
  const plant = planter(site, clearOfStreets)
  fillCities(site, cities, grids, streets, offStreets, plant)
  plantInterchanges(site, plant)
  lineRamps(site)
  const country = countryLand(site)
  // The pyramid levels the ground it stands on, so it comes before anything else in the country.
  raisePyramid(site, country, mountains)
  // The stations take their lots before the houses line the roads, or the houses would leave them none.
  raiseStations(site)
  coneOffRoadworks(site)
  // A house along an arterial has no sidewalk under its front: it keeps off a street's whole width.
  lineArterials(site, offStreets, plant)
  // The observatory, the boats and the camps throw their own dice, so which planets have them does not change whenever something else draws a number more or less.
  raiseObservatory(site, createRng((seed ^ OBSERVATORY_SALT) >>> 0), mountains)
  plantFarms(site, country, plant, mountains)
  plantOrchards(site, country, plant, mountains)
  raiseWindFarm(site, country)
  raiseStones(site, country)
  raiseLighthouses(site)
  moorBoats(site, createRng((seed ^ BOAT_SALT) >>> 0))
  raiseLifts(site, mountains, cities)
  raiseChurches(site, plant)
  raiseWaterTowers(site, cities)
  pitchCamps(site, createRng((seed ^ CAMP_SALT) >>> 0), plant)
  plantWilds(site, seed, mountains, plant)
  return {
    buildings: site.buildings.map((raised) => worldBuilding(raised, radius)),
    trees: site.trees,
    rocks: site.rocks,
    props: site.props,
    ramps: site.ramps,
    sidewalks: site.sidewalks,
    fields: site.fields,
  }
}
