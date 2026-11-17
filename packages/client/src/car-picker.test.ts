import { PLAYABLE_PROFILE_IDS } from '@buggies/game'
import { describe, expect, it } from 'vitest'

import { carTitle, startPicking, stepPicking, stepVehicle, vehicleAbility, vehicleNote, vehicleStats } from './car-picker.ts'

describe('the cars the modal turns through', () => {
  it('flicks through every vehicle and round from the last to the first', () => {
    const last = PLAYABLE_PROFILE_IDS.at(-1)!
    const first = PLAYABLE_PROFILE_IDS[0]!
    expect(stepVehicle(last, 1)).toBe(first)
    expect(stepVehicle(first, -1)).toBe(last)
    let at = first
    const seen = new Set([at])
    for (let k = 1; k < PLAYABLE_PROFILE_IDS.length; k++) seen.add((at = stepVehicle(at, 1)))
    expect(seen.size).toBe(PLAYABLE_PROFILE_IDS.length)
    // A step of more than one car lands as far round as it says, either way.
    expect(stepVehicle(first, PLAYABLE_PROFILE_IDS.length)).toBe(first)
    expect(stepVehicle(first, 2)).toBe(PLAYABLE_PROFILE_IDS[2])
    expect(stepVehicle(first, -(PLAYABLE_PROFILE_IDS.length - 2))).toBe(PLAYABLE_PROFILE_IDS[2])
  })

  it('turns the car it is choosing, keeping whose it is', () => {
    const own = startPicking(null, 'sportsCar')
    expect(carTitle(own)).toBe('Your car')
    expect(stepPicking(own, 1).profile).toBe(stepVehicle('sportsCar', 1))
    expect(stepPicking(own, 1).name).toBeNull()

    const bot = startPicking('Axle', 'raceCar')
    expect(carTitle(bot)).toBe("Axle's car")
    expect(stepPicking(bot, -1)).toEqual({ name: 'Axle', profile: stepVehicle('raceCar', -1) })
    expect(carTitle(stepPicking(bot, 1))).toBe("Axle's car")
  })

  it('measures each vehicle against the best: the race car the fastest, the tank the toughest', () => {
    const share = (profile: Parameters<typeof vehicleStats>[0], name: string): number => vehicleStats(profile).find((stat) => stat.name === name)!.share
    for (const profile of PLAYABLE_PROFILE_IDS) {
      for (const stat of vehicleStats(profile)) {
        expect(stat.share).toBeGreaterThan(0)
        expect(stat.share).toBeLessThanOrEqual(1)
      }
    }
    expect(share('raceCar', 'Top speed')).toBe(1)
    expect(share('tank', 'Toughness')).toBe(1)
    expect(share('goKart', 'Toughness')).toBeLessThan(share('sportsCar', 'Toughness'))
  })

  it('says what each vehicle is like to drive, and the ones with something of their own', () => {
    for (const profile of PLAYABLE_PROFILE_IDS) expect(vehicleNote(profile).length).toBeGreaterThan(0)
    expect(vehicleAbility('sportsCar')).toBe('')
    expect(vehicleAbility('amphibian')).toMatch(/^★ .*boat/)
    expect(vehicleAbility('police')).toMatch(/^★ .*machine guns/)
  })
})
