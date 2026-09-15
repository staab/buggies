// Ported from the seattle project (src/physics/vehicleStepState.ts). Kept in its original
// shape and formatting so the two can be compared and resynced.

import {quat, v3, vcopy, type Quat, type Vec3} from '@buggies/physics'
import {orientChassisFrame} from './chassisFrame.ts'
import type {Vehicle} from './vehicleBody.ts'

export interface VehicleStepState {
  steerAngle: number
  airborneTime: number
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
