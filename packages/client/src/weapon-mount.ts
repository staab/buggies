import type { Weapon } from '@buggies/game'
import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

import { disposeObject } from './dispose.ts'
import {
  buildBolt,
  buildBomb,
  buildEngine,
  buildGrapple,
  buildGun,
  buildHorn,
  buildMagnet,
  buildMines,
  buildOil,
  buildPlow,
  buildRepair,
  buildRocket,
  buildShield,
  buildTripleRocket,
  buildWings,
} from './weapon-models.ts'

/** What a car with a gun of its own fires from that gun, and so does not carry over its roof. */
const FROM_THE_GUN: readonly Weapon[] = ['rocket', 'machineGun', 'tripleRocket']

/** How the mount bobs and sways as it hovers. */
const BOB = 0.08
const BOB_RATE = 2.4
const SWAY = 0.06
const SWAY_RATE = 1.1
/** How quickly the gun swings onto what it is trained on, per second. */
const AIM_RATE = 10

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

  private readonly gun = buildGun()
  private readonly engine = buildEngine()
  private readonly horn = buildHorn()
  /** A model for everything that can be carried, one each. */
  private readonly models: Readonly<Record<Exclude<Weapon, 'none'>, THREE.Object3D>> = {
    rocket: buildRocket(),
    machineGun: this.gun,
    bomb: buildBomb(),
    engine: this.engine.model,
    wings: buildWings(),
    shockwave: buildBolt(),
    siren: this.horn,
    repair: buildRepair(),
    oil: buildOil(),
    shield: buildShield(),
    magnet: buildMagnet(),
    tripleRocket: buildTripleRocket(),
    plow: buildPlow(),
    grapple: buildGrapple(),
    mines: buildMines(),
  }
  private readonly height: number
  /** Whether the car has a gun of its own: the rocket and the gun are not mounted over its roof. */
  private readonly builtInGun: boolean
  /** Where the siren's base stands still on the roof, in the car's frame; it hovers with the rest when unknown. */
  private readonly sirenRest: number | null
  private readonly desired = AHEAD.clone()
  private shownWeapon: Weapon = 'none'
  private time = 0

  constructor(height: number, builtInGun = false, sirenRest: number | null = null) {
    this.height = height
    this.builtInGun = builtInGun
    this.sirenRest = sirenRest
    this.object.position.y = height
    for (const model of Object.values(this.models)) {
      model.visible = false
      this.object.add(model)
    }
    this.gun.quaternion.copy(AHEAD)
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
    const hidden = this.builtInGun && FROM_THE_GUN.includes(weapon)
    for (const [carried, model] of Object.entries(this.models)) model.visible = carried === weapon && !hidden
  }

  update(dt: number): void {
    this.time += dt
    this.object.position.y = this.height + Math.sin(this.time * BOB_RATE) * BOB
    this.object.rotation.y = Math.sin(this.time * SWAY_RATE) * SWAY
    if (this.sirenRest !== null) {
      this.horn.position.y = this.sirenRest - this.object.position.y
      this.horn.rotation.y = -this.object.rotation.y
    }
  }

  /** Whether the engine's flame is out behind it, flickering. */
  burn(on: boolean): void {
    const { flame } = this.engine
    flame.visible = on && this.shownWeapon === 'engine'
    if (!flame.visible) return
    const flicker = 0.75 + 0.25 * Math.sin(this.time * 47) * Math.sin(this.time * 31)
    flame.scale.set(flicker, flicker, 0.8 + 0.5 * flicker)
  }

  dispose(): void {
    this.object.removeFromParent()
    for (const model of Object.values(this.models)) disposeObject(model)
    this.object.clear()
  }
}
