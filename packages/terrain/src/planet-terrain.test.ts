import { describe, expect, it } from 'vitest'

import { PLANET_TERRAIN, generateTerrain, sampleHeight } from './index.ts'

describe("a planet's map", () => {
  for (const seed of [1, 4, 20]) {
    it(`keeps the land of island ${seed} to the band round its middle, with room on it for its cities, their streets and the highway's interchanges`, () => {
      const map = generateTerrain(seed, PLANET_TERRAIN)
      const { width, depth, cellSize, heights } = map.heightfield
      const middle = (depth * cellSize) / 2
      const band = PLANET_TERRAIN.landBand * depth * cellSize
      for (let row = 0; row < depth; row++) {
        for (let col = 0; col < width; col++) {
          if (heights[row * width + col]! <= map.seaLevel) continue
          expect(Math.abs(row * cellSize - middle)).toBeLessThanOrEqual(band)
        }
      }
      expect(map.districts.length).toBeGreaterThanOrEqual(3)
      for (const city of map.districts) {
        expect(city.area).toBeGreaterThan(0)
        expect(sampleHeight(map.heightfield, city.cx, city.cz)).toBeGreaterThan(map.seaLevel)
      }
      expect(map.roads.filter((road) => road.kind === 'cross').length).toBeGreaterThan(0)
      expect(map.roads.filter((road) => road.kind === 'street').length).toBeGreaterThan(5)
    }, 60_000)
  }
})
