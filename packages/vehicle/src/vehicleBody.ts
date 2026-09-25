// A vehicle's rigid body and wheels: how they are made, sized and put back
// on a spawn.

import * as RAPIER from '@dimforge/rapier3d-compat'

import { quat, quatFromYaw, v3, vset, type Vec3 } from '@buggies/physics'
import { createChassisFrame, readChassisFrame, type ChassisFrame } from './chassisFrame.ts'
import { createDriverCommand, readDriverCommand, NEUTRAL_INPUT, type DriverCommand } from './input.ts'
import type { VehicleTuning } from './tuning.ts'
import { worldGravity } from './world.ts'

export const WHEEL_COUNT = 4
export const WHEELS_PER_AXLE = 2

const CHASSIS_FRICTION = 0.4
const CHASSIS_RESTITUTION = 0.1
const DENSITY_FROM_EXPLICIT_MASS_ONLY = 0
const MIN_SPRING_RATE = 1e-3

export interface WheelState {
  readonly isFront: boolean
  readonly isLeft: boolean

  grounded: boolean
  steerAngle: number
  suspensionLength: number
  compression: number
  suspensionExtensionRate: number
  suspensionForce: number
  bumpStopDepth: number
  /** How far past full droop the ground is, while the wheel is still holding on to it. */
  stickDepth: number

  rayOrigin: Vec3
  rayEnd: Vec3
  contactPoint: Vec3
  contactNormal: Vec3
  wheelCenter: Vec3

  forward: Vec3
  right: Vec3

  slipSpeedLongitudinal: number
  slipSpeedLateral: number
  forceLongitudinal: number
  forceLateral: number

  /** Whether the tire has taken hold of the ground at rest, and where it did. */
  held: boolean
  holdPoint: Vec3

  spin: number
}

export interface Axle {
  readonly left: WheelState
  readonly right: WheelState
}

export interface Vehicle {
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly axles: readonly [Axle, Axle]
  readonly wheels: readonly [WheelState, WheelState, WheelState, WheelState]
  readonly ray: RAPIER.Ray
  readonly landingRay: RAPIER.Ray
  readonly frame: ChassisFrame
  readonly command: DriverCommand
  /** The velocity at the end of the last step, to read the knocks the car takes. */
  readonly lastLinearVelocity: Vec3

  rideHeight: number
  steerAngle: number
  speed: number
  forwardSpeed: number
  slipAngle: number
  groundedCount: number
  airborneTime: number
  /** Seconds since the chassis last took a hard knock. */
  impactTime: number
  /** How beaten up the car is, 0 untouched to 1 wrecked. */
  damage: number
  /** Blown up: past driving, and waiting to be put back on its spawn. */
  wrecked: boolean
  /** Pushed along this step by something other than its own engine, so the tires do not take hold against it. */
  boosted: boolean
  /** Held up this step by something other than the ground, so the wheels let go of the road rather than sticking to it. */
  lifted: boolean
  /** Carrying wings this step, held up by them or not: in the air they hold it level and the steering banks it, rather than the pedals pitching it. */
  winged: boolean
  /** How far, and which way, the car's up is tilted while it is held up: the bank its wings hold, as the horizontal part of the up they hold it to. */
  lean: Vec3
  invertedRestTime: number
  selfRighting: boolean
  selfRightElapsed: number
}

export interface VehicleSpawn {
  position: Vec3
  yaw: number
}

type WheelFrame =
  | 'isFront'
  | 'isLeft'
  | 'rayOrigin'
  | 'rayEnd'
  | 'contactPoint'
  | 'contactNormal'
  | 'wheelCenter'
  | 'forward'
  | 'right'
  | 'holdPoint'

type WheelMotion = Omit<WheelState, WheelFrame>

const NEUTRAL_WHEEL_MOTION: Readonly<WheelMotion> = Object.freeze({
  grounded: false,
  steerAngle: 0,
  suspensionLength: 0,
  compression: 0,
  suspensionExtensionRate: 0,
  suspensionForce: 0,
  bumpStopDepth: 0,
  stickDepth: 0,
  slipSpeedLongitudinal: 0,
  slipSpeedLateral: 0,
  forceLongitudinal: 0,
  forceLateral: 0,
  held: false,
  spin: 0,
})

