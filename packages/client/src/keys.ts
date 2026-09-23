import type { ControlHint } from './hud.ts'
import { LEFT_BINDINGS, RIGHT_BINDINGS, SOLO_BINDINGS, type KeyBindings } from './input.ts'

/** Which keys a driver has: to drive with, to get back on the road with, and what to tell them. */
export interface DriverKeys {
  bindings: KeyBindings
  /** Whether a key press is this driver asking to be put back on the road. */
  respawn: (event: KeyboardEvent) => boolean
  controls: readonly ControlHint[]
}

/** Alone: the whole keyboard. */
export const SOLO_KEYS: DriverKeys = {
  bindings: SOLO_BINDINGS,
  respawn: (event) => event.key === 'Enter',
  controls: [
    { keys: ['W', 'A', 'S', 'D'], does: 'or arrows to drive' },
    { keys: ['Space'], does: 'handbrake' },
    { keys: ['Enter'], does: 'back to the road' },
    { keys: ['M'], does: 'mute' },
    { keys: ['Esc'], does: 'menu' },
  ],
}

/** The left half of a split screen: the letters. */
export const LEFT_KEYS: DriverKeys = {
  bindings: LEFT_BINDINGS,
  respawn: (event) => event.code === 'KeyQ',
  controls: [
    { keys: ['W', 'A', 'S', 'D'], does: 'to drive' },
    { keys: ['Space'], does: 'handbrake' },
    { keys: ['Q'], does: 'back to the road' },
    { keys: ['M'], does: 'mute' },
    { keys: ['Esc'], does: 'menu' },
  ],
}

/** The right half of a split screen: the arrows. */
export const RIGHT_KEYS: DriverKeys = {
  bindings: RIGHT_BINDINGS,
  respawn: (event) => event.key === '?',
  controls: [
    { keys: ['↑', '←', '↓', '→'], does: 'to drive' },
    { keys: ['Left Shift'], does: 'handbrake' },
    { keys: ['?'], does: 'back to the road' },
    { keys: ['M'], does: 'mute' },
    { keys: ['Esc'], does: 'menu' },
  ],
}
