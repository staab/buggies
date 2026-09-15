/**
 * Where tunnels run, and what they hollow out of the hill.
 *
 * A bore is not recorded anywhere in the map: it is implied by the road being
 * marked as a tunnel, and both the mesh that gets drawn and the collider that
 * gets driven on have to derive it the same way. When they disagree, a vehicle
 * drives into a hill that is not on screen, or through one that is.
 */

import type { Heightfield, Road } from './types.ts'
import { ROAD_TUNNEL } from './roads.ts'

/** One straight piece of tunnel centreline, with the road height at each end. */
export interface BoreSegment {
  ax: number
  az: number
  bx: number
  bz: number
  ay: number
  by: number
  /** Half the tunnel road's width. */
  radius: number
}

export function tunnelSegments(roads: Road[]): BoreSegment[] {
  const segments: BoreSegment[] = []
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_TUNNEL) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ay: a.y, by: b.y, radius: road.width / 2 })
    }
  }
  return segments
}

/** The bore nearest a point: how far off its centreline, and its road height. */
function nearestBore(
  segments: BoreSegment[],
  x: number,
  z: number,
): { distance: number; floor: number; radius: number } {
  let bestDistanceSq = Infinity
  let floor = 0
  let radius = 0
  for (const segment of segments) {
    const vx = segment.bx - segment.ax
    const vz = segment.bz - segment.az
    const lengthSq = vx * vx + vz * vz || 1
    const t = Math.min(Math.max(((x - segment.ax) * vx + (z - segment.az) * vz) / lengthSq, 0), 1)
    const dx = x - (segment.ax + vx * t)
    const dz = z - (segment.az + vz * t)
    const distanceSq = dx * dx + dz * dz
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      floor = segment.ay + (segment.by - segment.ay) * t
      radius = segment.radius
    }
  }
  return { distance: Math.sqrt(bestDistanceSq), floor, radius }
}

/** How far below the arch a point at `x, z` is: negative inside the bore. */
export function boreClearance(segments: BoreSegment[], x: number, z: number, height: number): number {
  const { distance, floor, radius } = nearestBore(segments, x, z)
  if (distance > radius) return Infinity
  const arch = Math.sqrt(Math.max(radius ** 2 - distance * distance, 0))
  return height - (floor + arch)
}

/** Road height inside the bore over a point, or `null` where no tunnel runs. */
export function boreFloorAt(segments: BoreSegment[], x: number, z: number): number | null {
  const { distance, floor, radius } = nearestBore(segments, x, z)
  return distance > radius ? null : floor
}

/** Cells whose landscape sits inside a tunnel bore, so their faces can be dropped. */
export function buildTunnelHoles(field: Heightfield, segments: BoreSegment[]): Uint8Array {
  const { width, depth, cellSize, heights } = field
  const bestDistanceSq = new Float32Array(width * depth).fill(Infinity)
  const boreFloor = new Float32Array(width * depth)
  const boreRadius = new Float32Array(width * depth)
  let reach = cellSize
  for (const segment of segments) reach = Math.max(reach, segment.radius + cellSize)
  const margin = cellSize * 0.5

  for (const segment of segments) {
    const minCol = Math.max(Math.floor((Math.min(segment.ax, segment.bx) - reach) / cellSize), 0)
    const maxCol = Math.min(Math.ceil((Math.max(segment.ax, segment.bx) + reach) / cellSize), width - 1)
    const minRow = Math.max(Math.floor((Math.min(segment.az, segment.bz) - reach) / cellSize), 0)
    const maxRow = Math.min(Math.ceil((Math.max(segment.az, segment.bz) + reach) / cellSize), depth - 1)
    const vx = segment.bx - segment.ax
    const vz = segment.bz - segment.az
    const lengthSq = vx * vx + vz * vz || 1

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const x = col * cellSize
        const z = row * cellSize
        const t = Math.min(Math.max(((x - segment.ax) * vx + (z - segment.az) * vz) / lengthSq, 0), 1)
        const dx = x - (segment.ax + vx * t)
        const dz = z - (segment.az + vz * t)
        const distanceSq = dx * dx + dz * dz
        const cell = row * width + col
        if (distanceSq < bestDistanceSq[cell]!) {
          bestDistanceSq[cell] = distanceSq
          boreFloor[cell] = segment.ay + (segment.by - segment.ay) * t
          boreRadius[cell] = segment.radius
        }
      }
    }
  }

  const hole = new Uint8Array(width * depth)
  for (let cell = 0; cell < hole.length; cell++) {
    const distanceSq = bestDistanceSq[cell]!
    if (distanceSq === Infinity) continue
    const distance = Math.sqrt(distanceSq)
    const radius = boreRadius[cell]!
    if (distance > radius) continue
    const arch = Math.sqrt(Math.max(radius ** 2 - distance * distance, 0))
    if (heights[cell]! < boreFloor[cell]! + arch + margin) hole[cell] = 1
  }
  return hole
}
