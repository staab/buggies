import { describe, expect, it } from 'vitest'

import { fingerprint } from './fingerprint.ts'
import { generateTerrain } from './index.ts'

/**
 * What these islands hash to, bit for bit. A change here is either a change
 * to the generator, in which case update the number and say so in the
 * commit, or an engine that computes differently from the one this was
 * taken on, in which case the physics would not agree between server and
 * client and that is the bug.
 */
const GOLDEN: Record<number, string> = {
  7: '72dedd5f',
  11: '6f3e7ea1',
}

describe('terrain determinism', () => {
  for (const [seed, expected] of Object.entries(GOLDEN)) {
    it(`makes island ${seed} the same to the last bit, on this engine as on the one it was recorded on`, () => {
      const map = generateTerrain(Number(seed), { size: 513 })
      expect(fingerprint(map)).toBe(expected)
    }, 60_000)
  }

  it('hashes what the physics reads, and nothing else', () => {
    const map = generateTerrain(7, { size: 257 })
    const before = fingerprint(map)
    expect(before).toMatch(/^[0-9a-f]{8}$/)
    expect(fingerprint(map)).toBe(before)
    // A single height changed by the least a float can be is a different island.
    const heights = map.heightfield.heights
    const was = heights[1000]!
    heights[1000] = was + Math.max(Math.abs(was), 1) * 1e-6
    expect(heights[1000]).not.toBe(was)
    expect(fingerprint(map)).not.toBe(before)
  })
})
