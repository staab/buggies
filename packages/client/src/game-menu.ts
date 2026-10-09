import {
  GAME_KINDS,
  GAME_LABELS,
  GAME_PRIZE,
  GAME_TARGET_MOST,
  RACE_LAPS_MOST,
  RACE_LEG_LEAST,
  RACE_MARKS_MOST,
  apartOnGround,
  validGame,
  type CountKind,
  type Game,
  type GameKind,
  type GameRequest,
  type Race,
} from '@buggies/game'
import type { Vec3 } from '@buggies/physics'
import { onLand, type World } from '@buggies/terrain'

import { GlobeBoard } from './globe-board.ts'

/** How many pixels across the globe is drawn at to pick a course on. */
const MAP_PIXELS = 360

/** What each game asks for, under its name. */
const GAME_NOTES: Readonly<Record<GameKind, string>> = {
  score: 'Collect this many bananas',
  kills: "Wreck this many other players' cars with your weapons",
  robots: 'Bring down this many robots with your weapons',
  race: 'Race everyone on the island over a course you pick, once or for laps',
}

/** What each count starts at, when first picked. */
const GAME_DEFAULTS: Readonly<Record<CountKind, number>> = { score: 20, kills: 3, robots: 1 }

/** The colors a race's start, checkpoints and finish are drawn in on the map. */
export const START_COLOR = '#5cff8a'
export const CHECKPOINT_COLOR = '#ffd24a'
export const FINISH_COLOR = '#ff6b6b'

/** What the games panel needs of the game behind it. */
export interface GameHost {
  /** The island being played, or nothing when no game is on. */
  map(): World | null
  /** Where the player is, to be shown on the map. */
  position(): Vec3 | null
  /** The count being played for, if any. */
  game(): Game | null
  /** The race on over the island, if any, and whether this player set it going. */
  race(): { race: Race; mine: boolean } | null
  /** Play this game, or none: a count is the player's own, a race everyone's. */
  setGame(game: GameRequest | null): void
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

/** A field for a whole number, from 1 to `most`, that keeps the keys it is typed with from the game and plays on Enter. */
function wholeNumber(most: number, onInput: () => void, onEnter: () => void): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '1'
  input.max = String(most)
  input.step = '1'
  // The game is listening for keys too: these are the field's.
  input.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') onEnter()
  })
  input.addEventListener('input', onInput)
  return input
}

/** A field's number, if it is a whole one from 1 to `most`. */
function wholeIn(input: HTMLInputElement, most: number): number | null {
  const value = Number(input.value)
  return Number.isInteger(value) && value >= 1 && value <= most ? value : null
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const made = document.createElement('button')
  made.type = 'button'
  made.textContent = text
  made.addEventListener('click', onClick)
  return made
}

/**
 * The "games" panel, opened from the trophy in the corner: a game to play
 * on top of free play, a number of bananas, wrecks or robots, or a race
 * over a course of marks picked on a globe of the island, start first,
 * then the checkpoints, then the finish.
 */
export class GameMenu {
  private readonly root: HTMLElement
  private readonly host: GameHost
  private readonly cards: Record<GameKind, HTMLButtonElement>
  private readonly current: HTMLParagraphElement
  private readonly amount: HTMLLabelElement
  private readonly amountInput: HTMLInputElement
  private readonly course: HTMLDivElement
  private readonly lapsInput: HTMLInputElement
  private readonly board: GlobeBoard
  private readonly undoButton: HTMLButtonElement
  private readonly resetButton: HTMLButtonElement
  private readonly note: HTMLParagraphElement
  private readonly setButton: HTMLButtonElement
  private readonly clearButton: HTMLButtonElement
  private kind: GameKind = 'score'
  /** The marks picked so far, each the way out from the planet's middle through it, in the order they are to be driven. */
  private marks: Vec3[] = []
  /** Why the last click on the map was not taken, if it was not. */
  private refused = ''

