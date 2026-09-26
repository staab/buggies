import { describe, expect, it } from 'vitest'

import { RADAR_RANGE, radarPoint } from './radar.ts'

describe('the mini-map', () => {
  const home = { x: 100, z: 100 }

  it('turns with the car so that ahead is always up and its right is right', () => {
    const north = { x: 0, z: -1 }
    const ahead = radarPoint(home, north, { x: 100, z: 100 - RADAR_RANGE / 2 })
    expect(ahead.x).toBeCloseTo(0, 5)
    expect(ahead.y).toBeCloseTo(-0.5, 5)
    const right = radarPoint(home, north, { x: 100 + RADAR_RANGE / 2, z: 100 })
    expect(right.x).toBeCloseTo(0.5, 5)
    expect(right.y).toBeCloseTo(0, 5)
    // Facing east, what was on the right is now ahead.
    const turned = radarPoint(home, { x: 1, z: 0 }, { x: 100 + RADAR_RANGE / 2, z: 100 })
    expect(turned.x).toBeCloseTo(0, 5)
    expect(turned.y).toBeCloseTo(-0.5, 5)
  })

  it('holds anyone past its range on the rim, pointing the way to them', () => {
    const far = radarPoint(home, { x: 0, z: -1 }, { x: 100, z: 100 + RADAR_RANGE * 3 })
    expect(far.beyond).toBe(true)
    expect(far.x).toBeCloseTo(0, 5)
    expect(far.y).toBeCloseTo(1, 5)
    expect(radarPoint(home, { x: 0, z: -1 }, { x: 110, z: 90 }).beyond).toBe(false)
  })

  it('still faces somewhere when the car is pointing straight up or down', () => {
    const point = radarPoint(home, { x: 0, z: 0 }, { x: 100, z: 50 })
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
  })
})
