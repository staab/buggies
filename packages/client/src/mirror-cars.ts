import type { Seat, VehicleProfileId } from '@buggies/game'
import type { LocalPrediction, ReconcileOutcome } from '@buggies/net'
import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

import { CarView, seatColor } from './car-view.ts'
import { smokeAmount } from './damage.ts'
import type { Smoke } from './smoke.ts'
import { SmoothedBody } from './smoothed-body.ts'

interface Entry {
  seat: Seat
  profile: VehicleProfileId
  view: CarView
  body: SmoothedBody
  wrecked: boolean
}

/**
 * Everyone else's car, drawn where the mirror has it: the very body the local
 * car is driven against, run ahead from the last snapshot, so what is seen is
 * what is hit. Each snapshot's correction to a car is eased away the same way
 * as the local car's own.
 */
export class MirrorCars {
  readonly object = new THREE.Group()

  private readonly entries = new Map<number, Entry>()

  constructor(
    private readonly prediction: LocalPrediction,
    private readonly ownSeat: number,
    /** Called where a car blows up, the moment the server first says it has. */
    private readonly onWreck: (at: Vec3) => void = () => {},
    /** Where a damaged car's smoke goes. */
    private readonly smoke: Smoke | null = null,
  ) {}

  /** After the server's word has been taken in: whoever is on the map has a car, eased onto where it now is. */
  reconciled(outcome: ReconcileOutcome): void {
    this.syncSeats()
    if (outcome === 'idle') return
    for (const entry of this.entries.values()) {
      if (outcome === 'replayed') entry.body.absorbCorrection()
      else entry.body.snapToBody()
    }
  }

  /** After the mirror has stepped. */
  stepped(): void {
    for (const entry of this.entries.values()) entry.body.captureStep()
  }

  render(fraction: number, dt: number): void {
    for (const entry of this.entries.values()) {
      const { vehicle, tuning } = entry.seat
      entry.body.render(fraction, dt)
      entry.view.applySimulatedWheels(vehicle.wheels, tuning)
      if (vehicle.wrecked && !entry.wrecked) this.onWreck(vehicle.frame.position)
      entry.wrecked = vehicle.wrecked
      entry.view.setWrecked(vehicle.wrecked)
      if (!vehicle.wrecked) {
        this.smoke?.trail(vehicle.frame.position, vehicle.frame.linearVelocity, smokeAmount(vehicle.damage), dt)
      }
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.view.dispose()
    this.entries.clear()
    this.object.removeFromParent()
    this.object.clear()
  }

  private syncSeats(): void {
    for (const seat of this.prediction.seats) {
      if (seat.id === this.ownSeat) continue
      const existing = this.entries.get(seat.id)
      if (!seat.occupied) {
        if (existing !== undefined) {
          existing.view.dispose()
          this.entries.delete(seat.id)
        }
        continue
      }
      if (existing !== undefined && existing.profile === seat.profile) continue
      existing?.view.dispose()
      const view = new CarView(seat.profile, seatColor(seat.id))
      view.syncDimensions(seat.tuning)
      this.object.add(view.object)
      const body = new SmoothedBody(seat.vehicle.body, view.object)
      body.snapToBody()
      this.entries.set(seat.id, { seat, profile: seat.profile, view, body, wrecked: seat.vehicle.wrecked })
    }
  }
}
