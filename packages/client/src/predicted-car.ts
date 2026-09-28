import type { VehicleProfileId } from '@buggies/game'
import type { LocalPrediction, PredictionUpdate, ReconcileOutcome, SendInput } from '@buggies/net'
import * as THREE from 'three'

import { CarPresence, type PresenceEffects } from './car-presence.ts'
import type { MirrorCars } from './mirror-cars.ts'

/**
 * The local car: the prediction that drives it, and its presence on the
 * screen, which follows the predicted body with each server correction
 * eased away rather than shown as a jump. Put in another vehicle, it is
 * drawn afresh as that one.
 */
export class PredictedCar {
  readonly object = new THREE.Group()
  private current: CarPresence
  private profile: VehicleProfileId

  constructor(
    private readonly prediction: LocalPrediction,
    private readonly send: SendInput,
    private readonly color: number,
    private readonly effects: PresenceEffects,
  ) {
    this.current = new CarPresence(prediction.ownSeat, color, effects, { beam: true })
    this.profile = prediction.ownSeat.profile
    this.object.add(this.current.object)
  }

  get presence(): CarPresence {
    return this.current
  }

  /**
   * One fixed step: take in the server's word, then run ahead again. The
   * other cars of the mirror are corrected and stepped along with this one.
   */
  tick(update: PredictionUpdate, others?: MirrorCars): ReconcileOutcome {
    const outcome = this.prediction.reconcile(update.newestSnapshot)
    if (this.prediction.ownSeat.profile !== this.profile) this.redraw()
    // A correction is eased away, a fresh start after a stall too, unless it is too far to be anything but a jump.
    if (outcome !== 'idle') this.presence.body.absorbCorrection()
    others?.reconciled(outcome)
    this.prediction.advance(update, this.send)
    this.presence.body.captureStep()
    others?.stepped()
    return outcome
  }

  /** The server has put the car in another vehicle: draw that one instead. */
  private redraw(): void {
    this.current.dispose()
    this.object.remove(this.current.object)
    this.current = new CarPresence(this.prediction.ownSeat, this.color, this.effects, { beam: true })
    this.current.body.snapToBody()
    this.profile = this.prediction.ownSeat.profile
    this.object.add(this.current.object)
  }

  dispose(): void {
    this.current.dispose()
    this.prediction.dispose()
  }
}
