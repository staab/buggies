// Ported from the seattle project (src/physics/tuning.ts). Kept in its original
// shape and formatting so the two can be compared and resynced. Buggies adds
// the ground stick: how a car holds the road over a crest instead of leaving it.

import {createRng} from '@buggies/physics'

export interface VehicleTuning {
  chassisHalfWidth: number
  chassisHalfHeight: number
  chassisHalfLength: number
  mass: number
  centerOfMassOffsetY: number
  centerOfMassOffsetZ: number

  halfTrackWidth: number
  frontAxleZ: number
  rearAxleZ: number
  suspensionMountY: number
  wheelRadius: number

  suspensionRestLength: number
  suspensionStiffness: number
  suspensionDamping: number
  maxSuspensionForce: number
  bumpStopStiffness: number
  antiRollStiffnessFront: number
  antiRollStiffnessRear: number

  groundStickRange: number
  groundStickStiffness: number
  groundStickLiftSpeed: number

  maxSteerAngle: number
  steerRate: number
  steerReturnRate: number
  steerAtHighSpeed: number
  steerFalloffMinSpeed: number
  steerFalloffMaxSpeed: number
  counterSteerSlipMin: number
  counterSteerAuthority: number

  engineForce: number
  driveSplit: number
  maxSpeed: number
  brakeForce: number
  handbrakeForce: number
  reverseForceScale: number
  reverseSpeedThreshold: number
  rollingResistance: number
  dragCoefficient: number

  lateralPeakSlip: number
  lateralPeakGrip: number
  lateralPlateauEndSlip: number
  lateralFalloffRange: number
  lateralTailGrip: number
  longitudinalGrip: number
  frictionCircleGrip: number
  handbrakeRearGripFraction: number
  rearLateralGripScale: number

  downforce: number
  yawAssistTorque: number
  yawAssistMinSpeed: number
  yawAssistFullSpeed: number
  yawAssistSlipCutoff: number

  airPitchTorque: number
  airYawTorque: number
  airRollTorque: number

  airLevelTorque: number
  /** Torque against pitch and roll rate in the air, per rad/s: the damping on the levelling. */
  airLevelDamping: number
  airLevelEngageDelay: number
  /**
   * A knock this hard, in horizontal speed lost or gained in one step, is a
   * crash rather than a jump, and for `impactTumbleTime` after it the car is
   * left to tumble as it will.
   */
  impactSpeedChange: number
  impactTumbleTime: number
  airLevelInputYield: number
  airLevelLandingCastDistance: number
  airLevelLandingLookahead: number
  airLevelLandingBoostMax: number

  selfRightUprightDot: number
  selfRightRecoveredDot: number
  selfRightRestLinearSpeed: number
  selfRightRestAngularSpeed: number
  selfRightDelay: number
  selfRightTorque: number
  selfRightMaxDuration: number
  selfRightLiftSpeed: number
  selfRightSnapLift: number

  linearDamping: number
  angularDampingGrounded: number
  angularDampingAirborne: number
}

const SHARED_SELF_RIGHT_TUNING = {
  selfRightUprightDot: 0.35,
  selfRightRecoveredDot: 0.7,
  selfRightRestLinearSpeed: 0.5,
  selfRightRestAngularSpeed: 0.3,
  selfRightDelay: 1.2,
  selfRightTorque: 12000,
  selfRightMaxDuration: 3.0,
  selfRightLiftSpeed: 3.0,
  selfRightSnapLift: 0.6,
}

const SHARED_DAMPING_TUNING = {
  linearDamping: 0.02,
  angularDampingGrounded: 1.8,
  angularDampingAirborne: 1.4,
}

