// What the tests measure the planet by: how far apart two points are along
// the ground, how much higher one stands than another, and points ahead of
// or above others. Not part of the game.

import { vdistance, type Vec3 } from '@buggies/physics'
import { groundDistance, upOf } from '@buggies/terrain'

/** How far apart two points are along the ground, leaving out how much higher one stands. */
export const apart = groundDistance

/** How much higher one point stands than another, along the way up from the planet's middle. */
export function over(a: Vec3, b: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) - Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z)
}

/** A point this far along a way from another. */
export function ahead(point: Vec3, way: Vec3, distance: number): Vec3 {
  return { x: point.x + way.x * distance, y: point.y + way.y * distance, z: point.z + way.z * distance }
}

/** A point this far up from another. */
export function lifted(point: Vec3, rise: number): Vec3 {
  return ahead(point, upOf(point), rise)
}

/** The angle between two ways, in radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) * Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z))
  return Math.acos(Math.min(Math.max(dot, -1), 1))
}

/** How far apart two points are, straight through. */
export const between = vdistance
