import { describe, expect, it } from 'vitest'

import { exp, log, qrotate, quatFromYaw, uprightRotation, v3, vdot } from './index.ts'

describe('the math', () => {
  it('has exp and log that agree with the built-in ones to a rounding step or so', () => {
    for (let i = -400; i <= 400; i++) {
      const x = i * 0.0731
      expect(Math.abs(exp(x) - Math.exp(x)) / Math.exp(x)).toBeLessThan(4e-16)
      const y = Math.abs(x) + 1e-3
      expect(Math.abs(log(y) - Math.log(y))).toBeLessThan(4e-16 * Math.max(1, Math.abs(Math.log(y))))
    }
  })

  it('stands a car upright on any up, facing along the ground, and on the y axis just as a yaw would', () => {
    const forward = { x: 0.6, y: 0, z: -0.8 }
    expect(uprightRotation({ x: 0, y: 1, z: 0 }, forward)).toEqual(quatFromYaw(Math.atan2(-0.6, 0.8)))
    // An up leaning well off the y axis, and a heading square to it.
    const up = { x: 0.48, y: 0.6, z: 0.64 }
    const heading = { x: 0.8, y: 0, z: -0.6 }
    const turn = uprightRotation(up, heading)
    expect(vdot(qrotate(v3(), turn, { x: 0, y: 1, z: 0 }), up)).toBeCloseTo(1, 9)
    expect(vdot(qrotate(v3(), turn, { x: 0, y: 0, z: -1 }), heading)).toBeCloseTo(1, 9)
  })
})
