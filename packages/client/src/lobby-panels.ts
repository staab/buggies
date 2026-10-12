import { FIXED_TIMESTEP, GAME_LABELS, VEHICLE_PROFILE_LABELS, sameGame, type Game, type GameRequest } from '@buggies/game'
import type { PendingGame } from '@buggies/net'

import { seatColor } from './car-view.ts'
import { describeGame } from './game-menu.ts'
import type { Lobby, LobbyPlayer } from './mode.ts'

/** What the lists by the trophy need of the game behind them. */
export interface LobbyHost {
  /** Who is on the island and the games they play or wait to, or nothing when no game is on. */
  lobby(): Lobby | null
  /** Into the game waiting with this id, or out of whichever one the player is in. */
  joinGame(id: number | null): void
  /** Open the picker for a new game. */
  pickGame(): void
}

/** How often an open list looks again at who is on the island, in seconds. */
const REFRESH_SECONDS = 0.25

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  made.className = className
  made.textContent = text
  return made
}

function button(text: string, onClick: () => void, className = ''): HTMLButtonElement {
  const made = element('button', className, text)
  made.type = 'button'
  made.addEventListener('click', () => {
    onClick()
    // The keys drive the game, not the button, once it has been clicked.
    made.blur()
  })
  return made
}

/** Seconds as minutes and seconds: "1:05". */
function clockOf(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A game asked for, said in a few words. */
export function describeRequest(request: GameRequest): string {
  if (request.kind !== 'race') return describeGame({ kind: request.kind, target: request.target, from: 0, startTick: 0 })
  const checkpoints = request.course.length - 2
  const over = `${checkpoints} ${checkpoints === 1 ? 'checkpoint' : 'checkpoints'}`
  return request.target === 1 ? `race over ${over}` : `${request.target} laps over ${over}`
}

/** Names, joined into a line: "Ada, Bo and Cy". */
function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * A panel down the right of the screen, under the buttons in the corner,
 * that lists what is on the island and keeps up with it while it is open:
 * built again only when what it lists changes, so a button is not swapped
 * out from under a click, with its clocks run on in between.
 */
abstract class SidePanel {
  protected readonly host: LobbyHost
  private readonly root: HTMLElement
  protected readonly body = element('div', 'list')
  /** The clocks counting down in the list, each to the tick it reaches nought on. */
  protected clocks: { at: HTMLElement; tick: number }[] = []
  /** What the list was last built from. */
  private built = ''
  private since = 0

  constructor(root: HTMLElement, host: LobbyHost, title: string, blurb: string) {
    this.root = root
    this.host = host
    root.hidden = true
    const panel = element('div', 'panel side')
    const blurbLine = element('p', 'blurb', blurb)
    panel.append(element('h1', '', title), blurbLine, this.body)
    const nav = element('div', 'nav')
    this.decorate(nav)
    nav.append(button('Close', () => this.hide()))
    panel.append(nav)
    root.append(panel)
  }

  isOpen(): boolean {
    return !this.root.hidden
  }

  show(): void {
    if (this.host.lobby() === null) return
    this.root.hidden = false
    this.built = ''
    this.since = REFRESH_SECONDS
    this.update(0)
  }

  hide(): void {
    this.root.hidden = true
  }

  toggle(): void {
    if (this.isOpen()) this.hide()
    else this.show()
  }

  /** Once a frame: the list built again if what it lists has changed, and its clocks run on. */
  update(dt: number): void {
    if (!this.isOpen()) return
    this.since += dt
    if (this.since < REFRESH_SECONDS) return
    this.since = 0
    const lobby = this.host.lobby()
    if (lobby === null) {
      this.hide()
      return
    }
    const key = JSON.stringify({ ...lobby, tick: 0 })
    if (key !== this.built) {
      this.built = key
      this.clocks = []
      this.body.replaceChildren(...this.build(lobby))
    }
    for (const { at, tick } of this.clocks) at.textContent = clockOf(Math.max(Math.ceil((tick - lobby.tick) * FIXED_TIMESTEP), 0))
  }

  /** Buttons of its own for the foot of the panel, before Close. */
  protected decorate(_nav: HTMLElement): void {}

  protected abstract build(lobby: Lobby): HTMLElement[]

  /** A heading over a part of the list. */
  protected heading(text: string): HTMLElement {
    return element('h2', 'list-heading', text)
  }

  /** A line saying there is nothing to list. */
  protected empty(text: string): HTMLElement {
    return element('p', 'list-empty', text)
  }
}

/** The name a seat goes by in the list, "you" for the player's own. */
function nameIn(lobby: Lobby, seat: number): string {
  const name = lobby.players.find((player) => player.seat === seat)?.name ?? '?'
  return seat === lobby.seat ? `${name} (you)` : name
}

/**
 * The games on the island, opened from the trophy: those waiting for
 * players, each to be joined until its minute is up, when it starts for
 * everyone in it; those being played, and by whom; and a way to ask for a
 * new one, in the picker.
 */
export class GamesList extends SidePanel {
  constructor(root: HTMLElement, host: LobbyHost) {
    super(root, host, 'Games', 'Start a game, or join one waiting: everyone in it starts together when its minute is up.')
  }

  protected override decorate(nav: HTMLElement): void {
    nav.append(button('Start game', () => this.host.pickGame(), 'go'))
  }

  protected build(lobby: Lobby): HTMLElement[] {
    const waiting = lobby.waiting.map((game) => this.waitingCard(lobby, game))
    const playing = this.playing(lobby)
    return [
      this.heading('Waiting for players'),
      ...(waiting.length === 0 ? [this.empty('Nothing waiting. Start one, and everyone here gets a minute to join.')] : waiting),
      this.heading('Being played'),
      ...(playing.length === 0 ? [this.empty('Nothing being played: free play.')] : playing),
    ]
  }

  private waitingCard(lobby: Lobby, game: PendingGame): HTMLElement {
    const card = element('div', 'entry')
    const joined = game.joined.includes(lobby.seat)
    if (joined) card.classList.add('joined')
    const clock = element('span', 'clock')
    this.clocks.push({ at: clock, tick: game.startTick })
    const top = element('div', 'entry-top')
    top.append(element('span', 'name', `${GAME_LABELS[game.request.kind]}: ${describeRequest(game.request)}`), clock)
    const who = element('span', 'note', `Asked for by ${nameIn(lobby, game.host)} · in it: ${namesOf(game.joined.map((seat) => nameIn(lobby, seat)))}`)
    const act = joined ? button('Leave', () => this.host.joinGame(null)) : button('Join', () => this.host.joinGame(game.id), 'go')
    card.append(top, who, act)
    return card
  }

  /** The race on and the counts played, each with who plays it. */
  private playing(lobby: Lobby): HTMLElement[] {
    const entries: HTMLElement[] = []
    if (lobby.race !== null) {
      const racers = lobby.players.filter((player) => player.racing).map((player) => nameIn(lobby, player.seat))
      const laps = lobby.race.laps === 1 ? 'Race' : `Race, ${lobby.race.laps} laps`
      entries.push(this.playingEntry(laps, racers))
    }
    // A count played together is one game, set for all of them at once.
    const counts: { game: Game; players: LobbyPlayer[] }[] = []
    for (const player of lobby.players) {
      if (player.game === null) continue
      const together = counts.find((count) => sameGame(count.game, player.game!))
      if (together !== undefined) together.players.push(player)
      else counts.push({ game: player.game, players: [player] })
    }
    for (const { game, players } of counts) {
      entries.push(this.playingEntry(`${GAME_LABELS[game.kind]}: ${describeGame(game)}`, players.map((player) => nameIn(lobby, player.seat))))
    }
    return entries
  }

  private playingEntry(what: string, players: readonly string[]): HTMLElement {
    const entry = element('div', 'entry')
    entry.append(element('span', 'name', what), element('span', 'note', namesOf(players)))
    return entry
  }
}

/** Who is on the island, opened from the button beside the trophy: each by name, what they drive, their gems and bananas, and what they play. */
export class PlayersList extends SidePanel {
  constructor(root: HTMLElement, host: LobbyHost) {
    super(root, host, 'Players', 'Everyone driving on this island.')
  }

  protected build(lobby: Lobby): HTMLElement[] {
    const players = [...lobby.players].sort((a, b) => b.gems - a.gems || b.score - a.score || a.seat - b.seat)
    if (players.length === 0) return [this.empty('Nobody here yet.')]
    return [
      this.heading(`${players.length} on island ${lobby.seed}`),
      ...players.map((player) => {
        const entry = element('div', 'entry player')
        if (player.seat === lobby.seat) entry.classList.add('joined')
        const swatch = element('span', 'swatch')
        swatch.style.background = `#${seatColor(player.seat).toString(16).padStart(6, '0')}`
        const top = element('div', 'entry-top')
        top.append(swatch, element('span', 'name', nameIn(lobby, player.seat)), element('span', 'clock', `${player.gems} ${player.gems === 1 ? 'gem' : 'gems'} · ${player.score} ${player.score === 1 ? 'banana' : 'bananas'}`))
        const doing = [
          VEHICLE_PROFILE_LABELS[player.profile],
          ...(player.racing ? ['racing'] : []),
          ...(player.game === null ? [] : [`playing for: ${describeGame(player.game)}`]),
        ]
        entry.append(top, element('span', 'note', doing.join(' · ')))
        return entry
      }),
    ]
  }
}
