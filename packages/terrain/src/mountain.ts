import * as exact from '@buggies/physics'
import type { Mountain } from './types.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

export interface Triangle {
  ax: number
  az: number
  bx: number
  bz: number
  cx: number
  cz: number
}

/** Counter-clockwise winding, so inside the triangle all edge distances are positive. */
export function orientedTriangle(mountain: Mountain): Triangle {
  const { ax, az, bx, bz, cx, cz } = mountain
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
  return cross >= 0 ? { ax, az, bx, bz, cx, cz } : { ax, az, bx: cx, bz: cz, cx: bx, cz: bz }
}

/** Perpendicular distance to the line A->B, positive on its left. */
function edgeDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax
  const ez = bz - az
  const length = hypot(ex, ez) || 1
  return (ex * (pz - az) - ez * (px - ax)) / length
}

/** Signed distance to a triangle's nearest edge: positive inside, negative outside. */
export function signedDistanceToTriangle(px: number, pz: number, triangle: Triangle): number {
  return Math.min(
    edgeDistance(px, pz, triangle.ax, triangle.az, triangle.bx, triangle.bz),
    edgeDistance(px, pz, triangle.bx, triangle.bz, triangle.cx, triangle.cz),
    edgeDistance(px, pz, triangle.cx, triangle.cz, triangle.ax, triangle.az),
  )
}

/** Radius of the largest circle that fits inside the triangle. */
export function triangleInradius(triangle: Triangle): number {
  const ab = hypot(triangle.bx - triangle.ax, triangle.bz - triangle.az)
  const bc = hypot(triangle.cx - triangle.bx, triangle.cz - triangle.bz)
  const ca = hypot(triangle.ax - triangle.cx, triangle.az - triangle.cz)
  const perimeter = ab + bc + ca
  const doubleArea = Math.abs(
    (triangle.bx - triangle.ax) * (triangle.cz - triangle.az) -
      (triangle.bz - triangle.az) * (triangle.cx - triangle.ax),
  )
  return perimeter > 0 ? doubleArea / perimeter : 0
}

export function triangleCentroid(triangle: Triangle): { x: number; z: number } {
  return {
    x: (triangle.ax + triangle.bx + triangle.cx) / 3,
    z: (triangle.az + triangle.bz + triangle.cz) / 3,
  }
}