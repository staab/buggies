import { VEHICLE_PROFILE_IDS, VEHICLE_PROFILE_LABELS, type VehicleProfileId } from '@buggies/game'

import { modelCredits } from './car-model.ts'

export type Mode = 'drive' | 'split' | 'online'

/** The wizard's pages, in the order they come. */
export type Step = 'mode' | 'map' | 'car' | 'car2'

/** What the player has chosen. Everything the app needs to build a session. */
export interface Choice {
  mode: Mode
  seed: number
  vehicle: VehicleProfileId
  /** The second driver's, on a split screen. */
  vehicle2: VehicleProfileId
  server: string
}

/** What the wizard asks of the app as the player goes through it. */
export interface MenuHost {
  /**
   * Put the island with this seed behind the panel, to be looked over. It
   * resolves to a line about the island once it is made; an empty one if
   * something else was asked for in the meantime.
   */
  showIsland(seed: number): Promise<string>
  /** Put this vehicle behind the panel, turning on the spot. */
  showVehicle(vehicle: VehicleProfileId): void
  /** Set off. */
  start(choice: Choice): void
}

const MODE_NOTES: Record<Mode, { name: string; note: string; go: string }> = {
  drive: {
    name: 'Free drive',
    note: 'Take a vehicle out on an island of your choosing.',
    go: 'Drive',
  },
  split: {
    name: 'Split screen',
    note: 'Two of you on one keyboard: the letters on the left, the arrows on the right.',
    go: 'Drive',
  },
  online: {
    name: 'Online',
    note: 'Join a server and share its island with whoever else is on it.',
    go: 'Connect',
  },
}

const STEP_NAMES: Record<Step, string> = {
  mode: 'Mode',
  map: 'Map',
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

/** The pages a mode goes through: online, the server picks the map; split, there are two vehicles to pick. */
export function stepsFor(mode: Mode): readonly Step[] {
  if (mode === 'online') return ['mode', 'car']
  if (mode === 'split') return ['mode', 'map', 'car', 'car2']
  return ['mode', 'map', 'car']
}

/** Which of the choices a vehicle page is picking. */
function vehicleKey(step: Step): 'vehicle' | 'vehicle2' {
  return step === 'car2' ? 'vehicle2' : 'vehicle'
}

function card(name: string, note: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.innerHTML = `<span class="name"></span><span class="note"></span>`
  button.querySelector('.name')!.textContent = name
  button.querySelector('.note')!.textContent = note
  return button
}

function group(label: string): [HTMLFieldSetElement, HTMLDivElement] {
  const fieldset = document.createElement('fieldset')
  const legend = document.createElement('legend')
  legend.textContent = label
  const cards = document.createElement('div')
  cards.className = 'cards'
  fieldset.append(legend, cards)
  return [fieldset, cards]
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

/**
 * The one place a player picks anything, a page at a time: how to play, then
 * which island (looked over from above while it is chosen), then which
 * vehicle (turning on the spot beside the panel). It is reachable from every
 * mode, so any of it can be changed without going back to the start.
 */
export class Menu {
  private readonly root: HTMLElement
  private readonly host: MenuHost
  private readonly steps = document.createElement('ol')
  private readonly status = line('status')
  private readonly back = document.createElement('button')
  private readonly next = document.createElement('button')
  private readonly seedField = field('Map seed')
  private readonly serverField = field('Server')
  private readonly modeButtons = new Map<Mode, HTMLButtonElement>()
  private readonly vehicleButtons = new Map<VehicleProfileId, HTMLButtonElement>()
  private readonly pages: Record<Step, HTMLElement>
  private readonly serverGroup: HTMLFieldSetElement
  private readonly vehicleLegend: HTMLLegendElement
  private choice: Choice
  private step: Step = 'mode'
  /** Each island asked for outranks the one before: a slow one that lands late is let go. */
  private islands = 0
  /** Whether the island asked for last is still being made: there is no moving on until it is. */
  private generating = false

  constructor(root: HTMLElement, choice: Choice, host: MenuHost) {
    this.root = root
    this.host = host
    this.choice = { ...choice }

    const panel = document.createElement('div')
    panel.className = 'panel'

    const title = document.createElement('h1')
    title.textContent = 'Buggies'
    const blurb = line('blurb')
    blurb.textContent = 'Procedurally generated islands, with roads worth driving.'
    this.steps.className = 'steps'

    // Page one: how to play, and where, if that is somewhere else.
    const [modeGroup, modeCards] = group('Mode')
    for (const mode of ['drive', 'split', 'online'] as const) {
      const button = card(MODE_NOTES[mode].name, MODE_NOTES[mode].note)
      button.addEventListener('click', () => this.pick({ mode }))
      this.modeButtons.set(mode, button)
      modeCards.append(button)
    }
    const [serverGroup, serverRow] = group('Server')
    this.serverGroup = serverGroup
    serverRow.className = 'map'
    this.serverField.addEventListener('change', () => {
      this.choice.server = this.serverField.value.trim() || this.choice.server
    })
    this.serverField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.advance(1)
    })
    serverRow.append(this.serverField)
    const modePage = document.createElement('div')
    modePage.append(modeGroup, serverGroup)

    // Page two: the island, made afresh whenever the seed changes, and
    // looked over from above meanwhile.
    const [mapGroup, mapRow] = group('Map seed')
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
    const mapPage = document.createElement('div')
    mapPage.append(mapGroup)

    // Page three, and on a split screen four: the vehicle, turning on the
    // spot beside the panel. One page serves both drivers in turn.
    const [vehicleGroup, vehicleCards] = group('Vehicle')
    this.vehicleLegend = vehicleGroup.querySelector('legend')!
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
      '<kbd>Enter</kbd> back to the road &nbsp; <kbd>Esc</kbd> this menu'

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
   * Something the player should know, shown until they move on: why a
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
    if (step === 'map') void this.generate()
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

  private render(): void {
    const steps = stepsFor(this.choice.mode)
    const split = this.choice.mode === 'split'
    this.steps.replaceChildren(
      ...steps.map((step) => {
        const item = document.createElement('li')
        item.textContent = step === 'car' && split ? 'Vehicle 1' : STEP_NAMES[step]
        if (step === this.step) item.setAttribute('aria-current', 'step')
        else if (steps.indexOf(step) < steps.indexOf(this.step)) item.className = 'done'
        return item
      }),
    )
    for (const [step, page] of Object.entries(this.pages)) page.hidden = page !== this.pages[this.step]
    this.vehicleLegend.textContent = split ? (this.step === 'car2' ? 'Vehicle 2: the arrows' : 'Vehicle 1: the letters') : 'Vehicle'
    if (document.activeElement !== this.seedField) this.seedField.value = String(this.choice.seed)
    if (document.activeElement !== this.serverField) this.serverField.value = this.choice.server
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute('aria-pressed', String(mode === this.choice.mode))
    }
    // Online, the server picks the map, so there is a server to name instead.
    this.serverGroup.hidden = this.choice.mode !== 'online'
    const picking = this.choice[vehicleKey(this.step)]
    for (const [vehicle, button] of this.vehicleButtons) {
      button.setAttribute('aria-pressed', String(vehicle === picking))
    }
    this.back.hidden = this.step === steps[0]
    this.next.disabled = this.step === 'map' && this.generating
    this.next.textContent = this.step === steps[steps.length - 1] ? MODE_NOTES[this.choice.mode].go : 'Next'
  }
}
