/**
 * The boats moored off a planet's shores, drifting about where they lie
 * at anchor.
 */

import * as exact from '@buggies/physics'
import { qmultiply, quatFromBasis, quatFromYaw, type Quat, type Vec3 } from '@buggies/physics'

import { tangentFrame } from '../sphere-heights.ts'
import type { WorldBuilding } from '../world.ts'
import { BOAT_SWING } from './sizes.ts'

const { atan2, cos, sin } = exact

/** How far a boat drifts from where it lies at anchor, either way along the east and the south there. */
export const BOAT_WANDER = 10

/**
 * Where a boat is at this time, and how it is turned: meandering about
 * where it lies at anchor on a slow loop of its own, along the east and the
 * south there, its bow the way it is going, upright on the way up. Worked
 * out from the time alone, so everyone who knows the game's time sees it in
 * the same place.
 */
export function worldBoatAt(boat: WorldBuilding, index: number, seconds: number, out: { at: Vec3; turn: Quat }): { at: Vec3; turn: Quat } {
  const a = (2 * Math.PI) / (BOAT_SWING * (1 + 0.13 * (index % 5)))
  const b = a * (1.37 + 0.11 * (index % 3))
  const p = boat.tone * 2 * Math.PI
  const x = BOAT_WANDER * sin(a * seconds + p)
  const z = BOAT_WANDER * sin(b * seconds + index)
  const length = Math.sqrt(boat.at.x * boat.at.x + boat.at.y * boat.at.y + boat.at.z * boat.at.z)
  const up = { x: boat.at.x / length, y: boat.at.y / length, z: boat.at.z / length }
  const { east, north } = tangentFrame(up)
  out.at.x = boat.at.x + east.x * x - north.x * z
  out.at.y = boat.at.y + east.y * x - north.y * z
  out.at.z = boat.at.z + east.z * x - north.z * z
  // The hull's length lies along its own x: turned by the yaw, x points east by its cosine and north by its sine.
  const vx = a * cos(a * seconds + p)
  const vz = b * cos(b * seconds + index)
  const standing = quatFromBasis(east.x, east.y, east.z, up.x, up.y, up.z, -north.x, -north.y, -north.z)
  const turned = qmultiply(standing, quatFromYaw(atan2(-vz, vx)))
  out.turn.x = turned.x
  out.turn.y = turned.y
  out.turn.z = turned.z
  out.turn.w = turned.w
  return out
}
