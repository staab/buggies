export {
  flatHeightfield,
  groundHeight,
  heightAt,
  onGround,
  sampleHeight,
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
  ROAD_SKIRT,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  ROAD_WIDTH,
  STREET_WIDTH,
  SURFACE_SHOULDER,
  generateRoads,
  isSurfaceRoad,
  roadLift,
} from './roads.ts'
export {
  orientedTriangle,
  signedDistanceToTriangle,
  triangleCentroid,
  triangleInradius,
} from './mountain.ts'
export {
  RAIL_BASE,
  RAIL_FLARE,
  RAIL_HEIGHT,
  RAIL_THICKNESS,
  railMesh,
  railRuns,
  type RailMesh,
  type RailRun,
} from './rails.ts'
export { RIVER_BANK_LAP, traceRivers } from './rivers.ts'
export {
  TUNNEL_CLEARANCE,
  TUNNEL_WALL,
  boreClearance,
  boreFloorAt,
  buildTunnelHoles,
  tunnelCutFloors,
  tunnelSegments,
  tunnelShellMesh,
  type BoreSegment,
  type ShellMesh,
} from './tunnels.ts'
export { DRY, buildWaterLevels, waterLevelAt } from './water.ts'
export type {
  District,
  Heightfield,
  Lake,
  Mountain,
  River,
  RiverPoint,
  Road,
  RoadKind,
  RoadPoint,
  TerrainMap,
  TerrainOptions,
} from './types.ts'
