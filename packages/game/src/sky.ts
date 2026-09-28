/**
 * The sky over an island: the clouds floating high over the land, the
 * ceiling a little over them that nothing driven or flown gets above, and
 * the sun, which crosses it once a day so that day turns to night and back.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

const { cos, sin } = exact

/** How high over the sea the clouds float, in meters: well over the tallest tower and the highest peak. */
export const CLOUD_HEIGHT = 220
/** How high over the sea anything driven or flown may go: a little over the clouds. */
export const CEILING = CLOUD_HEIGHT + 30
/** How long a day takes, night and all, in seconds of the game's time. */
export const DAY_SECONDS = 600
/** How far into the day the game starts, as a share of it: mid-morning. */
const DAWN_SHARE = 0.35
/** How far south of overhead the sun passes at noon. */
const SUN_TILT = (30 * Math.PI) / 180
/** How much the sun's path is raised over the horizon, so the days run a little longer than the nights. */
const DAY_LIFT = 0.15

/**
 * The way to the sun, this many seconds into the game: up out of the east
 * in the morning, over to the south at noon, and down into the west, then
 * round under the island through the night.
 */
export function sunDirection(seconds: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  // Nought at midnight, a half turn at noon.
  const turn = 2 * Math.PI * (seconds / DAY_SECONDS + DAWN_SHARE)
  const x = -sin(turn)
  const y = -cos(turn) * cos(SUN_TILT) + DAY_LIFT
  const z = cos(turn) * sin(SUN_TILT)
  const length = Math.sqrt(x * x + y * y + z * z)
  out.x = x / length
  out.y = y / length
  out.z = z / length
  return out
}
