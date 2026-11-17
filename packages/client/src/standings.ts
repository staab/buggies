import { VEHICLE_PROFILE_LABELS } from '@buggies/game'
import type { Standing } from '@buggies/net'

import { button, element } from './dom.ts'
import { timeLabel } from './race-text.ts'

/** A standing as a row of the table. */
export interface StandingRow {
  /** Where the racer came, 1 upward. */
  place: string
  /** The racer's name, with a robot for a bot. */
  name: string
  /** What it drove. */
  vehicle: string
  /** How long it took, or `DNF`. */
  time: string
  /** Whether this is the racer that won. */
  winner: boolean
}

/** A standing as the table shows it: the place, the racer and what it drove, and its time or `DNF`. A bot's name says it is one. */
export function standingRow(standing: Standing): StandingRow {
  return {
    place: String(standing.place),
    name: standing.bot ? `🤖 ${standing.name}` : standing.name,
    vehicle: VEHICLE_PROFILE_LABELS[standing.vehicle],
    time: standing.dnf ? 'DNF' : timeLabel(standing.seconds),
    winner: standing.place === 1 && !standing.dnf,
  }
}

/** The table a race's standings go in: its headings, and the body to fill with its rows. */
export function standingsTable(): { table: HTMLTableElement; body: HTMLTableSectionElement } {
  const table = element('table')
  const head = element('thead')
  const titleRow = element('tr')
  for (const [text, className] of [
    ['#', ''],
    ['Racer', ''],
    ['Vehicle', ''],
    ['Time', 'time'],
  ] as const) {
    titleRow.append(element('th', className, text))
  }
  head.append(titleRow)
  const body = element('tbody')
  table.append(head, body)
  return { table, body }
}

/** Fill a standings table's body: the place, the racer and what it drove, and its time or `DNF`, the winner marked. */
export function fillStandings(body: HTMLTableSectionElement, rows: readonly Standing[], ownPlace = 0): void {
  body.replaceChildren()
  for (const standing of rows) {
    const row = standingRow(standing)
    const made = element('tr')
    if (row.winner) made.classList.add('winner')
    // A finisher's place is theirs alone, so the place the player came marks their row.
    if (ownPlace > 0 && !standing.dnf && standing.place === ownPlace) made.classList.add('you')
    made.append(element('td', '', row.place), element('td', '', row.name), element('td', '', row.vehicle), element('td', 'time', row.time))
    body.append(made)
  }
}

/**
 * How the race finished: where each racer came, what it drove and how long
 * it took, or that it did not finish. The winner's row is marked, and the
 * screen stays until the player leaves for the lobby.
 */
export class Standings {
  private readonly panel: HTMLElement
  private readonly body: HTMLTableSectionElement
  private readonly back: HTMLButtonElement

  constructor(root: HTMLElement, back: () => void) {
    this.panel = element('div', 'panel standings')
    this.panel.hidden = true

    const { table, body } = standingsTable()
    this.body = body
    this.back = button('Back to lobby', 'back')
    this.back.addEventListener('click', back)
    this.panel.append(element('h1', '', 'Standings'), table, this.back)
    root.append(this.panel)
  }

  /** Whether the standings are up. */
  open(): boolean {
    return !this.panel.hidden
  }

  /** Put the standings up: how each racer came, and the way back to the lobby under them. */
  show(rows: readonly Standing[]): void {
    fillStandings(this.body, rows)
    this.panel.hidden = false
    this.back.focus()
  }

  hide(): void {
    this.panel.hidden = true
  }
}
