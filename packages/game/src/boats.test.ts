import { boatAt, generateTerrain, sampleHeight, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { advance, createArena, initPhysics } from './index.ts'

/** The test islands, laid out as when a seed picked at most eight: the maps these tests were written against. */
const TEST_ISLANDS = { islandsMost: 8 }

let map: TerrainMap

describe('boats', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(3, TEST_ISLANDS)
  }, 120_000)

  it('meander about where they lie at anchor, their bows the way they go, and stay out on the water', () => {
    const boats = map.buildings.filter((building) => building.kind === 'boat')
    expect(boats.length).toBeGreaterThan(0)
    const pose = { x: 0, z: 0, yaw: 0 }
    for (const [i, boat] of boats.entries()) {
      let furthest = 0
      for (let seconds = 0; seconds < 600; seconds += 2) {
        boatAt(boat, i, seconds, pose)
        furthest = Math.max(furthest, Math.hypot(pose.x - boat.x, pose.z - boat.z))
        // Bow, middle and stern all over water.
        for (const along of [-boat.width / 2, 0, boat.width / 2]) {
          const x = pose.x + Math.cos(pose.yaw) * along
          const z = pose.z - Math.sin(pose.yaw) * along
          expect(sampleHeight(map.heightfield, x, z)).toBeLessThan(map.seaLevel)
        }
      }
      expect(furthest).toBeGreaterThan(5)
    }
  })

  it('carry their bodies with them for the cars to meet', () => {
    const arena = createArena(map)
    const [boat] = arena.boats
    const start = { ...boat!.body.translation() }
    for (let i = 0; i < 60 * 10; i++) advance(arena)
    const pose = boatAt(boat!.home, boat!.index, arena.tick / 60, { x: 0, z: 0, yaw: 0 })
    const now = boat!.body.translation()
    expect(Math.hypot(now.x - start.x, now.z - start.z)).toBeGreaterThan(1)
    expect(Math.hypot(now.x - pose.x, now.z - pose.z)).toBeLessThan(0.05)
    arena.world.free()
  })
})
