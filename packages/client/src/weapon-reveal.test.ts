import { describe, expect, it } from 'vitest'

import { REVEAL_SECONDS, WeaponReveal } from './weapon-reveal.ts'

describe('the weapon reveal', () => {
  it('rolls the names past, fast and then slower, and stops on what was won', () => {
    const reveal = new WeaponReveal()
    reveal.update('none', 0.1)
    expect(reveal.shown).toBe('none')
    expect(reveal.ready).toBe(false)

    reveal.update('machineGun', 0)
    expect(reveal.rolling).toBe(true)
    expect(reveal.ready).toBe(false)
    const changes: number[] = []
    let last = reveal.shown
    let now = 0
    while (now < REVEAL_SECONDS + 0.1) {
      reveal.update('machineGun', 1 / 120)
      now += 1 / 120
      if (reveal.shown !== last) {
        changes.push(now)
        last = reveal.shown
      }
    }
    expect(changes.length).toBeGreaterThan(8)
    const gaps = changes.slice(1).map((at, i) => at - changes[i]!)
    const early = (gaps[0]! + gaps[1]! + gaps[2]!) / 3
    const late = (gaps.at(-2)! + gaps.at(-3)! + gaps.at(-4)!) / 3
    expect(late).toBeGreaterThan(early * 3)
    expect(reveal.rolling).toBe(false)
    expect(reveal.shown).toBe('machineGun')
    expect(reveal.ready).toBe(true)

    // Fired or spent: gone at once, nothing to roll.
    reveal.update('none', 0.01)
    expect(reveal.shown).toBe('none')
    expect(reveal.ready).toBe(false)
    expect(reveal.rolling).toBe(false)
  })

  it('starts over when something else is won mid-roll', () => {
    const reveal = new WeaponReveal()
    reveal.update('rocket', 0)
    for (let i = 0; i < 30; i++) reveal.update('rocket', 1 / 60)
    reveal.update('machineGun', 1 / 60)
    for (let i = 0; i < REVEAL_SECONDS * 60 + 2; i++) reveal.update('machineGun', 1 / 60)
    expect(reveal.shown).toBe('machineGun')
    expect(reveal.ready).toBe(true)
  })
})
