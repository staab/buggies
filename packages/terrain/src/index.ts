export {
  flatHeightfield,
  groundHeight,
  heightAt,
  onGround,
} from './heightfield.ts'
export {
  DISTRICT_CITY,
  DISTRICT_COUNTRY,
  DISTRICT_SUBURB,
  generateDistricts,
  type DistrictMap,
} from './districts.ts'
export { computeFlowRouting, findLakes, type FlowRouting } from './flow.ts'
export { WORLD_SCALE, generateTerrain } from './generate.ts'
export { fbm2D, ridged2D, smoothstep, valueNoise2D } from './noise.ts'
export {
  ARTERIAL_BRIDGE_GRADE,
  ARTERIAL_WIDTH,
  CROSS_WIDTH,
  MAX_ARTERIAL_GRADE,
  MAX_RAMP_GRADE,
  MAX_ROAD_GRADE,
  RAMP_WIDTH,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_TUNNEL,
  ROAD_WIDTH,
  generateRoads,
} from './roads.ts'
export {
  orientedTriangle,
  signedDistanceToTriangle,
  triangleCentroid,
  triangleInradius,
} from './mountain.ts'
export { traceRivers } from './rivers.ts'
export type {
  District,
  Heightfield,
  Lake,
  Mountain,
  River,
  RiverPoint,
  Road,
  RoadPoint,
  TerrainMap,
  TerrainOptions,
} from './types.ts'
