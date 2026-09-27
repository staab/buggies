/**
 * Where a planet's tunnels run, and what they hollow out of its hills. A
 * bore is implied by a road's segments being marked as tunnel, and the
 * ground drawn, the ground driven on and the shell round the bore all
 * derive it the same way.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { ROAD_SURFACE, ROAD_TUNNEL } from '../roads/constants.ts'
import type { WorldMesh, WorldRoad } from '../world.ts'
import { along, angleBetween, lift, unit } from './lines.ts'
import { eachPointNear, type Land } from './placing.ts'
import { roadFrameAt } from './rails.ts'
import { nearestOn } from './segments.ts'

const { cos, sin } = exact

/** How thick the shell around a bore is, buried in the hill it cuts through. */
export const TUNNEL_WALL = 3
/** How far the bore reaches past the road's edge, so the arch has headroom over the whole roadway. */
export const TUNNEL_CLEARANCE = 1.5
/**
 * A bore is a horseshoe: walls rise straight from the road this far before
 * the arch springs from them, so a car against the wall meets a wall and not
 * a slope it can climb.
 */
export const TUNNEL_WALL_HEIGHT = 2.5

/** Facets round the arch of the shell, and how far its walls run below the road. */
const ARCH_SEGMENTS = 12
const SHELL_FOOTING = 1
/** How far past the bore's width the shell reaches out of a portal: at least a cell of the ground. */
const PORTAL_OVERHANG = 4
/** How far under its road the floor of a bore is cut, matching the bed a graded road is given. */
const BORE_BED = 0.6
/** How far apart the ground's grid points are, about. */
const GROUND_CELL = 3

/** One straight piece of a tunnel's centerline: its ends, the road's centerline height at each, and how far the bore reaches from it. */
interface Bore {
  readonly a: Vec3
  readonly b: Vec3
  readonly floorA: number
  readonly floorB: number
  readonly radius: number
}

function heightOf(p: Vec3, radius: number): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) - radius
}

function boresOf(roads: readonly WorldRoad[], radius: number): Bore[] {
  const bores: Bore[] = []
  for (const road of roads) {
    const count = road.points.length
    const lift = road.kind === 'highway' ? ROAD_SURFACE : 0
    for (let i = 0; i < (road.closed ? count : count - 1); i++) {
      if (road.structure[i] !== ROAD_TUNNEL) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      bores.push({ a: unit(a), b: unit(b), floorA: heightOf(a, radius) - lift, floorB: heightOf(b, radius) - lift, radius: road.widths[0]! / 2 + TUNNEL_CLEARANCE })
    }
  }
  return bores
}

/** Height of the bore's roof over its floor, `distance` off the centerline. */
function archHeight(radius: number, distance: number): number {
  return TUNNEL_WALL_HEIGHT + Math.sqrt(Math.max(radius * radius - distance * distance, 0))
}

/**
 * The ground as it is driven on, bored out under every tunnel and a cell's
 * diagonal beyond it, so no face of the hill leans in over the ledge; and
 * the grid points the bore takes, where the ground is not drawn so the bore
 * can be seen into.
 */
export function boreGround(land: Land, roads: readonly WorldRoad[]): { bored: Float32Array; holes: Uint8Array } {
  const { ground, radius } = land
  const bored = Float32Array.from(ground.heights)
  const holes = new Uint8Array(ground.heights.length)
  const cutMargin = GROUND_CELL * Math.SQRT2
  const nearest = new Float32Array(ground.heights.length).fill(Infinity)
  const floorOf = new Float32Array(ground.heights.length)
  const radiusOf = new Float32Array(ground.heights.length)
  for (const bore of boresOf(roads, radius)) {
    const middle = unit({ x: bore.a.x + bore.b.x, y: bore.a.y + bore.b.y, z: bore.a.z + bore.b.z })
    const reach = angleBetween(bore.a, bore.b) * radius / 2 + bore.radius + cutMargin
    eachPointNear(land, middle, reach, (at, p) => {
      const { t, distance } = nearestOn(p, bore.a, bore.b, radius)
      if (distance > bore.radius + cutMargin || distance >= nearest[at]!) return
      nearest[at] = distance
      floorOf[at] = bore.floorA + (bore.floorB - bore.floorA) * t
      radiusOf[at] = bore.radius
    })
  }
  for (let at = 0; at < nearest.length; at++) {
    const distance = nearest[at]!
    if (distance === Infinity) continue
    bored[at] = Math.min(bored[at]!, floorOf[at]! - BORE_BED)
    const reach = radiusOf[at]!
    if (distance <= reach && ground.heights[at]! < floorOf[at]! + archHeight(reach, distance) + GROUND_CELL / 2) holes[at] = 1
  }
  return { bored, holes }
}

