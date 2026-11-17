import { VEHICLE_PROFILE_LABELS, type VehicleProfileId } from '@buggies/game'
import { SLOTS_MOST, type GameMode, type GameOptions, type GameSlotView, type GameView } from '@buggies/net'
import { WORLD_KINDS, WORLD_TRAITS, planetSeedOf, type WorldKind } from '@buggies/terrain'

import { CarPicker, startPicking } from './car-picker.ts'

import './room.css'

/** The race lengths a host may pick, in worlds. */
export const RACE_LENGTHS: readonly number[] = [2, 3, 4]

/** What the game room asks of the app. */
export interface RoomHost {
  /** The game this tab's member is in, as the server last said; nothing once it has left. */
  game(): GameView | null
  /** Whether this tab's member is the game's host: the one who sets it up and starts it. */
  isHost(): boolean
  /** Put this vehicle on the showroom turntable, in the car modal's stage. */
  showVehicle(profile: VehicleProfileId): void
  /** This tab's member drives this, from now on. */
  setVehicle(profile: VehicleProfileId): void
  /** A bot's car, for the host alone to set. */
  setBotVehicle(slot: number, profile: VehicleProfileId): void
  /** One more bot's slot in the game, up to the most it may have. */
  addSlot(): void
  /** Take a bot's slot away. */
  removeSlot(slot: number): void
  /** This tab's member is ready to drive, or no longer is. In a free drive, ready is what drives. */
  ready(ready: boolean): void
  /** The game's world and rules: the host's to change, and only while they may. */
  edit(options: GameOptions): void
  /** Start the race the room waits for. */
  start(): void
  leave(): void
  /** Look at another of the seed's worlds in the room's stage: this player's preview alone. */
  previewWorld(kind: WorldKind): void
}

/** A mark for each kind of world, on its button in the room's row of them. */
const WORLD_ICONS: Readonly<Record<WorldKind, string>> = {
  planet: '🏝️',
  moon: '🌑',
  mars: '🔴',
  neptune: '🌊',
  jupiter: '🪐',
  venus: '🌿',
  mercury: '⛏️',
}

/** A world's name on its own, as a button has it: "Island", "Moon", "Mars". */
function shortName(kind: WorldKind): string {
  return WORLD_TRAITS[kind].name.replace(/^the /, '').replace(/^./, (first) => first.toUpperCase())
}

/** This tab's own slot in the game, or nothing while it is only looking at one. */
export function ownMember(game: GameView): GameSlotView | null {
  return game.slots.find((slot) => slot.member !== 0 && slot.member === game.you) ?? null
}

/**
 * Whether the game may still be set up: by the host alone, a race only in
 * its waiting room, a free drive only while nobody has driven into the world.
 */
export function mayEdit(game: GameView, host: boolean): boolean {
  if (!host) return false
  if (game.options.mode === 'race') return game.status === 'open'
  return !game.slots.some((slot) => slot.driving)
}

/** Whether the race may be started: by the host, from the waiting room, with every player in it ready. A bot always is. */
export function mayStart(game: GameView, host: boolean): boolean {
  const players = game.slots.filter((slot) => !slot.bot)
  return game.options.mode === 'race' && host && game.status === 'open' && players.length > 0 && players.every((slot) => slot.ready)
}

/** Whether the host may add another bot's slot: in a game that may still be set up, under the most it may have. */
export function mayAddSlot(game: GameView, host: boolean): boolean {
  return host && mayEdit(game, host) && game.slots.length < SLOTS_MOST
}

/** Whether the host may take this slot away: a bot's, and never the last one a game has. */
export function mayRemoveSlot(game: GameView, host: boolean, slot: number): boolean {
  const found = game.slots.find((each) => each.slot === slot)
  return host && mayEdit(game, host) && found !== undefined && found.bot && game.slots.length > 1
}

/** Whether this tab may choose the car in this slot: its own, or any bot's, which is the host's to set. */
export function mayChooseCar(game: GameView, host: boolean, slot: GameSlotView): boolean {
  return slot.bot ? host : slot.member !== 0 && slot.member === game.you
}

/** What a slot's row calls its driver: a crown for the host, a robot for a bot. */
export function slotName(slot: GameSlotView, host: number): string {
  if (slot.bot) return `🤖 ${slot.name}`
  return slot.member !== 0 && slot.member === host ? `👑 ${slot.name}` : slot.name
}


