import type { GameStatus, GameSummary } from '@buggies/net'
import { WORLD_TRAITS, planetSeedOf } from '@buggies/terrain'

import { button, element, setClass, setHidden, writeAttribute, writeText } from './dom.ts'

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

/** An island's picture painted into a card's own little canvas, twice its size on the page for sharpness. */
function paintThumbnail(canvas: HTMLCanvasElement, picture: HTMLCanvasElement): void {
  canvas.width = picture.width
  canvas.height = picture.height
  const context = canvas.getContext('2d')
  if (context !== null) context.drawImage(picture, 0, 0)
}

/** What a card's game offers to do with it, which is what its one button does. */
type CardAction = 'none' | 'join' | 'watch'

/**
 * One game's card on the start screen: the world it is played on drawn
 * beside it, what the game is and who is in it, and the one button that
 * joins it or looks on at it. It is shown every frame the screen is up, so
 * it keeps what it says and writes only what has changed.
 */
class GameEntry {
  readonly element = element('div', 'entry')
  private readonly placeholder = element('span', 'thumb')
  private readonly picture = element('canvas', 'thumb')
  private readonly name = element('span', 'name')
  private readonly note = element('p', 'note')
  private readonly top = element('div', 'entry-top')
  private action: HTMLButtonElement | null = null
  private actionKind: CardAction = 'none'
  private shownThumbnail: HTMLCanvasElement | null = null
  /** What the card was last told of its game, to tell whether it says what the game says now. */
  private readonly shown = { seed: Number.NaN, mode: '', status: '', host: '', humans: Number.NaN, slots: Number.NaN, watching: false }

  constructor(private readonly host: StartHost) {
    this.picture.hidden = true
    this.top.append(this.name)
    this.element.append(this.placeholder, this.picture, this.top, this.note)
  }

  /** Whether the card already says what this game is now, watched as it is. */
  sameAs(game: GameSummary, watching: number, picture: HTMLCanvasElement | null): boolean {
    const shown = this.shown
    return (
      shown.seed === game.seed &&
      shown.mode === game.mode &&
      shown.status === game.status &&
      shown.host === game.host &&
      shown.humans === game.humans &&
      shown.slots === game.slots &&
      shown.watching === (watching === game.id) &&
      this.shownThumbnail === picture
    )
  }

  /** Say what this game is now, on its card. */
  show(game: GameSummary, watching: number): void {
    const card = describeGame(game)
    writeText(this.name, card.world)
    writeText(this.note, `${card.mode} · ${card.host} · ${card.players} · ${card.status}`)
    setClass(this.element, 'watched', watching === game.id)
    this.showAction(game, watching)
    this.showThumbnail(this.host.picture(game))
    const shown = this.shown
    shown.seed = game.seed
    shown.mode = game.mode
    shown.status = game.status
    shown.host = game.host
    shown.humans = game.humans
    shown.slots = game.slots
    shown.watching = watching === game.id
  }

  /** The one button, which joins the game, watches it, or is not there at all. */
  private showAction(game: GameSummary, watching: number): void {
    const kind: CardAction = this.host.watchable(game) ? 'watch' : game.status === 'open' ? 'join' : 'none'
    if (kind !== this.actionKind) {
      this.actionKind = kind
      this.action?.remove()
      this.action = kind === 'none' ? null : button(kind === 'watch' ? 'Watch' : 'Join')
      if (this.action !== null) {
        const action = this.action
        if (kind === 'watch') action.addEventListener('click', () => this.host.watch(game.id))
        else action.addEventListener('click', () => this.host.join(game.id))
        this.top.append(action)
      }
    }
    if (this.action === null) return
    if (kind === 'watch') {
      // A race under way takes nobody: it is watched, and it plays on behind the screen while it is.
      writeAttribute(this.action, 'aria-pressed', String(watching === game.id))
      return
    }
    const open = this.host.joinable(game)
    if (this.action.disabled !== !open) this.action.disabled = !open
  }

