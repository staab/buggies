export {
  flatHeightfield,
  groundHeight,
  heightAt,
  onGround,
} from './heightfield.ts'
export { computeFlowRouting, findLakes, type FlowRouting } from './flow.ts'
export { generateTerrain } from './generate.ts'
export { fbm2D, ridged2D, smoothstep, valueNoise2D } from './noise.ts'
export { traceRivers } from './rivers.ts'
export type {
  Heightfield,
  Lake,
  Ridge,
  River,
  RiverPoint,
  TerrainMap,
  TerrainOptions,
} from './types.ts'
