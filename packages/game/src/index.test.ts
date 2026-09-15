import { generateTerrain } from '@buggies/terrain'
import { NEUTRAL_INPUT, groundAt } from '@buggies/vehicle'
import { describe, expect, it } from 'vitest'

import { advance, createGame, findSpawn, respawn, type PlayerInput } from './index.ts'

const FLAT_OUT: PlayerInput[] = [
  { vehicleId: 'player', input: { ...NEUTRAL_INPUT, throttle: 1 } },
]

describe('game', () => {
  it('starts at tick zero with a single vehicle', () => {
    const state = createGame()
    expect(state.tick).toBe(0)
    expect(Object.keys(state.vehicles)).toEqual(['player'])
  })

  it('advances deterministically for the same inputs', () => {
    const a = advance(advance(createGame(), FLAT_OUT), FLAT_OUT)
    const b = advance(advance(createGame(), FLAT_OUT), FLAT_OUT)
    expect(a).toEqual(b)
    expect(a.tick).toBe(2)
    expect(a.vehicles.player?.position.z).toBeGreaterThan(0)
  })

  it('spawns on a road, facing along it, resting on the surface', () => {
    const map = generateTerrain(7, { size: 513 })
    const spawn = findSpawn(map)
    const nearest = map.roads
      .flatMap((road) => road.points)
      .reduce((best, point) =>
        Math.hypot(point.x - spawn.position.x, point.z - spawn.position.z) <
        Math.hypot(best.x - spawn.position.x, best.z - spawn.position.z)
          ? point
          : best,
      )
    expect(Math.hypot(nearest.x - spawn.position.x, nearest.z - spawn.position.z)).toBeLessThan(1)

    const state = createGame({ map })
    const vehicle = state.vehicles.player!
    const support = groundAt(state.surface, vehicle.position.x, vehicle.position.z, vehicle.position.y)
    expect(vehicle.position.y).toBeCloseTo(support, 3)
  })

  it('puts a stuck vehicle back on its spawn', () => {
    let state = createGame()
    for (let i = 0; i < 120; i++) state = advance(state, FLAT_OUT)
    expect(state.vehicles.player!.position.z).toBeGreaterThan(5)

    state = respawn(state)
    expect(state.vehicles.player!.position).toEqual(state.spawn.position)
    expect(state.vehicles.player!.speed).toBe(0)
  })
})
