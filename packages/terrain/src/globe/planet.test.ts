import { describe, expect, it } from 'vitest'

import { DISTRICT_CITY } from '../sphere-districts.ts'
import { arcDistance, gridPlace, groundIndex, sphereHeight } from '../sphere.ts'
import { DRY } from '../world.ts'
import { RAISED_KINDS, type BuildingKind } from '../types.ts'
import { ROAD_GRADE } from '../roads/constants.ts'
import { unit } from './lines.ts'
import { SPHERE_CELLS, generatePlanet } from './planet.ts'
import { axes, heightOf } from './test-kit.ts'

describe('a planet', () => {
  for (const seed of [1, 4, 20]) {
    it(`raises planet ${seed} with land and sea, its cities on its land, everything standing upright on its ground`, () => {
      const world = generatePlanet(seed)
      const { ground } = world
      expect(ground.n).toBe(SPHERE_CELLS)
      // Land and sea both, and neither all of it.
      const land = ground.heights.filter((height) => height > world.seaLevel).length / ground.heights.length
      expect(land).toBeGreaterThan(0.1)
      expect(land).toBeLessThan(0.8)
      // The sea over every point under it.
      for (let at = 0; at < ground.heights.length; at += 97) if (ground.heights[at]! <= world.seaLevel) expect(world.water[at]).not.toBe(DRY)

      // The cities: each on land, its middle city ground, well apart along the ground.
      expect(world.districts.length).toBeGreaterThanOrEqual(3)
      const place = { face: 0, i: 0, j: 0 }
      for (const city of world.districts) {
        gridPlace(ground.n, city.center, place)
        expect(world.districtOf[groundIndex(ground, place.face, Math.round(place.i), Math.round(place.j))]).toBe(DISTRICT_CITY)
        expect(sphereHeight(ground, city.center)).toBeGreaterThan(world.seaLevel)
        for (const other of world.districts) if (other !== city) expect(arcDistance(city.center, other.center, world.radius)).toBeGreaterThan(500)
      }

      // Every surface road at grade is on the ground.
      for (const road of world.roads) {
        expect(road.widths.length).toBe(road.points.length)
        if (road.kind === 'highway') continue
        for (const [i, p] of road.points.entries()) {
          if (road.structure[Math.min(i, road.structure.length - 1)] !== ROAD_GRADE) continue
          expect(Math.abs(heightOf(world, p) - sphereHeight(ground, unit(p)))).toBeLessThan(0.5)
        }
      }
      // Everything standing, upright on the way up where it is, and on the ground under it but what stands on something else or floats.
      for (const stands of [world.buildings, world.rocks, world.props]) {
        for (const thing of stands) {
          const up = unit(thing.at)
          const { x, z } = axes(thing.turn)
          const y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x }
          expect(y.x * up.x + y.y * up.y + y.z * up.z).toBeGreaterThan(0.999)
          if (RAISED_KINDS.includes(thing.kind as BuildingKind)) continue
          expect(heightOf(world, thing.at)).toBeLessThan(Math.max(sphereHeight(ground, up), world.seaLevel) + 2)
        }
      }
      // The rivers run down to the sea, never uphill.
      for (const river of world.rivers) {
        for (let i = 0; i + 1 < river.points.length; i++) expect(heightOf(world, river.points[i + 1]!.at)).toBeLessThanOrEqual(heightOf(world, river.points[i]!.at) + 1e-6)
      }
    }, 120_000)
  }
})
