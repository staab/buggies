// How a tyre grips: the lateral force curve, the drive and retarding
// forces, the hold a tyre at rest takes of the ground, and the friction
// circle that bounds them together.

import { clamp, hypot, inverseLerpClamped, v3, vcopy, vdot, vsub } from '@buggies/physics'
import type { VehicleTuning } from './tuning.ts'
import { WHEEL_COUNT, WHEELS_PER_AXLE, type WheelState } from './vehicleBody.ts'

const MIN_PEAK_SLIP_SPEED = 1e-4
const MIN_FALLOFF_RANGE = 1e-4
const MIN_COMBINED_FORCE = 1e-6

/**
 * Below this slip speed, with nothing asked of it, a tyre takes hold of the
 * ground where it stands rather than rolling on. A car left alone then stays
 * where it was left, on a slope or a camber too, instead of creeping off on
 * the small sideways part of its own springs' push, which a force that only
 * answers speed can never quite cancel.
 */
export const HOLD_SLIP_SPEED = 0.5

/**
 * A held tyre pulls back to where it took hold like a spring, for each
 * kilogram on the wheel, on top of the force that cancels its slip in a
 * step. Together the two let a push die away by a quarter each step, so
 * the hold neither rings nor lets the car wander.
 */
const HOLD_STIFFNESS_PER_KG = 900

const holdOffset = v3()

export interface TyreDriveContext {
  throttle: number
  brake: number
  handbrake: boolean
  brakePedalDrivesReverse: boolean
  remainingDriveFraction: number
  massPerWheel: number
}

export function createTyreDriveContext(): TyreDriveContext {
  return {
    throttle: 0,
    brake: 0,
    handbrake: false,
    brakePedalDrivesReverse: false,
    remainingDriveFraction: 0,
    massPerWheel: 0,
  }
}

function gripRisingToPeak(slipSpeed: number, tuning: VehicleTuning): number {
  return tuning.lateralPeakGrip * (slipSpeed / Math.max(tuning.lateralPeakSlip, MIN_PEAK_SLIP_SPEED))
}

function gripFallingToTail(slipSpeed: number, tuning: VehicleTuning): number {
  const fallen = inverseLerpClamped(
    slipSpeed - tuning.lateralPlateauEndSlip,
    0,
    Math.max(tuning.lateralFalloffRange, MIN_FALLOFF_RANGE),
  )

  return tuning.lateralPeakGrip + (tuning.lateralTailGrip - tuning.lateralPeakGrip) * fallen
}

export function lateralGripCurve(lateralSlipSpeed: number, tuning: VehicleTuning): number {
  const slipSpeed = Math.abs(lateralSlipSpeed)

  if (slipSpeed <= tuning.lateralPeakSlip) return gripRisingToPeak(slipSpeed, tuning)
  if (slipSpeed <= tuning.lateralPlateauEndSlip) return tuning.lateralPeakGrip

  return gripFallingToTail(slipSpeed, tuning)
}

function forceThatCancelsSlipInOneStep(slipSpeed: number, massPerWheel: number, dt: number): number {
  return (Math.abs(slipSpeed) * massPerWheel) / dt
}

function driveForce(wheel: WheelState, drive: TyreDriveContext, tuning: VehicleTuning): number {
  const shareOfAxle = wheel.isFront ? tuning.driveSplit : 1 - tuning.driveSplit
  const available = tuning.engineForce * (shareOfAxle / WHEELS_PER_AXLE) * drive.remainingDriveFraction
  const forward = drive.throttle * available

  if (drive.brake > 0 && drive.brakePedalDrivesReverse) {
    return forward - drive.brake * available * tuning.reverseForceScale
  }

  return forward
}

function retardingForce(wheel: WheelState, drive: TyreDriveContext, tuning: VehicleTuning, dt: number): number {
  let force = tuning.rollingResistance * Math.abs(wheel.slipSpeedLongitudinal)

  if (drive.brake > 0 && !drive.brakePedalDrivesReverse) {
    force += drive.brake * (tuning.brakeForce / WHEEL_COUNT)
  }

  if (drive.handbrake && !wheel.isFront) {
    force += tuning.handbrakeForce / WHEELS_PER_AXLE
  }

  return Math.min(force, forceThatCancelsSlipInOneStep(wheel.slipSpeedLongitudinal, drive.massPerWheel, dt))
}

