// A car on its roof or its side rights itself: once it has come to rest
// upside down, it is lifted a little and turned back onto its wheels.

import type * as RAPIER from '@dimforge/rapier3d-compat'

import {
  atan2,
  quatFromYaw,
  v3,
  vaddScaled,
  vcopy,
  vcross,
  vdot,
  vlength,
  vscale,
  vset,
  type Vec3,
} from '@buggies/physics'
import { addTorqueAbout } from './bodyForces.ts'
import type { VehicleTuning } from './tuning.ts'
import type { Vehicle } from './vehicleBody.ts'
import { WORLD_UP } from './world.ts'

const SELF_RIGHT_AXIS_EPSILON = 1e-4

const ZERO_VELOCITY: Vec3 = { x: 0, y: 0, z: 0 }

const angularVelocity = v3()
const selfRightAxis = v3()
const selfRightLiftVelocity = v3()
const selfRightSnapPosition = v3()

let chassisContactPartners = 0

function countChassisContactPartner(): void {
  chassisContactPartners += 1
}

function chassisHasContact(world: RAPIER.World, vehicle: Vehicle): boolean {
  chassisContactPartners = 0
  world.narrowPhase.contactPairsWith(vehicle.collider.handle, countChassisContactPartner)

  return chassisContactPartners > 0
}

function yawFromForward(forward: Vec3): number {
  return atan2(-forward.x, -forward.z)
}

function applySelfRightTorque(vehicle: Vehicle, tuning: VehicleTuning): void {
  vcross(selfRightAxis, vehicle.frame.up, WORLD_UP)

  const axisMagnitude = vlength(selfRightAxis)

  if (axisMagnitude < SELF_RIGHT_AXIS_EPSILON) {
    vcopy(selfRightAxis, vehicle.frame.forward)
  } else {
    vscale(selfRightAxis, selfRightAxis, 1 / axisMagnitude)
  }

  addTorqueAbout(vehicle.body, selfRightAxis, tuning.selfRightTorque)
}

function applySelfRightLift(vehicle: Vehicle, tuning: VehicleTuning): void {
  const { body, frame } = vehicle

  vset(
    selfRightLiftVelocity,
    frame.linearVelocity.x,
    frame.linearVelocity.y + tuning.selfRightLiftSpeed,
    frame.linearVelocity.z,
  )
  body.setLinvel(selfRightLiftVelocity, true)
}

function snapUpright(vehicle: Vehicle, tuning: VehicleTuning): void {
  const { body, frame } = vehicle

  vaddScaled(selfRightSnapPosition, frame.position, WORLD_UP, tuning.selfRightSnapLift)

  body.setTranslation(selfRightSnapPosition, true)
  body.setRotation(quatFromYaw(yawFromForward(frame.forward)), true)
  body.setLinvel(ZERO_VELOCITY, true)
  body.setAngvel(ZERO_VELOCITY, true)
}

export function updateSelfRighting(
  world: RAPIER.World,
  vehicle: Vehicle,
  tuning: VehicleTuning,
  dt: number,
  grounded: boolean,
): boolean {
  const { body, frame } = vehicle

  if (grounded) {
    vehicle.invertedRestTime = 0
    vehicle.selfRighting = false
    vehicle.selfRightElapsed = 0

    return false
  }

  body.angvel(angularVelocity)
  const angularSpeed = vlength(angularVelocity)
  const uprightDot = vdot(frame.up, WORLD_UP)

  if (vehicle.selfRighting) {
    vehicle.selfRightElapsed += dt

    const recovered = uprightDot > tuning.selfRightRecoveredDot && angularSpeed < tuning.selfRightRestAngularSpeed
    const timedOut = vehicle.selfRightElapsed > tuning.selfRightMaxDuration

    if (recovered || timedOut) {
      if (timedOut && !recovered) snapUpright(vehicle, tuning)

      vehicle.selfRighting = false
      vehicle.selfRightElapsed = 0
      vehicle.invertedRestTime = 0

      return false
    }

    applySelfRightTorque(vehicle, tuning)

    return true
  }

  const tipped = uprightDot < tuning.selfRightUprightDot
  const atRest = vehicle.speed < tuning.selfRightRestLinearSpeed && angularSpeed < tuning.selfRightRestAngularSpeed
  const resting = tipped && atRest && chassisHasContact(world, vehicle)

  vehicle.invertedRestTime = resting ? vehicle.invertedRestTime + dt : 0

  if (vehicle.invertedRestTime < tuning.selfRightDelay) return false

  vehicle.selfRighting = true
  vehicle.selfRightElapsed = 0
  applySelfRightLift(vehicle, tuning)
  applySelfRightTorque(vehicle, tuning)

  return true
}
