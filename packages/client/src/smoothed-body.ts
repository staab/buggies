import type * as RAPIER from '@dimforge/rapier3d-compat'
import { quat, v3 } from '@buggies/physics'
import * as THREE from 'three'

import { BodyView } from './body-view.ts'
import { remainingFraction } from './damping.ts'

/** How quickly a correction is folded away, per second. */
const CORRECTION_DECAY_RATE = 16

/** Corrections bigger than this are shown at once: hiding them would look worse. */
const LARGEST_SMOOTHED_CORRECTION_METRES = 1.5
const LARGEST_SMOOTHED_CORRECTION_RADIANS = 0.5

const NO_ROTATION = new THREE.Quaternion()
const scratchTranslation = v3()
const scratchRotation = quat()

/**
 * A body of the mirror as drawn. The object follows the body, except that
 * when a server correction moves the body it keeps drawing the object where
 * it was and eases the difference away over a few frames, so a correction
 * reads as a nudge rather than a jump.
 */
export class SmoothedBody {
  private readonly view: BodyView
  private readonly body: RAPIER.RigidBody
  private readonly captured = new THREE.Vector3()
  private readonly capturedRotation = new THREE.Quaternion()
  private readonly corrected = new THREE.Vector3()
  private readonly correctedRotation = new THREE.Quaternion()
  private readonly offset = new THREE.Vector3()
  private readonly offsetRotation = new THREE.Quaternion()
  private readonly undone = new THREE.Quaternion()

  constructor(body: RAPIER.RigidBody, object: THREE.Object3D) {
    this.body = body
    this.view = new BodyView(body, object)
    this.readBody(this.captured, this.capturedRotation)
  }

  /** After a step: where the body is now, to draw between and to measure a correction against. */
  captureStep(): void {
    this.view.capture()
    this.readBody(this.captured, this.capturedRotation)
  }

  /** After a correction has moved the body: carry the difference, to ease away. */
  absorbCorrection(): void {
    this.readBody(this.corrected, this.correctedRotation)
    this.undone.copy(this.correctedRotation).invert()
    this.offset.add(this.captured).sub(this.corrected)
    this.offsetRotation.multiply(this.capturedRotation).multiply(this.undone)
    if (
      this.offset.length() > LARGEST_SMOOTHED_CORRECTION_METRES ||
      this.offsetRotation.angleTo(NO_ROTATION) > LARGEST_SMOOTHED_CORRECTION_RADIANS
    ) {
      this.forgetCorrection()
    }
    this.captureStep()
  }

  /** Draw the body where it is, at once. */
  snapToBody(): void {
    this.forgetCorrection()
    this.view.reset()
    this.readBody(this.captured, this.capturedRotation)
  }

  render(fraction: number, dt: number): void {
    const remaining = remainingFraction(CORRECTION_DECAY_RATE, dt)
    this.offset.multiplyScalar(remaining)
    this.offsetRotation.slerp(NO_ROTATION, 1 - remaining)
    this.view.apply(fraction)
    this.view.object.position.add(this.offset)
    this.view.object.quaternion.premultiply(this.offsetRotation)
  }

  private forgetCorrection(): void {
    this.offset.set(0, 0, 0)
    this.offsetRotation.identity()
  }

  private readBody(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    this.body.translation(scratchTranslation)
    this.body.rotation(scratchRotation)
    position.set(scratchTranslation.x, scratchTranslation.y, scratchTranslation.z)
    rotation.set(scratchRotation.x, scratchRotation.y, scratchRotation.z, scratchRotation.w)
  }
}
