import { qrotate, v3 } from '@buggies/physics'
import { generateMoon, generatePlanet, heightOver, isMoon, moonOf, sphereHeight, upOf, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, initPhysics, portalCrossed, portalLink, portalSpawn, takeSeat } from './index.ts'
import { apart } from './test-planet.ts'

let planet: World
let moon: World

describe('the portals', () => {
  beforeAll(async () => {
    await initPhysics()
    planet = generatePlanet(5)
    moon = generateMoon(5)
  }, 120_000)

  it('stand three to five on a planet and one on its moon, and lead from each to the other', () => {
    expect(planet.portals.length).toBeGreaterThanOrEqual(3)
    expect(planet.portals.length).toBeLessThanOrEqual(5)
    expect(moon.portals).toHaveLength(1)
    expect(moon.radius).toBeCloseTo(planet.radius / 2, 6)
    expect(moon.kind).toBe('moon')
    expect(isMoon(moon.seed)).toBe(true)
    expect(portalLink(planet)).toEqual({ to: moonOf(5), arrival: 0 })
    // Back from the moon by the portal the car came through.
    expect(portalLink(moon, 2)).toEqual({ to: 5, arrival: 2 })
    // And on the moon, the lander and its flag.
    expect(moon.buildings.map((building) => building.kind).sort()).toEqual(['flag', 'lander'])
  })

  it('know a car driving through a ring, and not one going round it', () => {
    const portal = planet.portals[1]!
    const up = upOf(portal.at)
    const through = qrotate(v3(), portal.turn, { x: 0, y: 0, z: 1 })
    const across = qrotate(v3(), portal.turn, { x: 1, y: 0, z: 0 })
    const at = (along: number, aside: number, rise: number): { x: number; y: number; z: number } => ({
      x: portal.at.x + through.x * along + across.x * aside + up.x * rise,
      y: portal.at.y + through.y * along + across.y * aside + up.y * rise,
      z: portal.at.z + through.z * along + across.z * aside + up.z * rise,
    })
    expect(portalCrossed(planet, at(-1, 0, 1), at(1, 0, 1))).toBe(1)
    expect(portalCrossed(planet, at(1, 0, 1), at(-1, 0, 1))).toBe(1)
    expect(portalCrossed(planet, at(-1, portal.radius + 2, 1), at(1, portal.radius + 2, 1))).toBe(-1)
    expect(portalCrossed(planet, at(2, 0, 1), at(4, 0, 1))).toBe(-1)
  })

  it('set a car down out of a portal on the moon, on the ground and on its wheels, where it drives off', () => {
    const arena = createArena(moon)
    const seat = takeSeat(arena, 0, 'sportsCar')
    const spawn = portalSpawn(moon, 0)!
    expect(apart(seat.vehicle.frame.position, spawn.position)).toBeLessThan(1)
    for (let i = 0; i < 60; i++) advance(arena)
    expect(seat.vehicle.groundedCount).toBeGreaterThan(0)
    // At rest on its wheels, its ride height over the ground and no more: nothing under the moon holds it up but the ground.
    const at = seat.vehicle.frame.position
    expect(heightOver(moon, at) - sphereHeight(moon.ground, upOf(at))).toBeLessThan(1.5)
    expect(seat.vehicle.speed).toBeLessThan(0.5)
    expect(seat.vehicle.wrecked).toBe(false)
    const start = { ...seat.vehicle.frame.position }
    for (let i = 0; i < 60 * 3; i++) advance(arena, () => ({ ...NEUTRAL_INPUT, throttle: 1 }))
    expect(apart(seat.vehicle.frame.position, start)).toBeGreaterThan(10)
    arena.world.free()
  })
})
