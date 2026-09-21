// Ported from the seattle project (src/physics/vehicleStepState.ts). Kept in its original
// shape and formatting so the two can be compared and resynced.

import {quat, v3, vcopy, type Quat, type Vec3} from '@buggies/physics'
import {orientChassisFrame} from './chassisFrame.ts'
import type {Vehicle} from './vehicleBody.ts'

export interface VehicleStepState {
  steerAngle: number
  airborneTime: number
  /** Buggies addition: how long since the last crash, and the wheels' travel the stick reads its lift speed from. */
  impactTime: number
  damage: number
  impactPeak: number
  wrecked: boolean
  wheelSuspensionLength: [number, number, number, number]
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
    impactPeak: 0,
    wrecked: false,
    wheelSuspensionLength: [0, 0, 0, 0],
    invertedRestTime: 0,
    selfRighting: false,
    selfRightElapsed: 0,
    framePosition: v3(),
    frameRotation: quat(),
    frameLinearVelocity: v3(),
  }
}

export function readVehicleStepState(out: VehicleStepState, vehicle: Vehicle): VehicleStepState {
  const {frame} = vehicle

  out.steerAngle = vehicle.steerAngle
  out.airborneTime = vehicle.airborneTime
  out.impactTime = vehicle.impactTime
  out.damage = vehicle.damage
  out.impactPeak = vehicle.impactPeak
  out.wrecked = vehicle.wrecked
  for (let i = 0; i < 4; i++) out.wheelSuspensionLength[i] = vehicle.wheels[i]!.suspensionLength
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
  const {frame} = vehicle

  vehicle.steerAngle = state.steerAngle
  vehicle.airborneTime = state.airborneTime
  vehicle.impactTime = state.impactTime
  vehicle.damage = state.damage
  vehicle.impactPeak = state.impactPeak
  vehicle.wrecked = state.wrecked
  for (let i = 0; i < 4; i++) vehicle.wheels[i]!.suspensionLength = state.wheelSuspensionLength[i]!
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
