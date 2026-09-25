import { beforeAll, describe, expect, it } from 'vitest'

import { generateTerrain } from './generate.ts'
import { sampleHeight } from './heightfield.ts'
import { signedDistanceToTriangle, orientedTriangle } from './mountain.ts'
import {
  MAX_RAMP_CURVATURE,
  MAX_ROAD_CURVATURE,
  RAMP_WIDTH,
  ROAD_GRADE,
  ROAD_SKIRT,
  isSurfaceRoad,
  roadLift,
} from './roads.ts'
import type { TerrainMap } from './types.ts'

let map: TerrainMap

/**
 * Cells of dry, open plain: off the mountains, away from water and its banks,
 * back from the shore, which falls to the sea however flat the land is, and
 * clear of the roads, which shape the ground they run over.
 */
function plainCells(island: TerrainMap): number[] {
  const { width, depth, cellSize, heights } = island.heightfield
  const triangles = island.mountains.map(orientedTriangle)
  const wet = new Uint8Array(width * depth)
  const reach = Math.ceil(15 / cellSize)
  const flood = (x: number, z: number, cells = reach): void => {
    const centerCol = Math.round(x / cellSize)
    const centerRow = Math.round(z / cellSize)
    for (let row = centerRow - cells; row <= centerRow + cells; row++) {
      for (let col = centerCol - cells; col <= centerCol + cells; col++) {
        if (row < 0 || row >= depth || col < 0 || col >= width) continue
        wet[row * width + col] = 1
      }
    }
  }
  for (const river of island.rivers) for (const point of river.points) flood(point.x, point.z)
  const margin = Math.ceil(20 / cellSize)
  for (const road of island.roads) for (const point of road.points) flood(point.x, point.z, margin)
  for (const lake of island.lakes) {
    for (const cell of lake.cells) flood((cell % width) * cellSize, Math.floor(cell / width) * cellSize)
  }
  // The shore: every cell within 200m of the sea. Only the sea's own edge
  // cells need flooding, and only those with land beside them.
  const shore = Math.ceil(200 / cellSize)
  for (let cell = 0; cell < width * depth; cell++) {
    if (heights[cell]! > island.seaLevel) continue
    const col = cell % width
    const row = Math.floor(cell / width)
    const edge =
      (col > 0 && heights[cell - 1]! > island.seaLevel) ||
      (col + 1 < width && heights[cell + 1]! > island.seaLevel) ||
      (row > 0 && heights[cell - width]! > island.seaLevel) ||
      (row + 1 < depth && heights[cell + width]! > island.seaLevel)
    if (edge) flood(col * cellSize, row * cellSize, shore)
  }

  const cells: number[] = []
  for (let cell = 0; cell < width * depth; cell++) {
    if (wet[cell] === 1) continue
    if (heights[cell]! < island.seaLevel + 3) continue
    const x = (cell % width) * cellSize
    const z = Math.floor(cell / width) * cellSize
    const onHills = island.mountains.some(
      (mountain, index) => signedDistanceToTriangle(x, z, triangles[index]!) > -mountain.skirt * 2,
    )
    if (!onHills) cells.push(cell)
  }
  return cells
}

/** Distance in plan from a point to the nearest stretch of a road's centerline. */
function distanceToRoad(road: TerrainMap['roads'][number], x: number, z: number): number {
  let nearest = Infinity
  for (let i = 0; i + 1 < road.points.length; i++) {
    const a = road.points[i]!
    const b = road.points[i + 1]!
    const vx = b.x - a.x
    const vz = b.z - a.z
    const lengthSq = vx * vx + vz * vz || 1
    const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
    nearest = Math.min(nearest, Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)))
  }
  return nearest
}

function slopeAt(island: TerrainMap, cell: number): number {
  const { width, cellSize, heights } = island.heightfield
  const height = heights[cell]!
  const col = cell % width
  const right = col + 1 < width ? Math.abs(heights[cell + 1]! - height) : 0
  const down = cell + width < heights.length ? Math.abs(heights[cell + width]! - height) : 0
  return Math.max(right, down) / cellSize
}

/** How much the slope changes across a cell: what a car feels as a bump or a crest. */
function kinkAt(island: TerrainMap, cell: number): number {
  const { width, cellSize, heights } = island.heightfield
  const col = cell % width
  const row = Math.floor(cell / width)
  if (col < 1 || col + 1 >= width || row < 1 || row + 1 >= island.heightfield.depth) return 0
  const height = heights[cell]!
  const across = Math.abs(heights[cell - 1]! - 2 * height + heights[cell + 1]!)
  const along = Math.abs(heights[cell - width]! - 2 * height + heights[cell + width]!)
  return Math.max(across, along) / cellSize
}