const MUSTANG_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 0.9,
  chassisHalfHeight: 0.3,
  chassisHalfLength: 2.1,
  mass: 1200,
  centerOfMassOffsetY: -0.3,
  centerOfMassOffsetZ: -0.1,

  halfTrackWidth: 0.85,
  frontAxleZ: -1.45,
  rearAxleZ: 1.45,
  suspensionMountY: -0.2,
  wheelRadius: 0.35,

  suspensionRestLength: 0.3,
  suspensionStiffness: 30000,
  suspensionDamping: 3000,
  maxSuspensionForce: 60000,
  bumpStopStiffness: 240000,
  antiRollStiffnessFront: 18000,
  antiRollStiffnessRear: 15000,

  groundStickRange: 0.5,
  groundStickStiffness: 14000,
  groundStickLiftSpeed: 4.5,

  maxSteerAngle: 0.62,
  steerRate: 4.0,
  steerReturnRate: 6.0,
  steerAtHighSpeed: 0.35,
  steerFalloffMinSpeed: 8,
  steerFalloffMaxSpeed: 45,
  counterSteerSlipMin: 0.2,
  counterSteerAuthority: 0.9,

  engineForce: 20000,
  driveSplit: 0.0,
  maxSpeed: 72,
  brakeForce: 25000,
  handbrakeForce: 9000,
  reverseForceScale: 0.45,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 12,
  dragCoefficient: 2.6,

  lateralPeakSlip: 2.5,
  lateralPeakGrip: 1.8,
  lateralPlateauEndSlip: 6.0,
  lateralFalloffRange: 12.0,
  lateralTailGrip: 1.15,
  longitudinalGrip: 2.0,
  frictionCircleGrip: 2.2,
  handbrakeRearGripFraction: 0.35,
  rearLateralGripScale: 0.95,

  downforce: 2.0,
  yawAssistTorque: 6000,
  yawAssistMinSpeed: 1.5,
  yawAssistFullSpeed: 12,
  yawAssistSlipCutoff: 0.9,

  airPitchTorque: 4000,
  airYawTorque: 3000,
  airRollTorque: 900,

  airLevelTorque: 26000,
  airLevelDamping: 9000,
  airLevelEngageDelay: 0.08,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  airLevelInputYield: 0.35,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.4,
  airLevelLandingBoostMax: 2.5,

  ...SHARED_SELF_RIGHT_TUNING,
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

const PICKUP_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 1.05,
  chassisHalfHeight: 0.5,
  chassisHalfLength: 2.6,
  mass: 2200,
  centerOfMassOffsetY: -0.42,
  centerOfMassOffsetZ: -0.15,

  halfTrackWidth: 1.0,
  frontAxleZ: -2.0,
  rearAxleZ: 1.9,
  suspensionMountY: -0.48,
  wheelRadius: 0.42,

  suspensionRestLength: 0.42,
  suspensionStiffness: 42000,
  suspensionDamping: 4200,
  maxSuspensionForce: 95000,
  bumpStopStiffness: 190000,
  antiRollStiffnessFront: 32000,
  antiRollStiffnessRear: 26000,

  groundStickRange: 0.55,
  groundStickStiffness: 18000,
  groundStickLiftSpeed: 4.5,

  maxSteerAngle: 0.5,
  steerRate: 2.6,
  steerReturnRate: 3.6,
  steerAtHighSpeed: 0.3,
  steerFalloffMinSpeed: 8,
  steerFalloffMaxSpeed: 40,
  counterSteerSlipMin: 0.2,
  counterSteerAuthority: 0.9,

  engineForce: 26000,
  driveSplit: 0.4,
  maxSpeed: 44,
  brakeForce: 32000,
  handbrakeForce: 11000,
  reverseForceScale: 0.47,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 18,
  dragCoefficient: 3.6,

  lateralPeakSlip: 2.6,
  lateralPeakGrip: 1.15,
  lateralPlateauEndSlip: 7.5,
  lateralFalloffRange: 14,
  lateralTailGrip: 0.75,
  longitudinalGrip: 1.9,
  frictionCircleGrip: 2.0,
  handbrakeRearGripFraction: 0.4,
  rearLateralGripScale: 0.92,

  downforce: 1.0,
  yawAssistTorque: 4000,
  yawAssistMinSpeed: 2.0,
  yawAssistFullSpeed: 14,
  yawAssistSlipCutoff: 0.7,

  airPitchTorque: 3000,
  airYawTorque: 2200,
  airRollTorque: 700,

  airLevelTorque: 34000,
  airLevelDamping: 17000,
  airLevelEngageDelay: 0.08,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  airLevelInputYield: 0.4,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.45,
  airLevelLandingBoostMax: 2.0,

  ...SHARED_SELF_RIGHT_TUNING,
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

