import type { Vec3 } from '@buggies/physics'

/** Where the sounds of a view are heard from: the local car, as a rule. */
export type Ear = () => Vec3

/** How far something is from the ear, for how loud it is. */
export function distanceFrom(ear: Ear, at: Vec3): number {
  const from = ear()
  return Math.hypot(at.x - from.x, at.y - from.y, at.z - from.z)
}
