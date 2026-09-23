import { VEHICLE_PROFILE_IDS, VEHICLE_PROFILE_LABELS, type VehicleProfileId } from '@buggies/game'
import type { RoomSummary } from '@buggies/net'

import { modelCredits } from './car-model.ts'

/** How many are playing on this screen. */
export type Mode = 'solo' | 'duo'

/** The wizard's pages, in the order they come. */
export type Step = 'mode' | 'map' | 'car' | 'car2'

/** What the player has chosen. Everything the app needs to join the server. */
export interface Choice {
  mode: Mode
  /** Which island: the server has a room for each. */
  seed: number
  vehicle: VehicleProfileId
  /** The second driver's, on a split screen. */
  vehicle2: VehicleProfileId
}

/** What the wizard asks of the app as the player goes through it. */
export interface MenuHost {
  /**
   * Put the island with this seed behind the panel, to be looked over. It
   * resolves to a line about the island once it is made; an empty one if
   * something else was asked for in the meantime.
   */
  showIsland(seed: number): Promise<string>
  /** Which islands have people on them, busiest first; none if the server cannot say. */
  listRooms(): Promise<RoomSummary[]>
  /** Put this vehicle behind the panel, turning on the spot. */
  showVehicle(vehicle: VehicleProfileId): void
  /** Set off. */
  start(choice: Choice): void
}

const MODE_NOTES: Record<Mode, { name: string; note: string }> = {
  solo: {
    name: '1 player',
    note: 'Pick a seed and drive with other people on the island.',
  },
  duo: {
    name: '2 players',
    note: 'Split screen mode lets two people drive at once, with one keyboard, same island.',
  },
}

/** How many of the busiest islands the island page offers. */
export const POPULAR_ISLANDS = 4

const STEP_NAMES: Record<Step, string> = {
  mode: 'Players',
  map: 'Island',
  car: 'Vehicle',
  car2: 'Vehicle 2',
}

const VEHICLE_NOTES: Record<VehicleProfileId, string> = {
  raceCar: 'Fast and unforgiving. Spins out if you ask too much.',
  police: 'A sedan with some shove. Takes a knock.',
  firetruck: 'Seven tonnes with the engine to climb anything. Slowly.',
  pickup: 'Heavy and slow to turn. Slides rather than rolls.',
  sportsCar: 'The balanced one. Start here.',
  smallCar: 'Tiny and nimble. Not quick.',
  tank: 'Nothing moves it off its line, and nothing hurts it much.',
  ambulance: 'A tall van, loaded. Steady if you let it be.',
  semi: 'The tractor unit, bobtail. Slow to turn, slower to stop.',
  goKart: 'An inch off the road. Turns on a coin, breaks if you look at it.',
}

/** The pages a mode goes through: two players have two vehicles to pick. */
export function stepsFor(mode: Mode): readonly Step[] {
  return mode === 'duo' ? ['mode', 'map', 'car', 'car2'] : ['mode', 'map', 'car']
}

