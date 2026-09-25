import type { ControlHint } from './hud.ts'
import { LEFT_BINDINGS, RIGHT_BINDINGS, SOLO_BINDINGS, type KeyBindings } from './input.ts'

/** Which keys a driver has: to drive with, to get back on the road with, and what to tell them. */
export interface DriverKeys {
  bindings: KeyBindings
  /** Whether a key press is this driver asking to be put back on the road. */
  respawn: (event: KeyboardEvent) => boolean
  /** What to tell the driver, given what their car does of its own, by name. */
  controls: (ability: string) => readonly ControlHint[]
}

/** Alone: the arrows, with the space bar, F, D and R under the other hand. */
export const SOLO_KEYS: DriverKeys = {
  bindings: SOLO_BINDINGS,
  respawn: (event) => event.code === 'KeyR',
  controls: (ability) => [
    { keys: ['↑', '←', '↓', '→'], does: 'to drive' },
    { keys: ['Space'], does: 'handbrake' },
    { keys: ['F'], does: 'fire' },
    { keys: ['D'], does: ability.toLowerCase() },
    { keys: ['R'], does: 'back to the road' },
    { keys: ['Esc'], does: 'menu' },
  ],
}

/** The left half of a split screen: the letters. */
export const LEFT_KEYS: DriverKeys = {
  bindings: LEFT_BINDINGS,
  respawn: (event) => event.code === 'KeyQ',
  controls: (ability) => [
    { keys: ['W', 'A', 'S', 'D'], does: 'to drive' },
    { keys: ['Z'], does: 'handbrake' },
    { keys: ['X'], does: 'fire' },
    { keys: ['Shift'], does: ability.toLowerCase() },
    { keys: ['Q'], does: 'back to the road' },
    { keys: ['Esc'], does: 'menu' },
  ],
}

/** The right half of a split screen: the arrows. */
export const RIGHT_KEYS: DriverKeys = {
  bindings: RIGHT_BINDINGS,
  respawn: (event) => event.key === 'Enter',
  controls: (ability) => [
    { keys: ['↑', '←', '↓', '→'], does: 'to drive' },
    { keys: [','], does: 'handbrake' },
    { keys: ['.'], does: 'fire' },
    { keys: ['M'], does: ability.toLowerCase() },
    { keys: ['Enter'], does: 'back to the road' },
    { keys: ['Esc'], does: 'menu' },
  ],
}