/** The room's status line: who hosts the game and what it waits for. */
export function roomStatus(game: GameView): string {
  const host = game.slots.find((slot) => slot.member !== 0 && slot.member === game.host)?.name ?? 'nobody'
  const players = game.slots.filter((slot) => !slot.bot)
  const ready = game.slots.filter((slot) => slot.ready).length
  const driving = players.filter((slot) => slot.driving).length
  const waiting =
    game.status === 'preparing'
      ? 'preparing the course…'
      : game.status === 'starting'
        ? 'lining up…'
        : game.options.mode === 'free'
          ? driving === 0
            ? 'nobody is driving yet'
            : `${driving} of ${players.length} driving`
          : ready === game.slots.length
            ? 'everyone is ready'
            : `${ready} of ${game.slots.length} ready`
  return `hosted by ${host} · ${waiting}`
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  if (className !== '') made.className = className
  if (text !== '') made.textContent = text
  return made
}

function button(text: string, className = ''): HTMLButtonElement {
  const made = element('button', className, text)
  made.type = 'button'
  return made
}

/**
 * The room of a game, between the start screen and the driving: its slots
 * down the left, in the start screen's own panel, and the game's options
 * over the world being looked at down the right. Every slot is a seat, a
 * player's or a bot's: the host adds bots and takes them away, sets their
 * cars and starts the race, while anyone sets their own car and says they
 * are ready. A car is chosen in a modal over the room; the world and that
 * car are drawn into the two stages the room is handed. Everything else
 * arrives as the server pushes it, so a change anyone makes is everyone's
 * to see at once.
 */
export class GameRoom {
  private readonly host: RoomHost
  private readonly root: HTMLElement
  private readonly title = element('h1')
  private readonly status = element('p', 'status')
  private readonly slots = element('ul', 'slots')
  private readonly add = button('+ Add a bot', 'add')
  private readonly warning = element('p', 'warning')
  private readonly options = element('fieldset', 'options')
  private readonly modes = new Map<GameMode, HTMLButtonElement>()
  private readonly seed = element('input')
  private readonly raceLength = element('div', 'field')
  private readonly lengths: readonly HTMLButtonElement[]
  private readonly weapons = button('Weapons', 'switch')
  private readonly bananas = button('Bananas', 'switch')
  private readonly hostOnly = element('p', 'host-note')
  private readonly worlds = new Map<WorldKind, HTMLButtonElement>()
  private readonly worldStage = element('div', 'stage')
  private readonly startButton = button('Start the race', 'big go')
  private readonly picker: CarPicker
  private shown: GameView | null = null
  /** The seed last shown, and the world of it being looked at: the island, until another is picked. */
  private shownSeed = -1
  private preview: WorldKind = 'planet'
  /** The slot the car modal is open for, and whether it is a bot's: nothing while it is shut. */
  private choosing: { slot: number; bot: boolean } | null = null

