/**
 * The portals between a planet's worlds: which one a car has just driven
 * through, where each leads, and where a car comes out of one.
 */

import { qrotate, uprightRotation, v3, type Vec3 } from '@buggies/physics'
import { WORLD_KINDS, planetSeedOf, sphereHeight, upOf, worldId, type World, type WorldPortal } from '@buggies/terrain'
import type { VehicleSpawn } from '@buggies/vehicle'

/** How far out of a portal a car comes, past its ring, and how far apart two cars coming out together stand. */
const EXIT = 14
const ABREAST = 3.5

/** A portal's middle, where its ring is round, sunk to the ground it stands on; and the way through it. */
function ringOf(portal: WorldPortal): { middle: Vec3; through: Vec3 } {
  const through = qrotate(v3(), portal.turn, { x: 0, y: 0, z: 1 })
  return { middle: portal.at, through }
}

/** Which of a world's portals a move from one point to the next passes through, inside its ring; or -1. */
export function portalCrossed(world: World, from: Vec3, to: Vec3): number {
  for (const [index, portal] of world.portals.entries()) {
    const { middle, through } = ringOf(portal)
    const before = (from.x - middle.x) * through.x + (from.y - middle.y) * through.y + (from.z - middle.z) * through.z
    const after = (to.x - middle.x) * through.x + (to.y - middle.y) * through.y + (to.z - middle.z) * through.z
    if (before === 0 || Math.sign(before) === Math.sign(after)) continue
    const t = before / (before - after)
    const x = from.x + (to.x - from.x) * t - middle.x
    const y = from.y + (to.y - from.y) * t - middle.y
    const z = from.z + (to.z - from.z) * t - middle.z
    if (x * x + y * y + z * z < portal.radius * portal.radius) return index
  }
  return -1
}

/**
 * Where a portal leads: to any of the planet's other worlds, picked at
 * random each time it is driven through. A car comes out of the first
 * portal of the world it goes to; back on the planet itself, out of the
 * one `back` names, the one it left by.
 */
export function portalLink(world: World, back = 0, random: () => number = Math.random): { to: number; arrival: number } {
  const others = WORLD_KINDS.filter((kind) => kind !== world.kind)
  const kind = others[Math.min(Math.floor(random() * others.length), others.length - 1)]!
  return { to: worldId(planetSeedOf(world.seed), kind), arrival: kind === 'planet' ? back : 0 }
}

/**
 * Where a car comes out of a portal: on the ground a little past its ring,
 * the way through it, driving on away from it; the `place`th of several
 * coming out together side by side.
 */
export function portalSpawn(world: World, index: number, place = 0): VehicleSpawn | null {
  const portal = world.portals[index]
  if (portal === undefined) return null
  const { through } = ringOf(portal)
  const across = qrotate(v3(), portal.turn, { x: 1, y: 0, z: 0 })
  const aside = (place % 2 === 0 ? 1 : -1) * Math.ceil(place / 2) * ABREAST
  const out = {
    x: portal.at.x + through.x * EXIT + across.x * aside,
    y: portal.at.y + through.y * EXIT + across.y * aside,
    z: portal.at.z + through.z * EXIT + across.z * aside,
  }
  const up = upOf(out)
  const r = world.radius + sphereHeight(world.ground, up)
  const position = v3(up.x * r, up.y * r, up.z * r)
  return { position, up, rotation: uprightRotation(up, through) }
}