  /** The world's picture, into the card's own canvas: a blank card until it has been drawn. */
  private showThumbnail(thumbnail: HTMLCanvasElement | null): void {
    if (thumbnail === this.shownThumbnail) return
    this.shownThumbnail = thumbnail
    if (thumbnail !== null) paintThumbnail(this.picture, thumbnail)
    setHidden(this.picture, thumbnail === null)
    setHidden(this.placeholder, thumbnail !== null)
  }
}

/**
 * The screen every player comes back to: the games on the server as they
 * happen, each with the world it is played on drawn beside it, and one
 * button above them to make a race of one's own. A race under way is not
 * joined but watched, and whichever is watched plays on behind the screen:
 * the server's demo until one is picked. Whatever a game is doing, it is
 * shown; only the ones that may be joined have a Join to press.
 *
 * The screen is asked every frame whether it is what the server last said,
 * a game at a time, and only a game that has changed is written to the page.
 */
export class StartScreen {
  private readonly host: StartHost
  private readonly panel = element('div', 'panel')
  private readonly lobby = element('div', 'lobby')
  private readonly empty = element('p', 'list-empty', 'No games yet: host one.')
  private readonly as = element('p', 'status')
  private readonly warning = element('p', 'warning')
  private readonly entries = new Map<number, GameEntry>()
  /** The games on the screen, in the order they are on it, and the name they are playing as. */
  private shownOrder: readonly number[] = []
  private shownName = ''

  constructor(root: HTMLElement, host: StartHost) {
    this.host = host
    this.panel.hidden = true
    this.warning.hidden = true

    const heading = element('h1', '', 'Play')
    const hosting = button('Host a game', 'host')
    hosting.append(element('span', 'note', 'A race through several worlds, or the room’s switch makes it a free drive.'))
    hosting.addEventListener('click', () => this.host.host())
    const change = button('Change name')
    change.addEventListener('click', () => this.host.changeName())
    const nav = element('div', 'nav')
    nav.append(change)

    this.lobby.append(this.empty)
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
   * one: called every frame, writing nothing until something has changed.
   */
  update(): void {
    if (this.panel.hidden) return
    if (this.stale()) this.render()
  }

  /** Why nothing could be joined, kept in view until the player moves on. */
  warn(text: string): void {
    writeText(this.warning, text)
    setHidden(this.warning, text === '')
  }

  /** Whether any card on the screen is not what the server last said of its game. */
  private stale(): boolean {
    if (this.host.name() !== this.shownName) return true
    const watching = this.host.watching()
    let seen = 0
    for (const game of this.host.games()) {
      if (game.demo) continue
      if (this.shownOrder[seen] !== game.id) return true
      const entry = this.entries.get(game.id)
      if (entry === undefined || !entry.sameAs(game, watching, this.host.picture(game))) return true
      seen += 1
    }
    return seen !== this.shownOrder.length
  }

  /** Write the games onto their cards: one card a game, kept from frame to frame and from lobby message to lobby message. */
  private render(): void {
    const watching = this.host.watching()
    this.shownName = this.host.name()
    writeText(this.as, `Playing as ${this.shownName}`)
    const order: number[] = []
    for (const game of this.host.games()) {
      if (game.demo) continue
      let entry = this.entries.get(game.id)
      if (entry === undefined) {
        entry = new GameEntry(this.host)
        this.entries.set(game.id, entry)
      }
      entry.show(game, watching)
      order.push(game.id)
    }
    const kept = new Set(order)
    for (const [id, entry] of this.entries) {
      if (kept.has(id)) continue
      this.entries.delete(id)
      entry.element.remove()
    }
    this.arrange(order)
    this.shownOrder = order
  }

  /** The cards in the order the games are in, the word on there being none at the end of them. */
  private arrange(order: readonly number[]): void {
    setHidden(this.empty, order.length !== 0)
    for (const [index, id] of order.entries()) {
      const entry = this.entries.get(id)!
      if (this.lobby.children[index] !== entry.element) this.lobby.insertBefore(entry.element, this.lobby.children[index] ?? null)
    }
  }
}
