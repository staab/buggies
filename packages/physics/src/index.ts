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

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Where `value` sits between `min` and `max`, clamped to 0..1. */
export function unlerp(value: number, min: number, max: number): number {
  return max === min ? 0 : clamp((value - min) / (max - min), 0, 1)
}

/** Step `current` toward `target`, never overshooting it. */
export function moveTowards(current: number, target: number, maxStep: number): number {
  const delta = target - current
  return Math.abs(delta) <= maxStep ? target : current + Math.sign(delta) * maxStep
}

/**
 * Ease `current` toward `target` at a rate independent of the step size, so
 * the same motion comes out of a long frame and a short one.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt)
}

export { createRng, randomInt, randomRange, type Rng } from './rng.ts'
