import { qrotate, quat, v3 } from '@buggies/physics'
import { PLANET_TERRAIN, generateTerrain, groundUnder, worldBoatAt, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { advance, createArena, initPhysics } from './index.ts'
import { apart, between, lifted } from './test-planet.ts'

let map: TerrainMap

describe('boats', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(3, PLANET_TERRAIN)
  }, 120_000)

  it('meander about where they lie at anchor, their bows the way they go, and stay out on the water', () => {
    const planet = map.world!
    const boats = planet.buildings.filter((building) => building.kind === 'boat')
    expect(boats.length).toBeGreaterThan(0)
    const pose = { at: v3(), turn: quat() }
    for (const [i, boat] of boats.entries()) {
      let furthest = 0
      let last = { ...boat.at }
      for (let seconds = 0; seconds < 600; seconds += 2) {
        worldBoatAt(boat, i, seconds, pose)
        furthest = Math.max(furthest, apart(pose.at, boat.at))
        // Bow, middle and stern all over water.
        for (const along of [-boat.width / 2, 0, boat.width / 2]) {
          const offset = qrotate(v3(), pose.turn, { x: along, y: 0, z: 0 })
          const point = { x: pose.at.x + offset.x, y: pose.at.y + offset.y, z: pose.at.z + offset.z }
          expect(groundUnder(planet, point)).toBeLessThan(planet.seaLevel)
        }
        // Its bow, its own +x, is the way it goes.
        const bow = qrotate(v3(), pose.turn, { x: 1, y: 0, z: 0 })
        const went = { x: pose.at.x - last.x, y: pose.at.y - last.y, z: pose.at.z - last.z }
        if (seconds > 0 && between(pose.at, last) > 0.5) expect(bow.x * went.x + bow.y * went.y + bow.z * went.z).toBeGreaterThan(0)
        last = { ...pose.at }
      }
      expect(furthest).toBeGreaterThan(5)
    }
  })

  it('carry their bodies with them for the cars to meet', () => {
    const arena = createArena(map)
    const [boat] = arena.boats
    const start = { ...boat!.body.translation() }
    for (let i = 0; i < 60 * 10; i++) advance(arena)
    const pose = worldBoatAt(boat!.home, boat!.index, arena.tick / 60, { at: v3(), turn: quat() })
    const now = boat!.body.translation()
    expect(apart(now, start)).toBeGreaterThan(1)
    expect(between(now, lifted(pose.at, boat!.home.height / 2))).toBeLessThan(0.05)
    arena.world.free()
  })
})
