import type { Ridge } from './types.ts'

export interface Segment {
  ax: number
  az: number
  bx: number
  bz: number
}

export function ridgeSegment(ridge: Ridge): Segment {
  const dirX = Math.cos(ridge.angle)
  const dirZ = Math.sin(ridge.angle)
  const half = ridge.length / 2
  return {
    ax: ridge.x - dirX * half,
    az: ridge.z - dirZ * half,
    bx: ridge.x + dirX * half,
    bz: ridge.z + dirZ * half,
  }
}

/** Distance from a point to a segment, plus how far along the segment it falls. */
export function distanceToSegment(x: number, z: number, segment: Segment): { distance: number; along: number } {
  const abx = segment.bx - segment.ax
  const abz = segment.bz - segment.az
  const lengthSq = abx * abx + abz * abz
  const raw = lengthSq > 0 ? ((x - segment.ax) * abx + (z - segment.az) * abz) / lengthSq : 0
  const along = Math.min(Math.max(raw, 0), 1)
  const closestX = segment.ax + abx * along
  const closestZ = segment.az + abz * along
  return { distance: Math.hypot(x - closestX, z - closestZ), along }
}