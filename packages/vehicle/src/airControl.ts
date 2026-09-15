// Ported from the seattle project (src/physics/airControl.ts). Kept in its original
// shape and formatting so the two can be compared and resynced.

import type * as RAPIER from '@dimforge/rapier3d-compat'

import {inverseLerpClamped, lerp, v3, vcopy, vcross, vlength} from '@buggies/physics'
import {addTorqueAbout} from './bodyForces.ts'
import type {DriverCommand} from './input.ts'
import type {VehicleTuning} from './tuning.ts'
import type {Vehicle} from './vehicleBody.ts'
import {WORLD_UP} from './world.ts'

const MIN_FALL_SPEED_FOR_LANDING_PREDICTION = 1e-3

const angularVelocity = v3()
const uprightError = v3()

export function applyAirControl(vehicle: Vehicle, tuning: VehicleTuning): void {
  const {body, command, frame} = vehicle
  const pitchDemand = command.throttle - command.brake

  addTorqueAbout(body, frame.right, -pitchDemand * tuning.airPitchTorque)
  addTorqueAbout(body, frame.up, -command.steer * tuning.airYawTorque)
  addTorqueAbout(body, frame.forward, command.steer * tuning.airRollTorque)
}

function spinAuthority(angularSpeed: number, tuning: VehicleTuning): number {
  return (
    1 - inverseLerpClamped(angularSpeed, tuning.airLevelSpinFadeStart, tuning.airLevelSpinFadeEnd)
  )
}

function inputAuthority(command: DriverCommand, tuning: VehicleTuning): number {
  const pitchDemand = Math.abs(command.throttle - command.brake)
  const rollYawDemand = Math.abs(command.steer)

  return 1 - tuning.airLevelInputYield * Math.max(pitchDemand, rollYawDemand)
}

function landingBoost(
  world: RAPIER.World,
  vehicle: Vehicle,
  tuning: VehicleTuning,
): number {
  const {body, frame, landingRay} = vehicle
  const fallSpeed = -frame.linearVelocity.y

  if (fallSpeed <= MIN_FALL_SPEED_FOR_LANDING_PREDICTION) return 1

  vcopy(landingRay.origin, frame.position)

  const hit = world.castRay(
    landingRay,
    tuning.airLevelLandingCastDistance,
    true,
    undefined,
    undefined,
    undefined,
    body,
  )

  if (hit === null) return 1

  const distanceToGround = hit.timeOfImpact
  const secondsToImpact = distanceToGround / fallSpeed
  const approach = 1 - inverseLerpClamped(secondsToImpact, 0, tuning.airLevelLandingLookahead)

  return lerp(1, tuning.airLevelLandingBoostMax, approach)
}

export function applyAirStabilization(
  world: RAPIER.World,
  vehicle: Vehicle,
  tuning: VehicleTuning,
): void {
  if (vehicle.airborneTime < tuning.airLevelEngageDelay) return

  vehicle.body.angvel(angularVelocity)

  const fromSpin = spinAuthority(vlength(angularVelocity), tuning)

  if (fromSpin <= 0) return

  const fromInput = inputAuthority(vehicle.command, tuning)
  const fromApproach = landingBoost(world, vehicle, tuning)
  const authority = tuning.airLevelTorque * fromSpin * fromInput * fromApproach

  vcross(uprightError, vehicle.frame.up, WORLD_UP)
  addTorqueAbout(vehicle.body, uprightError, authority)
}
