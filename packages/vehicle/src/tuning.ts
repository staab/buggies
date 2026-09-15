/**
 * Every dial that gives a vehicle its character. Distances are world units
 * (roughly metres), speeds are units per second and accelerations are units
 * per second squared, so a value can be read against gravity at a glance.
 *
 * This is deliberately a short list. It is enough to tell a wallowing truck
 * from a darty buggy, and stops well short of the per-wheel loads, slip ratios
 * and load transfer a simulator needs.
 */
export interface VehicleTuning {
  /** Body box, drawn by the view and used to place the wheels. */
  length: number
  width: number
  height: number
  wheelBase: number
  trackWidth: number
  wheelRadius: number
  /** Clearance under the body, above the contact patch. */
  rideHeight: number

  /** Acceleration at a standstill, falling to nothing at `maxSpeed`. */
  enginePower: number
  maxSpeed: number
  /** Share of engine power available in reverse. */
  reversePower: number
  reverseMaxSpeed: number
  brakePower: number
  /** Coasting losses: linear in speed, then quadratic with it. */
  rollingResistance: number
  dragCoefficient: number

  maxSteerAngle: number
  /** How fast the rack travels, in radians per second. */
  steerRate: number
  /** Share of the steering lock still available at `steerFalloffSpeed`. */
  steerAtMaxSpeed: number
  steerFalloffSpeed: number
  /** How sharply the nose answers the wheel. Higher is twitchier. */
  yawResponse: number

  /** Sideways acceleration the tyres hold before they let go. */
  gripLimit: number
  /** What is left once they have, which is what a slide feels like. */
  driftGrip: number
  /** Sideways speed the tyres tolerate before grip starts to fade. */
  slipTolerance: number
  /** How much more slip it takes to fade all the way to `driftGrip`. */
  slipRange: number
  /** Share of grip the rear keeps with the handbrake down. */
  handbrakeGrip: number

  /** Steering authority in the air, in radians per second. */
  airSteer: number
  /** How far the ground can fall away before the wheels leave it. */
  groundStick: number
  /** Visual suspension travel. */
  suspensionTravel: number
  /** Visual body lean at the limit of grip, in radians. */
  bodyLean: number
}

const BUGGY: Readonly<VehicleTuning> = Object.freeze({
  length: 4.0,
  width: 2.0,
  height: 1.1,
  wheelBase: 2.7,
  trackWidth: 1.8,
  wheelRadius: 0.52,
  rideHeight: 0.45,

  enginePower: 14,
  maxSpeed: 45,
  reversePower: 0.45,
  reverseMaxSpeed: 12,
  brakePower: 22,
  rollingResistance: 0.02,
  dragCoefficient: 0.0006,

  maxSteerAngle: 0.62,
  steerRate: 5,
  steerAtMaxSpeed: 0.35,
  steerFalloffSpeed: 40,
  yawResponse: 9,

  gripLimit: 13,
  driftGrip: 7,
  slipTolerance: 3.5,
  slipRange: 7,
  handbrakeGrip: 0.35,

  airSteer: 1.6,
  groundStick: 0.35,
  suspensionTravel: 0.35,
  bodyLean: 0.1,
} satisfies VehicleTuning)

const TRUCK: Readonly<VehicleTuning> = Object.freeze({
  length: 5.6,
  width: 2.4,
  height: 1.7,
  wheelBase: 3.6,
  trackWidth: 2.1,
  wheelRadius: 0.62,
  rideHeight: 0.55,

  enginePower: 8.5,
  maxSpeed: 32,
  reversePower: 0.5,
  reverseMaxSpeed: 10,
  brakePower: 15,
  rollingResistance: 0.05,
  dragCoefficient: 0.0011,

  maxSteerAngle: 0.5,
  steerRate: 2.8,
  steerAtMaxSpeed: 0.3,
  steerFalloffSpeed: 30,
  yawResponse: 4.5,

  gripLimit: 8,
  driftGrip: 4.5,
  slipTolerance: 3,
  slipRange: 9,
  handbrakeGrip: 0.4,

  airSteer: 0.9,
  groundStick: 0.45,
  suspensionTravel: 0.45,
  bodyLean: 0.16,
} satisfies VehicleTuning)

const RACER: Readonly<VehicleTuning> = Object.freeze({
  length: 4.3,
  width: 1.9,
  height: 0.85,
  wheelBase: 2.6,
  trackWidth: 1.75,
  wheelRadius: 0.4,
  rideHeight: 0.22,

  enginePower: 18,
  maxSpeed: 62,
  reversePower: 0.35,
  reverseMaxSpeed: 10,
  brakePower: 28,
  rollingResistance: 0.015,
  dragCoefficient: 0.0005,

  maxSteerAngle: 0.55,
  steerRate: 7,
  steerAtMaxSpeed: 0.4,
  steerFalloffSpeed: 55,
  yawResponse: 12,

  gripLimit: 17,
  // Well short of `gripLimit`, and reached quickly: the back steps out hard
  // and it takes a lift to get it back.
  driftGrip: 6.5,
  slipTolerance: 2.2,
  slipRange: 4,
  handbrakeGrip: 0.3,

  airSteer: 2,
  groundStick: 0.22,
  suspensionTravel: 0.15,
  bodyLean: 0.06,
} satisfies VehicleTuning)

export type VehicleProfileId = 'buggy' | 'truck' | 'racer'

export const VEHICLE_PROFILE_IDS: readonly VehicleProfileId[] = ['buggy', 'truck', 'racer']

export const VEHICLE_PROFILES: Readonly<Record<VehicleProfileId, Readonly<VehicleTuning>>> =
  Object.freeze({ buggy: BUGGY, truck: TRUCK, racer: RACER })

export const VEHICLE_LABELS: Readonly<Record<VehicleProfileId, string>> = Object.freeze({
  buggy: 'Buggy',
  truck: 'Truck',
  racer: 'Racer',
})

export const DEFAULT_VEHICLE: VehicleProfileId = 'buggy'

export function vehicleTuning(profile: VehicleProfileId = DEFAULT_VEHICLE): VehicleTuning {
  return { ...VEHICLE_PROFILES[profile] }
}
