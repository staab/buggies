import type { Seat, VehicleProfileId } from '@buggies/game'
import type { LocalPrediction, ReconcileOutcome } from '@buggies/net'
import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

import { engineRev, skidAmount, type EngineVoice, type SkidVoice, type Sound } from './audio.ts'
import { CarView, seatColor } from './car-view.ts'
import { smokeAmount } from './damage.ts'
import type { Smoke } from './smoke.ts'
import { SmoothedBody } from './smoothed-body.ts'

interface Entry {
  seat: Seat
  profile: VehicleProfileId
  view: CarView
  body: SmoothedBody
  voice: EngineVoice | null
  skid: SkidVoice | null
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
    /** Called where a car blows up, the moment the server first says it has, and whose it was. */
    private readonly onWreck: (at: Vec3, seat: number) => void = () => {},
    /** Where a damaged car's smoke goes. */
    private readonly smoke: Smoke | null = null,
    /** Where their engines are heard, as far off as they are. */
    private readonly sound: Sound | null = null,
    /** Whose car is driven from this very screen, and so is heard from its own view, not here. */
    private readonly isLocal: (seat: number) => boolean = () => false,
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
    const ear = this.prediction.vehicle.frame.position
    for (const entry of this.entries.values()) {
      const { vehicle, tuning } = entry.seat
      entry.body.render(fraction, dt)
      entry.view.applySimulatedWheels(vehicle.wheels, tuning)
      const { x, y, z } = vehicle.frame.position
      const off = Math.hypot(x - ear.x, y - ear.y, z - ear.z)
      entry.voice?.set(vehicle.wrecked ? 0 : engineRev(vehicle.speed, tuning.maxSpeed, vehicle.command.throttle), off)
      entry.skid?.set(vehicle.wrecked ? 0 : skidAmount(vehicle.wheels), off)
      if (vehicle.wrecked && !entry.wrecked) this.onWreck(vehicle.frame.position, entry.seat.id)
      entry.wrecked = vehicle.wrecked
      entry.view.setWrecked(vehicle.wrecked)
      if (!vehicle.wrecked) {
        this.smoke?.trail(vehicle.frame.position, vehicle.frame.linearVelocity, smokeAmount(vehicle.damage), dt)
      }
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.view.dispose()
      entry.voice?.stop()
      entry.skid?.stop()
    }
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
          existing.voice?.stop()
          existing.skid?.stop()
          this.entries.delete(seat.id)
        }
        continue
      }
      if (existing !== undefined && existing.profile === seat.profile) continue
      existing?.view.dispose()
      existing?.voice?.stop()
      existing?.skid?.stop()
      const view = new CarView(seat.profile, seatColor(seat.id))
      view.syncDimensions(seat.tuning)
      this.object.add(view.object)
      const body = new SmoothedBody(seat.vehicle.body, view.object)
      body.snapToBody()
      const heard = this.sound !== null && !this.isLocal(seat.id) ? this.sound : null
      const voice = heard?.engine(seat.profile) ?? null
      const skid = heard?.skid() ?? null
      this.entries.set(seat.id, { seat, profile: seat.profile, view, body, voice, skid, wrecked: seat.vehicle.wrecked })
    }
  }
}
