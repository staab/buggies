import { NATURE_NOTES, PLAYABLE_PROFILE_IDS, VEHICLE_PROFILE_LABELS, armorShare, createVehicleTuning, type VehicleProfileId } from '@buggies/game'

/** What the car modal asks of the room that shows it. */
export interface CarPickerHost {
  /** Put this vehicle on the showroom turntable, in the modal's stage. */
  show(profile: VehicleProfileId): void
  /** The vehicle the player settled on, as the modal shuts: theirs to keep. */
  choose(profile: VehicleProfileId): void
  /** The modal has shut, however it went: nothing is being chosen any more. */
  closed(): void
}

/** What each vehicle is like to drive, in a line. */
const VEHICLE_NOTES: Readonly<Record<VehicleProfileId, string>> = {
  raceCar: 'Fast and unforgiving. Spins out if you ask too much.',
  police: 'A sedan with some shove. Takes a knock.',
  firetruck: 'Seven tons with the engine to climb anything. Slowly.',
  pickup: 'Heavy and slow to turn. Slides rather than rolls.',
  sportsCar: 'The balanced one. Start here.',
  smallCar: 'Tiny and nimble. Not quick.',
  tank: 'Nothing moves it off its line, and nothing hurts it much.',
  ambulance: 'A tall van, loaded. Steady if you let it be.',
  semi: 'The tractor, bobtail. Slow to turn, slower to stop.',
  goKart: 'An inch off the road. Turns on a coin, breaks if you look at it.',
  duneBuggy: 'Light and springy. Bounds over everything, and keeps bouncing.',
  amphibian: 'A boat on wheels. Slow on the road, but drive it into the sea and it floats.',
  moonRover: 'Wanders the moon by itself.',
}

/** What a vehicle is like to drive, in one line. */
export function vehicleNote(profile: VehicleProfileId): string {
  return VEHICLE_NOTES[profile]
}

/** What a vehicle has of its own that the others have not: its nature, or nothing. */
export function vehicleAbility(profile: VehicleProfileId): string {
  const nature = NATURE_NOTES[profile]
  return nature.length === 0 ? '' : `★ ${nature.join(' ')}`
}

/** One of a vehicle's readings beside the turntable, as a share of the best of the playable vehicles. */
export interface VehicleStat {
  readonly name: string
  readonly share: number
}

/** The raw readings of a vehicle: how fast it goes, how it holds the road, and how much it takes. */
function readingsOf(profile: VehicleProfileId): readonly number[] {
  const tuning = createVehicleTuning(profile)
  return [tuning.maxSpeed, tuning.lateralPeakGrip, 1 / armorShare(tuning)]
}

const STAT_NAMES = ['Top speed', 'Grip', 'Toughness'] as const
const BEST = STAT_NAMES.map((_, index) => Math.max(...PLAYABLE_PROFILE_IDS.map((profile) => readingsOf(profile)[index] ?? 0)))

/** A vehicle's top speed, grip and toughness, each as a share of the best any playable vehicle has. */
export function vehicleStats(profile: VehicleProfileId): readonly VehicleStat[] {
  const readings = readingsOf(profile)
  return STAT_NAMES.map((name, index) => ({ name, share: Math.min((readings[index] ?? 0) / (BEST[index] || 1), 1) }))
}

/** The vehicle this many along the garage's line from this one, round from the end to the start. */
export function stepVehicle(profile: VehicleProfileId, step: number): VehicleProfileId {
  const count = PLAYABLE_PROFILE_IDS.length
  const at = Math.max(PLAYABLE_PROFILE_IDS.indexOf(profile), 0)
  return PLAYABLE_PROFILE_IDS[(((at + step) % count) + count) % count]!
}

/** Whose car the modal is choosing, and the vehicle it is turned to. */
export interface Picking {
  /** Whose car it is, or nothing for this player's own. */
  readonly name: string | null
  readonly profile: VehicleProfileId
}

/** Begin choosing a car: nothing for this player's own, or a bot's name. */
export function startPicking(name: string | null, profile: VehicleProfileId): Picking {
  return { name, profile }
}

/** What the modal's heading says: `Your car`, or `Axle's car` for a bot's. */
export function carTitle(picking: Picking): string {
  return picking.name === null ? 'Your car' : `${picking.name}'s car`
}

