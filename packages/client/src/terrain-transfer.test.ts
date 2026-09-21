import { generateTerrain } from '@buggies/terrain'
import { describe, expect, it } from 'vitest'

import { terrainTransferables } from './terrain-transfer.ts'

describe('a map crossing from its worker', () => {
  it('arrives whole, with its big buffers handed over rather than copied', () => {
    const map = generateTerrain(11, { size: 129 })
    const transfer = terrainTransferables(map)
    expect(transfer.length).toBeGreaterThan(2)
    expect(new Set(transfer).size).toBe(transfer.length)
    const heights = Array.from(map.heightfield.heights.slice(0, 64))
    const roads = map.roads.length

    const arrived = structuredClone(map, { transfer })
    expect(arrived.seed).toBe(11)
    expect(arrived.roads.length).toBe(roads)
    expect(Array.from(arrived.heightfield.heights.slice(0, 64))).toEqual(heights)
    expect(arrived.heightfield.heights).toBeInstanceOf(Float32Array)
    expect(arrived.districtOf).toBeInstanceOf(Uint8Array)
    expect(arrived.buildings.length).toBe(map.buildings.length)
    // Handed over: the original no longer has it.
    expect(map.heightfield.heights.byteLength).toBe(0)
  })
})
