import type { ControlHint } from './hud.ts'
import { SOLO_BINDINGS, type KeyBindings } from './input.ts'

/** Which keys a driver has: to drive with, to get back on the road with, and what to tell them. */
export interface DriverKeys {
  bindings: KeyBindings
  /** Whether a key press is this driver asking to be put back on the road. */
  respawn: (event: KeyboardEvent) => boolean
  /** What to tell the driver, with what their car's signal key does, by name. */
  controls: (signal: string) => readonly ControlHint[]
}

/** The arrows, with the space bar, the number keys to select a weapon, F to fire it, D and R. */
export const SOLO_KEYS: DriverKeys = {
  bindings: SOLO_BINDINGS,
  respawn: (event) => event.code === 'KeyR',
  controls: (signal) => [
    { keys: ['↑', '←', '↓', '→'], does: 'drive' },
    { keys: ['Space'], does: 'handbrake' },
    { keys: ['1–9'], does: 'select weapon' },
    { keys: ['0'], does: 'clear weapon' },
    { keys: ['F'], does: 'fire' },
    { keys: ['D'], does: signal },
    { keys: ['R'], does: 'respawn' },
    { keys: ['Esc'], does: 'menu' },
  ],
}