function createWheelState(isFront: boolean, isLeft: boolean): WheelState {
  return {
    isFront,
    isLeft,
    rayOrigin: v3(),
    rayEnd: v3(),
    contactPoint: v3(),
    contactNormal: v3(0, 1, 0),
    wheelCenter: v3(),
    forward: v3(0, 0, 1),
    right: v3(1, 0, 0),
    holdPoint: v3(),
    ...NEUTRAL_WHEEL_MOTION,
  }
}

function createAxle(isFront: boolean): Axle {
  return {
    left: createWheelState(isFront, true),
    right: createWheelState(isFront, false),
  }
}

type VehicleRig =
  | 'body'
  | 'collider'
  | 'axles'
  | 'wheels'
  | 'ray'
  | 'landingRay'
  | 'frame'
  | 'command'
  | 'lastLinearVelocity'
  | 'rideHeight'

type VehicleMotion = Omit<Vehicle, VehicleRig>

const NEUTRAL_VEHICLE_MOTION: Readonly<VehicleMotion> = Object.freeze({
  steerAngle: 0,
  speed: 0,
  forwardSpeed: 0,
  slipAngle: 0,
  groundedCount: 0,
  airborneTime: 0,
  impactTime: Number.POSITIVE_INFINITY,
  damage: 0,
  wrecked: false,
  boosted: false,
  lifted: false,
  winged: false,
  lean: v3(),
  invertedRestTime: 0,
  selfRighting: false,
  selfRightElapsed: 0,
})

export interface WheelCorner {
  readonly isFront: boolean
  readonly isLeft: boolean
}

export const WHEEL_CORNERS: readonly WheelCorner[] = [
  { isFront: true, isLeft: true },
  { isFront: true, isLeft: false },
  { isFront: false, isLeft: true },
  { isFront: false, isLeft: false },
]

export function wheelMountLocal(out: Vec3, wheel: WheelCorner, tuning: VehicleTuning): Vec3 {
  return vset(
    out,
    wheel.isLeft ? -tuning.halfTrackWidth : tuning.halfTrackWidth,
    tuning.suspensionMountY,
    wheel.isFront ? tuning.frontAxleZ : tuning.rearAxleZ,
  )
}

function suspensionTravelAtRest(tuning: VehicleTuning, gravity: number): number {
  const springRate = Math.max(tuning.suspensionStiffness, MIN_SPRING_RATE)
  const bumpStopRate = Math.max(tuning.bumpStopStiffness, MIN_SPRING_RATE)
  const springCapacity = springRate * tuning.suspensionRestLength
  const wheelLoad = Math.min((tuning.mass * gravity) / WHEEL_COUNT, tuning.maxSuspensionForce)

  if (wheelLoad <= springCapacity) return tuning.suspensionRestLength - wheelLoad / springRate

  return -(wheelLoad - springCapacity) / bumpStopRate
}

export function restingRideHeight(tuning: VehicleTuning, gravity: number): number {
  return Math.max(
    tuning.wheelRadius - tuning.suspensionMountY + suspensionTravelAtRest(tuning, gravity),
    tuning.chassisHalfHeight,
  )
}

const restingPosition = v3()

function chassisRestingPosition(out: Vec3, vehicle: Vehicle, spawn: VehicleSpawn): Vec3 {
  return vset(out, spawn.position.x, spawn.position.y + vehicle.rideHeight, spawn.position.z)
}

export function adoptVehicle(
  world: RAPIER.World,
  tuning: VehicleTuning,
  body: RAPIER.RigidBody,
  collider: RAPIER.Collider,
): Vehicle {
  const front = createAxle(true)
  const rear = createAxle(false)

  return {
    body,
    collider,
    axles: [front, rear],
    wheels: [front.left, front.right, rear.left, rear.right],
    ray: new RAPIER.Ray(v3(), v3(0, -1, 0)),
    landingRay: new RAPIER.Ray(v3(), v3(0, -1, 0)),
    frame: readChassisFrame(createChassisFrame(), body),
    command: createDriverCommand(),
    lastLinearVelocity: v3(),
    rideHeight: restingRideHeight(tuning, worldGravity(world)),
    ...NEUTRAL_VEHICLE_MOTION,
  }
}

