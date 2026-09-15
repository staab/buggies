import type { VehicleInput } from '@buggies/game'

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

/**
 * Keys to driver intent. Nothing is read from the keyboard during a simulation
 * step: the step takes a plain struct, which is what a network payload will be.
 */
export class Keyboard {
  private readonly held: Held = {
    forward: false,
    back: false,
    left: false,
    right: false,
    handbrake: false,
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    const binding = BINDINGS[event.code]
    if (binding === undefined) return
    event.preventDefault()
    this.held[binding] = event.type === 'keydown'
  }

  constructor() {
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
    window.addEventListener('blur', () => this.release())
  }

  read(): VehicleInput {
    const { forward, back, left, right, handbrake } = this.held
    return {
      throttle: forward ? 1 : 0,
      brake: back ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake,
    }
  }

  /** Drop everything held. A window that loses focus never sees the key-up. */
  release(): void {
    Object.assign(this.held, {
      forward: false,
      back: false,
      left: false,
      right: false,
      handbrake: false,
    })
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
  }
}
