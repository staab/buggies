import {
  CHASSIS_FORWARD,
  createVehicleTuning,
  type VehicleProfileId,
  type VehicleTuning,
} from '@buggies/game'
import type { VehicleRenderState } from '@buggies/net'
import { qrotate, v3, vdot } from '@buggies/physics'
import * as THREE from 'three'

import { CarView, seatColor } from './car-view.ts'

interface Entry {
  profile: VehicleProfileId
  view: CarView
  tuning: VehicleTuning
  spin: number
}

const forward = v3()

/**
 * Everyone else's car, drawn where the server last said it was. Nothing is
 * simulated here: the wheels roll to match the speed and that is all.
 */
export class RemoteCars {
  readonly object = new THREE.Group()

  private readonly entries = new Map<number, Entry>()

  constructor(private readonly ownSeat: number) {}

  update(states: readonly VehicleRenderState[], dt: number): void {
    const seen = new Set<number>()
    for (const state of states) {
      if (state.seat === this.ownSeat) continue
      seen.add(state.seat)
      const entry = this.entryFor(state.seat, state.profile)
      const { object } = entry.view
      object.position.set(state.position.x, state.position.y, state.position.z)
      object.quaternion.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w)

      qrotate(forward, state.rotation, CHASSIS_FORWARD)
      entry.spin += (vdot(forward, state.linearVelocity) * dt) / entry.tuning.wheelRadius
      entry.view.applyRollingWheels(entry.tuning, entry.spin)
    }
    for (const [seat, entry] of this.entries) {
      if (seen.has(seat)) continue
      entry.view.dispose()
      this.entries.delete(seat)
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.view.dispose()
    this.entries.clear()
    this.object.removeFromParent()
    this.object.clear()
  }

  private entryFor(seat: number, profile: VehicleProfileId): Entry {
    const existing = this.entries.get(seat)
    if (existing !== undefined && existing.profile === profile) return existing
    existing?.view.dispose()

    const tuning = createVehicleTuning(profile)
    const view = new CarView(seatColor(seat))
    view.syncDimensions(tuning)
    this.object.add(view.object)
    const created = { profile, view, tuning, spin: 0 }
    this.entries.set(seat, created)
    return created
  }
}
