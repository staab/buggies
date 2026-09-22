import type * as THREE from 'three'

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
  hud(): string
  dispose(): void
}