/**
 * Take hold of the ground if the tyre is as good as still and nothing is
 * asked of it; let go the moment something is, or something moves it.
 * The handbrake or the brake at speed ask nothing: they are stopping it.
 */
function takeHold(wheel: WheelState, drive: TyreDriveContext): void {
  const asked = drive.throttle > 0 || (drive.brake > 0 && drive.brakePedalDrivesReverse)
  const still =
    Math.abs(wheel.slipSpeedLongitudinal) < HOLD_SLIP_SPEED && Math.abs(wheel.slipSpeedLateral) < HOLD_SLIP_SPEED
  if (asked || !still) {
    wheel.held = false
    return
  }
  if (wheel.held) return
  wheel.held = true
  vcopy(wheel.holdPoint, wheel.contactPoint)
}

/** The pull of a held tyre along one of its axes: back to where it took hold, and against its slip. */
function holdForce(displacement: number, slipSpeed: number, drive: TyreDriveContext, dt: number): number {
  const spring = HOLD_STIFFNESS_PER_KG * drive.massPerWheel * displacement
  const damping = Math.sign(slipSpeed) * forceThatCancelsSlipInOneStep(slipSpeed, drive.massPerWheel, dt)
  return -(spring + damping)
}

function lateralGrip(wheel: WheelState, drive: TyreDriveContext, tuning: VehicleTuning): number {
  const grip = lateralGripCurve(wheel.slipSpeedLateral, tuning)

  if (wheel.isFront) return grip

  const rearGrip = grip * tuning.rearLateralGripScale

  if (drive.handbrake) return rearGrip * tuning.handbrakeRearGripFraction

  return rearGrip
}

export function solveTyreForces(wheel: WheelState, drive: TyreDriveContext, tuning: VehicleTuning, dt: number): void {
  // A corner the stick is pulling down to the ground has nothing pressing
  // its tyre into it: no grip, rather than the grip of a load below nothing,
  // which would turn every bound here inside out.
  const load = Math.max(wheel.suspensionForce, 0)
  const longitudinalCeiling = tuning.longitudinalGrip * load
  takeHold(wheel, drive)

  let longitudinal: number
  let lateral: number
  if (wheel.held) {
    // Held: pulled back to where it took hold, as hard as a tyre can pull.
    vsub(holdOffset, wheel.contactPoint, wheel.holdPoint)
    longitudinal = clamp(
      holdForce(vdot(holdOffset, wheel.forward), wheel.slipSpeedLongitudinal, drive, dt),
      -longitudinalCeiling,
      longitudinalCeiling,
    )
    const lateralCeiling = tuning.lateralPeakGrip * load
    lateral = clamp(
      holdForce(vdot(holdOffset, wheel.right), wheel.slipSpeedLateral, drive, dt),
      -lateralCeiling,
      lateralCeiling,
    )
  } else {
    longitudinal = clamp(
      driveForce(wheel, drive, tuning) -
        Math.sign(wheel.slipSpeedLongitudinal) * retardingForce(wheel, drive, tuning, dt),
      -longitudinalCeiling,
      longitudinalCeiling,
    )
    lateral =
      -Math.sign(wheel.slipSpeedLateral) *
      Math.min(
        lateralGrip(wheel, drive, tuning) * load,
        forceThatCancelsSlipInOneStep(wheel.slipSpeedLateral, drive.massPerWheel, dt),
      )
  }

  const frictionCircleLimit = tuning.frictionCircleGrip * load
  const combined = hypot(longitudinal, lateral)

  if (combined > frictionCircleLimit && combined > MIN_COMBINED_FORCE) {
    const scale = frictionCircleLimit / combined

    longitudinal *= scale
    lateral *= scale
  }

  wheel.forceLongitudinal = longitudinal
  wheel.forceLateral = lateral
}
