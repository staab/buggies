import type { LocalPrediction, PredictionUpdate, ReconcileOutcome, SendInput } from '@buggies/net'
import type * as THREE from 'three'

import { CarView } from './car-view.ts'
import type { ChaseTarget } from './chase-camera.ts'
import type { MirrorCars } from './mirror-cars.ts'
import { SmoothedBody } from './smoothed-body.ts'

/**
 * The local car as drawn: it follows the predicted body, with each server
 * correction eased away rather than shown as a jump.
 */
export class PredictedCar {
  readonly object: THREE.Group

  private readonly view: CarView
  private readonly body: SmoothedBody

  constructor(
    private readonly prediction: LocalPrediction,
    private readonly send: SendInput,
    color: number,
  ) {
    this.view = new CarView(color)
    this.view.syncDimensions(prediction.tuning)
    this.object = this.view.object
    this.body = new SmoothedBody(prediction.vehicle.body, this.object)
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

  /**
   * One fixed step: take in the server's word, then run ahead again. The
   * other cars of the mirror are corrected and stepped along with this one.
   */
  tick(update: PredictionUpdate, others?: MirrorCars): ReconcileOutcome {
    const outcome = this.prediction.reconcile(update.newestSnapshot)
    if (outcome === 'replayed') this.body.absorbCorrection()
    if (outcome === 'resynced') this.body.snapToBody()
    others?.reconciled(outcome)
    this.prediction.advance(update, this.send)
    this.body.captureStep()
    others?.stepped()
    return outcome
  }

  render(fraction: number, dt: number): void {
    this.body.render(fraction, dt)
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
}
