import { NEUTRAL_INPUT, type VehicleInput } from '@buggies/game'

interface Held {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  handbrake: boolean
  fire: boolean
  ability: boolean
}

/** Which key (by its `code`) does what. */
export type KeyBindings = Readonly<Record<string, keyof Held>>

/** A player alone: the arrows to drive, and the space bar, F and D under the other hand. */
export const SOLO_BINDINGS: KeyBindings = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'handbrake',
  KeyF: 'fire',
  KeyD: 'ability',
}

/**
 * The right of a shared keyboard: the arrows to drive, the comma and the
 * full stop under the same hand for the handbrake and to fire, and M for
 * what the car does of its own.
 */
export const RIGHT_BINDINGS: KeyBindings = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Comma: 'handbrake',
  Period: 'fire',
  KeyM: 'ability',
}

/** The same shape under the left hand, for whoever has the left of a shared keyboard. */
export const LEFT_BINDINGS: KeyBindings = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  KeyZ: 'handbrake',
  KeyX: 'fire',
  ShiftLeft: 'ability',
}

const RELEASED: Held = {
  forward: false,
  back: false,
  left: false,
  right: false,
  handbrake: false,
  fire: false,
  ability: false,
}

/**
 * Keys to driver intent. Nothing is read from the keyboard during a simulation
 * step: the step takes a plain struct, which is what a network payload will be.
 */
export class Keyboard {
  private readonly held: Held = { ...RELEASED }
  private readonly command: VehicleInput = { ...NEUTRAL_INPUT }
  private readonly bindings: KeyBindings

  private readonly onKey = (event: KeyboardEvent): void => {
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
    const { forward, back, left, right, handbrake, fire, ability } = this.held
    this.command.throttle = forward ? 1 : 0
    this.command.brake = back ? 1 : 0
    this.command.steer = (right ? 1 : 0) - (left ? 1 : 0)
    this.command.handbrake = handbrake
    this.command.fire = fire
    this.command.ability = ability
    return this.command
  }

  /** Drop everything held. A window that loses focus never sees the key-up. */
  release(): void {
    Object.assign(this.held, RELEASED)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    window.removeEventListener('blur', this.onBlur)
  }
}
