import type { Weapon } from '@buggies/game'
import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

const SHELL = new THREE.Color('#ece7dd')
const NOSE = new THREE.Color('#d8402c')
const STEEL = new THREE.Color('#2c3038')
const BARREL = new THREE.Color('#4b525c')
const BRASS = new THREE.Color('#c9a24b')

/** How the mount bobs and sways as it hovers. */
const BOB = 0.08
const BOB_RATE = 2.4
const SWAY = 0.06
const SWAY_RATE = 1.1
/** How quickly the gun swings onto what it is trained on, per second. */
const AIM_RATE = 10

function metal(color: THREE.Color, roughness = 0.5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.2 })
}

/** A rocket: a pale tube with a red nose and three fins, pointing the way the car does. */
export function buildRocket(): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 12), metal(SHELL))
  body.rotation.x = Math.PI / 2
  group.add(body)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 12), metal(NOSE, 0.4))
  nose.rotation.x = -Math.PI / 2
  nose.position.z = -0.875
  group.add(nose)
  const finMaterial = metal(NOSE, 0.6)
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.32, 0.3), finMaterial)
    const pivot = new THREE.Group()
    pivot.rotation.z = (i * 2 * Math.PI) / 3
    fin.position.set(0, 0.28, 0.5)
    pivot.add(fin)
    group.add(pivot)
  }
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

/**
 * A machine gun: a dark receiver with a barrel out the front and a box of
 * rounds on the side. Its barrel runs along +Z, the way `lookAt` turns a
 * thing, so it is turned about to face the way the car does at rest.
 */
export function buildGun(): THREE.Group {
  const group = new THREE.Group()
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.8), metal(STEEL))
  group.add(receiver)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 10), metal(BARREL, 0.35))
  barrel.rotation.x = Math.PI / 2
  barrel.position.z = 0.85
  group.add(barrel)
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 10), metal(STEEL))
  brake.rotation.x = Math.PI / 2
  brake.position.z = 1.25
  group.add(brake)
  const rounds = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.32), metal(BRASS, 0.45))
  rounds.position.set(-0.28, -0.02, -0.05)
  group.add(rounds)
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

/** A bomb: a black ball with a short fuse, its end glowing. */
export function buildBomb(): THREE.Group {
  const group = new THREE.Group()
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), metal(new THREE.Color('#202226'), 0.45))
  group.add(ball)
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), metal(new THREE.Color('#8a7a5a'), 0.8))
  fuse.position.y = 0.5
  group.add(fuse)
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 5),
    new THREE.MeshStandardMaterial({ color: '#ff9a3c', emissive: '#ff6a1c', emissiveIntensity: 1.5 }),
  )
  ember.position.y = 0.62
  group.add(ember)
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

function disposeModel(model: THREE.Object3D): void {
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    node.geometry.dispose()
    if (node.material instanceof THREE.Material) node.material.dispose()
  })
}

const AHEAD = new THREE.Quaternion(0, 1, 0, 0)
const sight = new THREE.Object3D()
const gunAt = new THREE.Vector3()
const mountTurn = new THREE.Quaternion()

/**
 * What a car is carrying, hovering over its roof for everyone to see: the
 * rocket until it goes, the gun until it runs dry, swung onto whatever it
 * is trained on. It bobs a little.
 */
export class WeaponMount {
  readonly object = new THREE.Group()

  private readonly rocket = buildRocket()
  private readonly gun = buildGun()
  private readonly bomb = buildBomb()
  private readonly height: number
  private readonly desired = AHEAD.clone()
  private shownWeapon: Weapon = 'none'
  private time = 0

  constructor(height: number) {
    this.height = height
    this.object.position.y = height
    this.rocket.visible = false
    this.gun.visible = false
    this.bomb.visible = false
    this.gun.quaternion.copy(AHEAD)
    this.object.add(this.rocket, this.gun, this.bomb)
  }

  /** Where the gun points: at this, or dead ahead for nothing. */
  get aimed(): THREE.Quaternion {
    return this.gun.quaternion
  }

  /**
   * Swing the gun toward a point in the world, or back to dead ahead,
   * easing over a few frames. Worked out in the mount's own frame, so it
   * holds as the car turns under it.
   */
  aim(point: Vec3 | null, dt: number): void {
    if (point === null) this.desired.copy(AHEAD)
    else {
      this.gun.getWorldPosition(gunAt)
      sight.position.copy(gunAt)
      sight.lookAt(point.x, point.y, point.z)
      this.object.getWorldQuaternion(mountTurn)
      this.desired.copy(mountTurn.invert()).multiply(sight.quaternion)
    }
    this.gun.quaternion.slerp(this.desired, 1 - Math.exp(-dt * AIM_RATE))
  }

  get shown(): Weapon {
    return this.shownWeapon
  }

  show(weapon: Weapon): void {
    if (weapon === this.shownWeapon) return
    this.shownWeapon = weapon
    this.rocket.visible = weapon === 'rocket'
    this.gun.visible = weapon === 'machineGun'
    this.bomb.visible = weapon === 'bomb'
  }

  update(dt: number): void {
    this.time += dt
    this.object.position.y = this.height + Math.sin(this.time * BOB_RATE) * BOB
    this.object.rotation.y = Math.sin(this.time * SWAY_RATE) * SWAY
  }

  dispose(): void {
    this.object.removeFromParent()
    disposeModel(this.rocket)
    disposeModel(this.gun)
    disposeModel(this.bomb)
    this.object.clear()
  }
}
