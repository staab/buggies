import { describe, expect, it } from 'vitest'

import { createPlanet, directionOf, placeOf } from '@buggies/physics'

import {
  DISTRICT_CITY,
  PLANET_TERRAIN,
  RAISED_KINDS,
  ROAD_SURFACE,
  arcDistance,
  SPHERE_CELLS,
  generateTerrain,
  gridPlace,
  groundIndex,
  sampleHeight,
  sphereHeight,
  type Building,
  type Stand,
} from './index.ts'

/** The way up a thing stands by: its turn's y. */
function upOf({ turn: q }: Stand): { x: number; y: number; z: number } {
  return { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) }
}

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
      const ground = map.world!.ground
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

      // The same map as the world has it: every road on the ground, everything standing upright on it, the cities where they are.
      const world = map.world!
      expect(world.radius).toBeCloseTo(planet.radius, 6)
      const unit = (p: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
        const length = Math.hypot(p.x, p.y, p.z)
        return { x: p.x / length, y: p.y / length, z: p.z / length }
      }
      for (const road of world.roads) {
        expect(road.widths.length).toBe(road.points.length)
        for (const [i, p] of road.points.entries()) {
          if (road.structure[Math.min(i, road.structure.length - 1)] !== ROAD_SURFACE) continue
          expect(Math.abs(Math.hypot(p.x, p.y, p.z) - world.radius - sphereHeight(ground, unit(p)))).toBeLessThan(2)
        }
      }
      for (const stands of [world.buildings, world.rocks, world.props]) {
        for (const thing of stands) {
          const up = upOf(thing)
          const out = unit(thing.at)
          expect(up.x * out.x + up.y * out.y + up.z * out.z).toBeGreaterThan(0.999)
          // What stands on something else, a canopy on its posts or a pyramid's tier on the one below, stands in the air; a boat floats on the sea.
          if (RAISED_KINDS.includes(thing.kind as Building["kind"])) continue
          expect(Math.hypot(thing.at.x, thing.at.y, thing.at.z) - world.radius).toBeLessThan(Math.max(sphereHeight(ground, out), world.seaLevel) + 2)
        }
      }
      const grid = { face: 0, i: 0, j: 0 }
      // The cities are placed on the planet's own ground: each on land, its middle city, well apart along the ground.
      expect(world.districts.length).toBeGreaterThanOrEqual(3)
      for (const district of world.districts) {
        gridPlace(ground.n, district.center, grid)
        expect(world.districtOf[groundIndex(ground, grid.face, Math.round(grid.i), Math.round(grid.j))]).toBe(DISTRICT_CITY)
        expect(sphereHeight(ground, district.center)).toBeGreaterThan(world.seaLevel)
        expect(district.area).toBeGreaterThan(0)
        for (const other of world.districts) {
          if (other !== district) expect(arcDistance(district.center, other.center, world.radius)).toBeGreaterThan(500)
        }
      }
      for (const pole of [2, 3]) expect(world.water[groundIndex(ground, pole, face, face)]).toBe(world.seaLevel)
    }, 60_000)
  }
})
