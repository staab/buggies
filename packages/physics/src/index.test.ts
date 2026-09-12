import { describe, expect, it } from 'vitest'

import { FIXED_TIMESTEP, add, scale, vec3 } from './index.ts'

describe('physics', () => {
  it('adds vectors', () => {
    expect(add(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual(vec3(5, 7, 9))
  })

  it('scales vectors', () => {
    expect(scale(vec3(1, -2, 3), 2)).toEqual(vec3(2, -4, 6))
  })

  it('uses a fixed timestep', () => {
    expect(FIXED_TIMESTEP).toBeCloseTo(1 / 60)
  })
})