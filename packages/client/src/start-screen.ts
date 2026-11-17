import type { GameStatus, GameSummary } from '@buggies/net'
import { WORLD_TRAITS, planetSeedOf } from '@buggies/terrain'

/** How wide an island's thumbnail is drawn, in pixels: twice its height, as pictures are. */
export const THUMB_PIXELS = 256

/** What the start screen asks of the app. */
export interface StartHost {
  /** Every game on the server, as it last looked: live, never polled for. */
  games(): readonly GameSummary[]
  /** The world's thumbnail, or nothing yet while it is being drawn. */
  picture(game: GameSummary): HTMLCanvasElement | null
  join(game: number): void
  /** Look on at this race behind the screens, or at the demo again if it is the one already watched. */
  watch(game: number): void
  /** The game playing behind the screens: `0` for the server's demo, which is what is watched until a race is picked. */
  watching(): number
  /** Make a race of one's own, and go into its room. */
  host(): void
  name(): string
  changeName(): void
  /** Whether a game may be joined at all, by its state and its seats. */
  joinable(game: GameSummary): boolean
  /** Whether a game is a race under way, to be looked on at as it happens. */
  watchable(game: GameSummary): boolean
}

/** A game as its card on the start screen says it. */
export interface GameCard {
  /** The world it is played on: `seed 12 · the island`. */
  world: string
  /** `Race` or `Free drive`. */
  mode: string
  /** `hosted by Ada`. */
  host: string
  /** `3 / 8`. */
  players: string
  /** `waiting`, `preparing the course`, `starting`, `under way` or `finished`. */
  status: string
}

/** How a game's state reads on its card. */
export function statusLabel(status: GameStatus): string {
  switch (status) {
    case 'open':
      return 'waiting'
    case 'preparing':
      return 'preparing the course'
    case 'starting':
      return 'starting'
    case 'racing':
      return 'under way'
    case 'finished':
      return 'finished'
  }
}

/** Whether a game may be joined: one still waiting, with a bot's slot left in it for a player. */
export function joinable(game: GameSummary): boolean {
  return game.status === 'open' && game.humans < game.slots
}

/** Whether a game is a race under way, which anyone may look on at: one starting or racing. */
export function watchable(game: GameSummary): boolean {
  return game.mode === 'race' && (game.status === 'starting' || game.status === 'racing')
}

/** A game's card, from what the server said of it. */
export function describeGame(game: GameSummary): GameCard {
  return {
    world: `seed ${planetSeedOf(game.seed)} · ${WORLD_TRAITS.planet.name}`,
    mode: game.mode === 'race' ? 'Race' : 'Free drive',
    host: game.host === '' ? 'nobody hosts it' : `hosted by ${game.host}`,
    players: `${game.humans} / ${game.slots}`,
    status: statusLabel(game.status),
  }
}

function span(className: string, text = ''): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

function line(className: string, text = ''): HTMLParagraphElement {
  const paragraph = document.createElement('p')
  paragraph.className = className
  paragraph.textContent = text
  return paragraph
}

function button(text: string, className = ''): HTMLButtonElement {
  const made = document.createElement('button')
  made.type = 'button'
  made.className = className
  made.textContent = text
  return made
}

/** An island's picture painted into the card's own little canvas, twice its size on the page for sharpness. */
function thumbnail(picture: HTMLCanvasElement | null): HTMLElement {
  if (picture === null) return span('thumb')
  const canvas = document.createElement('canvas')
  canvas.className = 'thumb'
  canvas.width = picture.width
  canvas.height = picture.height
  const context = canvas.getContext('2d')
  if (context === null) return canvas
  context.drawImage(picture, 0, 0)
  return canvas
}

/**
 * The screen every player comes back to: the games on the server as they
 * happen, each with the world it is played on drawn beside it, and one
 * button above them to make a race of one's own. A race under way is not
 * joined but watched, and whichever is watched plays on behind the screen:
 * the server's demo until one is picked. Whatever a game is doing, it is
 * shown; only the ones that may be joined have a Join to press.
 */
export class StartScreen {
  private readonly host: StartHost
  private readonly panel: HTMLElement
  private readonly lobby: HTMLElement
  private readonly as: HTMLParagraphElement
  private readonly warning: HTMLParagraphElement
  private readonly change: HTMLButtonElement
  private signature = ''

  constructor(root: HTMLElement, host: StartHost) {
    this.host = host
    this.panel = document.createElement('div')
    this.panel.className = 'panel'
    this.panel.hidden = true

    const heading = document.createElement('h1')
    heading.textContent = 'Play'
    this.as = line('status')
    this.warning = line('warning')
    this.warning.hidden = true
    this.lobby = document.createElement('div')
    this.lobby.className = 'lobby'

    const hosting = button('Host a game', 'host')
    hosting.append(span('note', 'A race through several worlds, or the room’s switch makes it a free drive.'))
    hosting.addEventListener('click', () => this.host.host())

    this.change = button('Change name')
    this.change.addEventListener('click', () => this.host.changeName())
    const nav = document.createElement('div')
    nav.className = 'nav'
    nav.append(this.change)

    this.panel.append(heading, this.as, this.warning, hosting, this.lobby, nav)
    root.append(this.panel)
  }

  /** Whether the screen is up. */
  open(): boolean {
    return !this.panel.hidden
  }

  show(): void {
    this.warn('')
    this.panel.hidden = false
    this.render()
  }

  hide(): void {
    this.panel.hidden = true
  }

  /**
   * Put up the games as they are now, and a thumbnail for each that has
   * one: called every frame, doing nothing until something has changed.
   */
  update(): void {
    if (this.panel.hidden) return
    if (this.signatureOf() !== this.signature) this.render()
  }

  /** Why nothing could be joined, kept in view until the player moves on. */
  warn(text: string): void {
    this.warning.textContent = text
    this.warning.hidden = text === ''
  }

  /** What the screen shows, in as much as tells it whether anything on it has changed. */
  private signatureOf(): string {
    return this.host
      .games()
      .filter((game) => !game.demo)
      .map((game) => `${game.id}:${game.humans}:${game.slots}:${game.status}:${this.host.joinable(game) ? 1 : 0}:${this.host.picture(game) === null ? 0 : 1}`)
      .concat(`${this.host.watching()}`)
      .join('|')
  }

  private render(): void {
    const games = this.host.games().filter((game) => !game.demo)
    const watching = this.host.watching()
    this.signature = this.signatureOf()
    this.as.textContent = `Playing as ${this.host.name()}`
    this.lobby.replaceChildren()
    if (games.length === 0) {
      this.lobby.append(line('list-empty', 'No games yet: host one.'))
      return
    }
    for (const game of games) {
      const card = describeGame(game)
      const entry = document.createElement('div')
      entry.className = watching === game.id ? 'entry watched' : 'entry'
      const top = document.createElement('div')
      top.className = 'entry-top'
      top.append(span('name', card.world))
      // A race under way takes nobody: it is watched, and it plays on behind the screen while it is.
      const watch = this.host.watchable(game)
      if (watch || game.status === 'open') {
        const action = button(watch ? 'Watch' : 'Join')
        if (watch) {
          action.setAttribute('aria-pressed', String(watching === game.id))
          action.addEventListener('click', () => this.host.watch(game.id))
        } else {
          action.disabled = !this.host.joinable(game)
          action.addEventListener('click', () => this.host.join(game.id))
        }
        top.append(action)
      }
      entry.append(thumbnail(this.host.picture(game)), top, line('note', `${card.mode} · ${card.host} · ${card.players} · ${card.status}`))
      this.lobby.append(entry)
    }
  }
}
