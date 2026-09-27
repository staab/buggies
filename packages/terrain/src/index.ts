export { PLANET_RADIUS, SPHERE_CELLS, generatePlanet } from './globe/planet.ts'
export { fingerprint } from './fingerprint.ts'
export { flatHeightfield } from './heightfield.ts'
export { BOAT_WANDER, worldBoatAt } from './globe/boats.ts'
export { DECK_SKIRT } from './globe/decks.ts'
export { RAIL_BASE, RAIL_FLARE, RAIL_HEIGHT, RAIL_THICKNESS } from './globe/rails.ts'
export { CURB_HEIGHT } from './globe/solids.ts'
export { TUNNEL_CLEARANCE, TUNNEL_WALL, TUNNEL_WALL_HEIGHT } from './globe/tunnels.ts'
export { RIVER_BANK_LAP } from './globe/water.ts'
export {
  ARTERIAL_WIDTH,
  CROSS_WIDTH,
  MAX_ARTERIAL_GRADE,
  MAX_RAMP_GRADE,
  MAX_ROAD_CURVATURE,
  MAX_ROAD_GRADE,
  RAMP_WIDTH,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SKIRT,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  ROAD_WIDTH,
  STREET_CURB,
  STREET_SPACING,
  STREET_WIDTH,
} from './roads/constants.ts'
export { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB } from './sphere-districts.ts'
export { fbm3D, smoothstep } from './noise.ts'
export { orientedTriangle, signedDistanceToTriangle, triangleInradius, type Triangle } from './mountain.ts'
export { HOUSE_KINDS, RAISED_KINDS, ROUND_KINDS, WATER_KINDS } from './types.ts'
export type { BuildingKind, Heightfield, PropKind, RoadKind } from './types.ts'
export {
  CUBE_FACES,
  arcDistance,
  createSphereGround,
  gridDirection,
  gridPlace,
  groundIndex,
  sidePoints,
  sphereHeight,
  type CubeFace,
  type GridPlace,
  type SphereGround,
} from './sphere.ts'
export { DRY } from './world.ts'
export type {
  Stand,
  World,
  WorldBuilding,
  WorldDecks,
  WorldDistrict,
  WorldField,
  WorldLake,
  WorldMesh,
  WorldProp,
  WorldRamp,
  WorldRiver,
  WorldRiverPoint,
  WorldRoad,
  WorldRock,
  WorldSidewalk,
  WorldTree,
} from './world.ts'
export { groundDirections, groundNeighbors } from './sphere-water.ts'
export {
  alongGround,
  atHeight,
  groundDistance,
  groundUnder,
  heightOver,
  onLand,
  overGround,
  overSurface,
  randomDirection,
  upOf,
  waterUnder,
} from './world-queries.ts'
export { tangentFrame, type SphereMountain } from './sphere-heights.ts'
