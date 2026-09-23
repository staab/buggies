/**
 * Where tunnels run, and what they hollow out of the hill.
 *
 * A bore is not recorded anywhere in the map: it is implied by the road being
 * marked as a tunnel, and both the mesh that gets drawn and the collider that
 * gets driven on have to derive it the same way. When they disagree, a vehicle
 * drives into a hill that is not on screen, or through one that is.
 */

import * as exact from '@buggies/physics'
import { at } from './at.ts'
import type { Heightfield, Road } from './types.ts'
import { ROAD_SURFACE, ROAD_TUNNEL } from './roads.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { cos, hypot, sin } = exact

/** How thick the shell around a bore is, buried in the hill it cuts through. */
export const TUNNEL_WALL = 3
/** How far the bore reaches past the road's edge, so the arch has headroom over the whole carriageway. */
export const TUNNEL_CLEARANCE = 1.5
/**
 * A bore is a horseshoe: walls rise straight from the road this far before
 * the arch springs from them, so a car against the wall meets a wall and not
 * a slope it can climb.
 */
export const TUNNEL_WALL_HEIGHT = 2.5
/** Facets around the arch of the shell. */
const ARCH_SEGMENTS = 12
/** The shell's walls run this far below the road, to be buried rather than to end at it. */
const SHELL_FOOTING = 1

/** One straight piece of tunnel centreline, with the road height at each end. */
export interface BoreSegment {
  ax: number
  az: number
  bx: number
  bz: number
  ay: number
  by: number
  /** Half the tunnel road's width, plus the clearance the bore has past it. */
  radius: number
}

export function tunnelSegments(roads: Road[]): BoreSegment[] {
  const segments: BoreSegment[] = []
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    // Within the road: i runs over its segments, and the point after the last is a loop's first.
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_TUNNEL) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      segments.push({
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        ay: a.y,
        by: b.y,
        radius: road.width / 2 + TUNNEL_CLEARANCE,
      })
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

/** Height of the bore's roof over its floor, `distance` off the centreline. */
function archHeight(radius: number, distance: number): number {
  return TUNNEL_WALL_HEIGHT + Math.sqrt(Math.max(radius ** 2 - distance * distance, 0))
}

/** How far below the arch a point at `x, z` is: negative inside the bore. */
export function boreClearance(segments: BoreSegment[], x: number, z: number, height: number): number {
  const { distance, floor, radius } = nearestBore(segments, x, z)
  if (distance > radius) return Infinity
  return height - (floor + archHeight(radius, distance))
}

/**
 * Road height inside the bore over a point, or `null` where no tunnel runs.
 * `wall` widens the bore by that much, to ask about the shell around it.
 */
export function boreFloorAt(segments: BoreSegment[], x: number, z: number, wall = 0): number | null {
  const { distance, floor, radius } = nearestBore(segments, x, z)
  return distance > radius + wall ? null : floor
}

/**
 * Cells whose landscape sits inside a tunnel bore, so their faces can be
 * dropped. With `wall` the bore is taken to be the shell around it instead:
 * what a collider has to cut, since a cell straddling the bore's edge would
 * otherwise put a face straight through it.
 */
export function buildTunnelHoles(field: Heightfield, segments: BoreSegment[], wall = 0): Uint8Array {
  const { width, depth, cellSize, heights } = field
  const bestDistanceSq = new Float32Array(width * depth).fill(Infinity)
  const boreFloor = new Float32Array(width * depth)
  const boreRadius = new Float32Array(width * depth)
  let reach = cellSize
  for (const segment of segments) reach = Math.max(reach, segment.radius + wall + cellSize)
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
        // The rows and columns are clamped to the field, which these arrays cover.
        const cell = row * width + col
        if (distanceSq < bestDistanceSq[cell]!) {
          bestDistanceSq[cell] = distanceSq
          boreFloor[cell] = segment.ay + (segment.by - segment.ay) * t
          boreRadius[cell] = segment.radius + wall
        }
      }
    }
  }

  // All of these cover the field, a value a cell.
  const hole = new Uint8Array(width * depth)
  for (let cell = 0; cell < hole.length; cell++) {
    const distanceSq = bestDistanceSq[cell]!
    if (distanceSq === Infinity) continue
    const distance = Math.sqrt(distanceSq)
    const radius = boreRadius[cell]!
    if (distance > radius) continue
    if (heights[cell]! < boreFloor[cell]! + archHeight(radius, distance) + margin) hole[cell] = 1
  }
  return hole
}

/**
 * The road height under every cell within `margin` of a bore's footprint,
 * `NaN` elsewhere. Unlike the holes this takes no account of height: it is
 * the ground a collider has to cut away along the whole length of a tunnel,
 * so that no face runs from a cut cell inside the bore to a standing one
 * beside it.
 */
