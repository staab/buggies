/**
 * The single fixed simulation step, in seconds.
 * Deterministic playback depends on every peer advancing by this exact amount.
 */
export const FIXED_TIMESTEP = 1 / 60

export * from './math.ts'

/** Buggies' own spelling of `v3`, kept for the terrain package. */
export { v3 as vec3 } from './math.ts'

export { createRng, randomInt, randomRange, type Rng } from './rng.ts'

export {
  chartFrame,
  chartToWorld,
  createChartFrame,
  createPlanet,
  directionOf,
  placeOf,
  upAt,
  worldToChart,
  type ChartFrame,
  type ChartPlace,
  type Planet,
} from './planet.ts'
