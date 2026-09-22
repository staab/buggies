import { VEHICLE_PROFILE_IDS, VEHICLE_PROFILE_LABELS, type VehicleProfileId } from '@buggies/game'

import { modelCredits } from './car-model.ts'

export type Mode = 'preview' | 'drive' | 'online'

/** What the player has chosen. Everything the app needs to build a session. */
export interface Choice {
  mode: Mode
  seed: number
  vehicle: VehicleProfileId
  server: string
}

const MODE_NOTES: Record<Mode, { name: string; note: string; go: string }> = {
  preview: {
    name: 'Terrain preview',
    note: 'Orbit a whole island and see how it was put together.',
    go: 'Explore',
  },
  drive: {
    name: 'Free drive',
    note: 'Take a vehicle out on the roads, or off them.',
    go: 'Drive',
  },
  online: {
    name: 'Online',
    note: 'Join a server and share its island with whoever else is on it.',
    go: 'Connect',
  },
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

function randomSeed(): number {
  return Math.floor(Math.random() * 100000)
}

/**
 * The one place a player picks anything. It is reachable from every mode, so
 * the map can be changed without first going back to wherever you started.
 */
export class Menu {
  private readonly root: HTMLElement
  private readonly seedField = field('Map seed')
  private readonly serverField = field('Server')
  private readonly modeButtons = new Map<Mode, HTMLButtonElement>()
  private readonly vehicleButtons = new Map<VehicleProfileId, HTMLButtonElement>()
  private readonly mapGroup: HTMLFieldSetElement
  private readonly serverGroup: HTMLFieldSetElement
  private readonly vehicleGroup: HTMLFieldSetElement
  private readonly go = document.createElement('button')
  private choice: Choice
  private commit: (choice: Choice) => void = () => {}

  constructor(root: HTMLElement, choice: Choice) {
    this.root = root
    this.choice = { ...choice }

    const panel = document.createElement('div')
    panel.className = 'panel'

    const title = document.createElement('h1')
    title.textContent = 'Buggies'
    const blurb = document.createElement('p')
    blurb.className = 'blurb'
    blurb.textContent = 'Procedurally generated islands, with roads worth driving.'

    const [modeGroup, modeCards] = group('Mode')
    for (const mode of ['preview', 'drive', 'online'] as const) {
      const button = card(MODE_NOTES[mode].name, MODE_NOTES[mode].note)
      button.addEventListener('click', () => this.pick({ mode }))
      this.modeButtons.set(mode, button)
      modeCards.append(button)
    }

    const [mapGroup, mapRow] = group('Map')
    this.mapGroup = mapGroup
    mapRow.className = 'map'
    this.seedField.inputMode = 'numeric'
    this.seedField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.confirm()
    })
    const shuffle = document.createElement('button')
    shuffle.type = 'button'
    shuffle.textContent = 'Random'
    shuffle.addEventListener('click', () => {
      this.seedField.value = String(randomSeed())
    })
    mapRow.append(this.seedField, shuffle)

    const [serverGroup, serverRow] = group('Server')
    this.serverGroup = serverGroup
    serverRow.className = 'map'
    this.serverField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.confirm()
    })
    serverRow.append(this.serverField)

    const [vehicleGroup, vehicleCards] = group('Vehicle')
    this.vehicleGroup = vehicleGroup
    for (const vehicle of VEHICLE_PROFILE_IDS) {
      const button = card(VEHICLE_PROFILE_LABELS[vehicle], VEHICLE_NOTES[vehicle])
      button.addEventListener('click', () => this.pick({ vehicle }))
      this.vehicleButtons.set(vehicle, button)
      vehicleCards.append(button)
    }

    this.go.type = 'button'
    this.go.className = 'go'
    this.go.addEventListener('click', () => this.confirm())

    const keys = document.createElement('p')
    keys.className = 'keys'
    keys.innerHTML =
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to drive &nbsp; ' +
      '<kbd>Space</kbd> handbrake &nbsp; <kbd>Enter</kbd> back to the road<br />' +
      '<kbd>R</kbd> a different map &nbsp; <kbd>Esc</kbd> this menu'

    // Whose models the vehicles are. One of them asks to be credited, and
    // the rest deserve it.
    const credits = document.createElement('p')
    credits.className = 'keys'
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

    panel.append(title, blurb, modeGroup, mapGroup, serverGroup, vehicleGroup, this.go, keys, credits)
    this.root.append(panel)
    this.render()
  }

  get open(): boolean {
    return !this.root.hidden
  }

  onCommit(commit: (choice: Choice) => void): void {
    this.commit = commit
  }

  show(choice: Choice): void {
    this.choice = { ...choice }
    this.render()
    this.root.hidden = false
  }

  hide(): void {
    this.root.hidden = true
  }

  private pick(change: Partial<Choice>): void {
    this.choice = { ...this.choice, ...change }
    this.render()
  }

  private confirm(): void {
    const typed = Number(this.seedField.value.trim())
    const seed = Number.isFinite(typed) && typed !== 0 ? Math.floor(Math.abs(typed)) : randomSeed()
    const server = this.serverField.value.trim() || this.choice.server
    this.hide()
    this.commit({ ...this.choice, seed, server })
  }

  private render(): void {
    if (document.activeElement !== this.seedField) this.seedField.value = String(this.choice.seed)
    if (document.activeElement !== this.serverField) this.serverField.value = this.choice.server
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute('aria-pressed', String(mode === this.choice.mode))
    }
    for (const [vehicle, button] of this.vehicleButtons) {
      button.setAttribute('aria-pressed', String(vehicle === this.choice.vehicle))
    }
    // Each choice only matters to some of the modes, and saying so is kinder
    // than letting a player wonder why their pick changed nothing: online, the
    // server picks the map; looking at one, nobody is driving.
    const online = this.choice.mode === 'online'
    this.mapGroup.disabled = online
    this.serverGroup.disabled = !online
    this.vehicleGroup.disabled = this.choice.mode === 'preview'
    this.go.textContent = MODE_NOTES[this.choice.mode].go
  }
}
