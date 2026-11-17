import { COUNTDOWN_TICKS, type Seat } from '@buggies/game'
import { HELD, type RaceView } from '@buggies/net'
import { describe, expect, it } from 'vitest'

import { GameBanners } from './game-banners.ts'

const quiet = { beep() {}, chime() {}, bummer() {} }

function race(elapsed: number): RaceView {
  return { world: 1, ofWorlds: 3, elapsed, over: false, racing: 2, racers: [{ seat: 0, place: 1, checkpoint: 0, finished: false }] }
}

describe('a race’s start', () => {
  it('waits for every racer to line up, counts down to the go, and then lets it go', () => {
    // The banners read no more of a seat than who it is and what it drives.
    const own = { id: 0, profile: 'sportsCar' } as Seat
    const beeps: boolean[] = []
    const banners = new GameBanners(1, { ...quiet, beep: (go) => beeps.push(go) })
    const view = (elapsed: number) => ({ own, seats: [own], race: race(elapsed), standings: null })
    // Held on the grid: the wait, and nothing big of the course.
    banners.update(0.1, view(HELD))
    expect(banners.state()?.title).toBe('Get ready')
    expect(banners.state()?.countdown).toBeUndefined()
    // The countdown comes straight out of the wait, with no intro between them.
    banners.update(0.1, view(-COUNTDOWN_TICKS))
    expect(banners.state()?.title).toBe('')
    expect(banners.state()?.countdown).toBe('3')
    banners.update(0.1, view(-COUNTDOWN_TICKS + 60))
    expect(banners.state()?.countdown).toBe('2')
    banners.update(0.1, view(0))
    expect(banners.state()?.countdown).toBe('Go!')
    expect(beeps).toEqual([false, false, true])
    // The go stays up a moment once driving has begun, and then it all goes.
    banners.update(0.5, view(90))
    expect(banners.state()?.countdown).toBe('Go!')
    banners.update(0.6, view(126))
    expect(banners.state()).toBeUndefined()
  })
})
