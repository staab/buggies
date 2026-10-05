import { describe, expect, it } from 'vitest'

import { SOLO_BINDINGS, weaponKey } from './input.ts'
import { SOLO_KEYS } from './keys.ts'

describe('key bindings', () => {
  it('give a player the arrows with the space bar, and D for the siren or the horn', () => {
    expect(SOLO_BINDINGS).toEqual({
      ArrowUp: 'forward',
      ArrowDown: 'back',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Space: 'handbrake',
      KeyD: 'signal',
    })
  })

  it('put the weapons on the number keys, along the top row or on the pad', () => {
    expect(weaponKey('Digit1')).toBe(1)
    expect(weaponKey('Digit9')).toBe(9)
    expect(weaponKey('Numpad4')).toBe(4)
    expect(weaponKey('Digit0')).toBe(0)
    expect(weaponKey('KeyF')).toBe(0)
  })

  it('tell the driver their keys, and take R for getting back on the road', () => {
    const on = (does: string): readonly string[] | undefined => SOLO_KEYS.controls('horn').find((hint) => hint.does === does)?.keys
    expect(on('handbrake')).toEqual(['Space'])
    expect(on('weapons')).toEqual(['1–9'])
    expect(on('horn')).toEqual(['D'])
    expect(on('respawn')).toEqual(['R'])
    const press = (code: string, key = code): KeyboardEvent => ({ code, key }) as KeyboardEvent
    expect(SOLO_KEYS.respawn(press('KeyR', 'r'))).toBe(true)
    expect(SOLO_KEYS.respawn(press('KeyQ', 'q'))).toBe(false)
  })
})
