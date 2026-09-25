import type { FlowRouting } from './flow.ts'
import { orientedTriangle, triangleCentroid, triangleInradius } from './mountain.ts'
import type { Heightfield, Mountain, River, RiverPoint } from './types.ts'

/** Headwaters start almost thread-thin and widen as the river descends. */
const MIN_WIDTH = 0.8
const MAX_WIDTH = 6.5
/** Springs sit this fraction of the mountain's rise below the summit. */
const SOURCE_DROP = 0.5

/**
 * A spring partway down a mountain rather than at its summit. The cell nearest
 * to half the mountain's rise is chosen, so the upper slopes stay riverless.
 */
function findSource(field: Heightfield, mountain: Mountain, seaLevel: number, used: Set<number>): number {
  const { width, depth, cellSize, heights } = field
  const triangle = orientedTriangle(mountain)
  const center = triangleCentroid(triangle)
  const coreRadius = Math.max(triangleInradius(triangle), 15)
  const searchRadius = coreRadius + Math.max(mountain.skirt, 20)
  const minCol = Math.max(Math.floor((center.x - searchRadius) / cellSize), 0)
  const maxCol = Math.min(Math.ceil((center.x + searchRadius) / cellSize), width - 1)
  const minRow = Math.max(Math.floor((center.z - searchRadius) / cellSize), 0)
  const maxRow = Math.min(Math.ceil((center.z + searchRadius) / cellSize), depth - 1)

  const within = (col: number, row: number, radius: number): boolean => {
    const dx = col * cellSize - center.x
    const dz = row * cellSize - center.z
    return dx * dx + dz * dz <= radius * radius
  }

  // The summit is only needed to measure how far down to start. The rows and
  // columns walked here are within the field, so every height is there.
  let summitY = -Infinity
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!within(col, row, coreRadius)) continue
      const cell = row * width + col
      if (used.has(cell) || heights[cell]! <= seaLevel) continue
      summitY = Math.max(summitY, heights[cell]!)
    }
  }
  if (summitY === -Infinity) return -1

  const targetY = summitY - mountain.height * SOURCE_DROP
  let best = -1
  let bestScore = Infinity
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!within(col, row, searchRadius)) continue
      const cell = row * width + col
      if (used.has(cell) || heights[cell]! <= seaLevel) continue
      const score = Math.abs(heights[cell]! - targetY)
      if (score < bestScore) {
        bestScore = score
        best = cell
      }
    }
  }
  return best
}

/**
 * Follow the routed downhill neighbours from a spring to the sea. The water
 * surface is `routing.filled`, which is flat across lakes and non-increasing
 * downhill, so the river always descends. Width tracks how far the river has
 * dropped, keeping the headwaters thin at the top of the mountain.
 */
function traceCourse(field: Heightfield, routing: FlowRouting, source: number, seaLevel: number): RiverPoint[] {
  const { width, cellSize, heights } = field
  const { filled, flow } = routing
  const points: RiverPoint[] = []
  const maxSteps = width * width
  // The source is a cell of the field, and so is everything the flow leads to.
  const sourceY = filled[source]!
  const drop = Math.max(sourceY - seaLevel, 1e-3)
  let cell = source

  for (let step = 0; step < maxSteps; step++) {
    const row = (cell / width) | 0
    const col = cell - row * width
    const y = filled[cell]!
    const progress = Math.min(Math.max((sourceY - y) / drop, 0), 1)
    points.push({
      x: col * cellSize,
      y,
      z: row * cellSize,
      width: (MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * progress) * cellSize,
    })

    if (heights[cell]! <= seaLevel) break

    const next = flow[cell] ?? -1
    if (next < 0 || next === cell) break
    cell = next
  }

  return points
}

/** One river per mountain, capped at `count`. */
/**
 * The water ribbon is drawn this much wider than the channel, as a fraction of
 * its half width, so it laps into the banks. A ribbon drawn to exactly the
 * river's width leaves the cut bank showing along the outside of every bend,
 * where the channel is swept wider than the flat quads that represent it.
 */
export const RIVER_BANK_LAP = 0.35

export function traceRivers(
  field: Heightfield,
  routing: FlowRouting,
  mountains: Mountain[],
  count: number,
  seaLevel: number,
): River[] {
  const rivers: River[] = []
  const used = new Set<number>()
  for (const mountain of mountains) {
    if (rivers.length >= count) break
    const source = findSource(field, mountain, seaLevel, used)
    if (source < 0) continue
    used.add(source)
    const points = traceCourse(field, routing, source, seaLevel)
    if (points.length > 1) rivers.push({ id: rivers.length, points })
  }
  return rivers
}