  constructor(root: HTMLElement, host: RoomHost) {
    this.host = host
    this.root = element('div', 'game-room')
    this.root.hidden = true

    // Down the left, where the start screen's panel is: what the game is, whose seats they are, and the way on.
    const players = element('section', 'players')
    const head = element('header', 'head')
    head.append(this.title, this.status)
    const leave = button('Leave', 'leave')
    leave.addEventListener('click', () => this.host.leave())
    this.add.addEventListener('click', () => this.host.addSlot())
    this.startButton.addEventListener('click', () => this.host.start())
    this.warning.hidden = true
    const foot = element('footer', 'foot')
    foot.append(leave, this.startButton)
    players.append(head, this.slots, this.add, this.warning, foot)

    // Down the right: the host's say over the game, then the seed's worlds over the stage they are looked at in.
    const course = element('section', 'course')
    const modes = element('div', 'modes')
    for (const mode of ['race', 'free'] as const) {
      const choice = button(mode === 'race' ? 'Race' : 'Free drive', 'mode')
      choice.addEventListener('click', () => this.change({ mode }))
      this.modes.set(mode, choice)
      modes.append(choice)
    }
    this.seed.type = 'text'
    this.seed.inputMode = 'numeric'
    this.seed.setAttribute('aria-label', 'Seed')
    this.seed.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') this.seed.blur()
    })
    this.seed.addEventListener('change', () => this.changeSeed(this.seed.value))
    const dice = button('🎲', 'dice')
    dice.title = 'Another seed'
    dice.addEventListener('click', () => this.changeSeed(String(Math.floor(Math.random() * 100000))))
    const seedField = element('div', 'field')
    const seedRow = element('div', 'seed')
    seedRow.append(this.seed, dice)
    seedField.append(element('span', 'label', 'Seed'), seedRow)
    this.lengths = RACE_LENGTHS.map((length) => {
      const choice = button(String(length), 'segment')
      choice.dataset.length = String(length)
      choice.addEventListener('click', () => this.change({ raceLength: length }))
      return choice
    })
    const segments = element('div', 'segments')
    segments.append(...this.lengths)
    this.raceLength.append(element('span', 'label', 'Worlds'), segments)
    this.weapons.addEventListener('click', () => this.change({ weapons: this.shown?.options.weapons !== true }))
    this.bananas.addEventListener('click', () => this.change({ bananas: this.shown?.options.bananas !== true }))
    const rules = element('div', 'field')
    const switches = element('div', 'switches')
    switches.append(this.weapons, this.bananas)
    rules.append(element('span', 'label', 'Rules'), switches)
    const fields = element('div', 'fields')
    fields.append(seedField, this.raceLength, rules)
    this.hostOnly.hidden = true
    this.options.append(modes, fields, this.hostOnly)
    const worldRow = element('div', 'worlds')
    for (const kind of WORLD_KINDS) {
      const choice = button('', 'world')
      choice.append(element('span', 'icon', WORLD_ICONS[kind]), element('span', 'label', shortName(kind)))
      choice.title = WORLD_TRAITS[kind].name
      choice.addEventListener('click', () => this.look(kind))
      this.worlds.set(kind, choice)
      worldRow.append(choice)
    }
    course.append(this.options, worldRow, this.worldStage)

    // Over the room, when a car is being chosen: the showroom's turntable and what it is like to drive.
    const modal = element('div', 'car-modal')
    this.picker = new CarPicker(modal, {
      show: (profile) => this.host.showVehicle(profile),
      choose: (profile) => this.choose(profile),
      closed: () => {
        this.choosing = null
      },
    })

    this.root.append(players, course, modal)
    root.append(this.root)
  }

  /** Whether the room is up. */
  open(): boolean {
    return !this.root.hidden
  }

  /** The stage the world being looked at is drawn in. */
  worldBox(): HTMLElement {
    return this.worldStage
  }

  /** Whether the world is still being made for its stage: said there until it is. */
  making(making: boolean): void {
    this.worldStage.classList.toggle('making', making)
  }

  /** The stage the vehicle being chosen is drawn in, or nothing while the car modal is shut. */
  carBox(): HTMLElement | null {
    return this.picker.opened() ? this.picker.stage() : null
  }

  /** Show the game as it is now; nothing hides the room again but `hide`. */
  show(game: GameView | null): void {
    if (game === null) {
      this.hide()
      return
    }
    this.shown = game
    this.root.hidden = false
    // Another seed is another set of worlds: the preview goes back to the island on it.
    if (game.options.seed !== this.shownSeed) {
      this.shownSeed = game.options.seed
      this.preview = 'planet'
      this.host.previewWorld('planet')
    }
    this.render()
  }

  hide(): void {
    this.root.hidden = true
    this.shown = null
    this.shownSeed = -1
    this.preview = 'planet'
    this.picker.close()
  }

  /** Why the room could not be entered, or the course could not be built: kept in view until something changes. */
  warn(text: string): void {
    this.warning.textContent = text
    this.warning.hidden = text === ''
  }

  private render(): void {
    const game = this.shown
    if (game === null) return
    const host = this.host.isHost()
    const own = ownMember(game)
    const racing = game.options.mode === 'race'
    this.title.textContent = racing ? 'Race' : 'Free drive'
    this.status.textContent = roomStatus(game)
    this.renderSlots(game, own, host)
    this.renderOptions(game, host, racing)

    this.leaveChosenSlot(game)
    this.startButton.hidden = !(racing && host)
    this.startButton.disabled = !mayStart(game, host)
    this.startButton.textContent =
      game.status === 'preparing' ? 'Preparing the course…' : game.status === 'starting' ? 'Starting…' : 'Start the race'
    this.warn(game.fault ?? '')
  }

  /** One row a seat: whose it is, what they drive, whether they are ready, and what this tab may do about it. */
  private renderSlots(game: GameView, own: GameSlotView | null, host: boolean): void {
    this.slots.replaceChildren()
    for (const slot of game.slots) {
      const you = slot === own
      const row = element('li', 'slot')
      if (you) row.classList.add('you')
      if (slot.bot) row.classList.add('bot')
      if (slot.ready || slot.driving) row.classList.add('in')

      const said = element('div', 'said')
      said.append(element('span', 'name', slotName(slot, game.host)))
      if (you) said.append(element('span', 'note', 'you'))
      row.append(said)
      // Another's readiness is said; this tab's own is the box it ticks, or the button it drives with.
      if (!you) row.append(element('span', 'state', slot.driving ? 'driving' : slot.ready ? 'ready' : 'not ready'))

      const doing = element('div', 'doing')
      if (you) {
        if (game.options.mode === 'free') {
          const drive = button(slot.driving ? 'Driving' : 'Drive', 'go')
          drive.disabled = slot.driving
          drive.addEventListener('click', () => this.host.ready(!slot.driving))
          doing.append(drive)
        } else {
          const tick = element('input')
          tick.type = 'checkbox'
          tick.checked = slot.ready
          tick.disabled = game.status !== 'open'
          tick.addEventListener('change', () => this.host.ready(tick.checked))
          const label = element('label', 'ready')
          label.append(tick, element('span', '', 'Ready'))
          doing.append(label)
        }
        doing.append(this.carButton(slot))
      } else if (slot.bot && host) {
        doing.append(this.carButton(slot))
        const drop = button('✕', 'remove')
        drop.title = `Take ${slot.name}'s slot away`
        drop.setAttribute('aria-label', `Take ${slot.name}'s slot away`)
        drop.disabled = !mayRemoveSlot(game, host, slot.slot)
        drop.addEventListener('click', () => this.host.removeSlot(slot.slot))
        doing.append(drop)
      } else {
        // A car this tab may not change is only said.
        doing.append(element('span', 'vehicle', VEHICLE_PROFILE_LABELS[slot.vehicle]))
      }
      row.append(doing)
      this.slots.append(row)
    }
    this.add.hidden = !mayAddSlot(game, host)
  }

  /** The game's world and rules, as the host may set them and everyone may see them. */
  private renderOptions(game: GameView, host: boolean, racing: boolean): void {
    const editable = mayEdit(game, host)
    const { options } = game
    this.options.disabled = !editable
    this.hostOnly.textContent = host ? 'The game is under way: its course and rules are set.' : 'Only the host sets the game.'
    this.hostOnly.hidden = editable
    for (const [mode, choice] of this.modes) choice.setAttribute('aria-pressed', String(mode === options.mode))
    if (document.activeElement !== this.seed) this.seed.value = String(planetSeedOf(options.seed))
    this.raceLength.hidden = !racing
    for (const choice of this.lengths) choice.setAttribute('aria-pressed', String(Number(choice.dataset.length) === options.raceLength))
    this.weapons.setAttribute('aria-pressed', String(options.weapons))
    this.bananas.setAttribute('aria-pressed', String(options.bananas))
    for (const [kind, choice] of this.worlds) choice.setAttribute('aria-pressed', String(kind === this.preview))
  }

  /** The button that opens the car modal on this slot's vehicle, named for the car it is now. */
  private carButton(slot: GameSlotView): HTMLButtonElement {
    const made = button(`${VEHICLE_PROFILE_LABELS[slot.vehicle]} ▾`, 'vehicle')
    made.title = `Choose ${slot.bot ? `${slot.name}'s` : 'your'} car`
    made.addEventListener('click', () => this.chooseFor(slot))
    return made
  }

  /** Open the car modal on this slot's car: this tab's own, or a bot's, which is the host's to set. */
  private chooseFor(slot: GameSlotView): void {
    const game = this.shown
    if (game === null || !mayChooseCar(game, this.host.isHost(), slot)) return
    this.choosing = { slot: slot.slot, bot: slot.bot }
    this.picker.open(startPicking(slot.bot ? slot.name : null, slot.vehicle))
  }

  /** The car the modal settled on: this tab's own, or a bot's. */
  private choose(profile: VehicleProfileId): void {
    const choosing = this.choosing
    this.choosing = null
    if (choosing === null) return
    if (choosing.bot) this.host.setBotVehicle(choosing.slot, profile)
    else this.host.setVehicle(profile)
  }

  /** Shut the modal if the seat it was opened on is gone, or is somebody else's now. */
  private leaveChosenSlot(game: GameView): void {
    const choosing = this.choosing
    if (choosing === null) return
    const slot = game.slots.find((each) => each.slot === choosing.slot)
    if (slot === undefined || slot.bot !== choosing.bot) this.picker.close()
  }

  /** Look at one of the seed's worlds in the stage: this player's preview alone, never the game's. */
  private look(kind: WorldKind): void {
    if (this.preview === kind) return
    this.preview = kind
    for (const [each, choice] of this.worlds) choice.setAttribute('aria-pressed', String(each === kind))
    this.host.previewWorld(kind)
  }

  /** The seed typed or diced for, made a planet's seed: the world itself is the seed and the kind together. */
  private changeSeed(typed: string): void {
    const seed = Math.floor(Math.abs(Number(typed)))
    if (!Number.isFinite(seed)) return
    this.change({ seed: planetSeedOf(seed) })
  }

  private change(patch: Partial<GameOptions>): void {
    const game = this.shown
    if (game === null) return
    this.host.edit({ ...game.options, ...patch })
  }
}
