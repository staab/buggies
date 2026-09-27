import { describe, expect, it } from 'vitest'

import { MAX_ARTERIAL_GRADE, MAX_RAMP_GRADE, MAX_ROAD_GRADE, ROAD_GRADE } from '../roads/constants.ts'
import { STREET_GRID_LEAST } from './streets.ts'
import type { WorldRoad } from '../world.ts'
import { angleBetween, lift, resample, unit } from './lines.ts'
import { generatePlanet } from './planet.ts'

const world = generatePlanet(6)
const { radius } = world

function heightOf(point: { x: number; y: number; z: number }): number {
  return Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) - radius
}

function apart(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return angleBetween(unit(a), unit(b)) * radius
}

/** How much of a road's at-grade length is steeper than its limit by more than a little, read over stretches of at least a meter. */
function overGrade(roads: readonly WorldRoad[], limitFor: (road: WorldRoad) => number): number {
  let length = 0
  let over = 0
  for (const road of roads) {
    let from = 0
    for (let i = 1; i < road.points.length; i++) {
      const run = apart(road.points[from]!, road.points[i]!)
      if (run < 1 && i + 1 < road.points.length) continue
      if (run < 1e-6) continue
      if (road.structure[from] === ROAD_GRADE) {
        length += run
        if (Math.abs(heightOf(road.points[i]!) - heightOf(road.points[from]!)) / run > limitFor(road) + 0.03) over += run
      }
      from = i
    }
  }
  expect(length).toBeGreaterThan(0)
  return over / length
}

describe("a planet's roads", () => {
  it('loops a highway through its cities, within its grade', () => {
    const highways = world.roads.filter((road) => road.kind === 'highway')
    expect(highways).toHaveLength(1)
    const highway = highways[0]!
    expect(highway.closed).toBe(true)
    const count = highway.points.length
    for (let i = 0; i < count; i++) {
      const a = highway.points[i]!
      const b = highway.points[(i + 1) % count]!
      expect(Math.abs(heightOf(b) - heightOf(a)) / apart(a, b)).toBeLessThanOrEqual(MAX_ROAD_GRADE + 1e-3)
    }
  })

  it('joins every road to the highway, but for whole street grids', () => {
    const roads = world.roads
    // Two roads meet where their roadways touch: every road walked in steps of a meter, and each step tried against those of the roads filed near it.
    const size = 12
    const walked = roads.map((road) => resample(road.points.map(unit), 1, radius, road.closed).map((direction) => lift(direction, radius, 0)))
    const cubes = new Map<string, { road: number; point: { x: number; y: number; z: number } }[]>()
    const keyOf = (point: { x: number; y: number; z: number }, dx = 0, dy = 0, dz = 0): string =>
      [Math.floor(point.x / size) + dx, Math.floor(point.y / size) + dy, Math.floor(point.z / size) + dz].join()
    for (const [road, points] of walked.entries()) {
      for (const point of points) {
        const key = keyOf(point)
        if (!cubes.has(key)) cubes.set(key, [])
        cubes.get(key)!.push({ road, point })
      }
    }
    const parent = roads.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
    for (const [a, points] of walked.entries()) {
      for (const point of points) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          for (const other of cubes.get(keyOf(point, dx, dy, dz)) ?? []) {
            if (find(other.road) === find(a)) continue
            const touch = (roads[a]!.widths[0]! + roads[other.road]!.widths[0]!) / 2
            const gap = Math.sqrt((point.x - other.point.x) ** 2 + (point.y - other.point.y) ** 2 + (point.z - other.point.z) ** 2)
            if (gap <= touch) parent[find(a)] = find(other.road)
          }
        }
      }
    }
    // Only a grid of streets may stand apart, reached over the grass; a scrap too small to be one may not.
    const sizes = new Map<number, number>()
    for (const [i] of roads.entries()) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1)
    const apartFrom = roads.filter((_, i) => find(i) !== find(0))
    expect(apartFrom.filter((road) => road.kind !== 'street').map((road) => `${road.kind} ${road.id}`)).toEqual([])
    for (const [i] of roads.entries()) if (find(i) !== find(0)) expect(sizes.get(find(i))).toBeGreaterThanOrEqual(STREET_GRID_LEAST)
    expect(roads.filter((road) => road.kind === 'arterial').length).toBeGreaterThan(10)
    expect(roads.filter((road) => road.kind === 'street').length).toBeGreaterThan(10)
  })

  it('holds its surface roads to their grades', () => {
    const surface = world.roads.filter((road) => road.kind !== 'highway')
    const limit = (road: WorldRoad): number => (road.kind === 'ramp' ? MAX_RAMP_GRADE : road.kind === 'arterial' ? MAX_ARTERIAL_GRADE : MAX_ROAD_GRADE)
    expect(overGrade(surface, limit)).toBeLessThan(0.06)
  })
})
