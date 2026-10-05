import { NEUTRAL_INPUT, NO_KEY, WEAPONS, type VehicleInput } from '@buggies/game'

interface Held {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  handbrake: boolean
  signal: boolean
}

/** Which key (by its `code`) does what. */
export type KeyBindings = Readonly<Record<string, keyof Held>>

/** The arrows to drive, and the space bar and D under the other hand. */
export const SOLO_BINDINGS: KeyBindings = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'handbrake',
  KeyD: 'signal',
}

/** The weapon key a key press is, 1 to 9 along the top row or on the number pad, or none. */
export function weaponKey(code: string): number {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code)
  const key = match === null ? NO_KEY : Number(match[1])
  return key <= WEAPONS.length ? key : NO_KEY
}

const RELEASED: Held = {
  forward: false,
  back: false,
  left: false,
  right: false,
  handbrake: false,
  signal: false,
}

/**
 * Keys to driver intent. Nothing is read from the keyboard during a simulation
 * step: the step takes a plain struct, which is what a network payload will be.
 */
export class Keyboard {
  private readonly held: Held = { ...RELEASED }
  /** The weapon keys held down, in the order they went down: the last is the one that counts. */
  private readonly weapons: number[] = []
  private readonly command: VehicleInput = { ...NEUTRAL_INPUT }
  private readonly bindings: KeyBindings

  private readonly onKey = (event: KeyboardEvent): void => {
    const weapon = weaponKey(event.code)
    if (weapon !== NO_KEY) {
      event.preventDefault()
      const at = this.weapons.indexOf(weapon)
      if (at >= 0) this.weapons.splice(at, 1)
      if (event.type === 'keydown') this.weapons.push(weapon)
      return
    }
    const binding = this.bindings[event.code]
    if (binding === undefined) return
    event.preventDefault()
    this.held[binding] = event.type === 'keydown'
  }

  private readonly onBlur = (): void => this.release()

  constructor(bindings: KeyBindings = SOLO_BINDINGS) {
    this.bindings = bindings
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
    window.addEventListener('blur', this.onBlur)
  }

  read(): VehicleInput {
    const { forward, back, left, right, handbrake, signal } = this.held
    this.command.throttle = forward ? 1 : 0
    this.command.brake = back ? 1 : 0
    this.command.steer = (right ? 1 : 0) - (left ? 1 : 0)
    this.command.handbrake = handbrake
    this.command.signal = signal
    this.command.weapon = this.weapons.at(-1) ?? NO_KEY
    return this.command
  }

  /** Drop everything held. A window that loses focus never sees the key-up. */
  release(): void {
    Object.assign(this.held, RELEASED)
    this.weapons.length = 0
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    window.removeEventListener('blur', this.onBlur)
  }
}
