import { NEUTRAL_INPUT, NO_KEY, WEAPONS, type VehicleInput } from '@buggies/game'

interface Held {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  handbrake: boolean
  fire: boolean
  signal: boolean
}

/** Which key (by its `code`) does what. */
export type KeyBindings = Readonly<Record<string, keyof Held>>

/** The arrows to drive, and the space bar, F and D under the other hand. */
export const SOLO_BINDINGS: KeyBindings = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'handbrake',
  KeyF: 'fire',
  KeyD: 'signal',
}

/** Not a number key. */
export const NOT_A_NUMBER = -1

/**
 * The weapon a number key selects, 1 to 9 along the top row or on the
 * number pad, or none for 0, which clears it; not a number key at all for
 * anything else.
 */
export function weaponKey(code: string): number {
  const match = /^(?:Digit|Numpad)([0-9])$/.exec(code)
  const key = match === null ? NOT_A_NUMBER : Number(match[1])
  return key <= WEAPONS.length ? key : NOT_A_NUMBER
}

const RELEASED: Held = {
  forward: false,
  back: false,
  left: false,
  right: false,
  handbrake: false,
  fire: false,
  signal: false,
}

/**
 * Keys to driver intent. Nothing is read from the keyboard during a simulation
 * step: the step takes a plain struct, which is what a network payload will be.
 */
export class Keyboard {
  /**
   * The weapon selected by its number key, kept until another is or 0
   * clears it, and from one keyboard to the next: through a portal or a
   * reconnect, the player has the weapon they had.
   */
  private static weapon = NO_KEY
  private readonly held: Held = { ...RELEASED }
  private readonly command: VehicleInput = { ...NEUTRAL_INPUT }
  private readonly bindings: KeyBindings

  private readonly onKey = (event: KeyboardEvent): void => {
    const weapon = weaponKey(event.code)
    if (weapon !== NOT_A_NUMBER) {
      event.preventDefault()
      if (event.type === 'keydown') Keyboard.weapon = weapon
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
    const { forward, back, left, right, handbrake, fire, signal } = this.held
    this.command.throttle = forward ? 1 : 0
    this.command.brake = back ? 1 : 0
    this.command.steer = (right ? 1 : 0) - (left ? 1 : 0)
    this.command.handbrake = handbrake
    this.command.fire = fire
    this.command.signal = signal
    this.command.weapon = Keyboard.weapon
    return this.command
  }

  /** Drop everything held, keeping the weapon selected. A window that loses focus never sees the key-up. */
  release(): void {
    Object.assign(this.held, RELEASED)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    window.removeEventListener('blur', this.onBlur)
  }
}
