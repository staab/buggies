/**
 * The ground of a planet, laid out on the planet itself: a cube-sphere. Each
 * of a cube's six faces is a grid of `n` × `n` cells, and each grid point is
 * carried out onto the sphere along the ray from the middle, spaced by equal
 * angles so the cells come out nearly square everywhere, the corners of the
 * cube as much as the middles of its faces. A height is kept at every grid
 * point, over the planet's radius; the points along the edges between faces
 * are kept once for each face they are on, the same height each time.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, tan } = exact

/** A face of the cube: the way out through its middle, and the ways its grid runs across it and up it, `across` × `up` = `out`. */
export interface CubeFace {
  readonly out: Vec3
  readonly across: Vec3
  readonly up: Vec3
}

export const CUBE_FACES: readonly CubeFace[] = [
  { out: { x: 1, y: 0, z: 0 }, across: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
  { out: { x: -1, y: 0, z: 0 }, across: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
  { out: { x: 0, y: 1, z: 0 }, across: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  { out: { x: 0, y: -1, z: 0 }, across: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { out: { x: 0, y: 0, z: 1 }, across: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { out: { x: 0, y: 0, z: -1 }, across: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
]

/** A planet's ground: how many cells a face's side has, the planet's radius, and a height at every grid point of every face. */
export interface SphereGround {
  readonly n: number
  readonly radius: number
  readonly heights: Float32Array
}

/** How many grid points a face has along a side. */
export function sidePoints(ground: { n: number }): number {
  return ground.n + 1
}

/** A new ground, level with the planet's radius everywhere. */
export function createSphereGround(n: number, radius: number): SphereGround {
  const side = n + 1
  return { n, radius, heights: new Float32Array(6 * side * side) }
}

/** Where a face's grid point's height is kept. */
export function groundIndex(ground: { n: number }, face: number, i: number, j: number): number {
  const side = ground.n + 1
  return face * side * side + j * side + i
}

/** The unit direction from the middle through a face's grid point, `i` across and `j` up, each 0 to n. */
export function gridDirection(n: number, face: number, i: number, j: number, out: Vec3): Vec3 {
  const { out: middle, across, up } = CUBE_FACES[face]!
  const a = tan(((2 * i) / n - 1) * (Math.PI / 4))
  const b = tan(((2 * j) / n - 1) * (Math.PI / 4))
  const x = middle.x + across.x * a + up.x * b
  const y = middle.y + across.y * a + up.y * b
  const z = middle.z + across.z * a + up.z * b
  const length = Math.sqrt(x * x + y * y + z * z)
  out.x = x / length
  out.y = y / length
  out.z = z / length
  return out
}

/** Where a direction meets the cube: which face, and how far across it and up it, each 0 to n, not rounded. */
export interface GridPlace {
  face: number
  i: number
  j: number
}

/** The face a direction leaves the cube by, and where on its grid. */
export function gridPlace(n: number, direction: Vec3, out: GridPlace): GridPlace {
  const { x, y, z } = direction
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  const face = ax >= ay && ax >= az ? (x >= 0 ? 0 : 1) : ay >= az ? (y >= 0 ? 2 : 3) : z >= 0 ? 4 : 5
  const { out: middle, across, up } = CUBE_FACES[face]!
  const outward = x * middle.x + y * middle.y + z * middle.z
  const a = atan2(x * across.x + y * across.y + z * across.z, outward) / (Math.PI / 4)
  const b = atan2(x * up.x + y * up.y + z * up.z, outward) / (Math.PI / 4)
  out.face = face
  out.i = ((a + 1) / 2) * n
  out.j = ((b + 1) / 2) * n
  return out
}

const place: GridPlace = { face: 0, i: 0, j: 0 }

/** The ground's height over the planet's radius in a direction, read between the four grid points round it. */
export function sphereHeight(ground: SphereGround, direction: Vec3): number {
  const { n, heights } = ground
  gridPlace(n, direction, place)
  const i0 = Math.min(Math.max(Math.floor(place.i), 0), n - 1)
  const j0 = Math.min(Math.max(Math.floor(place.j), 0), n - 1)
  const fi = Math.min(Math.max(place.i - i0, 0), 1)
  const fj = Math.min(Math.max(place.j - j0, 0), 1)
  const at = (i: number, j: number): number => heights[groundIndex(ground, place.face, i, j)]!
  const low = at(i0, j0) * (1 - fi) + at(i0 + 1, j0) * fi
  const high = at(i0, j0 + 1) * (1 - fi) + at(i0 + 1, j0 + 1) * fi
  return low * (1 - fj) + high * fj
}

/** The distance along the sphere between two directions, at this radius. */
export function arcDistance(a: Vec3, b: Vec3, radius: number): number {
  const cx = a.y * b.z - a.z * b.y
  const cy = a.z * b.x - a.x * b.z
  const cz = a.x * b.y - a.y * b.x
  return atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), a.x * b.x + a.y * b.y + a.z * b.z) * radius
}
