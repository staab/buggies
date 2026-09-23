import type { Heightfield, Lake } from './types.ts'

export interface FlowRouting {
  /** Water surface after depressions are filled. Never lower than the terrain. */
  filled: Float32Array
  /** Downhill neighbour for each cell, or -1 for cells with no outlet. */
  flow: Int32Array
  /** Order cells were finalized; lower means closer to the sea. */
  order: Int32Array
}

// The cells on the heap are all within the field, and the heap is only ever
// read below its length, so none of these reads comes back empty.
function compareCells(a: number, b: number, filled: Float32Array): number {
  const diff = filled[a]! - filled[b]!
  return diff !== 0 ? diff : a - b
}

function heapPush(heap: number[], cell: number, filled: Float32Array): void {
  heap.push(cell)
  let pos = heap.length - 1
  while (pos > 0) {
    const parent = (pos - 1) >> 1
    if (compareCells(heap[parent]!, cell, filled) <= 0) break
    heap[pos] = heap[parent]!
    pos = parent
  }
  heap[pos] = cell
}

/** The lowest cell on the heap, or nothing when it is empty. */
function heapPop(heap: number[], filled: Float32Array): number | undefined {
  const last = heap.pop()
  if (last === undefined) return undefined
  const top = heap[0]
  if (top === undefined) return last

  const length = heap.length
  let pos = 0
  for (;;) {
    const left = pos * 2 + 1
    if (left >= length) break
    const right = left + 1
    const child =
      right < length && compareCells(heap[right]!, heap[left]!, filled) < 0 ? right : left
    if (compareCells(heap[child]!, last, filled) >= 0) break
    heap[pos] = heap[child]!
    pos = child
  }
  heap[pos] = last
  return top
}

/**
 * Priority-flood depression filling with drainage routing.
 *
 * Every cell is raised to the level at which it can escape to the boundary,
 * and is given a downhill neighbour. This means rivers always have a path to
 * the sea, and any cell raised above its terrain becomes a lake.
 */
export function computeFlowRouting(field: Heightfield, seaLevel: number): FlowRouting {
  const { width, depth, heights } = field
  const count = width * depth
  const filled = new Float32Array(count)
  const flow = new Int32Array(count).fill(-1)
  const order = new Int32Array(count).fill(-1)
  const visited = new Uint8Array(count)
  const heap: number[] = []
  let processed = 0

  // Every cell here is within the field, so its height is there to read.
  const seed = (cell: number): void => {
    if (visited[cell]) return
    visited[cell] = 1
    filled[cell] = Math.max(heights[cell]!, seaLevel)
    heapPush(heap, cell, filled)
  }

  for (let col = 0; col < width; col++) {
    seed(col)
    seed((depth - 1) * width + col)
  }
  for (let row = 0; row < depth; row++) {
    seed(row * width)
    seed(row * width + width - 1)
  }

  for (let cell = heapPop(heap, filled); cell !== undefined; cell = heapPop(heap, filled)) {
    order[cell] = processed++
    const row = (cell / width) | 0
    const col = cell - row * width

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue
        const nextRow = row + dz
        const nextCol = col + dx
        if (nextRow < 0 || nextRow >= depth || nextCol < 0 || nextCol >= width) continue
        const next = nextRow * width + nextCol
        if (visited[next]) continue
        visited[next] = 1
        filled[next] = Math.max(heights[next]!, filled[cell]!)
        flow[next] = cell
        heapPush(heap, next, filled)
      }
    }
  }

  return { filled, flow, order }
}

/**
 * Contiguous patches where the filled water surface sits above the terrain.
 * Each patch is one lake at the level of its spill point.
 */
export function findLakes(field: Heightfield, routing: FlowRouting, seaLevel: number): Lake[] {
  const { width, depth, heights } = field
  const { filled } = routing
  const count = width * depth
  const visited = new Uint8Array(count)
  const lakes: Lake[] = []
  const stack: number[] = []

  // Only cells within the field are asked about.
  const isDepression = (cell: number): boolean =>
    heights[cell]! > seaLevel && filled[cell]! - heights[cell]! > 1e-3

  for (let start = 0; start < count; start++) {
    if (visited[start] || !isDepression(start)) continue

    const cells: number[] = []
    let level = -Infinity
    stack.push(start)
    visited[start] = 1

    for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
      cells.push(cell)
      level = Math.max(level, filled[cell]!)
      const row = (cell / width) | 0
      const col = cell - row * width
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue
          const nextRow = row + dz
          const nextCol = col + dx
          if (nextRow < 0 || nextRow >= depth || nextCol < 0 || nextCol >= width) continue
          const next = nextRow * width + nextCol
          if (visited[next] || !isDepression(next)) continue
          visited[next] = 1
          stack.push(next)
        }
      }
    }

    lakes.push({ id: lakes.length, level, cells })
  }

  return lakes
}
