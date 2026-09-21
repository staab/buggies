// Ported from the seattle project (src/physics/vehicle.ts). Kept in its original
// shape and formatting so the two can be compared and resynced. Buggies adds
// the ground stick: a wheel that has run out of suspension travel but can
// still see the ground holds on to it, unless the car is genuinely taking off.

import type * as RAPIER from '@dimforge/rapier3d-compat'

import {
  atan2,
  clamp,
  inverseLerpClamped,
  moveTowards,
  qrotate,
  rotateAboutAxis,
  v3,
  vadd,
  vaddScaled,
  vcopy,
  vcross,
  vdot,
  vlength,
  vnormalize,
  vprojectOntoPlane,
  vscale,
  type Vec3,
} from '@buggies/physics'
import {applyAirControl, applyAirStabilization} from './airControl.ts'
import {addForceAlong, addTorqueAbout} from './bodyForces.ts'
import {readChassisFrame, velocityAtPoint, type ChassisFrame} from './chassisFrame.ts'
import {WHEEL_RAY_GROUPS, isGround} from './groups.ts'
import {readDriverCommand, type VehicleInput} from './input.ts'
import {updateSelfRighting} from './selfRighting.ts'
import type {VehicleTuning} from './tuning.ts'
import {createTyreDriveContext, solveTyreForces} from './tyreModel.ts'
import {
  restingRideHeight,
  wheelMountLocal,
  WHEEL_COUNT,
  type Axle,
  type Vehicle,
  type WheelState,
} from './vehicleBody.ts'
import {worldGravity} from './world.ts'

const MIN_SPEED_FOR_SLIP_ANGLE = 1
const MIN_WHEEL_RADIUS = 1e-3
const MIN_SPEED_LIMIT = 1e-3
const YAW_ASSIST_SLIP_FADE_MULTIPLE = 2

const mountLocal = v3()
const mountWorld = v3()
const steeredForward = v3()
const pointVelocity = v3()
const contactForce = v3()
const driveContext = createTyreDriveContext()

/**
 * Buggies addition. Tell a crash from a jump by what hit the chassis over
 * the last step. The ground is no crash: a low car's belly touches down at
 * the foot of a steep ramp and flies on. A wall, a tree or another car is,
 * when it hits harder than the tyres ever could, and for a while after it
 * the car is left to tumble as it will.
 */
function noteImpacts(
  world: RAPIER.World,
  vehicle: Vehicle,
  tuning: VehicleTuning,
  dt: number,
): void {
  let impulse = 0
  world.contactPairsWith(vehicle.collider, other => {
    if (isGround(other)) return
    world.contactPair(vehicle.collider, other, manifold => {
      for (let i = 0; i < manifold.numContacts(); i++) {
        impulse += Math.hypot(
          manifold.contactImpulse(i),
          manifold.contactTangentImpulseX(i),
          manifold.contactTangentImpulseY(i),
        )
      }
    })
  })
  vehicle.impactTime = impulse > tuning.impactSpeedChange * tuning.mass ? 0 : vehicle.impactTime + dt
}

function updateMotionState(vehicle: Vehicle): void {
  const {frame} = vehicle
  const lateralSpeed = vdot(frame.linearVelocity, frame.right)

  vehicle.speed = vlength(frame.linearVelocity)
  vehicle.forwardSpeed = vdot(frame.linearVelocity, frame.forward)
  vehicle.slipAngle =
    vehicle.speed > MIN_SPEED_FOR_SLIP_ANGLE
      ? atan2(lateralSpeed, vehicle.forwardSpeed)
      : 0
}

function steerLimitAtSpeed(tuning: VehicleTuning, speed: number): number {
  const falloff = inverseLerpClamped(
    speed,
    tuning.steerFalloffMinSpeed,
    tuning.steerFalloffMaxSpeed,
  )

  return tuning.maxSteerAngle * (1 - (1 - tuning.steerAtHighSpeed) * falloff)
}

