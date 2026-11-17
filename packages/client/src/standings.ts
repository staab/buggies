import { VEHICLE_PROFILE_LABELS } from '@buggies/game'
import type { Standing } from '@buggies/net'

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

/** A race time as minutes and seconds: `3:07`. */
export function timeLabel(seconds: number): string {
  const whole = Math.max(Math.round(seconds), 0)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
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

function cell(text: string, className = ''): HTMLTableCellElement {
  const made = document.createElement('td')
  made.className = className
  made.textContent = text
  return made
}

/** The table a race's standings go in: its headings, and the body to fill with its rows. */
export function standingsTable(): { table: HTMLTableElement; body: HTMLTableSectionElement } {
  const table = document.createElement('table')
  const head = document.createElement('thead')
  const titleRow = document.createElement('tr')
  for (const [text, className] of [
    ['#', ''],
    ['Racer', ''],
    ['Vehicle', ''],
    ['Time', 'time'],
  ] as const) {
    const th = document.createElement('th')
    th.className = className
    th.textContent = text
    titleRow.append(th)
  }
  head.append(titleRow)
  const body = document.createElement('tbody')
  table.append(head, body)
  return { table, body }
}

/** Fill a standings table's body: the place, the racer and what it drove, and its time or `DNF`, the winner marked. */
export function fillStandings(body: HTMLTableSectionElement, rows: readonly Standing[], ownPlace = 0): void {
  body.replaceChildren()
  for (const standing of rows) {
    const row = standingRow(standing)
    const made = document.createElement('tr')
    if (row.winner) made.classList.add('winner')
    // A finisher's place is theirs alone, so the place the player came marks their row.
    if (ownPlace > 0 && !standing.dnf && standing.place === ownPlace) made.classList.add('you')
    made.append(cell(row.place), cell(row.name), cell(row.vehicle), cell(row.time, 'time'))
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
    this.panel = document.createElement('div')
    this.panel.className = 'panel standings'
    this.panel.hidden = true

    const heading = document.createElement('h1')
    heading.textContent = 'Standings'
    const { table, body } = standingsTable()
    this.body = body
    this.back = document.createElement('button')
    this.back.type = 'button'
    this.back.className = 'back'
    this.back.textContent = 'Back to lobby'
    this.back.addEventListener('click', back)
    this.panel.append(heading, table, this.back)
    root.append(this.panel)
  }

  /** Whether the standings are up. */
  open(): boolean {
    return !this.panel.hidden
  }

  show(rows: readonly Standing[]): void {
    fillStandings(this.body, rows)
    this.panel.hidden = false
    this.back.focus()
  }

  hide(): void {
    this.panel.hidden = true
  }
}
