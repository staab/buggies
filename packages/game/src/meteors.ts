import { createRng, v3, type Vec3 } from '@buggies/physics'
import { alongGround, overSurface, randomDirection, upOf, type World } from '@buggies/terrain'

/** How often a meteor comes down on a moon with anyone driving on it, in ticks. */
export const METEOR_EVERY_TICKS = 60 * 6
/** How long one takes to fall from where it is first seen, in ticks. */
export const METEOR_FALL_TICKS = 60 * 3
/** How high over the ground it is first seen, and how far off to one side, so it comes in slanting. */
export const METEOR_HEIGHT = 260
export const METEOR_SLANT = 140
/** How far from the car it is aimed at it can land. */
export const METEOR_SCATTER = 25
/** How far its blast reaches, and what it does to a car at its middle, half again a bomb's: less the further out, none at the edge. */
export const METEOR_RANGE = 18
export const METEOR_DAMAGE = 1.5
/** How hard its blast throws a car at its middle, in m/s, out and up. */
export const METEOR_THROW = 9
const METEOR_SALT = 0x3e7e

/** A meteor coming down: from where it was first seen to where it lands, by the tick it was first seen. */
export interface Meteor {
  readonly id: number
  readonly from: Vec3
  readonly to: Vec3
  readonly bornTick: number
}

/** The number of the meteor that comes down at this tick: the same on every mirror. */
export function meteorId(tick: number): number {
  return Math.floor(tick / METEOR_EVERY_TICKS) & 0xffff
}

/** Where a meteor is at a tick: on its straight line down, landed once its time is up. */
export function meteorAt(meteor: Meteor, tick: number, out: Vec3): Vec3 {
  const t = Math.min(Math.max((tick - meteor.bornTick) / METEOR_FALL_TICKS, 0), 1)
  out.x = meteor.from.x + (meteor.to.x - meteor.from.x) * t
  out.y = meteor.from.y + (meteor.to.y - meteor.from.y) * t
  out.z = meteor.from.z + (meteor.to.z - meteor.from.z) * t
  return out
}

/** Whether a meteor has come down by this tick. */
export function meteorLanded(meteor: Meteor, tick: number): boolean {
  return tick - meteor.bornTick >= METEOR_FALL_TICKS
}

const up = v3()
const aside = v3()

/**
 * A meteor aimed at one of these places, picked by the tick: landing on
 * the ground somewhere near it, and coming in from high over it and off
 * to one side. None with nowhere to aim at.
 */
export function aimMeteor(map: World, aims: readonly Vec3[], tick: number): Meteor | null {
  if (aims.length === 0) return null
  const rng = createRng((map.seed ^ METEOR_SALT) + meteorId(tick) * 6151)
  const aim = aims[Math.floor(rng() * aims.length) % aims.length]!
  // Somewhere round the car, within the scatter, along the ground.
  upOf(aim, up)
  alongGround(randomDirection(rng, aside), up, aside)
  const spread = Math.sqrt(aside.x * aside.x + aside.y * aside.y + aside.z * aside.z) || 1
  const off = rng() * METEOR_SCATTER
  const near = { x: aim.x + (aside.x / spread) * off, y: aim.y + (aside.y / spread) * off, z: aim.z + (aside.z / spread) * off }
  const to = overSurface(map, upOf(near, up), 0, v3())
  // In from another way along the ground, high up.
  alongGround(randomDirection(rng, aside), up, aside)
  const slant = Math.sqrt(aside.x * aside.x + aside.y * aside.y + aside.z * aside.z) || 1
  const from = {
    x: to.x + up.x * METEOR_HEIGHT + (aside.x / slant) * METEOR_SLANT,
    y: to.y + up.y * METEOR_HEIGHT + (aside.y / slant) * METEOR_SLANT,
    z: to.z + up.z * METEOR_HEIGHT + (aside.z / slant) * METEOR_SLANT,
  }
  return { id: meteorId(tick), from, to, bornTick: tick }
}

/** How much of a meteor's full blast is felt this far from where it lands: all of it at the middle, none past its reach. */
export function meteorShare(distance: number): number {
  return Math.max(1 - distance / METEOR_RANGE, 0)
}
