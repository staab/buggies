import { ROAD_GRADE, ROAD_TUNNEL, TUNNEL_CLEARANCE, TUNNEL_WALL_HEIGHT, groundUnder, type World } from '@buggies/terrain'
import type * as THREE from 'three'

import type { CameraBoundsAt } from './chase-camera.ts'

/** A deck has to clear the car's center by this much to count as over it rather than under it. */
const DECK_HEADROOM = 1.5
/** How far below a deck's surface its underside is taken to be. */
const DECK_UNDERSIDE = 0.4

/** A stretch of road with something over or around it: a deck to pass under, or a tunnel to be inside. */
interface Span {
  readonly a: THREE.Vector3Like
  readonly b: THREE.Vector3Like
  readonly half: number
  readonly tunnel: boolean
}

/**
 * Where a point lies along a span, seen from the planet's middle: how far
 * along it, 0 to 1, and how far to one side of it, along the ground.
 */
function across(span: Span, at: THREE.Vector3Like): { t: number; aside: number } {
  const { a, b } = span
  const vx = b.x - a.x
  const vy = b.y - a.y
  const vz = b.z - a.z
  const t = Math.min(Math.max(((at.x - a.x) * vx + (at.y - a.y) * vy + (at.z - a.z) * vz) / (vx * vx + vy * vy + vz * vz || 1), 0), 1)
  // The nearest point of the span, brought out to the point's own distance from the middle, so height does not count.
  const px = a.x + vx * t
  const py = a.y + vy * t
  const pz = a.z + vz * t
  const scale = Math.sqrt(at.x * at.x + at.y * at.y + at.z * at.z) / (Math.sqrt(px * px + py * py + pz * pz) || 1)
  return { t, aside: Math.hypot(at.x - px * scale, at.y - py * scale, at.z - pz * scale) }
}

/** How far a point of a span is from the planet's middle. */
function outAt(span: Span, t: number): number {
  const { a, b } = span
  return Math.hypot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
}

/**
 * What the chase camera must stay between, as distances from the planet's
 * middle: the ground, or for a car inside a tunnel the road and the arch
 * over it, or under a bridge the deck overhead. Read from the world rather
 * than the physics so the camera never has to ask the simulation anything.
 */
export function cameraBounds(world: World): CameraBoundsAt {
  const spans: Span[] = []
  for (const road of world.roads) {
    const count = road.points.length
    const segments = road.closed ? count : count - 1
    for (let i = 0; i < segments; i++) {
      const structure = road.structure[i]
      // The ground carries a surface road at grade: nothing over it there, nothing to be under.
      if (road.kind !== 'highway' && structure === ROAD_GRADE) continue
      spans.push({ a: road.points[i]!, b: road.points[(i + 1) % count]!, half: road.widths[i]! / 2, tunnel: structure === ROAD_TUNNEL })
    }
  }
  const reachOf = (span: Span): number => (span.tunnel ? span.half + TUNNEL_CLEARANCE : span.half)
  return (at, out, above) => {
    out.floor = world.radius + groundUnder(world, at)
    out.ceiling = Number.POSITIVE_INFINITY
    for (const span of spans) {
      const { t, aside } = across(span, at)
      if (aside > reachOf(span)) continue
      const road = outAt(span, t)
      if (span.tunnel) {
        // Only a car down in the bore is in the tunnel: one over it, flying or falling, is out in the open.
        const roof = road + TUNNEL_WALL_HEIGHT + span.half + TUNNEL_CLEARANCE
        if (above > roof) continue
        out.floor = road
        out.ceiling = Math.min(out.ceiling, roof)
      } else if (road > above + DECK_HEADROOM) {
        out.ceiling = Math.min(out.ceiling, road - DECK_UNDERSIDE)
      }
    }
    return out
  }
}
