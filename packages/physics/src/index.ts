/** A point or vector in the shared simulation space. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * The single fixed simulation step, in seconds.
 * Deterministic playback depends on every peer advancing by this exact amount.
 */
export const FIXED_TIMESTEP = 1 / 60

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function scale(v: Vec3, factor: number): Vec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor }
}

export { createRng, randomInt, randomRange, type Rng } from './rng.ts'