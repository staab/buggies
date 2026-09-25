import type * as THREE from 'three'

import type { HudState } from './hud.ts'

/**
 * One way of being on a map. Modes own their camera and whatever they add to
 * the scene; the shell owns the renderer, the lights and the terrain itself.
 */
export interface ModeView {
  readonly camera: THREE.PerspectiveCamera
  /** A scene of the mode's own to draw instead of the island's, if it has one. */
  readonly scene?: THREE.Scene
  resize(aspect: number): void
  /** `active` is false while a menu is over the top and the player is not driving. */
  update(dt: number, active: boolean): void
  /** The game's tick, the same on every mirror, for whatever on the island keeps time by it. */
  readonly tick?: number
  /** Draw itself, if it is not simply its scene through its camera: a split screen is two. */
  render?(renderer: THREE.WebGLRenderer): void
  /** What the HUD should say of the mode, one entry a viewport; none, and it is not shown. */
  hud(): readonly HudState[]
  dispose(): void
}
