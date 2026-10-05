import { vdot, type Vec3 } from '@buggies/physics'
import { atHeight, generatePlanet, groundUnder, heightOver, tangentFrame, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, advance, createArena, initPhysics, isLost, respawn, spawnHere, takeSeat, type Arena, type Seat } from './index.ts'
import { ahead, angleBetween, apart } from './test-planet.ts'

let map: World

/** Somewhere out at sea, deep, with open water all around: a way out from the middle, and the east there. */
function openSea(planet: World): { point: Vec3; east: Vec3 } {
  for (let latitude = -0.3; latitude <= 0.3; latitude += 0.05) {
    for (let longitude = 0; longitude < 2 * Math.PI; longitude += 0.05) {
      const out = { x: Math.cos(latitude) * Math.sin(longitude), y: Math.sin(latitude), z: Math.cos(latitude) * Math.cos(longitude) }
      const point = atHeight(planet, out, planet.seaLevel + 1)
      const { east, north } = tangentFrame(out)
      let open = true
      for (let dx = -60; dx <= 60 && open; dx += 20) {
        for (let dz = -60; dz <= 60 && open; dz += 20) open = groundUnder(planet, ahead(ahead(point, east, dx), north, dz)) < planet.seaLevel - 6
      }
      if (open) return { point, east }
    }
  }
  throw new Error('no open sea')
}

function putToSea(arena: Arena, seat: Seat): void {
  const { point, east } = openSea(arena.planet)
  respawn(seat, spawnHere(point, east))
}

describe('the amphibian', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(11)
  }, 60_000)

  it('floats at sea, is driven along the water by its throttle, and is never taken for lost there, where a car sinks', () => {
    const arena = createArena(map)
    const boat = takeSeat(arena, 0, 'amphibian')
    const car = takeSeat(arena, 1, 'sportsCar')
    advance(arena)
    putToSea(arena, boat)
    putToSea(arena, car)
    car.vehicle.body.setTranslation(ahead(car.vehicle.frame.position, car.vehicle.frame.right, 30), true)
    for (let i = 0; i < 60 * 4; i++) advance(arena)
    // Afloat: riding high in the water, upright, and not lost.
    const planet = arena.planet
    expect(heightOver(planet, boat.vehicle.frame.position)).toBeGreaterThan(planet.seaLevel - 0.5)
    expect(heightOver(planet, boat.vehicle.frame.position)).toBeLessThan(planet.seaLevel + 1.5)
    expect(vdot(boat.vehicle.frame.up, boat.vehicle.up)).toBeGreaterThan(0.95)
    expect(isLost(arena, boat)).toBe(false)
    expect(isLost(arena, car)).toBe(true)
    // Under way on the water.
    const start = { ...boat.vehicle.frame.position }
    for (let i = 0; i < 60 * 5; i++) advance(arena, (seat) => (seat === boat ? { ...NEUTRAL_INPUT, throttle: 1 } : NEUTRAL_INPUT))
    expect(apart(boat.vehicle.frame.position, start)).toBeGreaterThan(25)
    // And turned by its steering, briskly: a good way round in a second and a half.
    const heading = { ...boat.vehicle.frame.forward }
    for (let i = 0; i < 90; i++) advance(arena, (seat) => (seat === boat ? { ...NEUTRAL_INPUT, throttle: 1, steer: 1 } : NEUTRAL_INPUT))
    expect(angleBetween(boat.vehicle.frame.forward, heading)).toBeGreaterThan(1.2)
    expect(vdot(boat.vehicle.frame.up, boat.vehicle.up)).toBeGreaterThan(0.9)
    arena.world.free()
  })
})
