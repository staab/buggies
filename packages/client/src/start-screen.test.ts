import type { GameMode, GameStatus, GameSummary } from '@buggies/net'
import { describe, expect, it } from 'vitest'

import { describeGame, joinable, statusLabel, watchable } from './start-screen.ts'

function game(patch: Partial<GameSummary> = {}): GameSummary {
  return { id: 4, seed: 12, mode: 'race', status: 'open', host: 'Ada', humans: 2, slots: 4, leader: 0, demo: false, ...patch }
}

describe('a game on the start screen', () => {
  it('says what game it is, on what world, hosted by whom, how full and how it is going', () => {
    expect(describeGame(game())).toEqual({
      world: 'seed 12 · the island',
      mode: 'Race',
      host: 'hosted by Ada',
      players: '2 / 4',
      status: 'waiting',
    })
    expect(describeGame(game({ seed: 4242, mode: 'free' }))).toMatchObject({
      world: 'seed 4242 · the island',
      mode: 'Free drive',
    })
    // The server's own demo is nobody's to be hosted by, though it is not listed beside the others.
    expect(describeGame(game({ demo: true, host: '' })).host).toBe('nobody hosts it')
  })

  it('tells each state of a game apart', () => {
    const states: [GameStatus, string][] = [
      ['open', 'waiting'],
      ['preparing', 'preparing the course'],
      ['starting', 'starting'],
      ['racing', 'under way'],
      ['finished', 'finished'],
    ]
    for (const [status, said] of states) expect(statusLabel(status)).toBe(said)
    for (const mode of ['race', 'free'] as GameMode[]) expect(describeGame(game({ mode })).mode).not.toBe('')
  })

  it('may be joined only while it is waiting, with a slot left in it for a player', () => {
    expect(joinable(game())).toBe(true)
    expect(joinable(game({ humans: 4 }))).toBe(false)
    expect(joinable(game({ humans: 5 }))).toBe(false)
    expect(joinable(game({ status: 'preparing' }))).toBe(false)
    expect(joinable(game({ status: 'starting' }))).toBe(false)
    expect(joinable(game({ status: 'racing' }))).toBe(false)
    expect(joinable(game({ status: 'finished' }))).toBe(false)
  })

  it('is watched, not joined, while it is a race under way', () => {
    expect(watchable(game({ status: 'starting' }))).toBe(true)
    expect(watchable(game({ status: 'racing' }))).toBe(true)
    expect(watchable(game())).toBe(false)
    expect(watchable(game({ status: 'finished' }))).toBe(false)
    // A free drive is never watched: there is no race to follow in it.
    expect(watchable(game({ mode: 'free', status: 'racing' }))).toBe(false)
    // A race that may be joined is joined, not watched, and one under way may no longer be joined.
    expect(joinable(game({ status: 'racing' }))).toBe(false)
  })
})
