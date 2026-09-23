// A car as drawn: its model, when one has loaded, or a body of boxes, with
// wheels that follow the simulation's.

import * as THREE from 'three'

import { v3, type Vec3 } from '@buggies/physics'
import type { VehicleProfileId, VehicleTuning } from '@buggies/game'
import { wheelMountLocal, WHEEL_CORNERS, WHEEL_COUNT, type WheelState } from '@buggies/game'

import { carModelFor, type CarModel } from './car-model.ts'

export const PLAYER_BODY_COLOR = 0xd8452f
export const REMOTE_BODY_COLOR = 0x3f6fb5
export const BOT_BODY_COLOR = 0x3f8f5c

/** One colour per seat, so everyone sees the same cars. */
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

/** A colour each, for when a vehicle has to be drawn as boxes. */
const PROFILE_COLORS: Record<VehicleProfileId, number> = {
  raceCar: 0xe8a33a,
  police: 0xf4f4f4,
  firetruck: 0xc8252b,
  pickup: 0x3f6fb5,
  sportsCar: 0xd8452f,
  smallCar: 0x6fd3c7,
  tank: 0x6b7a3a,
  ambulance: 0xf7f2e8,
  semi: 0xe6e6e6,
  goKart: 0x9b59b6,
}

export function profileColor(profile: VehicleProfileId): number {
  return PROFILE_COLORS[profile]
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

/** A drawn wheel, and which of the simulated wheels it follows. */
interface DrawnWheel {
  pivot: THREE.Object3D
  /** Which simulated wheel it follows, in `WHEEL_CORNERS` order. */
  corner: number
  /** Where its hub sits across and along the chassis: the model's own place for it. */
  x: number
  z: number
}

function cornerIndex(isFront: boolean, isLeft: boolean): number {
  return WHEEL_CORNERS.findIndex((corner) => corner.isFront === isFront && corner.isLeft === isLeft)
}

export class CarView {
  readonly object: THREE.Group

  private readonly chassisMesh: THREE.Mesh | null = null
  private readonly cabinMesh: THREE.Mesh | null = null
  private readonly wheelMeshes: THREE.Mesh[] = []
  private readonly drawnWheels: DrawnWheel[] = []
  private readonly materials: THREE.Material[] = []
  private readonly mountLocal: Vec3 = v3()
  /** Whether the wheels sit where the model has them or where the tuning does. */
  private readonly modelled: boolean

  constructor(profile: VehicleProfileId, bodyColor: number, model: CarModel | null = carModelFor(profile)) {
    this.object = new THREE.Group()
    this.modelled = model !== null

    if (model !== null) {
      this.object.add(model.body.clone())
      for (const wheel of model.wheels) {
        const pivot = new THREE.Group()
        pivot.rotation.order = 'YXZ'
        pivot.add(wheel.group.clone())
        this.object.add(pivot)
        this.drawnWheels.push({
          pivot,
          corner: cornerIndex(wheel.isFront, wheel.isLeft),
          x: wheel.x,
          z: wheel.z,
        })
      }
      return
    }

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
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: WHEEL_COLOR, roughness: 0.85 })

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
      this.drawnWheels.push({ pivot: mesh, corner: index, x: 0, z: 0 })
    }
  }

  /** A blown-up car is gone, nothing left to draw, until it is put back. */
  setWrecked(wrecked: boolean): void {
    this.object.visible = !wrecked
  }

  syncDimensions(tuning: VehicleTuning): void {
    // A model is already the size its tuning was measured from.
    if (this.chassisMesh === null || this.cabinMesh === null) return

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
    for (const drawn of this.drawnWheels) {
      const wheel = wheels[drawn.corner]

      if (wheel === undefined) continue

      this.placeWheel(drawn, wheel, tuning, wheel.suspensionLength)
      drawn.pivot.rotation.set(-wheel.spin, -wheel.steerAngle, 0)
    }
  }

  applyRollingWheels(tuning: VehicleTuning, spin: number): void {
    const suspensionLength = tuning.suspensionRestLength * LOADED_SUSPENSION_FRACTION

    for (const drawn of this.drawnWheels) {
      const corner = WHEEL_CORNERS[drawn.corner]

      if (corner === undefined) continue

      this.placeWheel(drawn, corner, tuning, suspensionLength)
      drawn.pivot.rotation.set(-spin, 0, 0)
    }
  }

  /**
   * A wheel hangs below its mount by its suspension's length. A
   * model's wheel keeps the model's place for it across and along the
   * chassis, so it stays in its arch; the boxes' wheels take the tuning's.
   */
  private placeWheel(
    drawn: DrawnWheel,
    corner: { readonly isFront: boolean; readonly isLeft: boolean },
    tuning: VehicleTuning,
    suspensionLength: number,
  ): void {
    wheelMountLocal(this.mountLocal, corner, tuning)
    drawn.pivot.position.set(
      this.modelled ? drawn.x : this.mountLocal.x,
      this.mountLocal.y - suspensionLength,
      this.modelled ? drawn.z : this.mountLocal.z,
    )
  }

  dispose(): void {
    this.object.removeFromParent()
    this.object.clear()

    for (const material of this.materials) material.dispose()

    this.materials.length = 0
    this.wheelMeshes.length = 0
    this.drawnWheels.length = 0
  }
}
