// Every vehicle's numbers: its body, springs, tyres, engine, and how it
// behaves in the air and in a crash. Ten profiles, each measured off the
// model the client draws it with, at the scale it is drawn.

import { createRng } from '@buggies/physics'

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

  /** How hard the throttle and brake pitch the nose in the air. The steering does nothing there. */
  airPitchTorque: number

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
  /**
   * Level acceleration, in m/s², below which the car is only being driven:
   * anything the tyres can do to it. Past it, the car is being knocked, and
   * every bit of speed it gains or loses over that in a step is damage.
   */
  damageAcceleration: number
  /** How much level speed change, in m/s over all its knocks, wrecks the car. */
  damageToWreck: number
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

/**
 * The righting torque goes with the mass, so that a truck rolls back
 * onto its wheels as readily as a car does.
 */
const SELF_RIGHT_TORQUE_PER_KILOGRAM = 10

function selfRightTuning(mass: number) {
  return {
    selfRightUprightDot: 0.35,
    selfRightRecoveredDot: 0.7,
    selfRightRestLinearSpeed: 0.5,
    selfRightRestAngularSpeed: 0.3,
    selfRightDelay: 1.2,
    selfRightTorque: SELF_RIGHT_TORQUE_PER_KILOGRAM * mass,
    selfRightMaxDuration: 3.0,
    selfRightLiftSpeed: 3.0,
    selfRightSnapLift: 0.6,
  }
}

const SHARED_DAMPING_TUNING = {
  linearDamping: 0.02,
  angularDampingGrounded: 1.8,
  angularDampingAirborne: 1.4,
}

const SPORTS_CAR_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 1.04,
  chassisHalfHeight: 0.65,
  chassisHalfLength: 2.04,
  mass: 1200,
  centerOfMassOffsetY: -0.5,
  centerOfMassOffsetZ: 0.0,

  halfTrackWidth: 0.85,
  frontAxleZ: -1.06,
  rearAxleZ: 1.06,
  suspensionMountY: -0.4,
  wheelRadius: 0.48,

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

  airLevelTorque: 26000,
  airLevelDamping: 9000,
  airLevelEngageDelay: 0.08,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 80,
  airLevelInputYield: 0.35,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.4,
  airLevelLandingBoostMax: 2.5,

  ...selfRightTuning(1200),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

const PICKUP_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 1.12,
  chassisHalfHeight: 0.75,
  chassisHalfLength: 2.21,
  mass: 2200,
  centerOfMassOffsetY: -0.5,
  centerOfMassOffsetZ: -0.075,

  halfTrackWidth: 0.9,
  frontAxleZ: -1.29,
  rearAxleZ: 1.14,
  suspensionMountY: -0.456,
  wheelRadius: 0.45,

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

  engineForce: 40000,
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

  airLevelTorque: 34000,
  airLevelDamping: 17000,
  airLevelEngageDelay: 0.08,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 104,
  airLevelInputYield: 0.4,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.45,
  airLevelLandingBoostMax: 2.0,

  ...selfRightTuning(2200),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

const RACE_CAR_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 0.93,
  chassisHalfHeight: 0.4,
  chassisHalfLength: 1.98,
  mass: 900,
  centerOfMassOffsetY: -0.4,
  centerOfMassOffsetZ: 0.18,

  halfTrackWidth: 0.85,
  frontAxleZ: -0.99,
  rearAxleZ: 1.36,
  suspensionMountY: -0.1,
  wheelRadius: 0.465,

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

  airLevelTorque: 22000,
  airLevelDamping: 7000,
  airLevelEngageDelay: 0.06,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 64,
  airLevelInputYield: 0.35,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.35,
  airLevelLandingBoostMax: 3.2,

  ...selfRightTuning(900),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

// The rest of the garage. Each is a body of its own, weighed and sprung
// for what it is, from a kart you sit an inch off the road in to a tank. Every
// vehicle's measurements are those of the model the client draws it with, at
// the scale it is drawn: the chassis box is the body,
// the wheels are as big as its wheels and on its axles. The tyres stand a
// little wider than the wheels are drawn, though: these bodies are tall for
// their width, and would go over in a bend otherwise.

