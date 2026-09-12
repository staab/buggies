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
export { generateTerrain } from './generate.ts'
export { fbm2D, ridged2D, smoothstep, valueNoise2D } from './noise.ts'
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
  TerrainMap,
  TerrainOptions,
} from './types.ts'
