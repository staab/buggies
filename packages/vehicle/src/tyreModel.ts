// How a tyre grips: the lateral force curve, the drive and retarding
// forces, and the friction circle that bounds them together.

import { clamp, hypot, inverseLerpClamped } from '@buggies/physics'
import type { VehicleTuning } from './tuning.ts'
import { WHEEL_COUNT, WHEELS_PER_AXLE, type WheelState } from './vehicleBody.ts'

const MIN_PEAK_SLIP_SPEED = 1e-4
const MIN_FALLOFF_RANGE = 1e-4
const MIN_COMBINED_FORCE = 1e-6

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

function lateralGrip(wheel: WheelState, drive: TyreDriveContext, tuning: VehicleTuning): number {
  const grip = lateralGripCurve(wheel.slipSpeedLateral, tuning)

  if (wheel.isFront) return grip

  const rearGrip = grip * tuning.rearLateralGripScale

  if (drive.handbrake) return rearGrip * tuning.handbrakeRearGripFraction

  return rearGrip
}

export function solveTyreForces(wheel: WheelState, drive: TyreDriveContext, tuning: VehicleTuning, dt: number): void {
  const load = wheel.suspensionForce
  const longitudinalCeiling = tuning.longitudinalGrip * load

  let longitudinal = clamp(
    driveForce(wheel, drive, tuning) -
      Math.sign(wheel.slipSpeedLongitudinal) * retardingForce(wheel, drive, tuning, dt),
    -longitudinalCeiling,
    longitudinalCeiling,
  )

  let lateral =
    -Math.sign(wheel.slipSpeedLateral) *
    Math.min(
      lateralGrip(wheel, drive, tuning) * load,
      forceThatCancelsSlipInOneStep(wheel.slipSpeedLateral, drive.massPerWheel, dt),
    )

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
