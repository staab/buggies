import { ROAD_GRADE, ROAD_SKIRT, ROAD_TUNNEL, deckShouldered, isSurfaceRoad, roadLift, skirtFoot } from './roads.ts'
import { TUNNEL_CLEARANCE } from './tunnels.ts'
import type { Heightfield, Road } from './types.ts'

/**
 * How a road's shoulders are built at a sample: carried down to the ground
 * beside an at-grade run, left off a bridge, or run flat out to the wall of
 * a tunnel, where the ground is cut away and the wheels need something to
 * ride on beside the deck.
 */
type Shoulder = 'ground' | 'none' | 'ledge'

/**
 * How far a tunnel's ledge runs on under the wall. A car leaning on the wall
 * can have wheels standing out past its chassis, over the wall's footing,
 * and they need floor under them or the car hangs off the wall by its side.
 */
const LEDGE_UNDER_WALL = 1

function shoulderOf(road: Road, field: Heightfield, segment: number): Shoulder {
  if (road.structure[segment] === ROAD_TUNNEL) return 'ledge'
  return deckShouldered(road, field, segment) ? 'ground' : 'none'
}

/** The four points across a road at one of its samples: shoulder, edge, edge, shoulder. */
function crossSection(road: Road, field: Heightfield, index: number, out: number[], shoulder: Shoulder, lift: number): void {
  const count = road.points.length
  // The sample is one of the road's points, and its neighbors are wrapped around a loop or held at an end.
  const point = road.points[index]!
  const previous = road.points[road.closed ? (index - 1 + count) % count : Math.max(index - 1, 0)]!
  const next = road.points[road.closed ? (index + 1) % count : Math.min(index + 1, count - 1)]!
  const dx = next.x - previous.x
  const dz = next.z - previous.z
  const length = Math.hypot(dx, dz) || 1
  const nx = -dz / length
  const nz = dx / length
  const half = road.width / 2
  const y = point.y + lift
  const reach = shoulder === 'ground' ? half + ROAD_SKIRT : shoulder === 'ledge' ? half + TUNNEL_CLEARANCE + LEDGE_UNDER_WALL : half

  // A shoulder runs down to the highest ground across the skirt, as the deck is drawn.
  const leftGround = shoulder === 'ground' ? skirtFoot(field, point.x, point.z, nx, nz, half, y) : y
  const rightGround = shoulder === 'ground' ? skirtFoot(field, point.x, point.z, -nx, -nz, half, y) : y

  out.push(
    point.x + nx * reach, leftGround, point.z + nz * reach,
    point.x + nx * half, y, point.z + nz * half,
    point.x - nx * half, y, point.z - nz * half,
    point.x - nx * reach, rightGround, point.z - nz * reach,
  )
}

const LANES = 3

/**
 * The built roadways, as one mesh. The ground has a bed cut into it under
 * every built road, well below the surface the road is drawn at, so the
 * deck is what is driven on. Graded roads carry their shoulders down to the
 * ground with them so the edge is a ramp rather than a curb to crash into;
 * a bridge gets only its deck, because there is supposed to be nothing
 * beside it; in a tunnel the deck runs level to the wall. A surface road is
 * the ground wherever it is at grade, so only its bridges are built.
 */
export function deckMesh(roads: readonly Road[], field: Heightfield): { positions: number[]; indices: number[] } {
  const positions: number[] = []
  const indices: number[] = []
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const lift = roadLift(road)
    const painted = isSurfaceRoad(road)
    // A segment's structure is within the road's: there is one a segment.
    for (let i = 0; i < segmentCount; i++) {
      const structure = road.structure[i]!
      if (painted && structure === ROAD_GRADE) continue
      const shoulder = shoulderOf(road, field, i)
      const base = positions.length / 3
      crossSection(road, field, i, positions, shoulder, lift)
      crossSection(road, field, (i + 1) % count, positions, shoulder, lift)

      // Without a shoulder the outer pair sits exactly on the edge pair, and
      // the lanes either side of the roadway come out as zero-area
      // triangles. A mesh full of those does not just waste space: the solver
      // gets contacts with no usable normal off them, and vehicles near one
      // stick to nothing and grind to a halt.
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
  return { positions, indices }
}