/** A patrol sedan: a heavier, softer sports car with a bit more shove and a lot more to it. */
const POLICE_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 1.08,
  chassisHalfHeight: 0.7,
  chassisHalfLength: 2.24,
  mass: 1700,
  centerOfMassOffsetY: -0.55,
  centerOfMassOffsetZ: 0.0,

  halfTrackWidth: 0.85,
  frontAxleZ: -1.17,
  rearAxleZ: 1.17,
  suspensionMountY: -0.53,
  wheelRadius: 0.435,

  suspensionRestLength: 0.32,
  suspensionStiffness: 36000,
  suspensionDamping: 3600,
  maxSuspensionForce: 80000,
  bumpStopStiffness: 280000,
  antiRollStiffnessFront: 21000,
  antiRollStiffnessRear: 17000,

  groundStickRange: 0.5,
  groundStickStiffness: 16000,
  groundStickLiftSpeed: 4.5,

  maxSteerAngle: 0.6,
  steerRate: 4.0,
  steerReturnRate: 6.0,
  steerAtHighSpeed: 0.33,
  steerFalloffMinSpeed: 8,
  steerFalloffMaxSpeed: 45,
  counterSteerSlipMin: 0.2,
  counterSteerAuthority: 0.9,

  engineForce: 28000,
  driveSplit: 0.15,
  maxSpeed: 66,
  brakeForce: 34000,
  handbrakeForce: 12000,
  reverseForceScale: 0.45,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 13,
  dragCoefficient: 2.9,

  lateralPeakSlip: 2.5,
  lateralPeakGrip: 1.7,
  lateralPlateauEndSlip: 6.0,
  lateralFalloffRange: 12.0,
  lateralTailGrip: 1.1,
  longitudinalGrip: 2.0,
  frictionCircleGrip: 2.15,
  handbrakeRearGripFraction: 0.35,
  rearLateralGripScale: 0.95,

  downforce: 1.8,
  yawAssistTorque: 7500,
  yawAssistMinSpeed: 1.5,
  yawAssistFullSpeed: 12,
  yawAssistSlipCutoff: 0.9,

  airPitchTorque: 5200,

  airLevelTorque: 34000,
  airLevelDamping: 12000,
  airLevelEngageDelay: 0.08,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 96,
  airLevelInputYield: 0.35,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.4,
  airLevelLandingBoostMax: 2.5,

  ...selfRightTuning(1700),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

/**
 * A fire engine: seven tonnes on four driven wheels, with the engine to take
 * them up a mountain and the springs to keep all that height from going over.
 */
const FIRETRUCK_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 1.27,
  chassisHalfHeight: 1.1,
  chassisHalfLength: 2.89,
  mass: 7000,
  centerOfMassOffsetY: -0.75,
  centerOfMassOffsetZ: -0.25,

  halfTrackWidth: 1.1,
  frontAxleZ: -1.63,
  rearAxleZ: 1.12,
  suspensionMountY: -0.81,
  wheelRadius: 0.51,

  suspensionRestLength: 0.5,
  suspensionStiffness: 150000,
  suspensionDamping: 15000,
  maxSuspensionForce: 300000,
  bumpStopStiffness: 900000,
  antiRollStiffnessFront: 120000,
  antiRollStiffnessRear: 100000,

  groundStickRange: 0.6,
  groundStickStiffness: 60000,
  groundStickLiftSpeed: 4.0,

  maxSteerAngle: 0.45,
  steerRate: 2.0,
  steerReturnRate: 3.0,
  steerAtHighSpeed: 0.28,
  steerFalloffMinSpeed: 6,
  steerFalloffMaxSpeed: 32,
  counterSteerSlipMin: 0.2,
  counterSteerAuthority: 0.8,

  engineForce: 120000,
  driveSplit: 0.5,
  maxSpeed: 36,
  brakeForce: 110000,
  handbrakeForce: 30000,
  reverseForceScale: 0.5,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 30,
  dragCoefficient: 9,

  lateralPeakSlip: 3.0,
  lateralPeakGrip: 1.0,
  lateralPlateauEndSlip: 8.0,
  lateralFalloffRange: 14,
  lateralTailGrip: 0.7,
  longitudinalGrip: 1.6,
  frictionCircleGrip: 1.7,
  handbrakeRearGripFraction: 0.4,
  rearLateralGripScale: 0.95,

  downforce: 0,
  yawAssistTorque: 15000,
  yawAssistMinSpeed: 2.0,
  yawAssistFullSpeed: 12,
  yawAssistSlipCutoff: 0.7,

  airPitchTorque: 9000,

  airLevelTorque: 110000,
  airLevelDamping: 50000,
  airLevelEngageDelay: 0.1,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 140,
  airLevelInputYield: 0.4,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.45,
  airLevelLandingBoostMax: 1.8,

  ...selfRightTuning(7000),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