export function tunnelCutFloors(field: Heightfield, segments: BoreSegment[], margin: number): Float32Array {
  const { width, depth, cellSize } = field
  const floors = new Float32Array(width * depth).fill(NaN)
  const bestDistanceSq = new Float32Array(width * depth).fill(Infinity)
  for (const segment of segments) {
    const reach = segment.radius + margin
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
        if (distanceSq > reach * reach) continue
        // The rows and columns are clamped to the field, which these arrays cover.
        const cell = row * width + col
        if (distanceSq >= bestDistanceSq[cell]!) continue
        bestDistanceSq[cell] = distanceSq
        floors[cell] = segment.ay + (segment.by - segment.ay) * t
      }
    }
  }
  return floors
}

export interface ShellMesh {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * A solid horseshoe around the road for every tunnel run of a road: an inner
 * wall at the bore's edge and an outer wall `wall` further out, buried in the
 * hillside, footed below the road and capped at each portal. It follows the
 * centreline through the mountain, and is what gets drawn and what gets
 * driven against. Every face is wound to look out of the shell, into the
 * bore or into the hill, so a collider can treat it as a solid.
 */
export function tunnelShellMesh(road: Road, wall = TUNNEL_WALL): ShellMesh | null {
  const count = road.points.length
  const segmentCount = road.closed ? count : count - 1

  const inTunnel = new Uint8Array(count)
  for (let i = 0; i < segmentCount; i++) {
    if (road.structure[i] !== ROAD_TUNNEL) continue
    inTunnel[i] = 1
    inTunnel[(i + 1) % count] = 1
  }

  // Gather contiguous runs, starting from a sample outside every tunnel so no
  // run has to wrap.
  let firstOpen = 0
  while (firstOpen < count && inTunnel[firstOpen]) firstOpen++
  const runs: number[][] = []
  if (firstOpen === count) {
    runs.push(Array.from({ length: count }, (_, k) => k))
  } else {
    for (let k = 0; k < count; ) {
      if (!inTunnel[(firstOpen + k) % count]) {
        k++
        continue
      }
      const run: number[] = []
      while (k < count && inTunnel[(firstOpen + k) % count]) {
        run.push((firstOpen + k) % count)
        k++
      }
      runs.push(run)
    }
  }
  if (runs.length === 0) return null

  const positions: number[] = []
  const indices: number[] = []
  const archRadius = road.width / 2 + TUNNEL_CLEARANCE
  const outerRadius = archRadius + wall

  /**
   * The horseshoe, as offsets across and up from the road's centreline: a
   * footing below the road, a wall, the arch, and the same down the far side.
   */
  const profile = (radius: number): { across: number; up: number }[] => {
    const points = [
      { across: -radius, up: -SHELL_FOOTING },
      { across: -radius, up: TUNNEL_WALL_HEIGHT },
    ]
    for (let j = 0; j <= ARCH_SEGMENTS; j++) {
      const angle = Math.PI - (Math.PI * j) / ARCH_SEGMENTS
      points.push({
        across: radius * cos(angle),
        up: TUNNEL_WALL_HEIGHT + radius * sin(angle),
      })
    }
    points.push({ across: radius, up: TUNNEL_WALL_HEIGHT }, { across: radius, up: -SHELL_FOOTING })
    return points
  }
  const inside = profile(archRadius)
  const outside = profile(outerRadius)
  const width = inside.length

  for (const run of runs) {
    // Overhang a sample into the hillside at each portal so the shell meets the
    // landscape without a gap.
    const samples =
      run.length === count
        ? run
        : [
            (at(run, 0, 'tunnel run sample') - 1 + count) % count,
            ...run,
            (at(run, run.length - 1, 'tunnel run sample') + 1) % count,
          ]

    const base = positions.length / 3
    // Every sample is one of the road's points, and its neighbours wrap round the loop.
    for (const index of samples) {
      const point = road.points[index]!
      const prev = road.points[(index - 1 + count) % count]!
      const next = road.points[(index + 1) % count]!
      let dx = next.x - prev.x
      let dz = next.z - prev.z
      const length = hypot(dx, dz) || 1
      dx /= length
      dz /= length
      const nx = -dz
      const nz = dx

      for (const shape of [inside, outside]) {
        for (const { across, up } of shape) {
          positions.push(point.x + nx * across, point.y + ROAD_SURFACE + up, point.z + nz * across)
        }
      }
    }

    const inner = (s: number, j: number): number => base + s * width * 2 + j
    const outer = (s: number, j: number): number => base + s * width * 2 + width + j
    const quad = (a: number, b: number, c: number, d: number): void => {
      indices.push(a, b, c, b, d, c)
    }

    for (let s = 0; s < samples.length - 1; s++) {
      for (let j = 0; j + 1 < width; j++) {
        quad(inner(s, j), inner(s + 1, j), inner(s, j + 1), inner(s + 1, j + 1))
        quad(outer(s + 1, j), outer(s, j), outer(s + 1, j + 1), outer(s, j + 1))
      }
    }
    // Cap the wall at each portal.
    const first = 0
    const last = samples.length - 1
    for (let j = 0; j + 1 < width; j++) {
      quad(inner(first, j), inner(first, j + 1), outer(first, j), outer(first, j + 1))
      quad(inner(last, j + 1), inner(last, j), outer(last, j + 1), outer(last, j))
    }
  }

  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
