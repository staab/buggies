import type { FlowRouting } from './flow.ts'
import { distanceToSegment, ridgeSegment } from './ridge.ts'
import type { Heightfield, Ridge, River, RiverPoint } from './types.ts'

const MIN_WIDTH = 1.5
const MAX_WIDTH = 6.5
/** How far off a crest line a spring may sit, as a multiple of ridge width. */
const SOURCE_MARGIN = 2.5

/** Highest cell on a crest line, restricted to cells a predicate accepts. */
function searchCrest(
  field: Heightfield,
  ridge: Ridge,
  accept: (along: number) => boolean,
): number {
  const { width, depth, cellSize, heights } = field
  const segment = ridgeSegment(ridge)
  const margin = ridge.width * SOURCE_MARGIN
  const minCol = Math.max(Math.floor((Math.min(segment.ax, segment.bx) - margin) / cellSize), 0)
  const maxCol = Math.min(Math.ceil((Math.max(segment.ax, segment.bx) + margin) / cellSize), width - 1)
  const minRow = Math.max(Math.floor((Math.min(segment.az, segment.bz) - margin) / cellSize), 0)
  const maxRow = Math.min(Math.ceil((Math.max(segment.az, segment.bz) + margin) / cellSize), depth - 1)

  let best = -1
  let bestHeight = -Infinity
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const { distance, along } = distanceToSegment(col * cellSize, row * cellSize, segment)
      if (distance > margin || !accept(along)) continue
      const cell = row * width + col
      const height = heights[cell]!
      if (height > bestHeight) {
        bestHeight = height
        best = cell
      }
    }
  }
  return best
}

/**
 * Highest cell on a ridge crest, used as a spring. The ridges all cross at the
 * massif, so each spring is confined to one side of the crossing to keep the
 * rivers distinct.
 */
function findSource(field: Heightfield, ridge: Ridge, side: number): number {
  const source = searchCrest(field, ridge, (along) =>
    side === 0 ? along >= 0.55 && along <= 0.95 : along >= 0.05 && along <= 0.45,
  )
  return source >= 0 ? source : searchCrest(field, ridge, () => true)
}

/**
 * Follow the routed downhill neighbours from a spring to the sea. The water
 * surface is `routing.filled`, which is flat across lakes and non-increasing
 * downhill, so the river always descends. Width grows with distance travelled.
 */
function traceCourse(field: Heightfield, routing: FlowRouting, source: number, seaLevel: number): RiverPoint[] {
  const { width, cellSize, heights } = field
  const { filled, flow } = routing
  const points: RiverPoint[] = []
  const maxSteps = width * width
  let cell = source
  let distance = 0

  for (let step = 0; step < maxSteps; step++) {
    const row = (cell / width) | 0
    const col = cell - row * width
    const progress = Math.min(1, distance / (width * cellSize * 0.6))
    points.push({
      x: col * cellSize,
      y: filled[cell]!,
      z: row * cellSize,
      width: (MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * progress) * cellSize,
    })

    if (heights[cell]! <= seaLevel) break

    const next = flow[cell]!
    if (next < 0 || next === cell) break

    const nextRow = (next / width) | 0
    const nextCol = next - nextRow * width
    distance += Math.hypot(nextCol - col, nextRow - row) * cellSize
    cell = next
  }

  return points
}

/** One river per ridge, capped at `count`. */
export function traceRivers(
  field: Heightfield,
  routing: FlowRouting,
  ridges: Ridge[],
  count: number,
  seaLevel: number,
): River[] {
  const rivers: River[] = []
  for (let i = 0; i < ridges.length; i++) {
    if (rivers.length >= count) break
    const source = findSource(field, ridges[i]!, i % 2)
    if (source < 0) continue
    const points = traceCourse(field, routing, source, seaLevel)
    if (points.length > 1) rivers.push({ id: rivers.length, points })
  }
  return rivers
}