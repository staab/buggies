// The part of a vehicle's state that a step reads and writes besides its
// body: what the prediction has to record to replay a step, and no more.

import { quat, v3, vcopy, type Quat, type Vec3 } from '@buggies/physics'
import { orientChassisFrame } from './chassisFrame.ts'
import type { Vehicle } from './vehicleBody.ts'

export interface VehicleStepState {
  steerAngle: number
  airborneTime: number
  /** How long since the last crash, and the wheels' travel the stick reads its lift speed from. */
  impactTime: number
  damage: number
  lastLinearVelocity: Vec3
  wrecked: boolean
  wheelSuspensionLength: [number, number, number, number]
  /** Which tires hold the ground at rest, and where each took hold. */
  wheelHeld: [boolean, boolean, boolean, boolean]
  wheelHoldPoint: [Vec3, Vec3, Vec3, Vec3]
  invertedRestTime: number
  selfRighting: boolean
  selfRightElapsed: number
  framePosition: Vec3
  frameRotation: Quat
  frameLinearVelocity: Vec3
}

export function createVehicleStepState(): VehicleStepState {
  return {
    steerAngle: 0,
    airborneTime: 0,
    impactTime: Number.POSITIVE_INFINITY,
    damage: 0,
    lastLinearVelocity: v3(),
    wrecked: false,
    wheelSuspensionLength: [0, 0, 0, 0],
    wheelHeld: [false, false, false, false],
    wheelHoldPoint: [v3(), v3(), v3(), v3()],
    invertedRestTime: 0,
    selfRighting: false,
    selfRightElapsed: 0,
    framePosition: v3(),
    frameRotation: quat(),
    frameLinearVelocity: v3(),
  }
}

export function readVehicleStepState(out: VehicleStepState, vehicle: Vehicle): VehicleStepState {
  const { frame } = vehicle

  out.steerAngle = vehicle.steerAngle
  out.airborneTime = vehicle.airborneTime
  out.impactTime = vehicle.impactTime
  out.damage = vehicle.damage
  vcopy(out.lastLinearVelocity, vehicle.lastLinearVelocity)
  out.wrecked = vehicle.wrecked
  for (const [i, wheel] of vehicle.wheels.entries()) {
    out.wheelSuspensionLength[i] = wheel.suspensionLength
    out.wheelHeld[i] = wheel.held
    vcopy(out.wheelHoldPoint[i]!, wheel.holdPoint)
  }
  out.invertedRestTime = vehicle.invertedRestTime
  out.selfRighting = vehicle.selfRighting
  out.selfRightElapsed = vehicle.selfRightElapsed

  vcopy(out.framePosition, frame.position)
  vcopy(out.frameLinearVelocity, frame.linearVelocity)

  out.frameRotation.x = frame.rotation.x
  out.frameRotation.y = frame.rotation.y
  out.frameRotation.z = frame.rotation.z
  out.frameRotation.w = frame.rotation.w

  return out
}

export function writeVehicleStepState(vehicle: Vehicle, state: VehicleStepState): void {
  const { frame } = vehicle

  vehicle.steerAngle = state.steerAngle
  vehicle.airborneTime = state.airborneTime
  vehicle.impactTime = state.impactTime
  vehicle.damage = state.damage
  vcopy(vehicle.lastLinearVelocity, state.lastLinearVelocity)
  vehicle.wrecked = state.wrecked
  for (const [i, wheel] of vehicle.wheels.entries()) {
    wheel.suspensionLength = state.wheelSuspensionLength[i]!
    wheel.held = state.wheelHeld[i]!
    vcopy(wheel.holdPoint, state.wheelHoldPoint[i]!)
  }
  vehicle.invertedRestTime = state.invertedRestTime
  vehicle.selfRighting = state.selfRighting
  vehicle.selfRightElapsed = state.selfRightElapsed

  vcopy(frame.position, state.framePosition)
  vcopy(frame.linearVelocity, state.frameLinearVelocity)

  frame.rotation.x = state.frameRotation.x
  frame.rotation.y = state.frameRotation.y
  frame.rotation.z = state.frameRotation.z
  frame.rotation.w = state.frameRotation.w

  orientChassisFrame(frame)
}
