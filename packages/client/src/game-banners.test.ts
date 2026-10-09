import { COUNTDOWN_TICKS, FIXED_TIMESTEP, GAME_PRIZE, NOT_RACING, type Race, type Seat } from '@buggies/game'
import { describe, expect, it } from 'vitest'

import { GameBanners, GO_SECONDS, OVER_SECONDS, driverOf, playerTag } from './game-banners.ts'

/** Just what the banners read of a seat. */
function seat(id: number, profile: Seat['profile'] = 'sportsCar'): Seat {
  return { id, profile, occupied: true, gamesWon: 0, racePassed: NOT_RACING, game: null, score: 0 } as unknown as Seat
}

function heard(): { sounds: string[]; sound: { beep(go: boolean): void; chime(): void; bummer(): void } } {
  const sounds: string[] = []
  return {
    sounds,
    sound: {
      beep: (go) => sounds.push(go ? 'go' : 'beep'),
      chime: () => sounds.push('chime'),
      bummer: () => sounds.push('bummer'),
    },
  }
}

const course = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
]

describe('the game banners', () => {
  it('tell a seat by seven letters and digits, the same for everyone, and what it drives', () => {
    expect(playerTag(42, 3)).toMatch(/^[0-9a-z]{7}$/)
    expect(playerTag(42, 3)).toBe(playerTag(42, 3))
    expect(playerTag(42, 3)).not.toBe(playerTag(42, 4))
    expect(driverOf(42, { id: 3, profile: 'ambulance' })).toBe(`${playerTag(42, 3)} in an ambulance`)
    expect(driverOf(42, { id: 3, profile: 'tank' })).toBe(`${playerTag(42, 3)} in a tank`)
  })

  it('count a new race down from three to the go, then go away', () => {
    const { sounds, sound } = heard()
    const banners = new GameBanners(7, sound)
    const own = seat(0)
    const seats = [own]
    banners.update(0, { own, seats, race: null, tick: 100 })
    expect(banners.state()).toBeUndefined()

    const race: Race = { course, laps: 1, starter: 0, startTick: 100 }
    own.racePassed = 1
    banners.update(0, { own, seats, race, tick: 100 })
    expect(banners.state()).toMatchObject({ title: 'New race!', countdown: '3', mood: 'start' })
    banners.update(0, { own, seats, race, tick: 100 + Math.round(1.5 / FIXED_TIMESTEP) })
    expect(banners.state()?.countdown).toBe('2')
    banners.update(0, { own, seats, race, tick: 100 + COUNTDOWN_TICKS })
    expect(banners.state()?.countdown).toBe('Go!')
    banners.update(GO_SECONDS + 0.1, { own, seats, race, tick: 100 + COUNTDOWN_TICKS + 1 })
    expect(banners.state()).toBeUndefined()
    expect(sounds).toEqual(['beep', 'beep', 'go'])
  })

  it('throw confetti for the winner of a race, and rain on the rest of its racers', () => {
    const won = heard()
    const lost = heard()
    const a = seat(0, 'ambulance')
    const b = seat(1)
    const race: Race = { course, laps: 2, starter: 0, startTick: 0 }
    const winner = new GameBanners(7, won.sound)
    const loser = new GameBanners(7, lost.sound)
    a.racePassed = 3
    b.racePassed = 2
    const tick = COUNTDOWN_TICKS * 10
    winner.update(0, { own: a, seats: [a, b], race, tick })
    loser.update(0, { own: b, seats: [a, b], race, tick })

    // The server pays the winner and closes the race in the one snapshot.
    a.gamesWon = 1
    a.score = 340
    a.racePassed = NOT_RACING
    b.racePassed = NOT_RACING
    winner.update(0, { own: a, seats: [a, b], race: null, tick })
    loser.update(0, { own: b, seats: [a, b], race: null, tick })
    const told = { title: 'Race over!', subtitle: `${driverOf(7, a)} wins!`, detail: `+${GAME_PRIZE} bananas · 340 in all` }
    expect(winner.state()).toMatchObject({ ...told, mood: 'won' })
    expect(loser.state()).toMatchObject({ ...told, mood: 'lost' })
    expect(won.sounds).toEqual(['chime'])
    expect(lost.sounds).toEqual(['bummer'])
    loser.update(OVER_SECONDS, { own: b, seats: [a, b], race: null, tick })
    expect(loser.state()).toBeUndefined()
  })

  it('tell of a count won, and of a race called off', () => {
    const { sound } = heard()
    const own = seat(0)
    const banners = new GameBanners(7, sound)
    own.game = { kind: 'score', target: 5, from: 0, startTick: 0 }
    banners.update(0, { own, seats: [own], race: null, tick: 0 })
    expect(banners.state()).toMatchObject({ title: 'New game: Score', subtitle: 'Collect 5 bananas.' })
    own.game = null
    own.gamesWon = 1
    banners.update(0, { own, seats: [own], race: null, tick: 1000 })
    expect(banners.state()).toMatchObject({ title: 'Game over!', mood: 'won' })

    const race: Race = { course, laps: 1, starter: 0, startTick: 0 }
    const later = new GameBanners(7, sound)
    own.racePassed = 2
    later.update(0, { own, seats: [own], race, tick: 1000 })
    own.racePassed = NOT_RACING
    later.update(0, { own, seats: [own], race: null, tick: 1001 })
    expect(later.state()).toMatchObject({ title: 'Race called off', mood: 'lost' })
  })
})