function updateSteeringRack(vehicle: Vehicle, tuning: VehicleTuning, dt: number): void {
  const limit = steerLimitAtSpeed(tuning, vehicle.speed)
  const intoSlide =
    vehicle.command.steer !== 0 &&
    Math.abs(vehicle.slipAngle) > tuning.counterSteerSlipMin &&
    Math.sign(vehicle.command.steer) === Math.sign(vehicle.slipAngle)
  const authority = intoSlide
    ? Math.max(limit, tuning.maxSteerAngle * clamp(tuning.counterSteerAuthority, 0, 1))
    : limit
  const target = vehicle.command.steer * authority
  const recentring = Math.abs(target) < Math.abs(vehicle.steerAngle)
  const rate = recentring ? tuning.steerReturnRate : tuning.steerRate

  vehicle.steerAngle = moveTowards(vehicle.steerAngle, target, rate * dt)

  for (const wheel of vehicle.wheels) wheel.steerAngle = wheel.isFront ? vehicle.steerAngle : 0
}

function advanceWheelSpin(
  wheel: WheelState,
  contactPatchSpeed: number,
  tuning: VehicleTuning,
  dt: number,
): void {
  wheel.spin += (contactPatchSpeed / Math.max(tuning.wheelRadius, MIN_WHEEL_RADIUS)) * dt
}

function aimWheelRay(
  vehicle: Vehicle,
  wheel: WheelState,
  tuning: VehicleTuning,
  castDistance: number,
): void {
  const {frame} = vehicle

  wheelMountLocal(mountLocal, wheel, tuning)
  qrotate(mountWorld, frame.rotation, mountLocal)
  vadd(wheel.rayOrigin, frame.position, mountWorld)
  vaddScaled(wheel.rayEnd, wheel.rayOrigin, frame.down, castDistance)
  vcopy(vehicle.ray.origin, wheel.rayOrigin)
}

function markWheelAirborne(
  wheel: WheelState,
  tuning: VehicleTuning,
  frame: ChassisFrame,
): void {
  wheel.grounded = false
  wheel.compression = 0
  wheel.suspensionLength = tuning.suspensionRestLength
  wheel.suspensionExtensionRate = 0
  wheel.suspensionForce = 0
  wheel.bumpStopDepth = 0
  wheel.stickDepth = 0
  wheel.forceLongitudinal = 0
  wheel.forceLateral = 0
  wheel.slipSpeedLongitudinal = 0
  wheel.slipSpeedLateral = 0

  vaddScaled(wheel.wheelCenter, wheel.rayOrigin, frame.down, tuning.suspensionRestLength)
  vcopy(wheel.contactPoint, wheel.rayEnd)
  vcopy(wheel.contactNormal, frame.up)
}

function settleWheelOnContact(
  vehicle: Vehicle,
  wheel: WheelState,
  tuning: VehicleTuning,
  distanceToContact: number,
  contactNormal: Vec3,
): void {
  const {frame} = vehicle
  const travel = distanceToContact - tuning.wheelRadius

  vaddScaled(wheel.contactPoint, wheel.rayOrigin, frame.down, distanceToContact)
  vcopy(wheel.contactNormal, contactNormal)

  wheel.suspensionLength = clamp(travel, 0, tuning.suspensionRestLength)
  wheel.compression = tuning.suspensionRestLength - wheel.suspensionLength
  wheel.bumpStopDepth = Math.max(-travel, 0)

  vaddScaled(wheel.wheelCenter, wheel.rayOrigin, frame.down, wheel.suspensionLength)
  velocityAtPoint(pointVelocity, vehicle.body, frame, wheel.contactPoint)

  wheel.suspensionExtensionRate = vdot(pointVelocity, frame.up)
}

