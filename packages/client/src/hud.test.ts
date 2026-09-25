import { describe, expect, it } from 'vitest'

import { DIAL_LENGTH, DIAL_SWEEP, damageColor, dialArc, dialFraction, dialTop, needleAngle } from './hud.ts'

function channels(style: string): number[] {
  return style.match(/\d+/g)!.map(Number)
}

describe('the speedometer', () => {
  it('reads to a round number just past what the vehicle can do', () => {
    // 20m/s is 72km/h, so the dial goes to 80; 125m/s is 450, so 460.
    expect(dialTop(20)).toBe(80)
    expect(dialTop(125)).toBe(460)
    expect(dialTop(0)).toBe(20)
  })

  it('swings the needle from one end of the dial to the other', () => {
    expect(needleAngle(0)).toBe(-DIAL_SWEEP)
    expect(needleAngle(0.5)).toBe(0)
    expect(needleAngle(1)).toBe(DIAL_SWEEP)
    expect(dialFraction(0, 20)).toBe(0)
    expect(dialFraction(10, 20)).toBeCloseTo(36 / 80, 5)
    // Past the end of the dial is the end of the dial, and reversing reads the same as going.
    expect(dialFraction(50, 20)).toBe(1)
    expect(dialFraction(-10, 20)).toBe(dialFraction(10, 20))
  })

  it('draws an arc as long as it says', () => {
    expect(dialArc()).toMatch(/^M [\d.]+ [\d.]+ A 44 44 0 1 1 [\d.]+ [\d.]+$/)
    expect(DIAL_LENGTH).toBeCloseTo((44 * 240 * Math.PI) / 180, 5)
  })
})

describe('the damage dial', () => {
  it('goes from a quiet color to red as the car is knocked about', () => {
    const [r0, g0, b0] = channels(damageColor(0))
    const [r1, g1, b1] = channels(damageColor(1))
    expect(r1).toBeGreaterThan(r0!)
    expect(g1).toBeLessThan(g0!)
    expect(b1).toBeLessThan(b0!)
    // And steadily between.
    let lastRed = r0!
    for (const damage of [0.25, 0.5, 0.75]) {
      const [red] = channels(damageColor(damage))
      expect(red).toBeGreaterThan(lastRed)
      lastRed = red!
    }
    expect(damageColor(2)).toBe(damageColor(1))
  })
})