/** The modal turned this many vehicles along the garage's line, round from the end to the start. */
export function stepPicking(picking: Picking, step: number): Picking {
  return { ...picking, profile: stepVehicle(picking.profile, step) }
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
 * The car modal: a dialog over the game's room with the showroom's
 * turntable in it, the vehicles either side of it flicked through by the
 * buttons or the arrow keys, and the one turned to measured out beneath:
 * what it is called, what it is like to drive, what it has of its own,
 * and how its speed, grip and toughness read against the best there is.
 * Choose takes it, by the button, the Enter key or the row of pips under
 * the readings; Cancel, Escape or a click outside it leaves the car as it
 * was. The app draws the vehicle into the stage; everything else is here.
 */
export class CarPicker {
  private readonly host: CarPickerHost
  private readonly root: HTMLElement
  private readonly heading = element('h2')
  private readonly stageBox = element('div', 'car-stage')
  private readonly name = element('h3', 'car-name')
  private readonly note = element('p', 'car-note')
  private readonly ability = element('p', 'car-ability')
  private readonly stats = element('div', 'stats')
  private readonly pips = new Map<VehicleProfileId, HTMLButtonElement>()
  private readonly chooseButton = button('Choose', 'choose')
  private choosing: Picking | null = null
  /** What had the keyboard when the modal was opened, to have it back when the modal is shut. */
  private returnTo: HTMLElement | null = null

  constructor(root: HTMLElement, host: CarPickerHost) {
    this.host = host
    this.root = root
    this.root.hidden = true

    const dialog = element('div', 'car-dialog')
    this.heading.id = 'car-heading'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'car-heading')

    // Either side of the turntable, the way to the vehicle before and the one after.
    const back = button('‹', 'flick back')
    back.setAttribute('aria-label', 'Previous vehicle')
    back.addEventListener('click', () => this.turn(-1))
    const on = button('›', 'flick on')
    on.setAttribute('aria-label', 'Next vehicle')
    on.addEventListener('click', () => this.turn(1))
    this.stageBox.append(back, on)

    const pips = element('div', 'pips')
    for (const profile of PLAYABLE_PROFILE_IDS) {
      const pip = button('', 'pip')
      pip.title = VEHICLE_PROFILE_LABELS[profile]
      pip.setAttribute('aria-label', VEHICLE_PROFILE_LABELS[profile])
      pip.addEventListener('click', () => this.jump(profile))
      this.pips.set(profile, pip)
      pips.append(pip)
    }

    const foot = element('div', 'car-foot')
    const cancel = button('Cancel', 'cancel')
    cancel.addEventListener('click', () => this.close())
    this.chooseButton.addEventListener('click', () => {
      if (this.choosing !== null) this.choose(this.choosing.profile)
    })
    foot.append(this.chooseButton, cancel)

    // A click on the dark outside the dialog, never on the dialog itself, is a cancel.
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.close()
    })
    dialog.append(this.heading, this.stageBox, this.name, this.note, this.ability, this.stats, pips, foot)
    this.root.append(dialog)
    window.addEventListener('keydown', (event) => this.onKey(event))
  }

  /** Whether the modal is up. */
  opened(): boolean {
    return !this.root.hidden
  }

  /** Put the vehicle turned to on the turntable: the room draws into it, and it is a hole while it is shut. */
  stage(): HTMLElement {
    return this.stageBox
  }

  /** Open the modal on this car, with the vehicle it already has turned to. */
  open(picking: Picking): void {
    if (this.root.hidden) this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.root.hidden = false
    this.turnTo(picking)
    this.chooseButton.focus()
  }

  /** Shut the modal, leaving the car as it was. */
  close(): void {
    if (this.root.hidden) return
    this.root.hidden = true
    this.choosing = null
    this.returnTo?.focus()
    this.returnTo = null
    this.host.closed()
  }

  /** Say this vehicle is a keeper and shut the modal on it. */
  private choose(profile: VehicleProfileId): void {
    this.root.hidden = true
    this.choosing = null
    this.returnTo?.focus()
    this.returnTo = null
    this.host.choose(profile)
    this.host.closed()
  }

  /** Flick this many vehicles along the garage's line: on the turntable, and in the readings. */
  private turn(step: number): void {
    if (this.choosing !== null) this.turnTo(stepPicking(this.choosing, step))
  }

  /** Turn straight to this vehicle, without taking it: a pip is a way through the line, as the arrows are. */
  private jump(profile: VehicleProfileId): void {
    if (this.choosing !== null) this.turnTo({ ...this.choosing, profile })
  }

  private turnTo(picking: Picking): void {
    this.choosing = picking
    this.heading.textContent = carTitle(picking)
    this.name.textContent = VEHICLE_PROFILE_LABELS[picking.profile]
    this.note.textContent = vehicleNote(picking.profile)
    const ability = vehicleAbility(picking.profile)
    this.ability.textContent = ability
    this.ability.hidden = ability === ''
    this.stats.replaceChildren()
    for (const stat of vehicleStats(picking.profile)) {
      const row = element('div', 'stat')
      const bar = element('div', 'bar')
      const fill = element('div', 'fill')
      fill.style.width = `${Math.round(stat.share * 100)}%`
      bar.append(fill)
      row.append(element('span', 'label', stat.name), bar)
      this.stats.append(row)
    }
    for (const [profile, pip] of this.pips) pip.setAttribute('aria-pressed', String(profile === picking.profile))
    this.host.show(picking.profile)
  }

  /** The arrow keys flick through the cars, Enter takes the one turned to and Escape leaves it: only while the modal is up. */
  private onKey(event: KeyboardEvent): void {
    if (!this.opened()) return
    if (event.key === 'ArrowLeft') this.turn(-1)
    else if (event.key === 'ArrowRight') this.turn(1)
    else if (event.key === 'Enter' && this.choosing !== null) this.choose(this.choosing.profile)
    else if (event.key === 'Escape') this.close()
    else return
    event.preventDefault()
    // The room, and the page behind it, have nothing to do with these keys: the modal is what is up.
    event.stopImmediatePropagation()
  }
}