function settleWheelTravel(
  world: RAPIER.World,
  vehicle: Vehicle,
  wheel: WheelState,
  tuning: VehicleTuning,
  castDistance: number,
  dt: number,
): void {
  const {body, frame} = vehicle
  const droop = tuning.suspensionRestLength + tuning.wheelRadius

  aimWheelRay(vehicle, wheel, tuning, castDistance)

  const hit = world.castRayAndGetNormal(
    vehicle.ray,
    castDistance,
    true,
    undefined,
    WHEEL_RAY_GROUPS,
    undefined,
    body,
  )

  if (hit === null) {
    markWheelAirborne(wheel, tuning, frame)
    advanceWheelSpin(wheel, vehicle.forwardSpeed, tuning, dt)
    return
  }

  wheel.grounded = true

  settleWheelOnContact(vehicle, wheel, tuning, hit.timeOfImpact, hit.normal)

  const reach = hit.timeOfImpact - droop

  if (reach <= 0) {
    wheel.stickDepth = 0
    return
  }

  // Buggies addition. The ground is past full droop but within reach: over a
  // crest, or a bump, the car holds on to it rather than floating off. Only a
  // corner rising faster than the lift speed is really leaving the ground.
  if (wheel.suspensionExtensionRate > tuning.groundStickLiftSpeed) {
    markWheelAirborne(wheel, tuning, frame)
    advanceWheelSpin(wheel, vehicle.forwardSpeed, tuning, dt)
    return
  }

  wheel.stickDepth = reach
}

function antiRollForceOnLeft(axle: Axle, tuning: VehicleTuning): number {
  const {left, right} = axle

  if (!left.grounded || !right.grounded) return 0

  const stiffness = left.isFront ? tuning.antiRollStiffnessFront : tuning.antiRollStiffnessRear

  return stiffness * (left.compression - right.compression)
}

function applyWheelSuspensionForce(
  vehicle: Vehicle,
  wheel: WheelState,
  tuning: VehicleTuning,
  antiRoll: number,
): void {
  if (!wheel.grounded) return

  // Buggies addition. Past full droop the spring and damper have nothing to
  // push with; the stick pulls the corner down toward the ground instead, the
  // harder the further it has got away.
  wheel.suspensionForce =
    wheel.stickDepth > 0
      ? clamp(
          antiRoll - tuning.groundStickStiffness * wheel.stickDepth,
          -tuning.groundStickStiffness * tuning.groundStickRange,
          0,
        )
      : clamp(
          tuning.suspensionStiffness * wheel.compression +
            tuning.bumpStopStiffness * wheel.bumpStopDepth -
            tuning.suspensionDamping * wheel.suspensionExtensionRate +
            antiRoll,
          0,
          tuning.maxSuspensionForce,
        )

  vscale(contactForce, vehicle.frame.up, wheel.suspensionForce)
  vehicle.body.addForceAtPoint(contactForce, wheel.contactPoint, true)
}

function applySuspensionForces(
  world: RAPIER.World,
  vehicle: Vehicle,
  tuning: VehicleTuning,
  dt: number,
): void {
  const {axles, frame, wheels} = vehicle
  const castDistance =
    tuning.suspensionRestLength + tuning.wheelRadius + tuning.groundStickRange
  let groundedCount = 0

  vcopy(vehicle.ray.dir, frame.down)

  for (const wheel of wheels) {
    settleWheelTravel(world, vehicle, wheel, tuning, castDistance, dt)

    if (wheel.grounded) groundedCount += 1
  }

  vehicle.groundedCount = groundedCount

  for (const axle of axles) {
    const antiRoll = antiRollForceOnLeft(axle, tuning)

    applyWheelSuspensionForce(vehicle, axle.left, tuning, antiRoll)
    applyWheelSuspensionForce(vehicle, axle.right, tuning, -antiRoll)
  }
}

function updateTyreBasis(wheel: WheelState, frame: ChassisFrame): void {
  rotateAboutAxis(steeredForward, frame.forward, frame.up, -wheel.steerAngle)
  vprojectOntoPlane(wheel.forward, steeredForward, wheel.contactNormal)
  vnormalize(wheel.forward, wheel.forward)
  vcross(wheel.right, wheel.contactNormal, wheel.forward)
  vnormalize(wheel.right, wheel.right)
}

