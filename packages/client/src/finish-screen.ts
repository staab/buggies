import { FIXED_TIMESTEP } from '@buggies/game'
import type { Standing } from '@buggies/net'

import './finish.css'

import type { FinishState } from './mode.ts'
import { fillStandings, standingsTable } from './standings.ts'

/** How many pieces of confetti a finish throws: a win throws as many again, a moment later. */
const CONFETTI_PIECES = 160
/** How many waves of it fall for a finish, how many for a win, and how far apart they come, in seconds. */
const CONFETTI_WAVES = 3
const CONFETTI_WAVES_WON = 6
const CONFETTI_WAVE_SECONDS = 1.1

/** What the confetti is cut from: the course's gold, the page's accent, and a few bright colours besides. */
const CONFETTI_COLORS = ['#ffd24a', '#6fd3c7', '#ff5c8a', '#5cff8a', '#6fa8ff', '#ffffff']

/** What the finish is told is coming, as the drive's own race ends. */
export interface FinishSound {
  /** A bright rising chime, for any finish. */
  chime(): void
  /** A fanfare over the chime, for a win. */
  fanfare(): void
}

/** A place in words: "1st", "2nd", "3rd", "4th", and "11th" through "13th" for the awkward ones. */
export function ordinal(place: number): string {
  const whole = Math.max(Math.round(place), 1)
  const last = whole % 10
  const tens = whole % 100
  const ending = tens >= 11 && tens <= 13 ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'
  return `${whole}${ending}`
}

/** The line under the place: a win, a podium, or simply home. */
export function finishLine(place: number): string {
  const whole = Math.max(Math.round(place), 1)
  if (whole === 1) return 'You win!'
  if (whole <= 3) return 'Podium!'
  return 'Finished!'
}

/** A race time as minutes, seconds and tenths: `2:30.5`. Ticks less than none are none. */
export function finishTime(ticks: number): string {
  const tenths = Math.max(Math.round(ticks * FIXED_TIMESTEP * 10), 0)
  const seconds = Math.floor((tenths % 600) / 10)
  return `${Math.floor(tenths / 600)}:${String(seconds).padStart(2, '0')}.${tenths % 10}`
}

/** Whether the player has asked the page to keep its animation down. */
function stillMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A new element of the page, of this tag, with these classes and these words. */
function make(tag: string, className: string, words = ''): HTMLElement {
  const made = document.createElement(tag)
  made.className = className
  if (words !== '') made.textContent = words
  return made
}

/**
 * The celebration of the player's own finish, thrown up over the drive the
 * moment their racer comes home and staying until they leave: the place huge
 * in confetti, who else is home so far, and then the race's standings, with
 * the button back to the lobby under it all. The drive goes on behind it.
 */
export class FinishScreen {
  private readonly root: HTMLElement
  private readonly sound: FinishSound
  private readonly confetti: HTMLElement
  private readonly card: HTMLElement
  private readonly place: HTMLElement
  private readonly word: HTMLElement
  private readonly of: HTMLElement
  private readonly line: HTMLElement
  private readonly time: HTMLElement
  private readonly home: HTMLElement
  private readonly homeList: HTMLElement
  private readonly table: HTMLElement
  private readonly tableBody: HTMLTableSectionElement
  private readonly button: HTMLButtonElement
  /** Who was home last time they were listed, so that the list is only rebuilt when it changes. */
  private shownHome = ''
  /** The place the player came, whose row of the standings is theirs. */
  private ownPlace = 0

  constructor(root: HTMLElement, sound: FinishSound, back: () => void) {
    this.root = root
    this.sound = sound
    this.confetti = make('div', 'finish-confetti')
    this.confetti.setAttribute('aria-hidden', 'true')
    this.card = make('div', 'finish-card')
    this.card.setAttribute('role', 'dialog')
    this.card.setAttribute('aria-modal', 'true')
    this.card.setAttribute('aria-label', 'Race finished')

    this.place = make('p', 'finish-place')
    this.word = make('span', 'finish-place-word')
    this.of = make('span', 'finish-of')
    this.place.append(this.word, this.of)
    this.line = make('p', 'finish-line')
    this.time = make('p', 'finish-time')

    this.home = make('div', 'finish-home')
    this.homeList = make('ol', 'finish-home-list')
    this.home.append(make('h2', '', 'Home so far'), this.homeList)
    const { table, body } = standingsTable()
    this.table = make('div', 'finish-table standings')
    this.table.append(table)
    this.tableBody = body
    this.table.hidden = true

    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'finish-back'
    this.button.textContent = 'Back to lobby'
    this.button.addEventListener('click', back)

    this.card.append(make('p', 'finish-kicker', 'Race finished'), this.place, this.line, this.time, this.home, this.table, this.button)
    this.root.append(this.confetti, make('div', 'finish-scrim'), this.card)
  }

