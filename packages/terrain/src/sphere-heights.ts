/**
 * A planet's ground, raised on the sphere itself: islands out of the sea,
 * mountains on them, and the plains between, every grid point worked out
 * from where it is on the sphere, so there is no map edge, no seam and no
 * pole left bare.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { signedDistanceToTriangle, triangleInradius, type Triangle } from './mountain.ts'
import { fbm3D, ridged3D, smoothstep } from './noise.ts'
import { arcDistance, gridDirection, groundIndex, type SphereGround } from './sphere.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

/** An island on the sphere: the way out to its middle, and how far its land reaches along the surface, in meters. */
export interface SphereIsland {
  readonly center: Vec3
  readonly radius: number
}

/**
 * A mountain on the sphere: the way out to its middle, the plane that
 * touches the sphere there, by its east and north, and its triangle laid in
 * that plane, in meters from the middle; its skirt and its height.
 */
export interface SphereMountain {
  readonly center: Vec3
  readonly east: Vec3
  readonly north: Vec3
  readonly triangle: Triangle
  readonly skirt: number
  readonly height: number
}

/** The plane touching the sphere at a direction: its east, round the y axis, and its north, up toward it. */
export function tangentFrame(center: Vec3): { east: Vec3; north: Vec3 } {
  // East is up across the middle, or, at a pole, any way at all.
  let ex = center.z
  let ez = -center.x
  let length = hypot(ex, ez)
  if (length < 1e-9) {
    ex = 1
    ez = 0
    length = 1
  }
  const east = { x: ex / length, y: 0, z: ez / length }
  const north = {
    x: center.y * east.z - center.z * east.y,
    y: center.z * east.x - center.x * east.z,
    z: center.x * east.y - center.y * east.x,
  }
  return { east, north }
}

/**
 * Where a direction lies on the plane touching the sphere at a middle, in
 * meters: projected from the sphere's middle, as a map centered there is.
 * Only for directions within a quarter turn of it.
 */
export function onTangentPlane(direction: Vec3, center: Vec3, east: Vec3, north: Vec3, radius: number): { x: number; z: number } {
  const toward = direction.x * center.x + direction.y * center.y + direction.z * center.z
  const scale = radius / toward
  return {
    x: (direction.x * east.x + direction.y * east.y + direction.z * east.z) * scale,
    z: (direction.x * north.x + direction.y * north.y + direction.z * north.z) * scale,
  }
}

/** The height over which two islands' domes blend into one where they overlap. */
const DOME_BLEND = 6

/** The greater of two values, rounded off over `blend` where they come close, so the seam has no crease. */
function smoothMax(a: number, b: number, blend: number): number {
  const h = Math.max(blend - Math.abs(a - b), 0) / blend
  return Math.max(a, b) + (h * h * blend) / 4
}

/** How much overlapping mountains reinforce each other, 0 = max, 1 = pure sum. */
const MOUNTAIN_OVERLAP = 0.6

/** Everything the raising reads, in meters. */
export interface SphereRelief {
  readonly seed: number
  readonly islands: readonly SphereIsland[]
  readonly mountains: readonly SphereMountain[]
  readonly oceanDepth: number
  /** The largest island's radius, which sets how much the plains roll. */
  readonly largest: number
}

/**
 * Raise the ground at every grid point: an island's land out to near its
 * radius, its coast warped by noise into bays and headlands; a gentle dome
 * over it so water drains to the sea; low rolling plains; and the mountains,
 * full height inside their triangles and falling away over their skirts.
 * Past every coast the sea floor. Frequencies are in meters, as the flat
 * map's are once it is enlarged, so the ground has the same grain.
 */
export function raiseSphereGround(ground: SphereGround, relief: SphereRelief): void {
  const { n, radius, heights } = ground
  const { seed, islands, mountains, oceanDepth, largest } = relief
  const plainsAmplitude = largest * 0.002
  const baseFrequency = 0.008 / 3
  const roughFrequency = 0.03 / 3
  const warpFrequency = 0.006 / 3
  const shapes = mountains.map((mountain) => ({
    ...mountain,
    inradius: Math.max(triangleInradius(mountain.triangle), 1e-3),
    reach: Math.max(
      hypot(mountain.triangle.ax, mountain.triangle.az),
      hypot(mountain.triangle.bx, mountain.triangle.bz),
      hypot(mountain.triangle.cx, mountain.triangle.cz),
    ) + mountain.skirt,
  }))
  const direction = { x: 0, y: 0, z: 0 }
  const warped = { x: 0, y: 0, z: 0 }
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        gridDirection(n, face, i, j, direction)
        const px = direction.x * radius
        const py = direction.y * radius
        const pz = direction.z * radius
        // The coasts are warped: the point moved a little by noise before its distance from each island is taken.
        const wx = fbm3D(px * warpFrequency + 11.3, py * warpFrequency + 7.1, pz * warpFrequency + 3.3, seed + 101, 4) - 0.5
        const wy = fbm3D(px * warpFrequency + 3.7, py * warpFrequency + 19.2, pz * warpFrequency + 5.9, seed + 211, 4) - 0.5
        const wz = fbm3D(px * warpFrequency + 8.1, py * warpFrequency + 2.6, pz * warpFrequency + 17.4, seed + 307, 4) - 0.5
        let sea = 1
        let dome = 0
        for (const [k, island] of islands.entries()) {
          const warpAmplitude = island.radius * 0.45
          warped.x = px + wx * warpAmplitude * 2
          warped.y = py + wy * warpAmplitude * 2
          warped.z = pz + wz * warpAmplitude * 2
          const length = hypot(hypot(warped.x, warped.y), warped.z)
          warped.x /= length
          warped.y /= length
          warped.z /= length
          const distance = arcDistance(warped, island.center, radius)
          sea *= smoothstep(island.radius * 0.55, island.radius, distance)
          // The dome follows the plain distance from the middle, not the warped one the coast is cut by.
          const rise = island.radius * 0.032 * (1 - smoothstep(0, island.radius * 0.85, arcDistance(direction, island.center, radius)))
          dome = k === 0 ? rise : smoothMax(dome, rise, DOME_BLEND)
        }
        const mask = 1 - sea
        const base = fbm3D(px * baseFrequency, py * baseFrequency, pz * baseFrequency, seed + 1, 2)
        const land = base * plainsAmplitude + dome

        let mountain = 0
        let roughness = -1
        for (const shape of shapes) {
          const toward = direction.x * shape.center.x + direction.y * shape.center.y + direction.z * shape.center.z
          if (toward <= 0.2 || arcDistance(direction, shape.center, radius) > shape.reach) continue
          const at = onTangentPlane(direction, shape.center, shape.east, shape.north, radius)
          const signed = signedDistanceToTriangle(at.x, at.z, shape.triangle)
          if (signed <= -shape.skirt) continue
          if (roughness < 0) roughness = ridged3D(px * roughFrequency, py * roughFrequency, pz * roughFrequency, seed + 2, 5)
          const factor = smoothstep(-shape.skirt, shape.inradius, signed)
          const contribution = shape.height * factor * (0.6 + 0.4 * roughness)
          const high = Math.max(mountain, contribution)
          const low = Math.min(mountain, contribution)
          mountain = high + MOUNTAIN_OVERLAP * low
        }

        heights[groundIndex(ground, face, i, j)] = (land + mountain) * mask - oceanDepth * (1 - mask)
      }
    }
  }
}
