/**
 * A round tunnel as it is driven on: one smooth tube swept along its line,
 * an ellipse across, faced in toward its middle, which a car can drive
 * round all the way, up the wall, over the roof and down the far side.
 * The ground's grid cannot: it holds one floor and one roof at each of its
 * points, and where the two meet at a tunnel's sides they fold into a
 * crease a car stumbles on. So the tube is what is driven on, and the
 * floor and roof are cut a little outside it, out of the way.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { lift, unit } from '../globe/lines.ts'
import type { WorldMesh } from '../world.ts'

const { cos, sin } = exact

/** How many sides a tube has round. */
export const TUBE_SIDES = 36

/**
 * A tube's course: the line along its middle, how high its middle stands
 * over the radius at each point, how far it reaches across, up and down,
 * and how round its floor is at each point: 1 for an ellipse all round, 0
 * for flat right across at its lowest, walls rising straight from it to
 * where its roof springs, as at a mouth opening onto a floor.
 */
export interface Tube {
  readonly line: readonly Vec3[]
  readonly middle: readonly number[]
  readonly round: readonly number[]
  readonly reach: number
  readonly above: number
  readonly below: number
}

/** The tube swept along its line, each ring square to the way the line runs there, wound to face in. */
export function tubeMesh(tube: Tube, radius: number): WorldMesh {
  const { line, middle, round, reach, above, below } = tube
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i < line.length; i++) {
    const up = unit(line[i]!)
    const ahead = line[Math.min(i + 1, line.length - 1)]!
    const behind = line[Math.max(i - 1, 0)]!
    // Across: the way the line runs crossed with the way up.
    const run = { x: ahead.x - behind.x, y: ahead.y - behind.y, z: ahead.z - behind.z }
    const side = unit({ x: run.y * up.z - run.z * up.y, y: run.z * up.x - run.x * up.z, z: run.x * up.y - run.y * up.x })
    const center = lift(up, radius, middle[i]!)
    for (let k = 0; k < TUBE_SIDES; k++) {
      const angle = (2 * Math.PI * k) / TUBE_SIDES
      const across = cos(angle) * reach
      // Over its middle, the roof's ellipse; under it, the floor's, flattened as far as it is not round there.
      const s = sin(angle)
      const rise = s >= 0 ? s * above : -below * (1 - round[i]! + round[i]! * -s)
      positions.push(center.x + side.x * across + up.x * rise, center.y + side.y * across + up.y * rise, center.z + side.z * across + up.z * rise)
    }
  }
  const at = (i: number, k: number): number => i * TUBE_SIDES + (k % TUBE_SIDES)
  for (let i = 0; i + 1 < line.length; i++) {
    for (let k = 0; k < TUBE_SIDES; k++) indices.push(at(i, k), at(i, k + 1), at(i + 1, k), at(i, k + 1), at(i + 1, k + 1), at(i + 1, k))
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