const RACE_CAR_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 0.82,
  chassisHalfHeight: 0.22,
  chassisHalfLength: 1.95,
  mass: 900,
  centerOfMassOffsetY: -0.45,
  centerOfMassOffsetZ: 0.0,

  halfTrackWidth: 0.95,
  frontAxleZ: -1.3,
  rearAxleZ: 1.3,
  suspensionMountY: -0.16,
  wheelRadius: 0.3,

  suspensionRestLength: 0.16,
  suspensionStiffness: 58000,
  suspensionDamping: 6000,
  maxSuspensionForce: 60000,
  bumpStopStiffness: 460000,
  antiRollStiffnessFront: 22000,
  antiRollStiffnessRear: 26000,

  groundStickRange: 0.4,
  groundStickStiffness: 18000,
  groundStickLiftSpeed: 4.5,

  maxSteerAngle: 0.58,
  steerRate: 7.0,
  steerReturnRate: 9.0,
  steerAtHighSpeed: 0.42,
  steerFalloffMinSpeed: 10,
  steerFalloffMaxSpeed: 55,
  counterSteerSlipMin: 0.25,
  counterSteerAuthority: 0.5,

  engineForce: 19000,
  driveSplit: 0.0,
  maxSpeed: 125,
  brakeForce: 34000,
  handbrakeForce: 8000,
  reverseForceScale: 0.5,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 9,
  dragCoefficient: 1.5,

  lateralPeakSlip: 1.8,
  lateralPeakGrip: 2.6,
  lateralPlateauEndSlip: 3.2,
  lateralFalloffRange: 5.5,
  lateralTailGrip: 0.85,
  longitudinalGrip: 2.0,
  frictionCircleGrip: 2.4,
  handbrakeRearGripFraction: 0.3,
  rearLateralGripScale: 0.82,

  // Enough to plant it, not enough to crush it: at its top speed this is half
  // its weight, and the suspension still has travel left for the road.
  downforce: 2.2,
  yawAssistTorque: 3500,
  yawAssistMinSpeed: 1.0,
  yawAssistFullSpeed: 10,
  yawAssistSlipCutoff: 0.5,

  airPitchTorque: 5500,
  airYawTorque: 4500,
  airRollTorque: 1200,

  airLevelTorque: 22000,
  airLevelDamping: 7000,
  airLevelEngageDelay: 0.06,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  airLevelInputYield: 0.35,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.35,
  airLevelLandingBoostMax: 3.2,

  ...SHARED_SELF_RIGHT_TUNING,
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

export type VehicleProfileId = 'pickup' | 'mustang' | 'raceCar'

export const VEHICLE_PROFILE_IDS: readonly VehicleProfileId[] = ['pickup', 'mustang', 'raceCar']

export const VEHICLE_PROFILE_LABELS: Readonly<Record<VehicleProfileId, string>> = Object.freeze({
  pickup: 'Heavy pickup',
  mustang: 'Mustang',
  raceCar: 'Race car',
})

export const VEHICLE_PROFILES: Readonly<Record<VehicleProfileId, Readonly<VehicleTuning>>> =
  Object.freeze({
    pickup: PICKUP_TUNING,
    mustang: MUSTANG_TUNING,
    raceCar: RACE_CAR_TUNING,
  })

export const DEFAULT_VEHICLE_PROFILE: VehicleProfileId = 'mustang'

export function createVehicleTuning(profile: VehicleProfileId = DEFAULT_VEHICLE_PROFILE): VehicleTuning {
  return {...VEHICLE_PROFILES[profile]}
}

export function createVehicleTuningByProfile(): Record<VehicleProfileId, VehicleTuning> {
  const result = {} as Record<VehicleProfileId, VehicleTuning>

  for (const profile of VEHICLE_PROFILE_IDS) result[profile] = createVehicleTuning(profile)

  return result
}

export function resetVehicleTuning(tuning: VehicleTuning, profile: VehicleProfileId): void {
  Object.assign(tuning, VEHICLE_PROFILES[profile])
}

export function nextVehicleProfile(profile: VehicleProfileId): VehicleProfileId {
  const index = VEHICLE_PROFILE_IDS.indexOf(profile)
  const next = (index + 1) % VEHICLE_PROFILE_IDS.length

  return VEHICLE_PROFILE_IDS[next] ?? DEFAULT_VEHICLE_PROFILE
}

export function profileForSeed(seed: number): VehicleProfileId {
  const roll = createRng(seed)()
  const index = Math.floor(roll * VEHICLE_PROFILE_IDS.length)

  return VEHICLE_PROFILE_IDS[index] ?? DEFAULT_VEHICLE_PROFILE
}