/**
 * A solid horseshoe round the road for every tunnel run of a road: an
 * inner wall at the bore's edge and an outer wall further out, buried in
 * the hill, footed below the road, capped at each portal and run on out of
 * it as far as the ground is cut before it. Every face is wound to look out
 * of the shell, into the bore or into the hill.
 */
export function tunnelShells(roads: readonly WorldRoad[], radius: number): WorldMesh[] {
  const wall = Math.max(TUNNEL_WALL, 2 * GROUND_CELL * Math.SQRT2)
  return roads.flatMap((road) => {
    const shell = shellOf(road, wall, radius)
    return shell === null ? [] : [shell]
  })
}

function shellOf(road: WorldRoad, wall: number, radius: number): WorldMesh | null {
  const count = road.points.length
  const segments = road.closed ? count : count - 1
  const inTunnel = new Uint8Array(count)
  for (let i = 0; i < segments; i++) {
    if (road.structure[i] !== ROAD_TUNNEL) continue
    inTunnel[i] = 1
    inTunnel[(i + 1) % count] = 1
  }
  // Contiguous runs, gathered from a point outside every tunnel so no run has to wrap.
  let firstOpen = 0
  while (firstOpen < count && inTunnel[firstOpen]) firstOpen++
  const runs: number[][] = []
  if (firstOpen === count) runs.push(Array.from({ length: count }, (_, k) => k))
  else {
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

  const archRadius = road.widths[0]! / 2 + TUNNEL_CLEARANCE
  const outerRadius = archRadius + wall
  /** The horseshoe, as offsets across and up from the road's surface: a footing, a wall, the arch, and down the far side. */
  const profile = (reach: number): { across: number; up: number }[] => {
    const points = [
      { across: -reach, up: -SHELL_FOOTING },
      { across: -reach, up: TUNNEL_WALL_HEIGHT },
    ]
    for (let j = 0; j <= ARCH_SEGMENTS; j++) {
      const angle = Math.PI - (Math.PI * j) / ARCH_SEGMENTS
      points.push({ across: reach * cos(angle), up: TUNNEL_WALL_HEIGHT + reach * sin(angle) })
    }
    points.push({ across: reach, up: TUNNEL_WALL_HEIGHT }, { across: reach, up: -SHELL_FOOTING })
    return points
  }
  const inside = profile(archRadius)
  const outside = profile(outerRadius)
  const width = inside.length
  /** The points a shell runs on out of a portal, this way along the road, until past the bore and the overhang, or the road ends. */
  const portalReach = (portal: number, step: 1 | -1): number[] => {
    const from = unit(road.points[portal]!)
    const reached: number[] = []
    for (let k = 1; k < count; k++) {
      const index = road.closed ? (portal + step * k + count) % count : portal + step * k
      const point = road.points[index]
      if (point === undefined) break
      reached.push(index)
      if (angleBetween(unit(point), from) * radius >= outerRadius + PORTAL_OVERHANG) break
    }
    return step < 0 ? reached.reverse() : reached
  }

  const positions: number[] = []
  const indices: number[] = []
  for (const run of runs) {
    const samples = run.length === count ? run : [...portalReach(run[0]!, -1), ...run, ...portalReach(run.at(-1)!, 1)]
    const base = positions.length / 3
    for (const index of samples) {
      const point = road.points[index]!
      const at = unit(point)
      const surface = heightOf(point, radius)
      // The road's left: across from its right edge to its left, as the flat shell runs its profile.
      const { left } = roadFrameAt(road, index)
      for (const shape of [inside, outside]) {
        for (const { across, up } of shape) {
          const p = lift(along(at, left, across, radius), radius, surface + up)
          positions.push(p.x, p.y, p.z)
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
    const first = 0
    const last = samples.length - 1
    for (let j = 0; j + 1 < width; j++) {
      quad(inner(first, j), inner(first, j + 1), outer(first, j), outer(first, j + 1))
      quad(inner(last, j + 1), inner(last, j), outer(last, j + 1), outer(last, j))
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