/**
 * A city runabout: tiny, light, front driven, and quick to turn but not to
 * go. So short a car has little to hold it straight once its tail steps out,
 * so it is kept planted instead: its weight low, its tyres wide-set for its
 * body, and their grip a little short of a sports car's, so that it slides
 * before it snaps.
 */
const SMALL_CAR_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 0.75,
  chassisHalfHeight: 0.5,
  chassisHalfLength: 1.64,
  mass: 800,
  centerOfMassOffsetY: -0.45,
  centerOfMassOffsetZ: 0.0,

  halfTrackWidth: 0.72,
  frontAxleZ: -0.93,
  rearAxleZ: 0.93,
  suspensionMountY: -0.275,
  wheelRadius: 0.345,

  suspensionRestLength: 0.28,
  suspensionStiffness: 20000,
  suspensionDamping: 2000,
  maxSuspensionForce: 45000,
  bumpStopStiffness: 160000,
  antiRollStiffnessFront: 12000,
  antiRollStiffnessRear: 10000,

  groundStickRange: 0.5,
  groundStickStiffness: 10000,
  groundStickLiftSpeed: 4.5,

  maxSteerAngle: 0.62,
  steerRate: 5.0,
  steerReturnRate: 7.0,
  steerAtHighSpeed: 0.32,
  steerFalloffMinSpeed: 7,
  steerFalloffMaxSpeed: 35,
  counterSteerSlipMin: 0.2,
  counterSteerAuthority: 0.9,

  engineForce: 11000,
  driveSplit: 1.0,
  maxSpeed: 42,
  brakeForce: 16000,
  handbrakeForce: 6000,
  reverseForceScale: 0.5,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 10,
  dragCoefficient: 2.4,

  lateralPeakSlip: 2.6,
  lateralPeakGrip: 1.35,
  lateralPlateauEndSlip: 6.5,
  lateralFalloffRange: 12,
  lateralTailGrip: 1.1,
  longitudinalGrip: 1.8,
  frictionCircleGrip: 2.0,
  handbrakeRearGripFraction: 0.35,
  rearLateralGripScale: 1.05,

  downforce: 0.5,
  yawAssistTorque: 3000,
  yawAssistMinSpeed: 1.5,
  yawAssistFullSpeed: 12,
  yawAssistSlipCutoff: 0.9,

  airPitchTorque: 3000,

  airLevelTorque: 18000,
  airLevelDamping: 6000,
  airLevelEngageDelay: 0.08,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 60,
  airLevelInputYield: 0.35,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.4,
  airLevelLandingBoostMax: 2.5,

  ...selfRightTuning(800),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

/**
 * A tank: fourteen tonnes low on its tracks, slow, all but impossible to slide
 * or tip, and shrugging off knocks that would wreck anything else.
 */
