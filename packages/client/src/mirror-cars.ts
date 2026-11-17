import type { Arena, Seat, Vehicle, VehicleProfileId } from '@buggies/game'
import type { ReconcileOutcome } from '@buggies/net'
import * as THREE from 'three'

import { CarPresence, aimPointOf, type PresenceEffects } from './car-presence.ts'
import { seatColor } from './car-view.ts'
import type { ChaseTarget } from './chase-camera.ts'
import type { Ear } from './ear.ts'

/**
 * Where the cars of a mirror are read from: its seats and its machines, and
 * the car the sounds of the others fall on. That is the car the driver here
 * drives, or, for a watcher, the one it follows.
 */
export interface CarField extends Pick<Arena, 'seats' | 'robots' | 'ufos' | 'spiders'> {
  vehicle: Vehicle
}

/** One car on the screen that is not the driver's own, and the seat it is drawn from. */
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

  /** One entry for each car on the map but the driver's own: at most a seatful, and read with a plain loop as often as a frame comes. */
  private readonly entries: Entry[] = []
  /** Where their sounds fall, which follows the car driven here as the field's is put in another. */
  private readonly ear: Ear

  /** `ownSeat` is the seat whose car is drawn by its driver, and so not here; `NO_SEAT` for a watcher, which has none. */
  constructor(
    private readonly field: CarField,
    private readonly ownSeat: number,
    private readonly effects: PresenceEffects,
  ) {
    this.ear = () => field.vehicle.frame.position
  }

  /** After the server's word has been taken in: whoever is on the map has a car, eased onto where it now is. */
  reconciled(outcome: ReconcileOutcome): void {
    this.syncSeats()
    if (outcome === 'idle') return
    for (const entry of this.entries) entry.presence.body.absorbCorrection()
  }

  /** After the mirror has stepped. */
  stepped(): void {
    for (const entry of this.entries) entry.presence.body.captureStep()
  }

  render(fraction: number, dt: number): void {
    for (const entry of this.entries) {
      entry.presence.aimAt(aimPointOf(entry.seat, this.field))
      entry.presence.render(fraction, dt)
    }
  }

  /** Where to look to watch the car in this seat, if it is on this screen: for a camera that follows one of them. */
  aim(seat: number, target: ChaseTarget): boolean {
    for (const entry of this.entries) {
      if (entry.seat.id !== seat) continue
      entry.presence.aim(target)
      return true
    }
    return false
  }

  dispose(): void {
    for (const entry of this.entries) entry.presence.dispose()
    this.entries.length = 0
    this.object.removeFromParent()
    this.object.clear()
  }

  /** A car for every occupied seat but the driver's own, drawn afresh when a seat changes vehicle, and gone when it empties. */
  private syncSeats(): void {
    for (const seat of this.field.seats) {
      if (seat.id === this.ownSeat) continue
      const at = this.entryOf(seat.id)
      if (!seat.occupied) {
        if (at >= 0) this.drop(at)
        continue
      }
      if (at >= 0) {
        if (this.entries[at]!.profile === seat.profile) continue
        this.drop(at)
      }
      const presence = new CarPresence(seat, seatColor(seat.id), this.effects, { ear: this.ear, heard: true })
      presence.body.snapToBody()
      this.object.add(presence.object)
      this.entries.push({ seat, profile: seat.profile, presence })
    }
  }

  /** Where this seat's car is among the entries, or -1 while it has none. */
  private entryOf(seat: number): number {
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i]!.seat.id === seat) return i
    }
    return -1
  }

  /** Let go of the car at this place among the entries. */
  private drop(at: number): void {
    const entry = this.entries[at]!
    entry.presence.dispose()
    this.entries.splice(at, 1)
  }
}
