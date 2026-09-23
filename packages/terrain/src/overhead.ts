/**
 * Decks: every stretch of road built up off the ground, that something can
 * pass under. The highway is deck end to end wherever it is not bored
 * through a hill, and a surface road is deck across its bridges. What
 * passes under one, a car on the road beneath or the camera following it,
 * asks here what is overhead.
 */

import { ROAD_BRIDGE, ROAD_TUNNEL, isSurfaceRoad, roadLift } from './roads.ts'
import type { Road } from './types.ts'

/** One straight piece of deck: its centreline in plan, the surface height at each end, and how far it reaches either side. */
export interface DeckSpan {
  ax: number
  az: number
  bx: number
  bz: number
  ay: number
  by: number
  half: number
}

/** The deck reaches this far past the carriageway's edge. */
const DECK_OVERHANG = 1

export function deckSpans(roads: Road[]): DeckSpan[] {
  const spans: DeckSpan[] = []
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const lift = roadLift(road)
    const surface = isSurfaceRoad(road)
    // Within the road: i runs over its segments, and the point after the last is a loop's first.
    for (let i = 0; i < segmentCount; i++) {
      const structure = road.structure[i]
      if (structure === ROAD_TUNNEL) continue
      if (surface && structure !== ROAD_BRIDGE) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      spans.push({
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        ay: a.y + lift,
        by: b.y + lift,
        half: road.width / 2 + DECK_OVERHANG,
      })
    }
  }
  return spans
}

/**
 * The surface height of the lowest deck over a point that is higher than
 * `above`, or infinity where nothing is. A deck the point is on, or under
 * by less than that, does not count as overhead.
 */
export function lowestDeckOver(spans: DeckSpan[], x: number, z: number, above: number): number {
  let lowest = Number.POSITIVE_INFINITY
  for (const span of spans) {
    const vx = span.bx - span.ax
    const vz = span.bz - span.az
    const lengthSq = vx * vx + vz * vz || 1
    const t = Math.min(Math.max(((x - span.ax) * vx + (z - span.az) * vz) / lengthSq, 0), 1)
    const dx = x - (span.ax + vx * t)
    const dz = z - (span.az + vz * t)
    if (dx * dx + dz * dz > span.half * span.half) continue
    const height = span.ay + (span.by - span.ay) * t
    if (height > above && height < lowest) lowest = height
  }
  return lowest
}
