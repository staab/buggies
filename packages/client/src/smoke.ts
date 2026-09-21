import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

/** How many puffs can be in the air at once, over every car. */
const PUFFS = 240
/** A puff's life in seconds, and how many a badly damaged car gives off per second. */
const LIFE = 1.8
const RATE = 26
/** How fast a puff rises, and how much of the car's speed it keeps. */
const RISE = 2.2
const DRAG = 0.35
const SIZE = { start: 0.5, end: 2.6 } as const

const SOOT = new THREE.Color('#3a3a3a')

interface Puff {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  velocity: THREE.Vector3
  age: number
  alive: boolean
}

/**
 * Smoke pouring off damaged cars: grey puffs that rise, spread and thin out.
 * A pool of puffs is reused round and round, so nothing is made mid-race.
 */
export class Smoke {
  readonly object = new THREE.Group()

  private readonly puffs: Puff[] = []
  private readonly ball = new THREE.SphereGeometry(1, 8, 6)
  private next = 0
  private owed = 0

  constructor() {
    for (let i = 0; i < PUFFS; i++) {
      const material = new THREE.MeshBasicMaterial({ color: SOOT, transparent: true, opacity: 0, depthWrite: false })
      const mesh = new THREE.Mesh(this.ball, material)
      mesh.visible = false
      this.object.add(mesh)
      this.puffs.push({ mesh, material, velocity: new THREE.Vector3(), age: 0, alive: false })
    }
  }

  /** Give off smoke at a point for a frame: `amount` runs 0 (none) to 1 (pouring). */
  trail(at: Vec3, velocity: Vec3, amount: number, dt: number): void {
    if (amount <= 0) return
    this.owed += RATE * amount * dt
    while (this.owed >= 1) {
      this.owed -= 1
      const puff = this.puffs[this.next]!
      this.next = (this.next + 1) % PUFFS
      puff.alive = true
      puff.age = 0
      puff.mesh.visible = true
      puff.mesh.position.set(at.x, at.y + 0.6, at.z)
      puff.mesh.scale.setScalar(SIZE.start)
      // A little sideways scatter, from where in the pool the puff is.
      const scatter = (this.next % 7) - 3
      puff.velocity.set(velocity.x * DRAG + scatter * 0.3, RISE + velocity.y * DRAG, velocity.z * DRAG - scatter * 0.2)
      puff.material.opacity = 0.55 * (0.5 + 0.5 * amount)
    }
  }

  update(dt: number): void {
    for (const puff of this.puffs) {
      if (!puff.alive) continue
      puff.age += dt
      const life = puff.age / LIFE
      if (life >= 1) {
        puff.alive = false
        puff.mesh.visible = false
        continue
      }
      puff.mesh.position.addScaledVector(puff.velocity, dt)
      puff.velocity.multiplyScalar(1 - 0.8 * dt)
      puff.velocity.y += RISE * 0.4 * dt
      puff.mesh.scale.setScalar(SIZE.start + (SIZE.end - SIZE.start) * life)
      puff.material.opacity *= 1 - 1.6 * dt
    }
  }

  dispose(): void {
    for (const puff of this.puffs) puff.material.dispose()
    this.puffs.length = 0
    this.object.removeFromParent()
    this.object.clear()
    this.ball.dispose()
  }
}
