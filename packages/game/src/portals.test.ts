import { generateTerrain, moonOf, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, findSpawns, initPhysics, portalCrossed, portalLink, portalSpawn, respawn, takeSeat } from './index.ts'

let island: TerrainMap
let moon: TerrainMap

describe('the portals', () => {
  beforeAll(async () => {
    await initPhysics()
    island = generateTerrain(7)
    moon = generateTerrain(moonOf(7))
  }, 60_000)

  it('lead from every portal of an island to its moon, and from the moon back out of the one gone in by', () => {
    expect(portalLink(7, 2)).toEqual({ seed: moonOf(7), arrival: 0 })
    expect(portalLink(moonOf(7), 2)).toEqual({ seed: 7, arrival: 2 })
  })

  it('tell a move through a ring from one past it or beside it', () => {
    const portal = island.portals[1]!
    const middle = { x: portal.x, y: portal.y + portal.radius, z: portal.z }
    const at = (along: number, aside = 0, up = 0): { x: number; y: number; z: number } => ({
      x: middle.x + portal.dx * along - portal.dz * aside,
      y: middle.y + up,
      z: middle.z + portal.dz * along + portal.dx * aside,
    })
    expect(portalCrossed(island, at(-1), at(1))).toBe(1)
    expect(portalCrossed(island, at(1), at(-1))).toBe(1)
    expect(portalCrossed(island, at(-1, 3, -3), at(1, 3, -3))).toBe(1)
    expect(portalCrossed(island, at(-2), at(-1))).toBe(-1)
    expect(portalCrossed(island, at(-1, portal.radius + 1), at(1, portal.radius + 1))).toBe(-1)
    expect(portalCrossed(island, at(-1, 0, portal.radius + 1), at(1, 0, portal.radius + 1))).toBe(-1)
  })

  it('bring a car out of a portal on the ground past it, driving on away from it, and a crowd side by side', () => {
    const arena = createArena(moon)
    const seat = takeSeat(arena, 0, 'sportsCar')
    const out = portalSpawn(moon, 0, 0)!
    respawn(seat, out)
    for (let i = 0; i < 60; i++) advance(arena, () => ({ ...NEUTRAL_INPUT, throttle: 1 }))
    const portal = moon.portals[0]!
    const { position } = seat.vehicle.frame
    // Further on the far side of the ring than it came out, and on its wheels.
    expect((position.x - portal.x) * portal.dx + (position.z - portal.z) * portal.dz).toBeGreaterThan(20)
    expect(seat.vehicle.frame.up.y).toBeGreaterThan(0.9)
    const spots = Array.from({ length: 10 }, (_, place) => portalSpawn(moon, 0, place)!.position)
    for (const [k, a] of spots.entries()) for (const b of spots.slice(k + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(3)
    arena.world.free()
  })

  it('seat everyone on a moon, which has no roads, out of its portal, with nothing flying or walking about', () => {
    const spawns = findSpawns(moon, 8)
    const out = portalSpawn(moon, 0, 0)!
    expect(spawns[0]!.position).toEqual(out.position)
    const arena = createArena(moon)
    expect(arena.ufos).toEqual([])
    expect(arena.spiders).toEqual([])
    expect(arena.robots).toEqual([])
    arena.world.free()
  })
})
