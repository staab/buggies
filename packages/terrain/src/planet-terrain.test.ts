import { describe, expect, it } from 'vitest'

import { createPlanet, directionOf, placeOf } from '@buggies/physics'

import { PLANET_TERRAIN, SPHERE_CELLS, generateTerrain, groundIndex, sampleHeight, sphereHeight } from './index.ts'

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

      // The planet's own ground, over all of it: sea floor at the poles, and the map's ground wherever the map has it.
      const ground = map.ground!
      expect(ground.n).toBe(SPHERE_CELLS)
      const face = SPHERE_CELLS / 2
      for (const pole of [2, 3]) expect(ground.heights[groundIndex(ground, pole, face, face)]!).toBeLessThan(map.seaLevel)
      const planet = createPlanet(width * cellSize, depth * cellSize)
      const place = { longitude: 0, latitude: 0, scale: 1 }
      const direction = { x: 0, y: 0, z: 0 }
      for (const road of map.roads.slice(0, 20)) {
        const { x, z } = road.points[Math.floor(road.points.length / 2)]!
        placeOf(planet, x, z, place)
        directionOf(place.longitude, place.latitude, direction)
        expect(sphereHeight(ground, direction)).toBeCloseTo(sampleHeight(map.heightfield, x, z) * place.scale, 0)
      }
    }, 60_000)
  }
})
