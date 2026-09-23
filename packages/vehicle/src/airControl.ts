// Ported from the seattle project (src/physics/airControl.ts). Kept in its original
// shape and formatting so the two can be compared and resynced.

import type * as RAPIER from '@dimforge/rapier3d-compat'

import {inverseLerpClamped, lerp, v3, vaddScaled, vcopy, vcross, vdot, vnormalize, vscale, vset} from '@buggies/physics'
import {addTorqueAbout} from './bodyForces.ts'
import {WHEEL_RAY_GROUPS} from './groups.ts'
import type {DriverCommand} from './input.ts'
import type {VehicleTuning} from './tuning.ts'
import type {Vehicle} from './vehicleBody.ts'
import {WORLD_UP} from './world.ts'

const MIN_FALL_SPEED_FOR_LANDING_PREDICTION = 1e-3

const angularVelocity = v3()
const uprightError = v3()
const targetUp = v3()
const pitchRollRate = v3()
const levelTorque = v3()

/**
 * Buggies: in the air the throttle and brake pitch the nose, and that is all.
 * The steering does nothing until the wheels are down again: a car does not
 * turn in the air, and one that did was too easy to spin off a jump.
 */
export function applyAirControl(vehicle: Vehicle, tuning: VehicleTuning): void {
  const {body, command, frame} = vehicle
  const pitchDemand = command.throttle - command.brake

  addTorqueAbout(body, frame.right, -pitchDemand * tuning.airPitchTorque)
}

function inputAuthority(command: DriverCommand, tuning: VehicleTuning): number {
  const pitchDemand = Math.abs(command.throttle - command.brake)

  return 1 - tuning.airLevelInputYield * pitchDemand
}

/**
 * Where the car is going to land: how much harder to level for it, and
 * which way is up there. Falling toward ground within the lookahead, the
 * levelling strengthens as it nears, and aims at the ground's own normal so
 * the car lands square on a slope.
 */
function landing(world: RAPIER.World, vehicle: Vehicle, tuning: VehicleTuning): number {
  const {body, frame, landingRay} = vehicle
  const fallSpeed = -frame.linearVelocity.y
  vcopy(targetUp, WORLD_UP)

  if (fallSpeed <= MIN_FALL_SPEED_FOR_LANDING_PREDICTION) return 1

  vcopy(landingRay.origin, frame.position)

  const hit = world.castRayAndGetNormal(
    landingRay,
    tuning.airLevelLandingCastDistance,
    true,
    undefined,
    WHEEL_RAY_GROUPS,
    undefined,
    body,
  )

  if (hit === null) return 1

  const distanceToGround = hit.timeOfImpact
  const secondsToImpact = distanceToGround / fallSpeed
  const approach = 1 - inverseLerpClamped(secondsToImpact, 0, tuning.airLevelLandingLookahead)
  // Only ground that is roughly level is worth landing square on: the car is
  // not going to land on a wall.
  if (hit.normal.y > 0.5) {
    vset(targetUp, hit.normal.x, hit.normal.y, hit.normal.z)
    vnormalize(targetUp, targetUp)
  }

  return lerp(1, tuning.airLevelLandingBoostMax, approach)
}

/**
 * Buggies rewrite. Off a jump the car is held level in the air, whatever spin
 * the lip gave it: a torque toward upright, damped against its pitch and roll
 * rate, so it lands on its wheels. Yaw is left alone for the air controls.
 * Off a crash it is not: a car that has just been hit is let tumble.
 */
export function applyAirStabilization(
  world: RAPIER.World,
  vehicle: Vehicle,
  tuning: VehicleTuning,
): void {
  if (vehicle.airborneTime < tuning.airLevelEngageDelay) return
  if (vehicle.impactTime < tuning.impactTumbleTime) return

  const {body, frame} = vehicle
  const fromInput = inputAuthority(vehicle.command, tuning)
  const fromApproach = landing(world, vehicle, tuning)
  const authority = fromInput * fromApproach

  vcross(uprightError, frame.up, targetUp)
  body.angvel(angularVelocity)
  // Pitch and roll rate: the spin less its part about the car's own up.
  const yawRate = vdot(angularVelocity, frame.up)
  vaddScaled(pitchRollRate, angularVelocity, frame.up, -yawRate)

  vscale(levelTorque, uprightError, tuning.airLevelTorque * authority)
  vaddScaled(levelTorque, levelTorque, pitchRollRate, -tuning.airLevelDamping * authority)
  body.addTorque(levelTorque, true)
}
