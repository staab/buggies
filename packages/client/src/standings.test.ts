import type { Standing } from '@buggies/net'
import { describe, expect, it } from 'vitest'

import { standingRow, timeLabel } from './standings.ts'

function standing(patch: Partial<Standing> = {}): Standing {
  return { place: 1, name: 'Ada', vehicle: 'sportsCar', seconds: 67, dnf: false, bot: false, ...patch }
}

describe('a race’s standings', () => {
  it('says the place, the racer, what it drove and how long it took', () => {
    expect(standingRow(standing())).toEqual({ place: '1', name: 'Ada', vehicle: 'Sports car', time: '1:07', winner: true })
    expect(standingRow(standing({ place: 3, name: 'Bo', vehicle: 'tank', seconds: 5 }))).toEqual({
      place: '3',
      name: 'Bo',
      vehicle: 'Tank',
      time: '0:05',
      winner: false,
    })
  })

  it('names a bot as one', () => {
    expect(standingRow(standing({ name: 'Axle', bot: true }))).toMatchObject({ name: '🤖 Axle' })
  })

  it('marks a racer that did not finish, and never as the winner', () => {
    expect(standingRow(standing({ seconds: 0, dnf: true }))).toMatchObject({ time: 'DNF', winner: false })
    expect(standingRow(standing({ place: 2, dnf: true })).winner).toBe(false)
  })

  it('counts a time up in minutes and seconds', () => {
    expect(timeLabel(0)).toBe('0:00')
    expect(timeLabel(9.4)).toBe('0:09')
    expect(timeLabel(59.6)).toBe('1:00')
    expect(timeLabel(3600)).toBe('60:00')
    // Seconds never come out negative, whatever the clock did.
    expect(timeLabel(-3)).toBe('0:00')
  })
})
