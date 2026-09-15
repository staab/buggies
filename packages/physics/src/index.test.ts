import { describe, expect, it } from 'vitest'

import { FIXED_TIMESTEP, atan2, cos, qrotate, quatFromYaw, sin, v3, vadd, vcross, vdot, vscale } from './index.ts'

describe('physics', () => {
  it('adds and scales vectors', () => {
    expect(vadd(v3(), v3(1, 2, 3), v3(4, 5, 6))).toEqual(v3(5, 7, 9))
    expect(vscale(v3(), v3(1, -2, 3), 2)).toEqual(v3(2, -4, 6))
  })

  it('crosses vectors right-handed', () => {
    // Nose along +Z with up along +Y puts the right-hand side at -X, which is
    // the convention every vehicle frame in here is built on.
    expect(vcross(v3(), v3(0, 0, 1), v3(0, 1, 0))).toEqual(v3(-1, 0, 0))
  })

  it('rotates a vector by a yaw quaternion', () => {
    const turned = qrotate(v3(), quatFromYaw(Math.PI / 2), v3(0, 0, 1))
    expect(turned.x).toBeCloseTo(1, 10)
    expect(turned.z).toBeCloseTo(0, 10)
  })

  it('matches the standard library closely enough to trust', () => {
    for (let i = -20; i <= 20; i++) {
      const x = i / 3
      expect(sin(x)).toBeCloseTo(Math.sin(x), 12)
      expect(cos(x)).toBeCloseTo(Math.cos(x), 12)
      expect(atan2(x, 1.7)).toBeCloseTo(Math.atan2(x, 1.7), 12)
    }
  })

  it('reproduces its own results exactly, which is the point of it', () => {
    expect(sin(0.7)).toBe(sin(0.7))
    expect(vdot(v3(1, 2, 3), v3(4, 5, 6))).toBe(32)
  })

  it('uses a fixed timestep', () => {
    expect(FIXED_TIMESTEP).toBeCloseTo(1 / 60)
  })
})
