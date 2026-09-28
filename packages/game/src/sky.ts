/**
 * The sky over a planet: the clouds floating high over the land, the
 * ceiling a little over them that nothing driven or flown gets above, and
 * the sun, which the planet turns under so that day and night go round it.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

const { cos, sin } = exact

/** How high over the planet's radius the clouds float, in meters: well over the tallest tower and the highest peak. */
export const CLOUD_HEIGHT = 130
/** How high over the planet's radius anything driven or flown may go: a little over the clouds. */
export const CEILING = CLOUD_HEIGHT + 30
/** How long a day takes, in seconds of the game's time. */
export const DAY_SECONDS = 240
/** How far north of the equator the sun stands, as the planet's axis is tilted from it. */
const SUN_DECLINATION = (23.4 * Math.PI) / 180

/**
 * The way to the sun from the planet's middle, this many seconds into the
 * game: the sun stands this far north of the equator, and the planet turns
 * under it about its axis, the way from pole to pole, once a day.
 */
export function sunDirection(seconds: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const turn = (-2 * Math.PI * seconds) / DAY_SECONDS
  out.x = cos(SUN_DECLINATION) * sin(turn)
  out.y = sin(SUN_DECLINATION)
  out.z = cos(SUN_DECLINATION) * cos(turn)
  return out
}