/**
 * How far in from the chassis's edges and corners its collider is rounded,
 * without changing its size. A sharp corner scraping along a wall catches on
 * every seam between the wall's facets: the next facet's edge, a hair ahead
 * of the corner, is met square on and the car is stopped dead. A rounded
 * corner meets the edge at a glance and slides on over it.
 */
const CHASSIS_ROUNDING = 0.15

export function createVehicle(world: RAPIER.World, tuning: VehicleTuning, spawn: VehicleSpawn): Vehicle {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setLinearDamping(tuning.linearDamping)
      .setAngularDamping(tuning.angularDampingGrounded)
      .setCanSleep(false)
      .setCcdEnabled(true),
  )

  const collider = world.createCollider(
    RAPIER.ColliderDesc.roundCuboid(
      tuning.chassisHalfWidth - CHASSIS_ROUNDING,
      tuning.chassisHalfHeight - CHASSIS_ROUNDING,
      tuning.chassisHalfLength - CHASSIS_ROUNDING,
      CHASSIS_ROUNDING,
    )
      .setDensity(DENSITY_FROM_EXPLICIT_MASS_ONLY)
      .setFriction(CHASSIS_FRICTION)
      .setRestitution(CHASSIS_RESTITUTION),
    body,
  )

  const vehicle = adoptVehicle(world, tuning, body, collider)

  applyChassisMassProperties(vehicle, tuning)
  resetVehicle(vehicle, spawn)

  return vehicle
}

function cuboidPrincipalInertia(out: Vec3, mass: number, tuning: VehicleTuning): Vec3 {
  const width = tuning.chassisHalfWidth * 2
  const height = tuning.chassisHalfHeight * 2
  const length = tuning.chassisHalfLength * 2

  return vset(
    out,
    (mass / 12) * (height * height + length * length),
    (mass / 12) * (width * width + length * length),
    (mass / 12) * (width * width + height * height),
  )
}

export function applyChassisMassProperties(vehicle: Vehicle, tuning: VehicleTuning): void {
  // The rounding is kept, so the box inside it is set that much smaller, or
  // the chassis would be a rounding bigger all around than the tuning says.
  vehicle.collider.setHalfExtents({
    x: tuning.chassisHalfWidth - CHASSIS_ROUNDING,
    y: tuning.chassisHalfHeight - CHASSIS_ROUNDING,
    z: tuning.chassisHalfLength - CHASSIS_ROUNDING,
  })

  vehicle.body.setAdditionalMassProperties(
    tuning.mass,
    { x: 0, y: tuning.centerOfMassOffsetY, z: tuning.centerOfMassOffsetZ },
    cuboidPrincipalInertia(v3(), tuning.mass, tuning),
    quat(),
    true,
  )
}

export function deactivateVehicle(vehicle: Vehicle): void {
  vehicle.body.setEnabled(false)
}

export function activateVehicle(vehicle: Vehicle, spawn: VehicleSpawn): void {
  vehicle.body.setEnabled(true)
  resetVehicle(vehicle, spawn)
}

export function resetVehicle(vehicle: Vehicle, spawn: VehicleSpawn): void {
  const { body } = vehicle

  body.setTranslation(chassisRestingPosition(restingPosition, vehicle, spawn), true)
  body.setRotation(quatFromYaw(spawn.yaw), true)
  body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  body.resetForces(true)
  body.resetTorques(true)

  readChassisFrame(vehicle.frame, body)
  readDriverCommand(vehicle.command, NEUTRAL_INPUT)
  vset(vehicle.lastLinearVelocity, 0, 0, 0)

  Object.assign(vehicle, NEUTRAL_VEHICLE_MOTION)

  for (const wheel of vehicle.wheels) Object.assign(wheel, NEUTRAL_WHEEL_MOTION)
}