function applyTyreForces(vehicle: Vehicle, tuning: VehicleTuning, dt: number): void {
  const {body, command, frame, wheels} = vehicle

  driveContext.throttle = command.throttle
  driveContext.brake = command.brake
  driveContext.handbrake = command.handbrake
  driveContext.brakePedalDrivesReverse = vehicle.forwardSpeed < tuning.reverseSpeedThreshold
  driveContext.remainingDriveFraction = clamp(
    1 - vehicle.speed / Math.max(tuning.maxSpeed, MIN_SPEED_LIMIT),
    0,
    1,
  )
  driveContext.massPerWheel = tuning.mass / WHEEL_COUNT

  for (const wheel of wheels) {
    if (!wheel.grounded) continue

    updateTyreBasis(wheel, frame)
    velocityAtPoint(pointVelocity, body, frame, wheel.contactPoint)

    wheel.slipSpeedLongitudinal = vdot(pointVelocity, wheel.forward)
    wheel.slipSpeedLateral = vdot(pointVelocity, wheel.right)

    solveTyreForces(wheel, driveContext, tuning, dt)

    vscale(contactForce, wheel.forward, wheel.forceLongitudinal)
    vaddScaled(contactForce, contactForce, wheel.right, wheel.forceLateral)
    body.addForceAtPoint(contactForce, wheel.contactPoint, true)

    advanceWheelSpin(wheel, wheel.slipSpeedLongitudinal, tuning, dt)
  }
}

function groundFraction(vehicle: Vehicle): number {
  return vehicle.groundedCount / vehicle.wheels.length
}

function applyAerodynamics(vehicle: Vehicle, tuning: VehicleTuning): void {
  const {body, frame, speed} = vehicle

  addForceAlong(body, frame.linearVelocity, -tuning.dragCoefficient * speed)
  addForceAlong(body, frame.down, tuning.downforce * speed * speed * groundFraction(vehicle))
}

function applyYawAssist(vehicle: Vehicle, tuning: VehicleTuning): void {
  const speedRamp = inverseLerpClamped(
    vehicle.speed,
    tuning.yawAssistMinSpeed,
    tuning.yawAssistFullSpeed,
  )
  const slideAuthority =
    1 -
    inverseLerpClamped(
      Math.abs(vehicle.slipAngle),
      tuning.yawAssistSlipCutoff,
      tuning.yawAssistSlipCutoff * YAW_ASSIST_SLIP_FADE_MULTIPLE,
    )
  const travelDirection = vehicle.forwardSpeed >= 0 ? 1 : -1

  addTorqueAbout(
    vehicle.body,
    vehicle.frame.up,
    -vehicle.command.steer *
      tuning.yawAssistTorque *
      speedRamp *
      slideAuthority *
      groundFraction(vehicle) *
      travelDirection,
  )
}

export function stepVehicle(
  world: RAPIER.World,
  vehicle: Vehicle,
  tuning: VehicleTuning,
  input: VehicleInput,
  dt: number,
): void {
  const {body} = vehicle

  body.resetForces(false)
  body.resetTorques(false)

  readDriverCommand(vehicle.command, input)
  readChassisFrame(vehicle.frame, body)
  noteImpacts(world, vehicle, tuning, dt)

  vehicle.rideHeight = restingRideHeight(tuning, worldGravity(world))

  updateMotionState(vehicle)
  updateSteeringRack(vehicle, tuning, dt)
  applySuspensionForces(world, vehicle, tuning, dt)
  applyTyreForces(vehicle, tuning, dt)
  applyAerodynamics(vehicle, tuning)

  const grounded = vehicle.groundedCount > 0
  const selfRighting = updateSelfRighting(world, vehicle, tuning, dt, grounded)

  if (grounded) {
    vehicle.airborneTime = 0
    applyYawAssist(vehicle, tuning)
  } else if (selfRighting) {
    vehicle.airborneTime = 0
  } else {
    vehicle.airborneTime += dt
    applyAirControl(vehicle, tuning)
    applyAirStabilization(world, vehicle, tuning)
  }

  body.setLinearDamping(tuning.linearDamping)
  body.setAngularDamping(
    grounded || selfRighting ? tuning.angularDampingGrounded : tuning.angularDampingAirborne,
  )
}
