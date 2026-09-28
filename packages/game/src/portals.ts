/**
 * The portals between an island and its moon: which one a car has just
 * driven through, where each leads, and where a car comes out of one.
 */

import { isMoon, islandSeedOf, moonOf, sampleHeight, type Portal, type TerrainMap } from '@buggies/terrain'
import type { VehicleSpawn } from '@buggies/vehicle'

/** How far out of a portal a car comes, past its ring, how far apart two cars coming out together stand, how many abreast, and how far behind the row before the next. */
const EXIT = 14
const ABREAST = 3.5
const PER_ROW = 5
const ROW = 9

/** Where a portal's ring is round: a radius up off the ground it stands on. */
function middleOf(portal: Portal): { x: number; y: number; z: number } {
  return { x: portal.x, y: portal.y + portal.radius, z: portal.z }
}

/** Which of a map's portals a move from one point to the next passes through, inside its ring; or -1. */
export function portalCrossed(map: TerrainMap, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number {
  for (const [index, portal] of map.portals.entries()) {
    const middle = middleOf(portal)
    const before = (from.x - middle.x) * portal.dx + (from.z - middle.z) * portal.dz
    const after = (to.x - middle.x) * portal.dx + (to.z - middle.z) * portal.dz
    if (before === after || (before < 0) === (after < 0)) continue
    const t = before / (before - after)
    const x = from.x + (to.x - from.x) * t - middle.x
    const y = from.y + (to.y - from.y) * t - middle.y
    const z = from.z + (to.z - from.z) * t - middle.z
    if (x * x + y * y + z * z < portal.radius * portal.radius) return index
  }
  return -1
}

/**
 * Where a portal leads: every portal of an island to the one on its moon,
 * and the moon's back to the island, out of the portal `back` names, the
 * one the car went in by, or the first.
 */
export function portalLink(seed: number, back = 0): { seed: number; arrival: number } {
  return isMoon(seed) ? { seed: islandSeedOf(seed), arrival: back } : { seed: moonOf(seed), arrival: 0 }
}

/**
 * Where a car comes out of a portal: on the ground a little past its ring,
 * the way through it, driving on away from it; the `place`th of several
 * coming out together, side by side and then row behind row.
 */
export function portalSpawn(map: TerrainMap, index: number, place = 0): VehicleSpawn | null {
  const portal = map.portals[index]
  if (portal === undefined) return null
  const column = place % PER_ROW
  const aside = (column % 2 === 0 ? 1 : -1) * Math.ceil(column / 2) * ABREAST
  const out = EXIT + Math.floor(place / PER_ROW) * ROW
  const x = portal.x + portal.dx * out - portal.dz * aside
  const z = portal.z + portal.dz * out + portal.dx * aside
  return { position: { x, y: sampleHeight(map.heightfield, x, z), z }, yaw: Math.atan2(-portal.dx, -portal.dz) }
}