  constructor(root: HTMLElement, host: GameHost) {
    this.root = root
    this.host = host
    root.hidden = true
    const panel = document.createElement('div')
    panel.className = 'panel games'
    const title = document.createElement('h1')
    title.textContent = 'Games'
    const blurb = document.createElement('p')
    blurb.className = 'blurb'
    blurb.textContent = `Play for something. Win and you get ${GAME_PRIZE} bananas.`
    this.current = document.createElement('p')
    this.current.className = 'status current'

    const fieldset = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = 'Game'
    const cards = document.createElement('div')
    cards.className = 'cards'
    fieldset.append(legend, cards)
    const made = {} as Record<GameKind, HTMLButtonElement>
    for (const kind of GAME_KINDS) {
      const card = document.createElement('button')
      card.type = 'button'
      card.append(span('name', GAME_LABELS[kind]), span('note', GAME_NOTES[kind]))
      card.addEventListener('click', () => this.pick(kind))
      cards.append(card)
      made[kind] = card
    }
    this.cards = made

    // How many, for a count.
    this.amount = document.createElement('label')
    this.amount.className = 'amount'
    this.amountInput = wholeNumber(GAME_TARGET_MOST, () => this.render(), () => this.confirm())
    this.amount.append(span('name', 'How many'), this.amountInput)

    // The course, on a globe of the island.
    this.course = document.createElement('div')
    this.course.className = 'course'
    this.board = new GlobeBoard(MAP_PIXELS, (mark) => this.pickMark(mark))
    this.undoButton = button('Undo mark', () => {
      this.marks.pop()
      this.refused = ''
      this.render()
    })
    this.resetButton = button('Clear marks', () => {
      this.marks = []
      this.refused = ''
      this.render()
    })
    const tools = document.createElement('div')
    tools.className = 'tools'
    tools.append(this.undoButton, this.resetButton)
    // How many times round: once is start to finish, more is a circuit, from the finish back round by the start.
    const laps = document.createElement('label')
    laps.className = 'amount'
    this.lapsInput = wholeNumber(RACE_LAPS_MOST, () => this.render(), () => this.confirm())
    this.lapsInput.value = '1'
    laps.append(span('name', 'Laps'), this.lapsInput)
    this.course.append(laps, this.board.element, tools)

    this.note = document.createElement('p')
    this.note.className = 'status'

    const nav = document.createElement('div')
    nav.className = 'nav'
    this.setButton = button('Play', () => this.confirm())
    this.setButton.className = 'go'
    this.clearButton = button('Stop', () => {
      this.host.setGame(null)
      this.hide()
    })
    nav.append(this.setButton, this.clearButton, button('Close', () => this.hide()))

    panel.append(title, blurb, this.current, fieldset, this.amount, this.course, this.note, nav)
    root.append(panel)
  }

  get open(): boolean {
    return !this.root.hidden
  }

  show(): void {
    if (this.host.map() === null) return
    this.root.hidden = false
    // The globe turns to the race on, or else to the player.
    const facing = this.host.race()?.race.course[0] ?? this.marks[0] ?? this.host.position()
    if (facing !== null) this.board.face(facing)
    this.pick(this.host.game()?.kind ?? this.kind)
  }

  hide(): void {
    this.root.hidden = true
    // The keys drive the game again.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  toggle(): void {
    if (this.open) this.hide()
    else this.show()
  }

  /** Pick a kind of game: the count being played for as it is, or another as it starts out. */
  private pick(kind: GameKind): void {
    this.kind = kind
    const game = this.host.game()
    if (kind !== 'race') this.amountInput.value = String(game?.kind === kind ? game.target : GAME_DEFAULTS[kind])
    this.render()
  }

  /** The number asked for, if it is one that can be played for. */
  private target(): number | null {
    return wholeIn(this.amountInput, GAME_TARGET_MOST)
  }

  /**
   * The race asked for, made just as the server will take it, or `null`
   * where it cannot be played: with its marks rounded as the wire rounds
   * them, what passes here passes there.
   */
  private raceRequest(): GameRequest | null {
    const map = this.host.map()
    if (map === null) return null
    const laps = wholeIn(this.lapsInput, RACE_LAPS_MOST)
    if (laps === null) return null
    const course = this.marks.map(({ x, y, z }) => ({ x: Math.fround(x), y: Math.fround(y), z: Math.fround(z) }))
    return validGame({ kind: 'race', target: laps, course }, map.radius)
  }

