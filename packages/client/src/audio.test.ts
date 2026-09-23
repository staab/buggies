import { VEHICLE_PROFILE_IDS, createVehicleTuning } from '@buggies/game'
import { describe, expect, it } from 'vitest'

import { EARSHOT, ENGINE_TIMBRES, SKID_FULL, SKID_START, earshot, engineFrequency, engineRev, skidAmount } from './audio.ts'

describe('engines', () => {
  it('have a timbre for every vehicle, the big ones low and slow, the small ones high', () => {
    for (const profile of VEHICLE_PROFILE_IDS) {
      const timbre = ENGINE_TIMBRES[profile]
      expect(timbre.idle).toBeGreaterThan(20)
      expect(timbre.span).toBeGreaterThan(0)
      expect(timbre.volume).toBeGreaterThan(0)
      expect(timbre.volume).toBeLessThanOrEqual(0.5)
      if (timbre.chug > 0) expect(timbre.chugRate).toBeGreaterThan(0)
    }
    expect(ENGINE_TIMBRES.tank.idle).toBeLessThan(ENGINE_TIMBRES.sportsCar.idle)
    expect(ENGINE_TIMBRES.sportsCar.idle).toBeLessThan(ENGINE_TIMBRES.raceCar.idle)
    expect(engineFrequency(ENGINE_TIMBRES.raceCar, 1)).toBeGreaterThan(engineFrequency(ENGINE_TIMBRES.semi, 1) * 3)
    expect(ENGINE_TIMBRES.tank.chug).toBeGreaterThan(0)
    expect(ENGINE_TIMBRES.raceCar.chug).toBe(0)
  })

  it('rev with speed, and a little with the throttle from a standstill', () => {
    const { maxSpeed } = createVehicleTuning('sportsCar')
    expect(engineRev(0, maxSpeed, 0)).toBe(0)
    expect(engineRev(0, maxSpeed, 1)).toBeGreaterThan(0.2)
    expect(engineRev(0, maxSpeed, 1)).toBeLessThan(engineRev(maxSpeed / 2, maxSpeed, 0))
    expect(engineRev(maxSpeed, maxSpeed, 1)).toBe(1)
    expect(engineRev(maxSpeed * 2, maxSpeed, 0)).toBe(1)
    expect(engineRev(-10, maxSpeed, 0)).toBe(engineRev(10, maxSpeed, 0))
    const timbre = ENGINE_TIMBRES.sportsCar
    expect(engineFrequency(timbre, 0)).toBe(timbre.idle)
    expect(engineFrequency(timbre, 1)).toBe(timbre.idle + timbre.span)
  })

  it('squeal only for wheels on the ground sliding sideways past a point', () => {
    const wheel = (grounded: boolean, slipSpeedLateral: number) => ({ grounded, slipSpeedLateral })
    expect(skidAmount([wheel(true, 0), wheel(true, SKID_START)])).toBe(0)
    expect(skidAmount([wheel(true, -(SKID_START + SKID_FULL) / 2)])).toBeCloseTo(0.5, 5)
    expect(skidAmount([wheel(true, SKID_FULL * 3)])).toBe(1)
    // A wheel in the air is not squealing, however fast it is going sideways.
    expect(skidAmount([wheel(false, SKID_FULL * 3), wheel(true, 1)])).toBe(0)
  })

  it('are heard less the further off they are, and not at all past earshot', () => {
    expect(earshot(0)).toBe(1)
    expect(earshot(EARSHOT / 2)).toBeCloseTo(0.25, 5)
    expect(earshot(EARSHOT)).toBe(0)
    expect(earshot(EARSHOT * 2)).toBe(0)
  })
})
