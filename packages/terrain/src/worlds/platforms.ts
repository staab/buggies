/**
 * A floating platform's top: a round sheet laid over the sphere at the
 * platform's height, in rings out from its middle to an edge as round as
 * its sides are many, so the platform ends in a smooth circle rather than
 * the steps of the ground's grid. It is what is driven on and what is
 * drawn, and the rock under it hangs from the same edge.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { frameAt, fromFrame } from '../globe/frame.ts'
import { lift } from '../globe/lines.ts'
import type { WorldMesh, WorldPlatform } from '../world.ts'

const { cos, sin } = exact

/** How many sides a platform's edge has, and how far apart its rings are, in meters. */
export const PLATFORM_SIDES = 96
const RING_STEP = 3

/** The ways out round a platform's edge, this far in from it, one a side. */
export function platformEdge(platform: WorldPlatform, radius: number, inset = 0): Vec3[] {
  const frame = frameAt(platform.center, radius)
  const reach = platform.radius - inset
  return Array.from({ length: PLATFORM_SIDES }, (_, k) => {
    const angle = (2 * Math.PI * k) / PLATFORM_SIDES
    return fromFrame(frame, cos(angle) * reach, sin(angle) * reach)
  })
}

/** A platform's top, wound to face out from the planet's middle. */
export function platformTop(platform: WorldPlatform, radius: number): WorldMesh {
  const frame = frameAt(platform.center, radius)
  const rings = Math.max(1, Math.ceil(platform.radius / RING_STEP))
  const positions: number[] = []
  const indices: number[] = []
  const put = (direction: Vec3): void => {
    const p = lift(direction, radius, platform.height)
    positions.push(p.x, p.y, p.z)
  }
  put(frame.middle)
  for (let ring = 1; ring <= rings; ring++) {
    const reach = (platform.radius * ring) / rings
    for (let k = 0; k < PLATFORM_SIDES; k++) {
      const angle = (2 * Math.PI * k) / PLATFORM_SIDES
      put(fromFrame(frame, cos(angle) * reach, sin(angle) * reach))
    }
  }
  const at = (ring: number, k: number): number => (ring === 0 ? 0 : 1 + (ring - 1) * PLATFORM_SIDES + (k % PLATFORM_SIDES))
  for (let ring = 0; ring < rings; ring++) {
    for (let k = 0; k < PLATFORM_SIDES; k++) {
      // Counterclockwise seen from above, as the frame runs east then south: so wound with its outer ring first.
      if (ring === 0) indices.push(at(0, 0), at(1, k + 1), at(1, k))
      else indices.push(at(ring, k), at(ring, k + 1), at(ring + 1, k), at(ring, k + 1), at(ring + 1, k + 1), at(ring + 1, k))
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