describe('the ground under the roads', () => {
  beforeAll(() => {
    map = generateTerrain(1)
  }, 60_000)

  it('keeps the plains flat enough that nothing on them is a jump', () => {
    const cells = plainCells(map)
    expect(cells.length).toBeGreaterThan(10_000)
    const slopes = cells.map((cell) => slopeAt(map, cell)).sort((a, b) => a - b)
    const kinks = cells.map((cell) => kinkAt(map, cell)).sort((a, b) => a - b)
    // The plain drains gently to the sea and no more: nearly all of it is
    // gentler than a road is allowed to be.
    expect(slopes[Math.floor(slopes.length * 0.95)]!).toBeLessThan(0.1)
    // What throws a car is a change of slope, not a slope. Over a cell, at
    // 30m/s, a change of 0.06 is a full g: nothing on the plain comes near it.
    expect(kinks[Math.floor(kinks.length * 0.99)]!).toBeLessThan(0.04)
    expect(kinks[kinks.length - 1]!).toBeLessThan(0.08)
  })

  it('makes each surface road the ground it runs on, right across the roadway', () => {
    const { heightfield } = map
    let samples = 0
    let across = 0
    let acrossOff = 0
    for (const road of map.roads) {
      if (!isSurfaceRoad(road)) continue
      const count = road.points.length
      const segmentCount = road.closed ? count : count - 1
      for (let i = 1; i < segmentCount; i++) {
        if (road.structure[i] !== ROAD_GRADE || road.structure[i - 1] !== ROAD_GRADE) continue
        const point = road.points[i]!
        samples++
        expect(Math.abs(sampleHeight(heightfield, point.x, point.z) - point.y)).toBeLessThan(1e-3)

        // Level from edge to edge, not just along the centerline.
        const prev = road.points[i - 1]!
        const next = road.points[i + 1]!
        const dx = next.x - prev.x
        const dz = next.z - prev.z
        const length = Math.hypot(dx, dz) || 1
        const nx = -dz / length
        const nz = dx / length
        for (const side of [-1, 1]) {
          const x = point.x + nx * side * (road.width / 2)
          const z = point.z + nz * side * (road.width / 2)
          across++
          if (Math.abs(sampleHeight(heightfield, x, z) - point.y) > 0.25) acrossOff++
        }
      }
    }
    expect(samples).toBeGreaterThan(500)
    expect(acrossOff / across).toBeLessThan(0.02)
  })

  it('runs every ramp from the highway surface down onto the cross road', () => {
    const highway = map.roads.find((road) => road.kind === 'highway')!
    const ramps = map.roads.filter((road) => road.kind === 'ramp')
    const crossRoads = map.roads.filter((road) => road.kind === 'cross')
    expect(ramps.length).toBeGreaterThan(0)
    for (const ramp of ramps) {
      const top = ramp.points[0]!
      const foot = ramp.points[ramp.points.length - 1]!
      // The foot lands at the cross road's edge, half its width from the centerline.
      const nearestCross = Math.min(...crossRoads.map((road) => distanceToRoad(road, foot.x, foot.z)))
      expect(nearestCross).toBeLessThan(crossRoads[0]!.width / 2 + 1)
      // Both ends are the ground, and the top is the highway's own surface.
      expect(Math.abs(sampleHeight(map.heightfield, foot.x, foot.z) - foot.y)).toBeLessThan(0.3)
      expect(Math.abs(sampleHeight(map.heightfield, top.x, top.z) - top.y)).toBeLessThan(0.3)
      let deckAtTop = Infinity
      let nearestDeck = Infinity
      for (const point of highway.points) {
        const distance = Math.hypot(point.x - top.x, point.z - top.z)
        if (distance < nearestDeck) {
          nearestDeck = distance
          deckAtTop = point.y + roadLift(highway)
        }
      }
      // The top lies under the deck's edge, the lane's outer edge at the
      // deck's, a hair below the deck's surface.
      expect(nearestDeck).toBeLessThan(highway.width / 2 - RAMP_WIDTH / 2 + 1)
      expect(nearestDeck).toBeGreaterThan(highway.width / 2 - RAMP_WIDTH / 2 - 1)
      expect(deckAtTop - top.y).toBeGreaterThan(-0.05)
      expect(deckAtTop - top.y).toBeLessThan(0.5)
    }
  })

  it('builds only the highway and the bridges; the rest is painted on', () => {
    for (const road of map.roads) {
      expect(isSurfaceRoad(road)).toBe(road.kind !== 'highway')
    }
    expect(map.roads.filter((road) => road.kind === 'highway')).toHaveLength(1)
    expect(map.roads.some((road) => road.kind === 'street')).toBe(true)
    expect(map.roads.some((road) => road.kind === 'arterial')).toBe(true)
  })

  it("bends every road's profile gently, at crests and sags alike", () => {
    // A car at speed feels a change of grade as an acceleration; a road that
    // kinks throws it off the ground at a crest and bottoms it out in a sag.
    let length = 0
    let over = 0
    let sharpest = 0
    for (const road of map.roads) {
      const limit = road.kind === 'ramp' ? MAX_RAMP_CURVATURE : MAX_ROAD_CURVATURE
      const { points, structure } = road
      const count = points.length
      const segments = road.closed ? count : count - 1
      for (let i = 1; i < segments; i++) {
        if (structure[i - 1] !== ROAD_GRADE || structure[i] !== ROAD_GRADE) continue
        const a = points[i - 1]!
        const b = points[i]!
        const c = points[(i + 1) % count]!
        const before = Math.hypot(b.x - a.x, b.z - a.z)
        const after = Math.hypot(c.x - b.x, c.z - b.z)
        if (before < 1 || after < 1) continue
        const change = (c.y - b.y) / after - (b.y - a.y) / before
        const curvature = Math.abs(change) / ((before + after) / 2)
        length += (before + after) / 2
        if (curvature > limit + 0.003) over += (before + after) / 2
        sharpest = Math.max(sharpest, curvature - limit)
      }
    }
    // Where roads cross, the ground takes the mean of both and each is left
    // with a small kink it cannot smooth away on its own.
    expect(length).toBeGreaterThan(1000)
    expect(over / length).toBeLessThan(0.06)
    expect(sharpest).toBeLessThan(0.04)
  })
})
