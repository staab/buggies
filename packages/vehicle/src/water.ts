// A vehicle in the water: how deep it sits, and what the water does to it.

import { clamp, v3, type Vec3 } from '@buggies/physics'
import { addForceAlong } from './bodyForces.ts'
import type { VehicleTuning } from './tuning.ts'
import type { Vehicle } from './vehicleBody.ts'
import { WORLD_UP, type WorldTuning } from './world.ts'

const MIN_CHASSIS_DRAFT = 1e-3

const chassisPosition: Vec3 = v3()

export function submersionFraction(vehicle: Vehicle, tuning: VehicleTuning, waterLevel: number): number {
  const draft = Math.max(tuning.chassisHalfHeight * 2, MIN_CHASSIS_DRAFT)

  vehicle.body.translation(chassisPosition)

  return clamp((waterLevel - (chassisPosition.y - tuning.chassisHalfHeight)) / draft, 0, 1)
}

export function applyWaterResponse(
  vehicle: Vehicle,
  tuning: VehicleTuning,
  worldTuning: WorldTuning,
  waterLevel: number,
): number {
  const submersion = submersionFraction(vehicle, tuning, waterLevel)

  if (submersion <= 0) return 0

  addForceAlong(vehicle.body, WORLD_UP, tuning.mass * worldTuning.gravity * worldTuning.waterBuoyancy * submersion)
  vehicle.body.setLinearDamping(tuning.linearDamping + worldTuning.waterDrag * submersion)
  vehicle.body.setAngularDamping(tuning.angularDampingGrounded + worldTuning.waterSpinDrag * submersion)

  return submersion
}
