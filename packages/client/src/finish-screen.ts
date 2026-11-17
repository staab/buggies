import type { Standing } from '@buggies/net'

import './finish.css'

import { button, element, setClass, setHidden, writeText } from './dom.ts'
import type { FinishedRacer, FinishState } from './mode.ts'
import { finishTime, ordinal } from './race-text.ts'
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

/** The line under the place: a win, a podium, or simply home. */
export function finishLine(place: number): string {
  const whole = Math.max(Math.round(place), 1)
  if (whole === 1) return 'You win!'
  if (whole <= 3) return 'Podium!'
  return 'Finished!'
}

/** Whether the player has asked the page to keep its animation down. */
function stillMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
  /** Who was home last time they were listed, so that the list is only rebuilt where it has changed. */
  private readonly shownRacers: { place: number; name: string }[] = []
  /** The standings last put up, for the same reason: the same race is asked for every frame it is over. */
  private readonly shownRows: Standing[] = []
  /** The place the player came, whose row of the standings is theirs. */
  private ownPlace = 0

  constructor(root: HTMLElement, sound: FinishSound, back: () => void) {
    this.root = root
    this.sound = sound
    this.confetti = element('div', 'finish-confetti')
    this.confetti.setAttribute('aria-hidden', 'true')
    this.card = element('div', 'finish-card')
    this.card.setAttribute('role', 'dialog')
    this.card.setAttribute('aria-modal', 'true')
    this.card.setAttribute('aria-label', 'Race finished')

    this.place = element('p', 'finish-place')
    this.word = element('span', 'finish-place-word')
    this.of = element('span', 'finish-of')
    this.place.append(this.word, this.of)
    this.line = element('p', 'finish-line')
    this.time = element('p', 'finish-time')

    this.home = element('div', 'finish-home')
    this.homeList = element('ol', 'finish-home-list')
    this.home.append(element('h2', '', 'Home so far'), this.homeList)
    const { table, body } = standingsTable()
    this.table = element('div', 'finish-table standings')
    this.table.append(table)
    this.tableBody = body
    this.table.hidden = true

    this.button = button('Back to lobby', 'finish-back')
    this.button.addEventListener('click', back)

    this.card.append(element('p', 'finish-kicker', 'Race finished'), this.place, this.line, this.time, this.home, this.table, this.button)
    this.root.append(this.confetti, element('div', 'finish-scrim'), this.card)
  }

  /** Whether the celebration is up. */
  open(): boolean {
    return !this.root.hidden
  }

  /** Throw the celebration: the place, the time, the chime, the confetti and the button under the hand. */
  show(state: FinishState): void {
    setHidden(this.root, false)
    this.ownPlace = state.place
    setClass(this.card, 'win', state.place === 1)
    writeText(this.word, ordinal(state.place))
    writeText(this.of, `of ${state.of}`)
    writeText(this.line, finishLine(state.place))
    writeText(this.time, finishTime(state.ticks))
    setHidden(this.home, false)
    setHidden(this.table, true)
    this.homeList.replaceChildren()
    this.shownRacers.length = 0
    this.update(state)
    this.pop()
    this.scatter(state.place === 1)
    this.sound.chime()
    if (state.place === 1) this.sound.fanfare()
    this.button.focus()
  }

  /** Keep the list of who is home so far up to date, as the ones behind come in. Asked every frame, it writes nothing while nobody else is home. */
  update(state: FinishState): void {
    // Once the standings are up, they are what is shown below the place.
    if (!this.table.hidden) return
    setHidden(this.home, state.home.length === 0)
    if (!this.homeChanged(state.home)) return
    this.homeList.replaceChildren()
    for (const racer of state.home) {
      const row = element('li', 'finish-home-row')
      row.append(element('span', 'finish-home-place', ordinal(racer.place)), element('span', 'finish-home-name', racer.name))
      this.homeList.append(row)
    }
  }

  /** The race's standings, in place of who was home so far, once the race is over. */
  standings(rows: readonly Standing[]): void {
    if (!this.standingsChanged(rows)) return
    fillStandings(this.tableBody, rows, this.ownPlace)
    setHidden(this.table, false)
    setHidden(this.home, true)
  }

  /** Whether who is home has changed, a racer at a time: no list is built for the same one over again. */
  private homeChanged(home: readonly FinishedRacer[]): boolean {
    if (home.length !== this.shownRacers.length) {
      this.shownRacers.length = 0
      for (const racer of home) this.shownRacers.push({ place: racer.place, name: racer.name })
      return true
    }
    for (const [index, racer] of home.entries()) {
      const shown = this.shownRacers[index]!
      if (shown.place === racer.place && shown.name === racer.name) continue
      shown.place = racer.place
      shown.name = racer.name
      return true
    }
    return false
  }

  /** Whether these standings are not the ones already up, a racer at a time. */
  private standingsChanged(rows: readonly Standing[]): boolean {
    if (rows.length !== this.shownRows.length) {
      this.shownRows.length = 0
      for (const row of rows) this.shownRows.push(row)
      return true
    }
    for (const [index, row] of rows.entries()) {
      const shown = this.shownRows[index]!
      if (
        shown.place === row.place &&
        shown.name === row.name &&
        shown.vehicle === row.vehicle &&
        shown.seconds === row.seconds &&
        shown.dnf === row.dnf &&
        shown.bot === row.bot
      ) {
        continue
      }
      this.shownRows[index] = row
      return true
    }
    return false
  }

  /** Take the celebration down, with its confetti. */
  hide(): void {
    setHidden(this.root, true)
    setClass(this.card, 'win', false)
    this.confetti.replaceChildren()
    this.shownRacers.length = 0
    this.shownRows.length = 0
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
    // Wave after wave over the whole screen, and twice as many for a win, each wave put in in one go.
    const waves = win ? CONFETTI_WAVES_WON : CONFETTI_WAVES
    const confetti = document.createDocumentFragment()
    for (let wave = 0; wave < waves; wave++) this.throwPieces(confetti, CONFETTI_PIECES, wave * CONFETTI_WAVE_SECONDS)
    this.confetti.append(confetti)
  }

  /** Scatter this many pieces into what is being gathered, this many seconds after the first, each falling and tumbling its own way. */
  private throwPieces(into: DocumentFragment, count: number, after: number): void {
    for (let index = 0; index < count; index++) {
      const piece = element('i', index % 3 === 0 ? 'finish-piece round' : 'finish-piece')
      piece.style.left = `${Math.random() * 100}%`
      piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length]!
      piece.style.setProperty('--fall', `${3 + Math.random() * 3}s`)
      piece.style.setProperty('--delay', `${after + Math.random() * CONFETTI_WAVE_SECONDS}s`)
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 40}vw`)
      piece.style.setProperty('--size', `${0.7 + Math.random() * 0.9}`)
      piece.style.setProperty('--turn', `${Math.round(Math.random() * 720 - 360)}deg`)
      into.append(piece)
    }
  }
}
