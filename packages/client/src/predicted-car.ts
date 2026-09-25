import type { LocalPrediction, PredictionUpdate, ReconcileOutcome, SendInput } from '@buggies/net'
import type * as THREE from 'three'

import { CarPresence, type PresenceEffects } from './car-presence.ts'
import type { MirrorCars } from './mirror-cars.ts'

/**
 * The local car: the prediction that drives it, and its presence on the
 * screen, which follows the predicted body with each server correction
 * eased away rather than shown as a jump.
 */
export class PredictedCar {
  readonly presence: CarPresence

  constructor(
    private readonly prediction: LocalPrediction,
    private readonly send: SendInput,
    color: number,
    effects: PresenceEffects,
  ) {
    this.presence = new CarPresence(prediction.ownSeat, color, effects)
  }

  get object(): THREE.Group {
    return this.presence.object
  }

  /**
   * One fixed step: take in the server's word, then run ahead again. The
   * other cars of the mirror are corrected and stepped along with this one.
   */
  tick(update: PredictionUpdate, others?: MirrorCars): ReconcileOutcome {
    const outcome = this.prediction.reconcile(update.newestSnapshot)
    // A correction is eased away, a fresh start after a stall too, unless it is too far to be anything but a jump.
    if (outcome !== 'idle') this.presence.body.absorbCorrection()
    others?.reconciled(outcome)
    this.prediction.advance(update, this.send)
    this.presence.body.captureStep()
    others?.stepped()
    return outcome
  }

  dispose(): void {
    this.presence.dispose()
    this.prediction.dispose()
  }
}
