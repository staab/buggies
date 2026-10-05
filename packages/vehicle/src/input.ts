// What a driver asks of a car, and how the request is smoothed into a
// command the step can act on.

import { clamp } from '@buggies/physics'

export interface VehicleInput {
  steer: number
  throttle: number
  brake: number
  handbrake: boolean
  /** Which weapon's number key is held, 1 to 9, or 0 for none. */
  weapon: number
}

export interface DriverCommand {
  steer: number
  throttle: number
  brake: number
  handbrake: boolean
  weapon: number
}

export const NEUTRAL_INPUT: Readonly<VehicleInput> = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  weapon: 0,
} satisfies VehicleInput)

export function createVehicleInput(): VehicleInput {
  return { ...NEUTRAL_INPUT }
}

export function createDriverCommand(): DriverCommand {
  return { ...NEUTRAL_INPUT }
}

export function copyVehicleInput(out: VehicleInput, source: VehicleInput): VehicleInput {
  return Object.assign(out, {
    steer: source.steer,
    throttle: source.throttle,
    brake: source.brake,
    handbrake: source.handbrake,
    weapon: source.weapon,
  } satisfies VehicleInput)
}

export function readDriverCommand(out: DriverCommand, input: VehicleInput): DriverCommand {
  out.steer = clamp(input.steer, -1, 1)
  out.throttle = clamp(input.throttle, 0, 1)
  out.brake = clamp(input.brake, 0, 1)
  out.handbrake = input.handbrake
  out.weapon = input.weapon

  return out
}
