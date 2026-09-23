import type { Seat, VehicleProfileId } from '@buggies/game'
import type { LocalPrediction, ReconcileOutcome } from '@buggies/net'
import * as THREE from 'three'

import { CarPresence, aimPointOf, type PresenceEffects } from './car-presence.ts'
import { seatColor } from './car-view.ts'

interface Entry {
  seat: Seat
  profile: VehicleProfileId
  presence: CarPresence
}

/**
 * Everyone else's car, drawn where the mirror has it: the very body the local
 * car is driven against, run ahead from the last snapshot, so what is seen is
 * what is hit. Each snapshot's correction to a car is eased away the same way
 * as the local car's own, and each is heard as far off as it is.
 */
export class MirrorCars {
  readonly object = new THREE.Group()

  private readonly entries = new Map<number, Entry>()

  constructor(
    private readonly prediction: LocalPrediction,
    private readonly ownSeat: number,
    private readonly effects: PresenceEffects,
    /** Whose car is driven from this very screen, and so is heard from its own view, not here. */
    private readonly isLocal: (seat: number) => boolean = () => false,
  ) {}

  /** After the server's word has been taken in: whoever is on the map has a car, eased onto where it now is. */
  reconciled(outcome: ReconcileOutcome): void {
    this.syncSeats()
    if (outcome === 'idle') return
    for (const entry of this.entries.values()) {
      if (outcome === 'replayed') entry.presence.body.absorbCorrection()
      else entry.presence.body.snapToBody()
    }
  }

  /** After the mirror has stepped. */
  stepped(): void {
    for (const entry of this.entries.values()) entry.presence.body.captureStep()
  }

  render(fraction: number, dt: number): void {
    for (const entry of this.entries.values()) {
      entry.presence.aimAt(aimPointOf(entry.seat, this.prediction.seats))
      entry.presence.render(fraction, dt)
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.presence.dispose()
    this.entries.clear()
    this.object.removeFromParent()
    this.object.clear()
  }

  private syncSeats(): void {
    const ear = (): { x: number; y: number; z: number } => this.prediction.vehicle.frame.position
    for (const seat of this.prediction.seats) {
      if (seat.id === this.ownSeat) continue
      const existing = this.entries.get(seat.id)
      if (!seat.occupied) {
        if (existing !== undefined) {
          existing.presence.dispose()
          this.entries.delete(seat.id)
        }
        continue
      }
      if (existing !== undefined && existing.profile === seat.profile) continue
      existing?.presence.dispose()
      const presence = new CarPresence(seat, seatColor(seat.id), this.effects, { ear, heard: !this.isLocal(seat.id) })
      presence.body.snapToBody()
      this.object.add(presence.object)
      this.entries.set(seat.id, { seat, profile: seat.profile, presence })
    }
  }
}
