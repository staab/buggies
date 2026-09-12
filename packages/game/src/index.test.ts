import { describe, expect, it } from 'vitest'

import { advance, createGame } from './index.ts'

describe('game', () => {
  it('starts at tick zero with a single vehicle', () => {
    const state = createGame()
    expect(state.tick).toBe(0)
    expect(Object.keys(state.vehicles)).toEqual(['player'])
  })

  it('advances deterministically for the same inputs', () => {
    const inputs = [{ vehicleId: 'player', input: { throttle: 1, steer: 0 } }]
    const a = advance(advance(createGame(), inputs), inputs)
    const b = advance(advance(createGame(), inputs), inputs)
    expect(a).toEqual(b)
    expect(a.tick).toBe(2)
    expect(a.vehicles.player?.position.z).toBeGreaterThan(0)
  })
})