  /** Whether the celebration is up. */
  open(): boolean {
    return !this.root.hidden
  }

  /** Throw the celebration: the place, the time, the chime, the confetti and the button under the hand. */
  show(state: FinishState): void {
    this.root.hidden = false
    this.ownPlace = state.place
    this.card.classList.toggle('win', state.place === 1)
    this.word.textContent = ordinal(state.place)
    this.of.textContent = `of ${state.of}`
    this.line.textContent = finishLine(state.place)
    this.time.textContent = finishTime(state.ticks)
    this.home.hidden = false
    this.table.hidden = true
    this.homeList.replaceChildren()
    this.shownHome = ''
    this.update(state)
    this.pop()
    this.scatter(state.place === 1)
    this.sound.chime()
    if (state.place === 1) this.sound.fanfare()
    this.button.focus()
  }

  /** Keep the list of who is home so far up to date, as the ones behind come in. */
  update(state: FinishState): void {
    // Once the standings are up, they are what is shown below the place.
    if (!this.table.hidden) return
    const shown = state.home.map((racer) => `${racer.place}:${racer.name}`).join('|')
    this.home.hidden = state.home.length === 0
    if (shown === this.shownHome) return
    this.shownHome = shown
    this.homeList.replaceChildren()
    for (const racer of state.home) {
      const row = make('li', 'finish-home-row')
      row.append(make('span', 'finish-home-place', ordinal(racer.place)), make('span', 'finish-home-name', racer.name))
      this.homeList.append(row)
    }
  }

  /** The race's standings, in place of who was home so far, once the race is over. */
  standings(rows: readonly Standing[]): void {
    fillStandings(this.tableBody, rows, this.ownPlace)
    this.table.hidden = false
    this.home.hidden = true
  }

  /** Take the celebration down, with its confetti. */
  hide(): void {
    this.root.hidden = true
    this.card.classList.remove('win')
    this.confetti.replaceChildren()
    this.shownHome = ''
  }

  /** Pop the place in: the bounce is started again from the beginning. */
  private pop(): void {
    this.place.classList.remove('pop')
    // Reading the size makes the page lay the place out before the class goes back on.
    void this.place.offsetWidth
    this.place.classList.add('pop')
  }

  /** Throw confetti over the whole screen, and for a win a second burst a moment after the first. */
  private scatter(win: boolean): void {
    this.confetti.replaceChildren()
    if (stillMotion()) return
    // Wave after wave over the whole screen, and twice as many for a win.
    const waves = win ? CONFETTI_WAVES_WON : CONFETTI_WAVES
    for (let wave = 0; wave < waves; wave++) this.throwPieces(CONFETTI_PIECES, wave * CONFETTI_WAVE_SECONDS)
  }

  /** Scatter this many pieces, this many seconds after the first, each falling and tumbling its own way. */
  private throwPieces(count: number, after: number): void {
    for (let index = 0; index < count; index++) {
      const piece = document.createElement('i')
      piece.className = index % 3 === 0 ? 'finish-piece round' : 'finish-piece'
      piece.style.left = `${Math.random() * 100}%`
      piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length]!
      piece.style.setProperty('--fall', `${3 + Math.random() * 3}s`)
      piece.style.setProperty('--delay', `${after + Math.random() * CONFETTI_WAVE_SECONDS}s`)
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 40}vw`)
      piece.style.setProperty('--size', `${0.7 + Math.random() * 0.9}`)
      piece.style.setProperty('--turn', `${Math.round(Math.random() * 720 - 360)}deg`)
      this.confetti.append(piece)
    }
  }
}
