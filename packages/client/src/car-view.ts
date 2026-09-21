// Ported from the seattle project (src/game/carView.ts). Kept in its original shape
// and formatting so the two can be compared and resynced.

import * as THREE from 'three'

import {v3, type Vec3} from '@buggies/physics'
import type {VehicleTuning} from '@buggies/game'
import {
  wheelMountLocal,
  WHEEL_CORNERS,
  WHEEL_COUNT,
  type WheelState,
} from '@buggies/game'

export const PLAYER_BODY_COLOR = 0xd8452f
export const REMOTE_BODY_COLOR = 0x3f6fb5
export const BOT_BODY_COLOR = 0x3f8f5c

/** Buggies addition: one colour per seat, so everyone sees the same cars. */
const SEAT_COLORS = [
  PLAYER_BODY_COLOR,
  REMOTE_BODY_COLOR,
  0xe8a33a,
  BOT_BODY_COLOR,
  0x9b59b6,
  0x1abc9c,
  0xf06292,
  0xecf0f1,
]

export function seatColor(seat: number): number {
  return SEAT_COLORS[seat % SEAT_COLORS.length]!
}

const CABIN_COLOR = 0x1f2933
const WHEEL_COLOR = 0x14181d

const CABIN_WIDTH_FRACTION = 0.78
const CABIN_HEIGHT_FRACTION = 0.85
const CABIN_LENGTH_FRACTION = 0.42
const CABIN_LIFT_FRACTION = 0.9
const CABIN_SETBACK_FRACTION = 0.06
const WHEEL_WIDTH_PER_RADIUS = 0.75
const LOADED_SUSPENSION_FRACTION = 0.7

const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1)
const unitWheelGeometry = new THREE.CylinderGeometry(1, 1, 1, 20).rotateZ(Math.PI / 2)

export class CarView {
  readonly object: THREE.Group

  private readonly chassisMesh: THREE.Mesh
  private readonly cabinMesh: THREE.Mesh
  private readonly wheelMeshes: THREE.Mesh[] = []
  private readonly materials: THREE.Material[] = []
  private readonly mountLocal: Vec3 = v3()

  constructor(bodyColor: number) {
    this.object = new THREE.Group()

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.45,
      metalness: 0.1,
    })
    const cabinMaterial = new THREE.MeshStandardMaterial({
      color: CABIN_COLOR,
      roughness: 0.3,
      metalness: 0.2,
    })
    const wheelMaterial = new THREE.MeshStandardMaterial({color: WHEEL_COLOR, roughness: 0.85})

    this.materials.push(bodyMaterial, cabinMaterial, wheelMaterial)

    this.chassisMesh = new THREE.Mesh(unitBoxGeometry, bodyMaterial)
    this.chassisMesh.castShadow = true
    this.chassisMesh.receiveShadow = true
    this.object.add(this.chassisMesh)

    this.cabinMesh = new THREE.Mesh(unitBoxGeometry, cabinMaterial)
    this.cabinMesh.castShadow = true
    this.object.add(this.cabinMesh)

    for (let index = 0; index < WHEEL_COUNT; index += 1) {
      const mesh = new THREE.Mesh(unitWheelGeometry, wheelMaterial)

      mesh.castShadow = true
      mesh.rotation.order = 'YXZ'
      this.wheelMeshes.push(mesh)
      this.object.add(mesh)
    }
  }

  syncDimensions(tuning: VehicleTuning): void {
    const width = tuning.chassisHalfWidth * 2
    const height = tuning.chassisHalfHeight * 2
    const length = tuning.chassisHalfLength * 2

    this.chassisMesh.scale.set(width, height, length)
    this.cabinMesh.scale.set(
      width * CABIN_WIDTH_FRACTION,
      height * CABIN_HEIGHT_FRACTION,
      length * CABIN_LENGTH_FRACTION,
    )
    this.cabinMesh.position.set(0, height * CABIN_LIFT_FRACTION, -length * CABIN_SETBACK_FRACTION)

    const wheelWidth = tuning.wheelRadius * WHEEL_WIDTH_PER_RADIUS

    for (const mesh of this.wheelMeshes) {
      mesh.scale.set(wheelWidth, tuning.wheelRadius, tuning.wheelRadius)
    }
  }

  applySimulatedWheels(wheels: readonly WheelState[], tuning: VehicleTuning): void {
    for (const [index, wheel] of wheels.entries()) {
      const mesh = this.wheelMeshes[index]

      if (mesh === undefined) continue

      wheelMountLocal(this.mountLocal, wheel, tuning)
      mesh.position.set(
        this.mountLocal.x,
        this.mountLocal.y - wheel.suspensionLength,
        this.mountLocal.z,
      )
      mesh.rotation.set(-wheel.spin, -wheel.steerAngle, 0)
    }
  }

  applyRollingWheels(tuning: VehicleTuning, spin: number): void {
    const suspensionLength = tuning.suspensionRestLength * LOADED_SUSPENSION_FRACTION

    for (const [index, corner] of WHEEL_CORNERS.entries()) {
      const mesh = this.wheelMeshes[index]

      if (mesh === undefined) continue

      wheelMountLocal(this.mountLocal, corner, tuning)
      mesh.position.set(this.mountLocal.x, this.mountLocal.y - suspensionLength, this.mountLocal.z)
      mesh.rotation.set(-spin, 0, 0)
    }
  }

  dispose(): void {
    this.object.removeFromParent()
    this.object.clear()

    for (const material of this.materials) material.dispose()

    this.materials.length = 0
    this.wheelMeshes.length = 0
  }
}
