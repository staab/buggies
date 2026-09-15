import { NEUTRAL_INPUT, type VehicleInput } from '@buggies/game'

const BINDINGS: Record<string, keyof Held> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
}

interface Held {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  handbrake: boolean
}

const RELEASED: Held = {
  forward: false,
  back: false,
  left: false,
  right: false,
  handbrake: false,
}

/**
 * Keys to driver intent. Nothing is read from the keyboard during a simulation
 * step: the step takes a plain struct, which is what a network payload will be.
 */
export class Keyboard {
  private readonly held: Held = { ...RELEASED }
  private readonly command: VehicleInput = { ...NEUTRAL_INPUT }

  private readonly onKey = (event: KeyboardEvent): void => {
    const binding = BINDINGS[event.code]
    if (binding === undefined) return
    event.preventDefault()
    this.held[binding] = event.type === 'keydown'
  }

  private readonly onBlur = (): void => this.release()

  constructor() {
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
    window.addEventListener('blur', this.onBlur)
  }

  read(): VehicleInput {
    const { forward, back, left, right, handbrake } = this.held
    this.command.throttle = forward ? 1 : 0
    this.command.brake = back ? 1 : 0
    this.command.steer = (right ? 1 : 0) - (left ? 1 : 0)
    this.command.handbrake = handbrake
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
