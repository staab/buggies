import { describe, expect, it } from 'vitest'

import { DIAL_LENGTH, DIAL_SWEEP, clockLabel, compassText, damageColor, dialArc, dialFraction, dialTop, needleAngle, placeLabel, raceText } from './hud.ts'

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

describe('the race block', () => {
  it('says where the car stands, in the order it came', () => {
    expect(placeLabel(1, 5)).toBe('1st of 5')
    expect(placeLabel(2, 5)).toBe('2nd of 5')
    expect(placeLabel(3, 5)).toBe('3rd of 5')
    expect(placeLabel(4, 8)).toBe('4th of 8')
    // The teens are all th, however they end.
    expect(placeLabel(11, 12)).toBe('11th of 12')
    expect(placeLabel(12, 12)).toBe('12th of 12')
    expect(placeLabel(13, 20)).toBe('13th of 20')
    expect(placeLabel(21, 30)).toBe('21st of 30')
  })

  it('runs the race clock up in minutes and seconds', () => {
    expect(clockLabel(0)).toBe('0:00')
    expect(clockLabel(9.9)).toBe('0:09')
    expect(clockLabel(65)).toBe('1:05')
    expect(clockLabel(600)).toBe('10:00')
    // A race that runs long enough is told in hours too, and a countdown is not told as negative time.
    expect(clockLabel(3725)).toBe('1:02:05')
    expect(clockLabel(-3)).toBe('0:00')
  })

  it('reads the race as place, gate, world and time', () => {
    expect(raceText({ place: 2, of: 5, checkpoint: 2, ofCheckpoints: 6, world: 1, ofWorlds: 3, seconds: 65 })).toEqual({
      place: '2nd of 5',
      along: 'gate 3 of 6',
      world: 'world 1 of 3',
      time: '1:05',
    })
    // Past the last gate of the world, the block still names that gate rather than one past it.
    expect(raceText({ place: 1, of: 1, checkpoint: 6, ofCheckpoints: 6, world: 3, ofWorlds: 3, seconds: 0 }).along).toBe('gate 6 of 6')
  })
})

describe('the compass', () => {
  it('says which gate it points at and how far, in round meters and then kilometers', () => {
    expect(compassText({ angle: 0, meters: 123, label: '3' })).toEqual({ gate: 'gate 3', distance: '125 m' })
    expect(compassText({ angle: 1, meters: 1460, label: 'PORTAL' })).toEqual({ gate: 'portal', distance: '1.5 km' })
    expect(compassText({ angle: -1, meters: 2, label: 'FINISH' })).toEqual({ gate: 'finish', distance: '0 m' })
  })
})
