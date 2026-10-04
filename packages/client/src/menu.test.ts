import { moonOf } from '@buggies/terrain'
import { describe, expect, it } from 'vitest'

import { planetRooms } from './menu.ts'

describe('the popular islands', () => {
  it('are the planets alone, with those on each moon counted on its planet', () => {
    const rooms = [
      { seed: 7, players: 2 },
      { seed: moonOf(3), players: 2 },
      { seed: moonOf(7), players: 1 },
      { seed: 3, players: 1 },
      { seed: moonOf(9), players: 1 },
    ]
    expect(planetRooms(rooms)).toEqual([
      { seed: 3, players: 3 },
      { seed: 7, players: 3 },
      { seed: 9, players: 1 },
    ])
  })
})
