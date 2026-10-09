import {
  COUNTDOWN_TICKS,
  FIXED_TIMESTEP,
  GAME_LABELS,
  GAME_PRIZE,
  NOT_RACING,
  VEHICLE_PROFILE_LABELS,
  countdownLeft,
  type Game,
  type Race,
  type Seat,
} from '@buggies/game'

import type { BannerState } from './banner.ts'

/** How long a game over is told of, in seconds, and how long the go of a countdown stays up. */
export const OVER_SECONDS = 5
export const GO_SECONDS = 1

/** What the banners are told of a game: a seat's own, every seat, the race on and the tick. */
export interface GameView {
  readonly own: Seat
  readonly seats: readonly Seat[]
  readonly race: Race | null
  readonly tick: number
}

/** What the banners sound: a beat of the countdown, a game won and a game lost. */
export interface BannerSound {
  beep(go: boolean): void
  chime(): void
  bummer(): void
}

/** What a seat goes by on this island, for everyone to tell it by: seven letters and digits, the same for everyone there. */
export function playerTag(seed: number, seat: number): string {
  let hash = 0x811c9dc5
  for (const char of `${seed}:${seat}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  return (hash >>> 0).toString(36).padStart(7, '0')
}

/** Who a seat is and what it drives: "238s9d7 in an ambulance". */
export function driverOf(seed: number, seat: Pick<Seat, 'id' | 'profile'>): string {
  const vehicle = VEHICLE_PROFILE_LABELS[seat.profile].toLowerCase()
  return `${playerTag(seed, seat.id)} in ${/^[aeiou]/.test(vehicle) ? 'an' : 'a'} ${vehicle}`
}

/** What a count asks for, in a line. */
function countAsk(game: Game): string {
  const { target } = game
  if (game.kind === 'score') return `Collect ${target} ${target === 1 ? 'banana' : 'bananas'}.`
  if (game.kind === 'kills') return `Wreck ${target} other ${target === 1 ? "player's car" : "players' cars"} with your weapons.`
  return `Bring down ${target} ${target === 1 ? 'robot' : 'robots'} with your weapons.`
}

/** What a race asks for, in a line. */
function raceAsk(race: Race): string {
  const checkpoints = race.course.length - 2
  const passing = `Pass ${checkpoints === 1 ? 'the checkpoint' : `all ${checkpoints} checkpoints in order`}`
  if (race.laps === 1) return `${passing}, then be first over the finish. Follow the gold beacon.`
  return `${race.laps} laps: ${passing.toLowerCase()} and the finish, back round by the start, and be first over the finish on the last lap. Follow the gold beacon.`
}

/**
 * The big words for the games a seat plays: a new one's name and what it
 * asks, counted down from three, its driving held till the go; and once one
 * is over, who won it in what and what it paid, thrown up in confetti for
 * the winner and rained on for the rest of its racers.
 */
export class GameBanners {
  /** How many games each seat had won when last seen, to tell a win by. */
  private readonly gamesWon = new Map<number, number>()
  /** The seats in the race on when last seen, and that race. */
  private racers = new Set<number>()
  private raceOn: Race | null = null
  private start: BannerState | null = null
  private beat = ''
  private goFor = 0
  private over: BannerState | null = null
  private overFor = 0
  private ended = 0

  constructor(
    private readonly seed: number,
    private readonly sound: BannerSound,
  ) {}

  update(dt: number, view: GameView): void {
    const { own, race } = view
    const winners = this.winners(view.seats)
    // A race gone: won by whichever of its racers just won a game, or called off.
    if (this.raceOn !== null && race === null) {
      const winner = winners.find((seat) => this.racers.has(seat.id)) ?? null
      const mood = winner?.id === own.id ? 'won' : this.racers.has(own.id) ? 'lost' : 'over'
      this.endWith(winner === null ? 'Race called off' : 'Race over!', winner, mood, winner === null ? 'Nobody crossed the finish in time.' : undefined)
    } else if (winners.some((seat) => seat.id === own.id)) this.endWith('Game over!', own, 'won')
    this.racers = new Set(race === null ? [] : view.seats.filter((seat) => seat.occupied && seat.racePassed !== NOT_RACING).map((seat) => seat.id))
    this.raceOn = race

    // A game just started, counting down to its go.
    const left = countdownLeft(own, race, view.tick)
    if (left > 0) {
      const starting = race !== null && own.racePassed !== NOT_RACING && race.startTick + COUNTDOWN_TICKS > view.tick ? race : null
      const key = starting !== null ? `race:${starting.startTick}` : `game:${own.game?.startTick}`
      if (this.start?.key !== key) {
        this.start =
          starting !== null
            ? { key, title: starting.laps === 1 ? 'New race!' : 'New circuit race!', subtitle: raceAsk(starting), mood: 'start' }
            : { key, title: `New game: ${GAME_LABELS[own.game!.kind]}`, subtitle: countAsk(own.game!), mood: 'start' }
        this.over = null
        this.beat = ''
      }
      const beat = String(Math.ceil(left * FIXED_TIMESTEP))
      if (beat !== this.beat) this.sound.beep(false)
      this.beat = beat
      this.goFor = GO_SECONDS
    } else if (this.start !== null && this.beat !== 'Go!') {
      this.beat = 'Go!'
      this.sound.beep(true)
    } else if (this.start !== null) {
      this.goFor -= dt
      if (this.goFor <= 0) this.start = null
    }
    this.overFor = Math.max(this.overFor - dt, 0)
    if (this.overFor === 0) this.over = null
  }

  /** What the banner shows now, if anything. */
  state(): BannerState | undefined {
    if (this.over !== null) return this.over
    if (this.start !== null) return { ...this.start, countdown: this.beat }
    return undefined
  }

  /** The seats that have won a game since last seen. */
  private winners(seats: readonly Seat[]): Seat[] {
    const winners: Seat[] = []
    for (const seat of seats) {
      const before = this.gamesWon.get(seat.id)
      if (seat.occupied && before !== undefined && seat.gamesWon === ((before + 1) & 0xff)) winners.push(seat)
      this.gamesWon.set(seat.id, seat.occupied ? seat.gamesWon : 0)
    }
    return winners
  }

  private endWith(title: string, winner: Seat | null, mood: BannerState['mood'], subtitle?: string): void {
    this.ended += 1
    this.over = {
      key: `over:${this.ended}`,
      title,
      subtitle: subtitle ?? `${driverOf(this.seed, winner!)} wins!`,
      ...(winner === null ? {} : { detail: `+${GAME_PRIZE} bananas · ${winner.score} in all` }),
      mood,
    }
    this.overFor = OVER_SECONDS
    this.start = null
    if (mood === 'won') this.sound.chime()
    if (mood === 'lost') this.sound.bummer()
  }
}