const TANK_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 1.6,
  chassisHalfHeight: 1.0,
  chassisHalfLength: 1.69,
  mass: 14000,
  centerOfMassOffsetY: -0.45,
  centerOfMassOffsetZ: 0.0,

  halfTrackWidth: 1.3,
  frontAxleZ: -1.05,
  rearAxleZ: 1.05,
  suspensionMountY: -0.375,
  wheelRadius: 0.45,

  suspensionRestLength: 0.35,
  suspensionStiffness: 360000,
  suspensionDamping: 36000,
  maxSuspensionForce: 600000,
  bumpStopStiffness: 2000000,
  antiRollStiffnessFront: 250000,
  antiRollStiffnessRear: 250000,

  groundStickRange: 0.5,
  groundStickStiffness: 120000,
  groundStickLiftSpeed: 3.5,

  maxSteerAngle: 0.7,
  steerRate: 2.5,
  steerReturnRate: 4.0,
  steerAtHighSpeed: 0.5,
  steerFalloffMinSpeed: 5,
  steerFalloffMaxSpeed: 25,
  counterSteerSlipMin: 0.3,
  counterSteerAuthority: 0.3,

  // The pull to climb anything at all: on an 80% grade it still makes
  // 10m/s, where half this had it stall on 65%. The top speed keeps it a tank.
  engineForce: 400000,
  driveSplit: 0.5,
  maxSpeed: 18,
  brakeForce: 260000,
  handbrakeForce: 120000,
  reverseForceScale: 0.8,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 60,
  dragCoefficient: 14,

  lateralPeakSlip: 3.5,
  lateralPeakGrip: 1.6,
  lateralPlateauEndSlip: 9.0,
  lateralFalloffRange: 15,
  lateralTailGrip: 1.2,
  longitudinalGrip: 2.2,
  frictionCircleGrip: 2.4,
  handbrakeRearGripFraction: 0.2,
  rearLateralGripScale: 1.0,

  downforce: 0,
  yawAssistTorque: 40000,
  yawAssistMinSpeed: 1.0,
  yawAssistFullSpeed: 8,
  yawAssistSlipCutoff: 0.9,

  airPitchTorque: 18000,

  airLevelTorque: 260000,
  airLevelDamping: 120000,
  airLevelEngageDelay: 0.1,
  impactSpeedChange: 6,
  impactTumbleTime: 2.0,
  damageAcceleration: 120,
  damageToWreck: 400,
  airLevelInputYield: 0.3,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.5,
  airLevelLandingBoostMax: 1.5,

  ...selfRightTuning(14000),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

/** An ambulance: a tall, loaded van, steady enough to get there in one piece. */
const AMBULANCE_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 1.2,
  chassisHalfHeight: 1.1,
  chassisHalfLength: 2.6,
  mass: 3500,
  centerOfMassOffsetY: -0.7,
  centerOfMassOffsetZ: -0.08,

  halfTrackWidth: 0.95,
  frontAxleZ: -1.62,
  rearAxleZ: 1.46,
  suspensionMountY: -0.93,
  wheelRadius: 0.48,

  suspensionRestLength: 0.42,
  suspensionStiffness: 68000,
  suspensionDamping: 6800,
  maxSuspensionForce: 150000,
  bumpStopStiffness: 420000,
  antiRollStiffnessFront: 55000,
  antiRollStiffnessRear: 45000,

  groundStickRange: 0.55,
  groundStickStiffness: 28000,
  groundStickLiftSpeed: 4.5,

  maxSteerAngle: 0.5,
  steerRate: 2.8,
  steerReturnRate: 3.8,
  steerAtHighSpeed: 0.3,
  steerFalloffMinSpeed: 8,
  steerFalloffMaxSpeed: 38,
  counterSteerSlipMin: 0.2,
  counterSteerAuthority: 0.9,

  engineForce: 62000,
  driveSplit: 0.1,
  maxSpeed: 46,
  brakeForce: 52000,
  handbrakeForce: 16000,
  reverseForceScale: 0.47,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 20,
  dragCoefficient: 5,

  lateralPeakSlip: 2.7,
  lateralPeakGrip: 1.1,
  lateralPlateauEndSlip: 7.5,
  lateralFalloffRange: 14,
  lateralTailGrip: 0.75,
  longitudinalGrip: 1.8,
  frictionCircleGrip: 1.9,
  handbrakeRearGripFraction: 0.4,
  rearLateralGripScale: 0.92,

  downforce: 0.5,
  yawAssistTorque: 7000,
  yawAssistMinSpeed: 2.0,
  yawAssistFullSpeed: 14,
  yawAssistSlipCutoff: 0.7,

  airPitchTorque: 5000,

  airLevelTorque: 55000,
  airLevelDamping: 26000,
  airLevelEngageDelay: 0.08,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 110,
  airLevelInputYield: 0.4,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.45,
  airLevelLandingBoostMax: 2.0,

  ...selfRightTuning(3500),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

