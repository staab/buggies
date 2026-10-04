import type { ControlHint } from './hud.ts'
import { SOLO_BINDINGS, type KeyBindings } from './input.ts'

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
    { keys: ['↑', '←', '↓', '→'], does: 'drive' },
    { keys: ['Space'], does: 'handbrake' },
    { keys: ['F'], does: 'fire' },
    { keys: ['D'], does: ability.toLowerCase() },
    { keys: ['R'], does: 'respawn' },
    { keys: ['Esc'], does: 'menu' },
  ],
}
