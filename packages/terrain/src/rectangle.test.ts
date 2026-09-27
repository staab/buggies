import { describe, expect, it } from 'vitest'

import { generateTerrain, sampleHeight } from './index.ts'

describe('a map longer one way than the other', () => {
  // Full size, as the planet's map is: a small one is all mountain, and its cities come out wanting.
  for (const [size, depth] of [
    [1281, 641],
    [641, 1281],
  ] as const) {
    it(`lays ${size} cells across and ${depth} down: sea along every edge, cities on land, and everything built inside it`, () => {
      const map = generateTerrain(12, { size, depth, islandsMost: 8 })
      const { heightfield, cellSize, seaLevel } = map
      expect(map.size).toBe(size)
      expect(map.depth).toBe(depth)
      expect(heightfield.width).toBe(size)
      expect(heightfield.depth).toBe(depth)
      expect(heightfield.heights).toHaveLength(size * depth)
      const spanX = size * cellSize
      const spanZ = depth * cellSize
      // Sea all the way round.
      for (let col = 0; col < size; col++) {
        expect(heightfield.heights[col]!).toBeLessThan(seaLevel)
        expect(heightfield.heights[(depth - 1) * size + col]!).toBeLessThan(seaLevel)
      }
      for (let row = 0; row < depth; row++) {
        expect(heightfield.heights[row * size]!).toBeLessThan(seaLevel)
        expect(heightfield.heights[row * size + size - 1]!).toBeLessThan(seaLevel)
      }
      expect(map.districts.length).toBeGreaterThan(0)
      for (const city of map.districts) {
        expect(city.cx).toBeGreaterThan(0)
        expect(city.cx).toBeLessThan(spanX)
        expect(city.cz).toBeGreaterThan(0)
        expect(city.cz).toBeLessThan(spanZ)
        expect(sampleHeight(heightfield, city.cx, city.cz)).toBeGreaterThan(seaLevel)
      }
      expect(map.roads.length).toBeGreaterThan(0)
      for (const road of map.roads) {
        for (const point of road.points) {
          expect(point.x).toBeGreaterThanOrEqual(0)
          expect(point.x).toBeLessThanOrEqual(spanX)
          expect(point.z).toBeGreaterThanOrEqual(0)
          expect(point.z).toBeLessThanOrEqual(spanZ)
        }
      }
      for (const building of [...map.buildings, ...map.trees]) {
        expect(building.x).toBeGreaterThanOrEqual(0)
        expect(building.x).toBeLessThanOrEqual(spanX)
        expect(building.z).toBeGreaterThanOrEqual(0)
        expect(building.z).toBeLessThanOrEqual(spanZ)
      }
    }, 120_000)
  }
})
