import { describe, expect, it } from 'vitest'

import { SOLO_BINDINGS } from './input.ts'
import { SOLO_KEYS } from './keys.ts'

const EVERYTHING = new Set(['forward', 'back', 'left', 'right', 'handbrake', 'fire', 'ability'])

describe('key bindings', () => {
  it('give a player the arrows with the space bar, F and D, and everything a driver does', () => {
    expect(SOLO_BINDINGS).toEqual({
      ArrowUp: 'forward',
      ArrowDown: 'back',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Space: 'handbrake',
      KeyF: 'fire',
      KeyD: 'ability',
    })
    expect(new Set(Object.values(SOLO_BINDINGS))).toEqual(EVERYTHING)
  })

  it('tell each driver their keys, with what their own car does on its own key', () => {
    const on = (keys: typeof SOLO_KEYS, ability: string, does: string): readonly string[] | undefined =>
      keys.controls(ability).find((hint) => hint.does === does)?.keys
    expect(on(SOLO_KEYS, 'Machine gun', 'machine gun')).toEqual(['D'])
    expect(on(SOLO_KEYS, 'Horn', 'fire')).toEqual(['F'])
    expect(on(SOLO_KEYS, 'Horn', 'handbrake')).toEqual(['Space'])
    expect(on(SOLO_KEYS, 'Horn', 'respawn')).toEqual(['R'])
    // Getting back on the road is a key of its own.
    const press = (code: string, key = code): KeyboardEvent => ({ code, key }) as KeyboardEvent
    expect(SOLO_KEYS.respawn(press('KeyR', 'r'))).toBe(true)
    expect(SOLO_KEYS.respawn(press('KeyQ', 'q'))).toBe(false)
  })
})
