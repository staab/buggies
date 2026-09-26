import type { Shot } from '@buggies/game'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import { distanceFrom, type Ear } from './ear.ts'

/** How long a tracer is seen, in seconds. */
export const TRACER_LIFE = 0.1

const GLOW = new THREE.Color('#ffd37a')
/** A laser's beam: red, this thick, and seen for a little longer than a tick so it holds steady while the laser burns. */
const BEAM = new THREE.Color('#ff3030')
const BEAM_RADIUS = 0.07
const BEAM_LIFE = 0.05
/** A rod a meter long, standing up, to be stretched from one end of a beam to the other. */
const ROD = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0)
const UP = new THREE.Vector3(0, 1, 0)

interface Tracer {
  line: THREE.Object3D
  material: THREE.Material & { opacity: number }
  age: number
  life: number
}

/**
 * The machine gun's shots as streaks of light from the muzzle to wherever
 * they stopped, each fading in a blink, and each heard as far off as it is;
 * and the lasers' beams, the robots' eyes' included, as red rods of light
 * that hold as long as the laser burns.
 */
export class Tracers {
  readonly object = new THREE.Group()

  private readonly sound: Sound | null
  private readonly ear: Ear
  private readonly live: Tracer[] = []
  private lastTick = -1

  constructor(sound: Sound | null, ear: Ear) {
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
      if (shot.kind === 'laser') {
        this.beam(shot)
        continue
      }
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(shot.from.x, shot.from.y, shot.from.z),
        new THREE.Vector3(shot.to.x, shot.to.y, shot.to.z),
      ])
      const material = new THREE.LineBasicMaterial({ color: GLOW, transparent: true, opacity: 1 })
      const line = new THREE.Line(geometry, material)
      this.object.add(line)
      this.live.push({ line, material, age: 0, life: TRACER_LIFE })
      this.sound?.shot(distanceFrom(this.ear, shot.from))
    }
  }

  /** A laser's beam from where it was fired to wherever it stopped. */
  private beam(shot: Shot): void {
    const from = new THREE.Vector3(shot.from.x, shot.from.y, shot.from.z)
    const along = new THREE.Vector3(shot.to.x, shot.to.y, shot.to.z).sub(from)
    const length = along.length()
    if (length < 1e-3) return
    const material = new THREE.MeshBasicMaterial({ color: BEAM, transparent: true, opacity: 0.85, depthWrite: false })
    const rod = new THREE.Mesh(ROD, material)
    rod.position.copy(from)
    rod.quaternion.setFromUnitVectors(UP, along.normalize())
    rod.scale.set(BEAM_RADIUS, length, BEAM_RADIUS)
    this.object.add(rod)
    this.live.push({ line: rod, material, age: 0, life: BEAM_LIFE })
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const tracer = this.live[i]
      if (tracer === undefined) continue
      tracer.age += dt
      if (tracer.age >= tracer.life) {
        this.remove(tracer)
        this.live.splice(i, 1)
        continue
      }
      tracer.material.opacity = 1 - tracer.age / tracer.life
    }
  }

  private remove(tracer: Tracer): void {
    this.object.remove(tracer.line)
    // A beam's rod is shared; a tracer's line is its own.
    if (tracer.line instanceof THREE.Line) tracer.line.geometry.dispose()
    tracer.material.dispose()
  }

  dispose(): void {
    for (const tracer of this.live) this.remove(tracer)
    this.live.length = 0
    this.object.removeFromParent()
    this.object.clear()
  }
}
