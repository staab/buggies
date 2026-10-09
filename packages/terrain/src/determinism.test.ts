import { describe, expect, it } from 'vitest'

import { fingerprint } from './fingerprint.ts'
import { generatePlanet } from './globe/planet.ts'

/**
 * What these planets hash to, bit for bit. A change here is either a change
 * to the generator, in which case update the number and say so in the
 * commit, or an engine that computes differently from the one this was
 * taken on, in which case the physics would not agree between server and
 * client and that is the bug.
 */
const GOLDEN: Record<number, string> = {
  7: '657206e3',
  11: '805ab1f2',
}

describe('planet determinism', () => {
  for (const [seed, expected] of Object.entries(GOLDEN)) {
    it(`makes planet ${seed} the same to the last bit, on this engine as on the one it was recorded on`, () => {
      expect(fingerprint(generatePlanet(Number(seed)))).toBe(expected)
    }, 120_000)
  }

  it('hashes what the physics reads', () => {
    const world = generatePlanet(7)
    const before = fingerprint(world)
    expect(before).toMatch(/^[0-9a-f]{8}$/)
    expect(fingerprint(world)).toBe(before)
    // A single height changed by the least a float can be is a different planet.
    const heights = world.ground.heights
    const was = heights[1000]!
    heights[1000] = was + Math.max(Math.abs(was), 1) * 1e-6
    expect(fingerprint(world)).not.toBe(before)
  }, 120_000)
})
