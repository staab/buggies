// A vehicle in the water: how deep it sits, and what the water does to it.

import { clamp, v3, vaddScaled, vcross, vdot, vlength, vscale, type Vec3 } from '@buggies/physics'
import { addForceAlong, addTorqueAbout } from './bodyForces.ts'
import type { VehicleTuning } from './tuning.ts'
import type { Vehicle } from './vehicleBody.ts'
import type { WorldTuning } from './world.ts'

const MIN_CHASSIS_DRAFT = 1e-3

const chassisPosition: Vec3 = v3()

/**
 * How far into the water the chassis is, 0 to 1. `height` is how high its
 * middle is, in the same measure as the water's level: its height up the
 * y axis unless said otherwise.
 */
export function submersionFraction(vehicle: Vehicle, tuning: VehicleTuning, waterLevel: number, height?: number): number {
  const draft = Math.max(tuning.chassisHalfHeight * 2, MIN_CHASSIS_DRAFT)

  const middle = height ?? vehicle.body.translation(chassisPosition).y

  return clamp((waterLevel - (middle - tuning.chassisHalfHeight)) / draft, 0, 1)
}

export function applyWaterResponse(
  vehicle: Vehicle,
  tuning: VehicleTuning,
  worldTuning: WorldTuning,
  waterLevel: number,
  height?: number,
): number {
  const submersion = submersionFraction(vehicle, tuning, waterLevel, height)

  if (submersion <= 0) return 0

  const { hull } = tuning
  if (hull !== undefined) {
    float(vehicle, tuning, hull, worldTuning, submersion)
    return submersion
  }
  addForceAlong(vehicle.body, vehicle.up, tuning.mass * worldTuning.gravity * worldTuning.waterBuoyancy * submersion)
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
  const { body, frame, command, up } = vehicle
  const { mass } = tuning
  addForceAlong(body, up, mass * worldTuning.gravity * hull.buoyancy * submersion)
  addForceAlong(body, up, -mass * hull.heave * vdot(frame.linearVelocity, up) * Math.min(submersion * 2, 1))
  body.setLinearDamping(tuning.linearDamping + hull.drag * submersion)
  body.setAngularDamping(tuning.angularDampingGrounded + worldTuning.waterSpinDrag * submersion)
  // Toward level: about the axis that turns its up onto the way up where it is.
  vcross(righting, frame.up, up)
  const tilt = vlength(righting)
  if (tilt > 1e-4) addTorqueAbout(body, vscale(righting, righting, 1 / tilt), mass * hull.righting * tilt)
  // The screw and the rudder, along the water: the way it faces, less its part up or down.
  vaddScaled(ahead, frame.forward, up, -vdot(frame.forward, up))
  const level = vlength(ahead)
  if (level < 1e-4) return
  vscale(ahead, ahead, 1 / level)
  const drive = command.throttle - command.brake * 0.6
  const wet = Math.min(submersion * 2, 1)
  if (drive !== 0) addForceAlong(body, ahead, mass * hull.thrust * drive * wet)
  if (command.steer !== 0) addTorqueAbout(body, up, -mass * hull.turn * command.steer * wet)
}