/** Which of the choices a vehicle page is picking. */
function vehicleKey(step: Step): 'vehicle' | 'vehicle2' {
  return step === 'car2' ? 'vehicle2' : 'vehicle'
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

function card(name: string, note: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.append(span('name', name), span('note', note))
  return button
}

function group(label: string): [HTMLFieldSetElement, HTMLDivElement, HTMLLegendElement] {
  const fieldset = document.createElement('fieldset')
  const legend = document.createElement('legend')
  legend.textContent = label
  const cards = document.createElement('div')
  cards.className = 'cards'
  fieldset.append(legend, cards)
  return [fieldset, cards, legend]
}

/** A text field that keeps its keystrokes to itself: the game is listening too. */
function field(label: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.setAttribute('aria-label', label)
  input.addEventListener('keydown', (event) => event.stopPropagation())
  return input
}

function line(className: string): HTMLParagraphElement {
  const paragraph = document.createElement('p')
  paragraph.className = className
  return paragraph
}

function randomSeed(): number {
  return Math.floor(Math.random() * 100000)
}

function driving(players: number): string {
  return players === 1 ? '1 driving' : `${players} driving`
}

/**
 * The one place a player picks anything, a page at a time: how many are
 * playing, then which island (looked over from above while it is chosen),
 * then which vehicle each drives, turning on the spot beside the panel. It
 * is reachable from the game, so any of it can be changed without going
 * back to the start.
 */
export class Menu {
  private readonly root: HTMLElement
  private readonly host: MenuHost
  private readonly steps = document.createElement('ol')
  private readonly status = line('status')
  private readonly back = document.createElement('button')
  private readonly next = document.createElement('button')
  private readonly seedField = field('Island seed')
  private readonly popular: HTMLFieldSetElement
  private readonly popularCards: HTMLDivElement
  private readonly popularButtons = new Map<number, HTMLButtonElement>()
  private readonly modeButtons = new Map<Mode, HTMLButtonElement>()
  private readonly vehicleButtons = new Map<VehicleProfileId, HTMLButtonElement>()
  private readonly pages: Record<Step, HTMLElement>
  private readonly vehicleLegend: HTMLLegendElement
  private choice: Choice
  private step: Step = 'mode'
  /** Each island asked for outranks the one before: a slow one that lands late is let go. */
  private islands = 0
  /** Whether the island asked for last is still being made: there is no moving on until it is. */
  private generating = false
  /** Each asking after the busy islands outranks the one before. */
  private listings = 0

  constructor(root: HTMLElement, choice: Choice, host: MenuHost) {
    this.root = root
    this.host = host
    this.choice = { ...choice }

    const panel = document.createElement('div')
    panel.className = 'panel'

    const title = document.createElement('h1')
    title.textContent = 'Buggies'
    const blurb = line('blurb')
    blurb.textContent = 'Enjoy driving around a low-poly procedurally generated island.'
    this.steps.className = 'steps'

    // Page one: how many are playing.
    const [modeGroup, modeCards] = group('Players')
    for (const mode of ['solo', 'duo'] as const) {
      const button = card(MODE_NOTES[mode].name, MODE_NOTES[mode].note)
      button.addEventListener('click', () => this.pick({ mode }))
      this.modeButtons.set(mode, button)
      modeCards.append(button)
    }
    const modePage = document.createElement('div')
    modePage.append(modeGroup)

    // Page two: the island, made afresh whenever the seed changes, and
    // looked over from above meanwhile. Everyone on the same seed shares it.
    const [mapGroup, mapRow] = group('Island seed')
    mapRow.className = 'map'
    this.seedField.inputMode = 'numeric'
    this.seedField.addEventListener('change', () => void this.generate())
    const shuffle = document.createElement('button')
    shuffle.type = 'button'
    shuffle.textContent = 'Random'
    shuffle.addEventListener('click', () => {
      this.seedField.value = String(randomSeed())
      void this.generate()
    })
    mapRow.append(this.seedField, shuffle)
    // The islands with people on them, a card each, for joining in.
    ;[this.popular, this.popularCards] = group('Popular islands')
    this.popular.hidden = true
    const mapPage = document.createElement('div')
    mapPage.append(mapGroup, this.popular)

    // Page three, and with two players four: the vehicle, turning on the
    // spot beside the panel. One page serves both drivers in turn.
    const [vehicleGroup, vehicleCards, vehicleLegend] = group('Vehicle')
    this.vehicleLegend = vehicleLegend
    for (const vehicle of VEHICLE_PROFILE_IDS) {
      const button = card(VEHICLE_PROFILE_LABELS[vehicle], VEHICLE_NOTES[vehicle])
      button.addEventListener('click', () => {
        this.pick({ [vehicleKey(this.step)]: vehicle })
        this.host.showVehicle(vehicle)
      })
      this.vehicleButtons.set(vehicle, button)
      vehicleCards.append(button)
    }
    const carPage = document.createElement('div')
    carPage.append(vehicleGroup)

    this.pages = { mode: modePage, map: mapPage, car: carPage, car2: carPage }

    const nav = document.createElement('div')
    nav.className = 'nav'
    this.back.type = 'button'
    this.back.textContent = 'Back'
    this.back.addEventListener('click', () => this.advance(-1))
    this.next.type = 'button'
    this.next.className = 'go'
    this.next.addEventListener('click', () => this.advance(1))
    nav.append(this.back, this.next)

    const keys = line('keys')
    keys.innerHTML =
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to drive &nbsp; ' +
      '<kbd>Space</kbd> handbrake<br />' +
      '<kbd>Enter</kbd> back to the road &nbsp; <kbd>M</kbd> mute &nbsp; <kbd>Esc</kbd> this menu'

    // Whose models the vehicles are. One of them asks to be credited, and
    // the rest deserve it.
    const credits = line('keys')
    credits.append('Vehicles: ')
    modelCredits().forEach((credit, index) => {
      if (index > 0) credits.append(' · ')
      const model = document.createElement('a')
      model.href = credit.url
      model.target = '_blank'
      model.rel = 'noopener'
      model.textContent = `${credit.title} by ${credit.author}`
      const licence = document.createElement('a')
      licence.href = credit.licenceUrl
      licence.target = '_blank'
      licence.rel = 'noopener'
      licence.textContent = credit.licence
      credits.append(model, ' (', licence, ')')
    })

    panel.append(title, blurb, this.steps, modePage, mapPage, carPage, this.status, nav, keys, credits)
    // Enter moves on, unless it is pressing a button, which does its own thing.
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) this.advance(1)
    })
    this.root.append(panel)
    this.render()
  }

  get open(): boolean {
    return !this.root.hidden
  }

  /** Open at a page, the first as a rule, with these choices made already. */
  show(choice: Choice, step: Step = 'mode'): void {
    this.choice = { ...choice }
    this.root.hidden = false
    this.goTo(step)
  }

  hide(): void {
    this.root.hidden = true
  }

  /**
   * Something the player should know, shown until they move on: why the
   * server could not be joined, or, with `busy`, what is being waited for.
   */
  notice(text: string, busy = false): void {
    this.status.textContent = text
    this.status.classList.toggle('busy', busy)
  }

  private pick(change: Partial<Choice>): void {
    this.choice = { ...this.choice, ...change }
    this.render()
  }

  /** Turn to a page, and put behind the panel what the page is about. */
  private goTo(step: Step): void {
    this.step = step
    this.notice('')
    this.render()
    if (step === 'map') {
      void this.generate()
      void this.listPopular()
    }
    if (step === 'car' || step === 'car2') this.host.showVehicle(this.choice[vehicleKey(step)])
  }

  /** A page on, or back; on from the last page is setting off. */
  private advance(delta: 1 | -1): void {
    if (delta === 1 && this.next.disabled) return
    const steps = stepsFor(this.choice.mode)
    const to = steps[steps.indexOf(this.step) + delta]
    if (to !== undefined) {
      this.goTo(to)
      return
    }
    if (delta === 1) {
      this.hide()
      this.host.start({ ...this.choice })
    }
  }

  /** Make the island the seed field asks for, or one at random, and say what came of it. */
  private async generate(): Promise<void> {
    const typed = Number(this.seedField.value.trim())
    const seed = Number.isFinite(typed) && typed !== 0 ? Math.floor(Math.abs(typed)) : randomSeed()
    this.choice.seed = seed
    this.seedField.value = String(seed)
    const stamp = ++this.islands
    this.generating = true
    this.notice(`generating island ${seed}...`, true)
    this.render()
    const about = await this.host.showIsland(seed)
    if (stamp !== this.islands) return
    this.generating = false
    if (this.step === 'map') this.notice(about)
    this.render()
  }

  /** Ask which islands are busy, and offer the busiest few; the cards go when there are none. */
  private async listPopular(): Promise<void> {
    const stamp = ++this.listings
    const rooms = await this.host.listRooms()
    if (stamp !== this.listings) return
    this.popularButtons.clear()
    this.popularCards.replaceChildren()
    for (const room of rooms.slice(0, POPULAR_ISLANDS)) {
      const button = card(`Island ${room.seed}`, driving(room.players))
      button.addEventListener('click', () => {
        this.seedField.value = String(room.seed)
        void this.generate()
      })
      this.popularButtons.set(room.seed, button)
      this.popularCards.append(button)
    }
    this.popular.hidden = this.popularButtons.size === 0
    this.render()
  }

  private render(): void {
    const steps = stepsFor(this.choice.mode)
    const duo = this.choice.mode === 'duo'
    this.steps.replaceChildren(
      ...steps.map((step) => {
        const item = document.createElement('li')
        item.textContent = step === 'car' && duo ? 'Vehicle 1' : STEP_NAMES[step]
        if (step === this.step) item.setAttribute('aria-current', 'step')
        else if (steps.indexOf(step) < steps.indexOf(this.step)) item.className = 'done'
        return item
      }),
    )
    for (const page of new Set(Object.values(this.pages))) page.hidden = page !== this.pages[this.step]
    if (document.activeElement !== this.seedField) this.seedField.value = String(this.choice.seed)
    this.vehicleLegend.textContent = duo ? (this.step === 'car2' ? 'Vehicle 2: the arrows' : 'Vehicle 1: the letters') : 'Vehicle'
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute('aria-pressed', String(mode === this.choice.mode))
    }
    const picking = this.choice[vehicleKey(this.step)]
    for (const [vehicle, button] of this.vehicleButtons) {
      button.setAttribute('aria-pressed', String(vehicle === picking))
    }
    for (const [seed, button] of this.popularButtons) {
      button.setAttribute('aria-pressed', String(seed === this.choice.seed))
    }
    this.back.hidden = this.step === steps[0]
    this.next.disabled = this.step === 'map' && this.generating
    this.next.textContent = this.step === steps[steps.length - 1] ? 'Play' : 'Next'
  }
}
