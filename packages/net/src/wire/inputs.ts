import type { VehicleInput, VehicleProfileId } from '@buggies/game'

import { CLIENT_CHANGE_VEHICLE, CLIENT_INPUT, CLIENT_RESPAWN } from '../protocol.ts'
import { Reader, Writer, messageTypeOf, profileAt, profileCode } from './fields.ts'

/** An input: the tick it is for, and what is asked of the car on it. */
export const INPUT_BYTES = 18
export const RESPAWN_BYTES = 1
export const CHANGE_VEHICLE_BYTES = 2

/** What a driver asks of the car on one tick, stamped with that tick. */
export function encodeInput(tick: number, input: VehicleInput): Uint8Array {
  const writer = new Writer(INPUT_BYTES)
  writer.u8(CLIENT_INPUT)
  writer.u32(tick)
  writer.input(input)
  return writer.bytes
}

/** The tick the input is for, with the input itself written into `out`. */
export function decodeInput(payload: Uint8Array, out: VehicleInput): number | null {
  if (payload.length !== INPUT_BYTES || messageTypeOf(payload) !== CLIENT_INPUT) return null
  const reader = new Reader(payload)
  reader.u8()
  const tick = reader.u32()
  reader.input(out)
  return tick
}

/** Put the car back where it last was: asked for by the driver alone. */
export function encodeRespawn(): Uint8Array {
  return Uint8Array.of(CLIENT_RESPAWN)
}

/** Whether this is a respawn asked for. */
export function isRespawn(payload: Uint8Array): boolean {
  return payload.length === RESPAWN_BYTES && messageTypeOf(payload) === CLIENT_RESPAWN
}

/** Into another vehicle, where the car is: the seat, its bananas and the island stay. */
export function encodeChangeVehicle(profile: VehicleProfileId): Uint8Array {
  return Uint8Array.of(CLIENT_CHANGE_VEHICLE, profileCode(profile))
}

/** The vehicle a change asks for, or null if it is not one. */
export function decodeChangeVehicle(payload: Uint8Array): VehicleProfileId | null {
  if (payload.length !== CHANGE_VEHICLE_BYTES || messageTypeOf(payload) !== CLIENT_CHANGE_VEHICLE) return null
  return profileAt(payload[1]!)
}
