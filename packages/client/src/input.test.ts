import { describe, expect, it } from 'vitest'

import { LEFT_BINDINGS, RIGHT_BINDINGS, SOLO_BINDINGS } from './input.ts'

describe('key bindings', () => {
  it('give each half of a shared keyboard its own keys, with nothing in common', () => {
    const left = Object.keys(LEFT_BINDINGS)
    const right = Object.keys(RIGHT_BINDINGS)
    expect(left.filter((code) => right.includes(code))).toEqual([])
    // Each side can do everything a driver does.
    for (const bindings of [LEFT_BINDINGS, RIGHT_BINDINGS, SOLO_BINDINGS]) {
      expect(new Set(Object.values(bindings))).toEqual(new Set(['forward', 'back', 'left', 'right', 'handbrake', 'fire']))
    }
  })

  it('leave the letters and the arrows to the sides they belong to', () => {
    expect(Object.keys(LEFT_BINDINGS).every((code) => code.startsWith('Key') || code === 'Space')).toBe(true)
    expect(Object.keys(RIGHT_BINDINGS).every((code) => code.startsWith('Arrow') || code.startsWith('Shift'))).toBe(true)
    expect(RIGHT_BINDINGS.ShiftLeft).toBe('handbrake')
    expect(RIGHT_BINDINGS.ShiftRight).toBe('fire')
    expect(LEFT_BINDINGS.Space).toBe('handbrake')
  })
})