/**
 * A semi's tractor unit, running bobtail: the heaviest thing on the road bar
 * the tank, slow to steer and slower to stop, but with the pull to climb anything.
 */
const SEMI_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 1.28,
  chassisHalfHeight: 1.3,
  chassisHalfLength: 3.03,
  mass: 8500,
  centerOfMassOffsetY: -0.8,
  centerOfMassOffsetZ: 0.05,

  halfTrackWidth: 1.1,
  frontAxleZ: -1.75,
  rearAxleZ: 1.84,
  suspensionMountY: -0.87,
  wheelRadius: 0.5,

  suspensionRestLength: 0.5,
  suspensionStiffness: 190000,
  suspensionDamping: 19000,
  maxSuspensionForce: 360000,
  bumpStopStiffness: 1100000,
  antiRollStiffnessFront: 150000,
  antiRollStiffnessRear: 130000,

  groundStickRange: 0.6,
  groundStickStiffness: 70000,
  groundStickLiftSpeed: 4.0,

  maxSteerAngle: 0.45,
  steerRate: 1.8,
  steerReturnRate: 2.8,
  steerAtHighSpeed: 0.26,
  steerFalloffMinSpeed: 6,
  steerFalloffMaxSpeed: 32,
  counterSteerSlipMin: 0.2,
  counterSteerAuthority: 0.8,

  engineForce: 95000,
  driveSplit: 0.0,
  maxSpeed: 30,
  brakeForce: 130000,
  handbrakeForce: 40000,
  reverseForceScale: 0.5,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 32,
  dragCoefficient: 10,

  lateralPeakSlip: 3.0,
  lateralPeakGrip: 1.0,
  lateralPlateauEndSlip: 8.0,
  lateralFalloffRange: 14,
  lateralTailGrip: 0.7,
  longitudinalGrip: 1.7,
  frictionCircleGrip: 1.8,
  handbrakeRearGripFraction: 0.4,
  rearLateralGripScale: 1.0,

  downforce: 0,
  yawAssistTorque: 18000,
  yawAssistMinSpeed: 2.0,
  yawAssistFullSpeed: 12,
  yawAssistSlipCutoff: 0.7,

  airPitchTorque: 10000,

  airLevelTorque: 130000,
  airLevelDamping: 60000,
  airLevelEngageDelay: 0.1,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 150,
  airLevelInputYield: 0.4,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.45,
  airLevelLandingBoostMax: 1.8,

  ...selfRightTuning(8500),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

/**
 * A go-kart: two hundred kilos an inch off the road, on springs that hardly
 * are, that turns the instant it is asked and breaks if it is knocked at all.
 */
