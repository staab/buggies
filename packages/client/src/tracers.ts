import type { Shot } from '@buggies/game'
import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

import type { Sound } from './audio.ts'

/** How long a tracer is seen, in seconds. */
export const TRACER_LIFE = 0.1

const GLOW = new THREE.Color('#ffd37a')

interface Tracer {
  line: THREE.Line
  material: THREE.LineBasicMaterial
  age: number
}

/**
 * The machine gun's shots as streaks of light from the muzzle to wherever
 * they stopped, each fading in a blink, and each heard as far off as it is.
 */
export class Tracers {
  readonly object = new THREE.Group()

  private readonly sound: Sound | null
  private readonly ear: () => Vec3
  private readonly live: Tracer[] = []
  private lastTick = -1

  constructor(sound: Sound | null, ear: () => Vec3) {
    this.sound = sound
    this.ear = ear
  }

  get shown(): number {
    return this.live.length
  }

  /** The shots of a tick, taken once however many frames the tick lasts. */
  fire(shots: readonly Shot[], tick: number): void {
    if (tick === this.lastTick) return
    this.lastTick = tick
    for (const shot of shots) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(shot.from.x, shot.from.y, shot.from.z),
        new THREE.Vector3(shot.to.x, shot.to.y, shot.to.z),
      ])
      const material = new THREE.LineBasicMaterial({ color: GLOW, transparent: true, opacity: 1 })
      const line = new THREE.Line(geometry, material)
      this.object.add(line)
      this.live.push({ line, material, age: 0 })
      const ear = this.ear()
      this.sound?.shot(Math.hypot(shot.from.x - ear.x, shot.from.y - ear.y, shot.from.z - ear.z))
    }
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const tracer = this.live[i]
      if (tracer === undefined) continue
      tracer.age += dt
      if (tracer.age >= TRACER_LIFE) {
        this.remove(tracer)
        this.live.splice(i, 1)
        continue
      }
      tracer.material.opacity = 1 - tracer.age / TRACER_LIFE
    }
  }

  private remove(tracer: Tracer): void {
    this.object.remove(tracer.line)
    tracer.line.geometry.dispose()
    tracer.material.dispose()
  }

  dispose(): void {
    for (const tracer of this.live) this.remove(tracer)
    this.live.length = 0
    this.object.removeFromParent()
    this.object.clear()
  }
}
