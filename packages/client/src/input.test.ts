import { describe, expect, it } from 'vitest'

import { LEFT_BINDINGS, RIGHT_BINDINGS, SOLO_BINDINGS } from './input.ts'
import { LEFT_KEYS, RIGHT_KEYS, SOLO_KEYS } from './keys.ts'

const EVERYTHING = new Set(['forward', 'back', 'left', 'right', 'handbrake', 'fire', 'ability'])

describe('key bindings', () => {
  it('give each half of a shared keyboard its own keys, with nothing in common, and each side everything a driver does', () => {
    const left = Object.keys(LEFT_BINDINGS)
    const right = Object.keys(RIGHT_BINDINGS)
    expect(left.filter((code) => right.includes(code))).toEqual([])
    for (const bindings of [LEFT_BINDINGS, RIGHT_BINDINGS, SOLO_BINDINGS]) {
      expect(new Set(Object.values(bindings))).toEqual(EVERYTHING)
    }
  })

  it('give a player alone the arrows with the space bar, F and D, and a split screen the letters and the arrows', () => {
    expect(SOLO_BINDINGS).toEqual({
      ArrowUp: 'forward',
      ArrowDown: 'back',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Space: 'handbrake',
      KeyF: 'fire',
      KeyD: 'ability',
    })
    expect(LEFT_BINDINGS).toEqual({
      KeyW: 'forward',
      KeyS: 'back',
      KeyA: 'left',
      KeyD: 'right',
      KeyZ: 'handbrake',
      KeyX: 'fire',
      ShiftLeft: 'ability',
    })
    expect(RIGHT_BINDINGS).toEqual({
      ArrowUp: 'forward',
      ArrowDown: 'back',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Comma: 'handbrake',
      Period: 'fire',
      KeyM: 'ability',
    })
  })

  it('tell each driver their keys, with what their own car does on its own key', () => {
    const on = (keys: typeof SOLO_KEYS, ability: string, does: string): readonly string[] | undefined =>
      keys.controls(ability).find((hint) => hint.does === does)?.keys
    expect(on(SOLO_KEYS, 'Machine gun', 'machine gun')).toEqual(['D'])
    expect(on(SOLO_KEYS, 'Horn', 'fire')).toEqual(['F'])
    expect(on(SOLO_KEYS, 'Horn', 'handbrake')).toEqual(['Space'])
    expect(on(SOLO_KEYS, 'Horn', 'respawn')).toEqual(['R'])
    expect(on(LEFT_KEYS, 'Horn', 'horn')).toEqual(['Shift'])
    expect(on(LEFT_KEYS, 'Horn', 'fire')).toEqual(['X'])
    expect(on(RIGHT_KEYS, 'Wings', 'wings')).toEqual(['M'])
    expect(on(RIGHT_KEYS, 'Wings', 'handbrake')).toEqual([','])
    // Getting back on the road is a key of each driver's own too.
    const press = (code: string, key = code): KeyboardEvent => ({ code, key }) as KeyboardEvent
    expect(SOLO_KEYS.respawn(press('KeyR', 'r'))).toBe(true)
    expect(LEFT_KEYS.respawn(press('KeyQ', 'q'))).toBe(true)
    expect(RIGHT_KEYS.respawn(press('Enter'))).toBe(true)
    expect(SOLO_KEYS.respawn(press('KeyQ', 'q'))).toBe(false)
  })
})
