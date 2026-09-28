import { beforeAll, describe, expect, it } from 'vitest'

import { generateTerrain } from './generate.ts'
import { sampleHeight } from './heightfield.ts'
import { PORTAL_RADIUS, islandSeedOf, isMoon, moonOf } from './portals.ts'
import type { TerrainMap } from './types.ts'

let island: TerrainMap
let moon: TerrainMap

describe('the portals and the moon', () => {
  beforeAll(() => {
    island = generateTerrain(7)
    moon = generateTerrain(moonOf(7))
  }, 60_000)

  it('tell a moon by its seed, and its island from it', () => {
    expect(isMoon(7)).toBe(false)
    expect(isMoon(moonOf(7))).toBe(true)
    expect(islandSeedOf(moonOf(7))).toBe(7)
    expect(islandSeedOf(7)).toBe(7)
  })

  it('stand three to five portals on an island, far apart, on dry level ground clear of the roads', () => {
    expect(island.moon).toBe(false)
    expect(island.portals.length).toBeGreaterThanOrEqual(3)
    expect(island.portals.length).toBeLessThanOrEqual(5)
    for (const portal of island.portals) {
      expect(portal.radius).toBe(PORTAL_RADIUS)
      expect(portal.y).toBeGreaterThan(island.seaLevel)
      expect(Math.hypot(portal.dx, portal.dz)).toBeCloseTo(1, 6)
      // Level for a run at it either way.
      for (const along of [-20, 20]) {
        expect(Math.abs(sampleHeight(island.heightfield, portal.x + portal.dx * along, portal.z + portal.dz * along) - portal.y)).toBeLessThan(5)
      }
      for (const road of island.roads) for (const point of road.points) expect(Math.hypot(point.x - portal.x, point.z - portal.z)).toBeGreaterThan(PORTAL_RADIUS)
      for (const other of island.portals) if (other !== portal) expect(Math.hypot(other.x - portal.x, other.z - portal.z)).toBeGreaterThan(400)
    }
  })

  it('make the moon half the size, bare and dry, with one portal back and a flag and a lander by it', () => {
    expect(moon.moon).toBe(true)
    expect(moon.size * moon.cellSize).toBeCloseTo((island.size * island.cellSize) / 2, -1)
    expect(moon.roads).toEqual([])
    expect(moon.rivers).toEqual([])
    expect(moon.lakes).toEqual([])
    for (const height of moon.heightfield.heights) expect(height).toBeGreaterThan(moon.seaLevel)
    expect(moon.portals.length).toBe(1)
    expect(moon.buildings.map((building) => building.kind).sort()).toEqual(['flag', 'lander'])
    const portal = moon.portals[0]!
    for (const building of moon.buildings) expect(Math.hypot(building.x - portal.x, building.z - portal.z)).toBeLessThan(150)
    // Craters, mountains and valleys: a good deal of relief.
    let low = Infinity
    let high = -Infinity
    for (const height of moon.heightfield.heights) {
      low = Math.min(low, height)
      high = Math.max(high, height)
    }
    expect(high - low).toBeGreaterThan(60)
  })

  it('make the same moon every time', () => {
    const again = generateTerrain(moonOf(7))
    expect(again.portals).toEqual(moon.portals)
    expect(again.heightfield.heights).toEqual(moon.heightfield.heights)
  })
})
