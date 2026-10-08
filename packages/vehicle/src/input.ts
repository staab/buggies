// What a driver asks of a car, and how the request is smoothed into a
// command the step can act on.

import { clamp } from '@buggies/physics'

export interface VehicleInput {
  steer: number
  throttle: number
  brake: number
  handbrake: boolean
  /** Which weapon is selected by its number key, 1 to 9, or 0 for none. */
  weapon: number
  /** The fire key: the selected weapon goes on a press, or for as long as it is held. */
  fire: boolean
  /** The signal key: a siren turned on or off, or a horn blown. For show, and nothing more. */
  signal: boolean
}

export interface DriverCommand {
  steer: number
  throttle: number
  brake: number
  handbrake: boolean
  weapon: number
  fire: boolean
  signal: boolean
}

export const NEUTRAL_INPUT: Readonly<VehicleInput> = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  weapon: 0,
  fire: false,
  signal: false,
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
    fire: source.fire,
    signal: source.signal,
  } satisfies VehicleInput)
}

export function readDriverCommand(out: DriverCommand, input: VehicleInput): DriverCommand {
  out.steer = clamp(input.steer, -1, 1)
  out.throttle = clamp(input.throttle, 0, 1)
  out.brake = clamp(input.brake, 0, 1)
  out.handbrake = input.handbrake
  out.weapon = input.weapon
  out.fire = input.fire
  out.signal = input.signal

  return out
}
