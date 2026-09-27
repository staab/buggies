// A vehicle in the water: how deep it sits, and what the water does to it.

import { clamp, v3, type Vec3 } from '@buggies/physics'
import { addForceAlong, addTorqueAbout } from './bodyForces.ts'
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

  const { hull } = tuning
  if (hull !== undefined) {
    float(vehicle, tuning, hull, worldTuning, submersion)
    return submersion
  }
  addForceAlong(vehicle.body, WORLD_UP, tuning.mass * worldTuning.gravity * worldTuning.waterBuoyancy * submersion)
  vehicle.body.setLinearDamping(tuning.linearDamping + worldTuning.waterDrag * submersion)
  vehicle.body.setAngularDamping(tuning.angularDampingGrounded + worldTuning.waterSpinDrag * submersion)

  return submersion
}

const ahead: Vec3 = v3()
const righting: Vec3 = v3()

/**
 * A hull afloat: held up by the water as far as it is under, dragged on
 * lightly, righted toward level, and driven along the water, the way it
 * faces, by its throttle and turned by its steering, as far as it is in.
 */
function float(vehicle: Vehicle, tuning: VehicleTuning, hull: NonNullable<VehicleTuning['hull']>, worldTuning: WorldTuning, submersion: number): void {
  const { body, frame, command } = vehicle
  const { mass } = tuning
  addForceAlong(body, WORLD_UP, mass * worldTuning.gravity * hull.buoyancy * submersion)
  addForceAlong(body, WORLD_UP, -mass * hull.heave * frame.linearVelocity.y * Math.min(submersion * 2, 1))
  body.setLinearDamping(tuning.linearDamping + hull.drag * submersion)
  body.setAngularDamping(tuning.angularDampingGrounded + worldTuning.waterSpinDrag * submersion)
  // Toward level: about the axis that turns its up onto the world's.
  righting.x = frame.up.z * WORLD_UP.y - frame.up.y * WORLD_UP.z
  righting.y = 0
  righting.z = frame.up.y * WORLD_UP.x - frame.up.x * WORLD_UP.y
  const tilt = Math.hypot(righting.x, righting.z)
  if (tilt > 1e-4) addTorqueAbout(body, { x: -righting.x / tilt, y: 0, z: -righting.z / tilt }, mass * hull.righting * tilt)
  // The screw and the rudder, along the water.
  const level = Math.hypot(frame.forward.x, frame.forward.z)
  if (level < 1e-4) return
  ahead.x = frame.forward.x / level
  ahead.y = 0
  ahead.z = frame.forward.z / level
  const drive = command.throttle - command.brake * 0.6
  const wet = Math.min(submersion * 2, 1)
  if (drive !== 0) addForceAlong(body, ahead, mass * hull.thrust * drive * wet)
  if (command.steer !== 0) addTorqueAbout(body, WORLD_UP, -mass * hull.turn * command.steer * wet)
}