const GO_KART_TUNING: Readonly<VehicleTuning> = Object.freeze({
  chassisHalfWidth: 0.6,
  chassisHalfHeight: 0.25,
  chassisHalfLength: 0.93,
  mass: 320,
  centerOfMassOffsetY: -0.2,
  centerOfMassOffsetZ: 0.175,

  halfTrackWidth: 0.55,
  frontAxleZ: -0.27,
  rearAxleZ: 0.62,
  suspensionMountY: -0.16,
  wheelRadius: 0.273,

  suspensionRestLength: 0.14,
  suspensionStiffness: 30000,
  suspensionDamping: 2600,
  maxSuspensionForce: 30000,
  bumpStopStiffness: 300000,
  antiRollStiffnessFront: 8000,
  antiRollStiffnessRear: 8000,

  groundStickRange: 0.3,
  groundStickStiffness: 6000,
  groundStickLiftSpeed: 5.0,

  maxSteerAngle: 0.55,
  steerRate: 8.0,
  steerReturnRate: 10.0,
  steerAtHighSpeed: 0.45,
  steerFalloffMinSpeed: 8,
  steerFalloffMaxSpeed: 30,
  counterSteerSlipMin: 0.25,
  counterSteerAuthority: 0.6,

  engineForce: 9000,
  driveSplit: 0.0,
  maxSpeed: 36,
  brakeForce: 7500,
  handbrakeForce: 2500,
  reverseForceScale: 0.5,
  reverseSpeedThreshold: 0.5,
  rollingResistance: 4,
  dragCoefficient: 0.8,

  lateralPeakSlip: 2.0,
  lateralPeakGrip: 2.2,
  lateralPlateauEndSlip: 4.0,
  lateralFalloffRange: 7,
  lateralTailGrip: 1.0,
  longitudinalGrip: 2.1,
  frictionCircleGrip: 2.3,
  handbrakeRearGripFraction: 0.3,
  rearLateralGripScale: 0.9,

  downforce: 0.2,
  // Little yaw assist: so light and short a kart needs no help turning in,
  // and with more it slid wide at every full-lock corner.
  yawAssistTorque: 800,
  yawAssistMinSpeed: 1.0,
  yawAssistFullSpeed: 10,
  yawAssistSlipCutoff: 0.7,

  airPitchTorque: 1100,

  airLevelTorque: 5600,
  airLevelDamping: 1900,
  airLevelEngageDelay: 0.06,
  impactSpeedChange: 4,
  impactTumbleTime: 2.5,
  damageAcceleration: 80,
  damageToWreck: 44,
  airLevelInputYield: 0.35,
  airLevelLandingCastDistance: 20,
  airLevelLandingLookahead: 0.35,
  airLevelLandingBoostMax: 3.0,

  ...selfRightTuning(320),
  ...SHARED_DAMPING_TUNING,
} satisfies VehicleTuning)

export type VehicleProfileId =
  'raceCar' | 'police' | 'firetruck' | 'pickup' | 'sportsCar' | 'smallCar' | 'tank' | 'ambulance' | 'semi' | 'goKart'

export const VEHICLE_PROFILE_IDS: readonly VehicleProfileId[] = [
  'sportsCar',
  'raceCar',
  'police',
  'firetruck',
  'pickup',
  'smallCar',
  'tank',
  'ambulance',
  'semi',
  'goKart',
]

export const VEHICLE_PROFILE_LABELS: Readonly<Record<VehicleProfileId, string>> = Object.freeze({
  raceCar: 'Race car',
  police: 'Police car',
  firetruck: 'Fire truck',
  pickup: 'Heavy pickup',
  sportsCar: 'Sports car',
  smallCar: 'Small car',
  tank: 'Tank',
  ambulance: 'Ambulance',
  semi: 'Semi truck',
  goKart: 'Go-kart',
})

export const VEHICLE_PROFILES: Readonly<Record<VehicleProfileId, Readonly<VehicleTuning>>> = Object.freeze({
  raceCar: RACE_CAR_TUNING,
  police: POLICE_TUNING,
  firetruck: FIRETRUCK_TUNING,
  pickup: PICKUP_TUNING,
  sportsCar: SPORTS_CAR_TUNING,
  smallCar: SMALL_CAR_TUNING,
  tank: TANK_TUNING,
  ambulance: AMBULANCE_TUNING,
  semi: SEMI_TUNING,
  goKart: GO_KART_TUNING,
})

export const DEFAULT_VEHICLE_PROFILE: VehicleProfileId = 'sportsCar'

export function createVehicleTuning(profile: VehicleProfileId = DEFAULT_VEHICLE_PROFILE): VehicleTuning {
  return { ...VEHICLE_PROFILES[profile] }
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
