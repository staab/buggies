import { generatePlanet } from '@buggies/terrain'
import { describe, expect, it } from 'vitest'

import { terrainTransferables } from './terrain-transfer.ts'

describe('a planet crossing from its worker', () => {
  it('arrives whole, with its big buffers handed over rather than copied', () => {
    const world = generatePlanet(11)
    const transfer = terrainTransferables(world)
    expect(transfer.length).toBeGreaterThan(5)
    expect(new Set(transfer).size).toBe(transfer.length)
    const heights = Array.from(world.ground.heights.slice(0, 64))
    const roads = world.roads.length
    const buildings = world.buildings.length

    const arrived = structuredClone(world, { transfer })
    expect(arrived.seed).toBe(11)
    expect(arrived.roads.length).toBe(roads)
    expect(Array.from(arrived.ground.heights.slice(0, 64))).toEqual(heights)
    expect(arrived.ground.heights).toBeInstanceOf(Float32Array)
    expect(arrived.districtOf).toBeInstanceOf(Uint8Array)
    expect(arrived.buildings.length).toBe(buildings)
    // Handed over: the original no longer has it.
    expect(world.ground.heights.byteLength).toBe(0)
  }, 120_000)
})
