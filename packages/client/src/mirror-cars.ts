import type { Arena, Seat, Vehicle, VehicleProfileId } from '@buggies/game'
import type { ReconcileOutcome } from '@buggies/net'
import * as THREE from 'three'

import { CarPresence, aimPointOf, type PresenceEffects } from './car-presence.ts'
import { seatColor } from './car-view.ts'
import type { ChaseTarget } from './chase-camera.ts'

/**
 * Where the cars of a mirror are read from: its seats and its machines, and
 * the car the sounds of the others fall on. That is the car the driver here
 * drives, or, for a watcher, the one it follows.
 */
export interface CarField extends Pick<Arena, 'seats' | 'robots' | 'ufos' | 'spiders'> {
  vehicle: Vehicle
}

interface Entry {
  seat: Seat
  profile: VehicleProfileId
  presence: CarPresence
}

/**
 * Everyone else's car, drawn where the mirror has it: the very body the local
 * car is driven against, run ahead from the last snapshot, so what is seen is
 * what is hit. Each snapshot's correction to a car is eased away the same way
 * as the local car's own, and each is heard as far off as it is. A watcher
 * has no car of its own here, and so draws every car the mirror has.
 */
export class MirrorCars {
  readonly object = new THREE.Group()

  private readonly entries = new Map<number, Entry>()

  /** `ownSeat` is the seat whose car is drawn by its driver, and so not here; `NO_SEAT` for a watcher, which has none. */
  constructor(
    private readonly field: CarField,
    private readonly ownSeat: number,
    private readonly effects: PresenceEffects,
  ) {}

  /** After the server's word has been taken in: whoever is on the map has a car, eased onto where it now is. */
  reconciled(outcome: ReconcileOutcome): void {
    this.syncSeats()
    if (outcome === 'idle') return
    for (const entry of this.entries.values()) entry.presence.body.absorbCorrection()
  }

  /** After the mirror has stepped. */
  stepped(): void {
    for (const entry of this.entries.values()) entry.presence.body.captureStep()
  }

  render(fraction: number, dt: number): void {
    for (const entry of this.entries.values()) {
      entry.presence.aimAt(aimPointOf(entry.seat, this.field))
      entry.presence.render(fraction, dt)
    }
  }

  /** Where to look to watch the car in this seat, if it is on this screen: for a camera that follows one of them. */
  aim(seat: number, target: ChaseTarget): boolean {
    const entry = this.entries.get(seat)
    if (entry === undefined) return false
    entry.presence.aim(target)
    return true
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.presence.dispose()
    this.entries.clear()
    this.object.removeFromParent()
    this.object.clear()
  }

  private syncSeats(): void {
    const ear = (): { x: number; y: number; z: number } => this.field.vehicle.frame.position
    for (const seat of this.field.seats) {
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
      const presence = new CarPresence(seat, seatColor(seat.id), this.effects, { ear, heard: true })
      presence.body.snapToBody()
      this.object.add(presence.object)
      this.entries.set(seat.id, { seat, profile: seat.profile, presence })
    }
  }
}