  private pickMark(mark: Vec3): void {
    const map = this.host.map()
    if (map === null || this.host.race() !== null) return
    const last = this.marks.at(-1)
    if (!onLand(map, mark)) this.refused = 'Pick a spot on land.'
    else if (this.marks.length >= RACE_MARKS_MOST) this.refused = `A race has at most ${RACE_MARKS_MOST} marks.`
    else if (last !== undefined && apartOnGround(last, mark, map.radius) < RACE_LEG_LEAST)
      this.refused = `Each mark must be at least ${RACE_LEG_LEAST} m from the one before it.`
    else {
      this.marks.push(mark)
      this.refused = ''
    }
    this.render()
  }

  private confirm(): void {
    if (this.kind === 'race') {
      const request = this.raceRequest()
      if (request === null || this.host.race() !== null) return
      this.host.setGame(request)
      this.marks = []
    } else {
      const target = this.target()
      if (target === null) return
      this.host.setGame({ kind: this.kind, target, course: [] })
    }
    this.hide()
  }

  private render(): void {
    for (const kind of GAME_KINDS) this.cards[kind].setAttribute('aria-pressed', String(kind === this.kind))
    const game = this.host.game()
    const on = this.host.race()
    const playing = [
      ...(game === null ? [] : [`Playing for: ${describeGame(game)}`]),
      ...(on === null ? [] : [on.mine ? 'Your race is on.' : 'A race is on.']),
    ]
    this.current.textContent = playing.length === 0 ? 'No game: free play.' : playing.join(' ')
    this.clearButton.hidden = game === null && on?.mine !== true
    const race = this.kind === 'race'
    this.amount.hidden = race
    this.course.hidden = !race
    this.setButton.textContent = race ? 'Start race' : 'Play'
    if (race) {
      this.drawBoard()
      this.undoButton.disabled = this.marks.length === 0 || on !== null
      this.resetButton.disabled = this.marks.length === 0 || on !== null
      this.lapsInput.disabled = on !== null
      if (on !== null) this.lapsInput.value = String(on.race.laps)
      this.note.textContent =
        on !== null
          ? 'One race at a time: wait for this one to be won or called off.'
          : wholeIn(this.lapsInput, RACE_LAPS_MOST) === null
            ? `Laps: a whole number from 1 to ${RACE_LAPS_MOST}.`
            : this.refused || this.courseNote()
      this.setButton.disabled = on !== null || this.raceRequest() === null
    } else {
      this.note.textContent = this.target() === null ? `A whole number from 1 to ${GAME_TARGET_MOST}.` : ''
      this.setButton.disabled = this.target() === null
    }
  }

  /** What to pick next for the course. */
  private courseNote(): string {
    if (this.marks.length === 0) return 'Click the globe to place the start. Drag to turn it, scroll to zoom.'
    if (this.marks.length === 1) return 'Now a checkpoint, at least one.'
    if (this.marks.length === 2) return 'Now the finish, or more checkpoints before it.'
    const laps = wholeIn(this.lapsInput, RACE_LAPS_MOST) ?? 1
    const round = laps === 1 ? '' : ` Each of the ${laps} laps runs from the finish back round by the start.`
    return `The last mark is the finish.${round} Everyone on the island is put on the start when the race begins.`
  }

  /** The island, the player on it, and the course: the one on, or the one being picked. */
  private drawBoard(): void {
    const map = this.host.map()
    if (map === null) return
    const on = this.host.race()?.race
    const course = on?.course ?? this.marks
    const laps = on?.laps ?? wholeIn(this.lapsInput, RACE_LAPS_MOST) ?? 1
    this.board.draw(map, {
      closed: laps > 1,
      course: course.map((at, k) => {
        const finish = k === course.length - 1 && course.length >= 3
        return {
          at,
          color: k === 0 ? START_COLOR : finish ? FINISH_COLOR : CHECKPOINT_COLOR,
          label: k === 0 ? 'S' : finish ? 'F' : String(k),
        }
      }),
      here: this.host.position(),
    })
  }
}

/** A count, said in a few words. */
export function describeGame(game: Game): string {
  if (game.kind === 'score') return `collect ${game.target} ${game.target === 1 ? 'banana' : 'bananas'}`
  if (game.kind === 'kills') return `wreck ${game.target} ${game.target === 1 ? 'car' : 'cars'}`
  return `bring down ${game.target} ${game.target === 1 ? 'robot' : 'robots'}`
}
