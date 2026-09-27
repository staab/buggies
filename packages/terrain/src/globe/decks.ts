/**
 * A planet's built roadways as one mesh. The ground has a bed cut into it
 * under every built road, below the surface the road is drawn at, so the
 * deck is what is driven on. Graded roads carry their shoulders down to the
 * ground so the edge is a ramp rather than a curb to crash into; a bridge
 * gets only its deck, unless the ground beside it is nearly up to it; in a
 * tunnel the deck runs level out under the wall. A surface road is the
 * ground wherever it is at grade, so only its bridges are built.
 */

import type { Vec3 } from '@buggies/physics'

import { BRIDGE_SHOULDER_DROP, ROAD_BRIDGE, ROAD_GRADE, ROAD_SKIRT, ROAD_TUNNEL } from '../roads/constants.ts'
import { sphereHeight, type SphereGround } from '../sphere.ts'
import { TUNNEL_CLEARANCE } from './tunnels.ts'
import type { WorldDecks, WorldRoad } from '../world.ts'
import { along, lift, unit } from './lines.ts'
import { roadFrameAt } from './rails.ts'

/** How a road's shoulders are built at a point: carried down to the ground, left off, or run flat out to a tunnel's wall. */
type Shoulder = 'ground' | 'none' | 'ledge'

/** How far a tunnel's ledge runs on under the wall, so a car leaning on the wall has floor under its outer wheels. */
const LEDGE_UNDER_WALL = 1
/** Where across a deck's skirt the ground is read, as fractions of the skirt's width out from the deck's edge. */
const SKIRT_FOOT_SAMPLES = [0.25, 0.5, 0.75, 1] as const
const LANES = 3

/** What a deck's vertex is that is none of the `ROAD_*` structures: a shoulder, down to the ground or out to a tunnel's wall. */
export const DECK_SKIRT = 255

function heightOf(p: Vec3, radius: number): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) - radius
}

/** Where a deck's skirt meets the ground on one side: the highest the ground stands across the skirt's width, never above the deck. */
function skirtFoot(ground: SphereGround, at: Vec3, way: Vec3, half: number, deck: number): number {
  let foot = -Infinity
  for (const across of SKIRT_FOOT_SAMPLES) foot = Math.max(foot, sphereHeight(ground, along(at, way, half + ROAD_SKIRT * across, ground.radius)))
  return Math.min(foot, deck)
}

/** Whether a built road's segment carries its shoulders down to the ground: an at-grade run always, a bridge where the ground beside it is nearly up to the deck. */
function shouldered(ground: SphereGround, road: WorldRoad, segment: number): boolean {
  const structure = road.structure[segment]
  if (structure === ROAD_GRADE) return true
  if (structure !== ROAD_BRIDGE) return false
  const count = road.points.length
  const half = road.widths[0]! / 2
  for (const index of [segment, (segment + 1) % count]) {
    const point = road.points[index]!
    const at = unit(point)
    const { left } = roadFrameAt(road, index)
    for (const side of [1, -1]) {
      const way = { x: left.x * side, y: left.y * side, z: left.z * side }
      if (sphereHeight(ground, along(at, way, half + ROAD_SKIRT, ground.radius)) >= heightOf(point, ground.radius) - BRIDGE_SHOULDER_DROP) return true
    }
  }
  return false
}

/** The four points across a road at one of its points, shoulder, edge, edge, shoulder, and their heights. */
function crossSection(ground: SphereGround, road: WorldRoad, index: number, shoulder: Shoulder, out: number[]): void {
  const { radius } = ground
  const point = road.points[index]!
  const at = unit(point)
  const { left } = roadFrameAt(road, index)
  const right = { x: -left.x, y: -left.y, z: -left.z }
  const half = road.widths[index]! / 2
  const deck = heightOf(point, radius)
  const reach = shoulder === 'ground' ? half + ROAD_SKIRT : shoulder === 'ledge' ? half + TUNNEL_CLEARANCE + LEDGE_UNDER_WALL : half
  const leftGround = shoulder === 'ground' ? skirtFoot(ground, at, left, half, deck) : deck
  const rightGround = shoulder === 'ground' ? skirtFoot(ground, at, right, half, deck) : deck
  for (const p of [
    lift(along(at, left, reach, radius), radius, leftGround),
    lift(along(at, left, half, radius), radius, deck),
    lift(along(at, right, half, radius), radius, deck),
    lift(along(at, right, reach, radius), radius, rightGround),
  ]) {
    out.push(p.x, p.y, p.z)
  }
}

/** Every built roadway of a planet, and what each of its vertices is: a `ROAD_*` structure for the roadway, or `DECK_SKIRT` for a shoulder. */
export function globeDecks(ground: SphereGround, roads: readonly WorldRoad[]): WorldDecks {
  const positions: number[] = []
  const indices: number[] = []
  const surfaces: number[] = []
  for (const road of roads) {
    const count = road.points.length
    const segments = road.closed ? count : count - 1
    const painted = road.kind !== 'highway'
    for (let i = 0; i < segments; i++) {
      const structure = road.structure[i]!
      if (painted && structure === ROAD_GRADE) continue
      const shoulder: Shoulder = structure === ROAD_TUNNEL ? 'ledge' : shouldered(ground, road, i) ? 'ground' : 'none'
      const base = positions.length / 3
      crossSection(ground, road, i, shoulder, positions)
      crossSection(ground, road, (i + 1) % count, shoulder, positions)
      for (let k = 0; k < 2; k++) surfaces.push(DECK_SKIRT, structure, structure, DECK_SKIRT)
      // Without a shoulder the outer pair sits on the edge pair, and the lanes either side would be triangles of no area, which the solver gets no normal off.
      const first = shoulder === 'none' ? 1 : 0
      const last = shoulder === 'none' ? LANES - 1 : LANES
      for (let lane = first; lane < last; lane++) {
        const a = base + lane
        const b = base + lane + 1
        const c = base + LANES + 1 + lane
        const d = base + LANES + 2 + lane
        indices.push(a, c, b, b, c, d)
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), surfaces: Uint8Array.from(surfaces) }
}
