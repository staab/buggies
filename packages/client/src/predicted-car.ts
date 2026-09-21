import type { LocalPrediction, PredictionUpdate, ReconcileOutcome } from '@buggies/net'
import { quat, v3 } from '@buggies/physics'
import * as THREE from 'three'

import { BodyView } from './body-view.ts'
import { CarView } from './car-view.ts'
import type { ChaseTarget } from './chase-camera.ts'
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
 * The local car as drawn. It follows the predicted body, except that when a
 * server correction moves the body it keeps drawing the car where it was and
 * eases the difference away over a few frames, so a correction reads as a
 * nudge rather than a jump.
 */
export class PredictedCar {
  readonly object: THREE.Group

  private readonly view: CarView
  private readonly body: BodyView
  private readonly captured = new THREE.Vector3()
  private readonly capturedRotation = new THREE.Quaternion()
  private readonly corrected = new THREE.Vector3()
  private readonly correctedRotation = new THREE.Quaternion()
  private readonly offset = new THREE.Vector3()
  private readonly offsetRotation = new THREE.Quaternion()
  private readonly undone = new THREE.Quaternion()

  constructor(
    private readonly prediction: LocalPrediction,
    color: number,
  ) {
    this.view = new CarView(color)
    this.view.syncDimensions(prediction.tuning)
    this.object = this.view.object
    this.body = new BodyView(prediction.vehicle.body, this.object)
    this.readBody(this.captured, this.capturedRotation)
  }

  get speed(): number {
    return this.prediction.vehicle.speed
  }

  get wrecked(): boolean {
    return this.prediction.vehicle.wrecked
  }

  setWrecked(wrecked: boolean): void {
    this.view.setWrecked(wrecked)
  }

  /** One fixed step: take in the server's word, then run ahead again. */
  tick(update: PredictionUpdate): ReconcileOutcome {
    const outcome = this.prediction.reconcile(update.newestSnapshot)
    if (outcome === 'replayed') this.absorbCorrection()
    if (outcome === 'resynced') this.snapToBody()
    this.prediction.advance(update)
    this.capture()
    return outcome
  }

  render(fraction: number, dt: number): void {
    const remaining = remainingFraction(CORRECTION_DECAY_RATE, dt)
    this.offset.multiplyScalar(remaining)
    this.offsetRotation.slerp(NO_ROTATION, 1 - remaining)

    this.body.apply(fraction)
    this.object.position.add(this.offset)
    this.object.quaternion.premultiply(this.offsetRotation)
    this.view.applySimulatedWheels(this.prediction.vehicle.wheels, this.prediction.tuning)
  }

  aim(target: ChaseTarget): void {
    const { body, speed, wrecked } = this.prediction.vehicle
    body.translation(target.position)
    body.rotation(target.rotation)
    body.linvel(target.velocity)
    target.speed = speed
    target.wrecked = wrecked
  }

  dispose(): void {
    this.view.dispose()
    this.prediction.dispose()
  }

  private capture(): void {
    this.body.capture()
    this.readBody(this.captured, this.capturedRotation)
  }

  private absorbCorrection(): void {
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
    this.capture()
  }

  private snapToBody(): void {
    this.forgetCorrection()
    this.body.reset()
    this.readBody(this.captured, this.capturedRotation)
  }

  private forgetCorrection(): void {
    this.offset.set(0, 0, 0)
    this.offsetRotation.identity()
  }

  private readBody(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    const { body } = this.prediction.vehicle
    body.translation(scratchTranslation)
    body.rotation(scratchRotation)
    position.set(scratchTranslation.x, scratchTranslation.y, scratchTranslation.z)
    rotation.set(scratchRotation.x, scratchRotation.y, scratchRotation.z, scratchRotation.w)
  }
}
