// Ported from the seattle project (src/render/damping.ts). Kept in its original shape
// and formatting so the two can be compared and resynced.

import * as THREE from 'three'

import {lerp} from '@buggies/physics'

export function remainingFraction(ratePerSecond: number, dt: number): number {
  return Math.exp(-ratePerSecond * dt)
}

export function dampToward(
  current: number,
  target: number,
  ratePerSecond: number,
  dt: number,
): number {
  return lerp(target, current, remainingFraction(ratePerSecond, dt))
}

export function dampVector3Toward(
  current: THREE.Vector3,
  target: THREE.Vector3,
  ratePerSecond: number,
  dt: number,
): void {
  const remaining = remainingFraction(ratePerSecond, dt)

  current.x = target.x + (current.x - target.x) * remaining
  current.y = target.y + (current.y - target.y) * remaining
  current.z = target.z + (current.z - target.z) * remaining
}
