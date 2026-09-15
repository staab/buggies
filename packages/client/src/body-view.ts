// Ported from the seattle project (src/game/bodyView.ts). Kept in its original shape
// and formatting so the two can be compared and resynced.

import type * as RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'

import {quat, v3} from '@buggies/physics'

const scratchTranslation = v3()
const scratchRotation = quat()

export class BodyView {
  readonly body: RAPIER.RigidBody
  readonly object: THREE.Object3D

  private readonly previousPosition = new THREE.Vector3()
  private readonly previousRotation = new THREE.Quaternion()
  private readonly currentPosition = new THREE.Vector3()
  private readonly currentRotation = new THREE.Quaternion()

  constructor(body: RAPIER.RigidBody, object: THREE.Object3D) {
    this.body = body
    this.object = object
    this.reset()
  }

  capture(): void {
    this.previousPosition.copy(this.currentPosition)
    this.previousRotation.copy(this.currentRotation)

    this.body.translation(scratchTranslation)
    this.body.rotation(scratchRotation)

    this.currentPosition.set(scratchTranslation.x, scratchTranslation.y, scratchTranslation.z)
    this.currentRotation.set(
      scratchRotation.x,
      scratchRotation.y,
      scratchRotation.z,
      scratchRotation.w,
    )
  }

  reset(): void {
    this.capture()
    this.previousPosition.copy(this.currentPosition)
    this.previousRotation.copy(this.currentRotation)
    this.apply(1)
  }

  apply(accumulatorFraction: number): void {
    this.object.position.lerpVectors(
      this.previousPosition,
      this.currentPosition,
      accumulatorFraction,
    )
    this.object.quaternion
      .copy(this.previousRotation)
      .slerp(this.currentRotation, accumulatorFraction)
  }
}
