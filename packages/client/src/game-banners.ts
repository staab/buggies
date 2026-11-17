import { FIXED_TIMESTEP, VEHICLE_PROFILE_LABELS, type Seat } from '@buggies/game'
import { HELD, type RaceView, type Standing } from '@buggies/net'

import type { BannerState } from './banner.ts'

/** How long a race over is told of, in seconds, and how long the go of its countdown stays up. */
export const OVER_SECONDS = 5
export const GO_SECONDS = 1

/** What the banners sound: a beat of a countdown, a race won and a race lost. */
export interface BannerSound {
  beep(go: boolean): void
  chime(): void
  bummer(): void
}

/**
 * What the banners are told of a race, snapshot by snapshot: the car they
 * are for, everyone in this world of it, the race as the server last said
 * and, once it is over, where everyone came.
 */
export interface GameView {
  readonly own: Seat
  readonly seats: readonly Seat[]
  readonly race: RaceView | null
  readonly standings: readonly Standing[] | null
}

/** What a seat goes by on this island, for everyone to tell it by: seven letters and digits, the same for everyone there. */
export function playerTag(seed: number, seat: number): string {
  let hash = 0x811c9dc5
  for (const char of `${seed}:${seat}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  return (hash >>> 0).toString(36).padStart(7, '0')
}

/** Who a seat is and what it drives: "Ada in an ambulance", or by its tag, "238s9d7 in an ambulance", if it gave no name. */
export function driverOf(seed: number, seat: Pick<Seat, 'id' | 'profile'>, name = ''): string {
  const vehicle = VEHICLE_PROFILE_LABELS[seat.profile].toLowerCase()
  return `${name || playerTag(seed, seat.id)} in ${/^[aeiou]/.test(vehicle) ? 'an' : 'a'} ${vehicle}`
}

/** Which beat of the countdown a race's `elapsed` is on: "3", "2", "1", and "Go!" once driving has begun. */
function beatOf(race: RaceView): string {
  return race.elapsed === 0 ? 'Go!' : String(Math.min(Math.max(Math.ceil(-race.elapsed * FIXED_TIMESTEP), 1), 9))
}

/** The banner for a race won by one of these seats, lost by it, or over without it in it. */
function moodOf(winnerSeat: number | undefined, ownSeat: number, raced: boolean): BannerState['mood'] {
  if (winnerSeat === undefined) return 'over'
  if (winnerSeat === ownSeat) return 'won'
  return raced ? 'lost' : 'over'
}

/**
 * The big words for a race: the wait for its racers to line up, the
 * countdown to its go, and who won it once it is over, thrown up in
 * confetti for the winner and rained on for the rest of its racers. It is
 * told how the race stands every frame, and answers with the one banner it
 * is showing, made again only where it says something else.
 */
export class GameBanners {
  /** How many races this has ended, so that a second one gets a banner of its own. */
  private ended = 0
  /** What the last countdown beat was, to sound a new one only when it changes. */
  private beat = ''
  /** The wait for the grid, and the countdown: one banner, replaced where it says something else. */
  private start: BannerState | null = null
  private goFor = 0
  /** The race over, and how long it has left to be told of. */
  private over: BannerState | null = null
  private overFor = 0
  /** Whether the end of this race has been told of. */
  private toldOver = false
  /** What `state()` answers with, and what it is made of: the countdown beat is laid over the banner it belongs to. */
  private showing: BannerState | null = null
  private showingBeat = ''

  constructor(
    /** The island the race is on, for what a seat goes by. */
    readonly seed: number,
    readonly sound: BannerSound,
    /** The name a seat goes by, if it gave one. */
    readonly nameOf: (seat: number) => string = () => '',
  ) {}

  /**
   * Take in how the race stands now, a frame later: the wait for every
   * racer to be on the grid, the countdown and the go, and the end of it
   * with whoever won. A free drive has no race, and so has no banner.
   */
  update(dt: number, view: GameView): void {
    const { race } = view
    if (race === null) {
      this.clear()
      return
    }
    if (race.over) {
      this.endWith(race, view, dt)
      return
    }
    if (race.elapsed === HELD) {
      this.waitOnGrid(race)
      return
    }
    if (race.elapsed <= 0) {
      this.countDown(race)
      return
    }
    this.driveAway(dt)
  }

  /** What the banner shows now, if anything: the same banner every frame until it says something else. */
  state(): BannerState | undefined {
    return this.showing ?? undefined
  }

  /** Nothing to tell of: a free drive, or a race not yet in this world. */
  private clear(): void {
    this.start = null
    this.over = null
    this.beat = ''
    this.toldOver = false
    this.show(null)
  }

  /** The racers are still being put on the grid: nobody drives till they are all there. */
  private waitOnGrid(race: RaceView): void {
    this.over = null
    if (this.start?.key === `held:${race.world}`) return
    this.start = { key: `held:${race.world}`, title: 'Get ready', subtitle: 'Waiting for every racer to line up.', mood: 'start' }
    this.beat = ''
    this.show(this.start)
  }

  /** The countdown: nothing but its beats, big, once the grid is full. */
  private countDown(race: RaceView): void {
    this.over = null
    if (this.start?.key !== `start:${race.world}`) {
      this.start = { key: `start:${race.world}`, title: '', subtitle: '', mood: 'start' }
      this.beat = ''
      this.show(this.start)
    }
    const beat = beatOf(race)
    if (beat === this.beat) return
    this.beat = beat
    this.sound.beep(beat === 'Go!')
    if (beat === 'Go!') this.goFor = GO_SECONDS
    this.show(this.start)
  }

  /** Driving has begun: the go stays up a moment, and then it all goes. */
  private driveAway(dt: number): void {
    this.toldOver = false
    if (this.start === null) {
      this.show(this.over)
      return
    }
    this.goFor = Math.max(this.goFor - dt, 0)
    if (this.goFor > 0) return
    this.start = null
    this.show(this.over)
  }

  /** The race is over: who won it is told of, and stays up its while. */
  private endWith(race: RaceView, view: GameView, dt: number): void {
    this.overFor = Math.max(this.overFor - dt, 0)
    if (!this.toldOver) {
      this.toldOver = true
      this.tellTheEnd(race, view)
      return
    }
    if (this.overFor > 0 || this.over === null) return
    this.over = null
    this.show(this.start)
  }

  /** Put up who won, in what, for whichever of the racers is looking at it. */
  private tellTheEnd(race: RaceView, view: GameView): void {
    const winner = this.winnerOf(view)
    const winnerSeat = race.racers.find((racer) => racer.place === 1)?.seat
    const raced = race.racers.some((racer) => racer.seat === view.own.id)
    const mood = moodOf(winnerSeat, view.own.id, raced)
    this.ended += 1
    this.over = {
      key: `over:${this.ended}`,
      title: 'Race over!',
      subtitle: winner === null ? 'Nobody crossed the finish in time.' : `${driverOf(this.seed, { id: 0, profile: winner.vehicle }, winner.name)} wins!`,
      mood,
    }
    this.overFor = OVER_SECONDS
    this.start = null
    this.show(this.over)
    if (mood === 'won') this.sound.chime()
    if (mood === 'lost') this.sound.bummer()
  }

  /** Take the banner to show as this one, with the countdown beat laid over it: made again only where it says something else. */
  private show(banner: BannerState | null): void {
    if (banner === null) {
      this.showing = null
      this.showingBeat = ''
      return
    }
    if (this.showing !== null && this.showingBeat === (banner === this.over ? '' : this.beat) && this.showing.key === banner.key) return
    this.showingBeat = banner === this.over ? '' : this.beat
    this.showing = this.showingBeat === '' ? banner : { ...banner, countdown: this.showingBeat }
  }

  /** Who won the race, in what: from the standings if they have come, and from the racers in this world if they have not. */
  private winnerOf(view: GameView): { name: string; vehicle: Seat['profile'] } | null {
    const first = view.standings?.find((standing) => standing.place === 1)
    if (first !== undefined) return { name: first.name, vehicle: first.vehicle }
    const winner = view.race?.racers.find((racer) => racer.place === 1)
    const seat = winner === undefined ? undefined : view.seats[winner.seat]
    if (seat === undefined) return null
    return { name: this.nameOf(seat.id), vehicle: seat.profile }
  }
}
