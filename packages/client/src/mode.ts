import type * as THREE from 'three'

/**
 * One way of being on a map. Modes own their camera and whatever they add to
 * the scene; the shell owns the renderer, the lights and the terrain itself.
 */
export interface ModeView {
  readonly camera: THREE.PerspectiveCamera
  resize(aspect: number): void
  update(dt: number): void
  hud(): string
  dispose(): void
}
