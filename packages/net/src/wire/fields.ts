import { VEHICLE_PROFILE_IDS, WEAPONS, type VehicleInput, type VehicleProfileId } from '@buggies/game'
import type { Quat, Vec3 } from '@buggies/physics'
import { hexToBytes } from '@noble/hashes/utils'

import { fromUtf8 } from './text.ts'

/**
 * Every message is a flat run of fixed-width fields, read and written in the
 * same order. Rapier keeps its numbers in single precision, so `f32` on the
 * wire loses nothing where a place is told. How things move and turn is
 * told more loosely, in whole steps finer than a mirror notices, since it
 * is told again every snapshot. A message is decoded by its declared size
 * alone: anything the wrong length is refused rather than read past.
 */

/**
 * How finely a body's velocity is told, in m/s, and its spin, in rad/s:
 * finer than a mirror notices over the few ticks it runs on from them, and
 * wide enough, at ±327 m/s and ±32 rad/s, for anything driven, flown or
 * knocked flying.
 */
export const VELOCITY_STEP = 1 / 100
export const SPIN_STEP = 1 / 1000

/** The byte that says a vehicle profile: its index among them, or `-1` if it is none of them. */
export function profileCode(profile: VehicleProfileId): number {
  return VEHICLE_PROFILE_IDS.indexOf(profile)
}

/** The vehicle a profile byte says, or `null` if it is none of them. */
export function profileAt(code: number): VehicleProfileId | null {
  return VEHICLE_PROFILE_IDS[code] ?? null
}

/** A number kept between nothing and `most`. */
export function atMost(value: number, most: number): number {
  return Math.min(Math.max(value, 0), most)
}

/** A share of something, 0 to 1, as the byte that says so: rounded, so a half is a half. */
export function share(value: number): number {
  return Math.round(atMost(value, 1) * 255)
}

/** Hex as so many bytes, all naughts where it is empty. */
export function hexBytes(hex: string, length: number): Uint8Array {
  return hex === '' ? new Uint8Array(length) : hexToBytes(hex)
}

/** The type of a message, from the byte it starts with: what it is and who may read it. */
export function messageTypeOf(payload: Uint8Array): number {
  return payload[0] ?? -1
}

/** A number a client sent, kept to its range; one that is not a number at all is nothing. */
export function within(value: number, low: number, high: number): number {
  if (value >= low && value <= high) return value
  if (value > high) return high
  if (value < low) return low
  return 0
}

/** The signal key's bit, over the four the weapon selected takes, and the fire key's over that. */
const SIGNAL_BIT = 1 << 5
const FIRE_BIT = 1 << 6

/** The buttons of an input, in a byte: the handbrake in the lowest bit, the weapon selected over it, then the signal key and the fire key. */
function buttons(value: VehicleInput): number {
  const key = Number.isInteger(value.weapon) && value.weapon > 0 && value.weapon <= WEAPONS.length ? value.weapon : 0
  return (value.handbrake ? 1 : 0) | (key << 1) | (value.signal ? SIGNAL_BIT : 0) | (value.fire ? FIRE_BIT : 0)
}

/** An input's buttons from their byte; a weapon key past the last is none. */
function readButtons(byte: number, out: VehicleInput): void {
  out.handbrake = (byte & 1) === 1
  const key = (byte >> 1) & 0xf
  out.weapon = key <= WEAPONS.length ? key : 0
  out.signal = (byte & SIGNAL_BIT) !== 0
  out.fire = (byte & FIRE_BIT) !== 0
}

/** A rotation's three smallest parts are kept to this much, the fourth following from them. */
const HALF_ROOT_TWO = Math.SQRT1_2
const QUATERNION_SCALE = 32767 / HALF_ROOT_TWO

/** A run of bytes a message is written into, field by field, in the order it is read back. */
export class Writer {
  readonly bytes: Uint8Array
  private readonly view: DataView
  private at = 0

  constructor(length: number) {
    this.bytes = new Uint8Array(length)
    this.view = new DataView(this.bytes.buffer)
  }

  u8(value: number): void {
    this.view.setUint8(this.at, value)
    this.at += 1
  }

  u16(value: number): void {
    this.view.setUint16(this.at, value)
    this.at += 2
  }

  u32(value: number): void {
    this.view.setUint32(this.at, value >>> 0)
    this.at += 4
  }

  i32(value: number): void {
    this.view.setInt32(this.at, Math.round(Math.min(Math.max(value, -0x80000000), 0x7fffffff)))
    this.at += 4
  }

  f32(value: number): void {
    this.view.setFloat32(this.at, value)
    this.at += 4
  }

  vec3(value: Vec3): void {
    this.f32(value.x)
    this.f32(value.y)
    this.f32(value.z)
  }

  /** Bytes as they are, such as a name already measured. */
  raw(value: Uint8Array): void {
    this.bytes.set(value, this.at)
    this.at += value.length
  }

  input(value: VehicleInput): void {
    this.f32(value.steer)
    this.f32(value.throttle)
    this.f32(value.brake)
    this.u8(buttons(value))
  }

  i16(value: number): void {
    this.view.setInt16(this.at, Math.round(Math.min(Math.max(value, -32767), 32767)))
    this.at += 2
  }

  /** A vector as whole steps of a given size, each way along each axis. */
  steps(value: Vec3, step: number): void {
    this.i16(value.x / step)
    this.i16(value.y / step)
    this.i16(value.z / step)
  }

  /**
   * A rotation as its three smallest parts and which is left out: a unit
   * quaternion's largest part follows from the others, and the others are
   * never more than a half root two across, so they keep their precision.
   */
  rotation(value: Quat): void {
    const { x, y, z, w } = value
    const ax = Math.abs(x)
    const ay = Math.abs(y)
    const az = Math.abs(z)
    const aw = Math.abs(w)
    const largest = ax >= ay && ax >= az && ax >= aw ? 0 : ay >= az && ay >= aw ? 1 : az >= aw ? 2 : 3
    // The same turn with every part's sign flipped, if need be, so the part left out is the positive one.
    const sign = (largest === 0 ? x : largest === 1 ? y : largest === 2 ? z : w) < 0 ? -1 : 1
    const scale = sign * QUATERNION_SCALE
    this.u8(largest)
    if (largest !== 0) this.i16(x * scale)
    if (largest !== 1) this.i16(y * scale)
    if (largest !== 2) this.i16(z * scale)
    if (largest !== 3) this.i16(w * scale)
  }

  /** A driver's input, near enough for a mirror to run a car on. */
  looseInput(value: VehicleInput): void {
    this.view.setInt8(this.at, Math.round(Math.min(Math.max(value.steer, -1), 1) * 127))
    this.at += 1
    this.u8(share(value.throttle))
    this.u8(share(value.brake))
    this.u8(buttons(value))
  }
}

/** A run of bytes read field by field, in the order it was written. */
export class Reader {
  private readonly view: DataView
  private at = 0

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u8(): number {
    const value = this.view.getUint8(this.at)
    this.at += 1
    return value
  }

  u16(): number {
    const value = this.view.getUint16(this.at)
    this.at += 2
    return value
  }

  u32(): number {
    const value = this.view.getUint32(this.at)
    this.at += 4
    return value
  }

  i32(): number {
    const value = this.view.getInt32(this.at)
    this.at += 4
    return value
  }

  f32(): number {
    const value = this.view.getFloat32(this.at)
    this.at += 4
    return value
  }

  vec3(): Vec3 {
    return { x: this.f32(), y: this.f32(), z: this.f32() }
  }

  /** So many bytes of UTF-8 as text, or `null` if they are not UTF-8. */
  text(length: number): string | null {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.at, length)
    this.at += length
    return fromUtf8(bytes)
  }

  /** How many bytes are left to read. */
  left(): number {
    return this.view.byteLength - this.at
  }

  /** How far through the message it has read. */
  offset(): number {
    return this.at
  }

  i16(): number {
    const value = this.view.getInt16(this.at)
    this.at += 2
    return value
  }

  steps(step: number): Vec3 {
    return { x: this.i16() * step, y: this.i16() * step, z: this.i16() * step }
  }

  /** A rotation told as its three smallest parts, or null if the part left out is none of the four. */
  rotation(): Quat | null {
    const largest = this.u8()
    if (largest > 3) return null
    let x = 0
    let y = 0
    let z = 0
    let w = 0
    let sum = 0
    // The parts come in the order they were written, the one left out skipped.
    if (largest !== 0) {
      x = (this.i16() / 32767) * HALF_ROOT_TWO
      sum += x * x
    }
    if (largest !== 1) {
      y = (this.i16() / 32767) * HALF_ROOT_TWO
      sum += y * y
    }
    if (largest !== 2) {
      z = (this.i16() / 32767) * HALF_ROOT_TWO
      sum += z * z
    }
    if (largest !== 3) {
      w = (this.i16() / 32767) * HALF_ROOT_TWO
      sum += w * w
    }
    const biggest = Math.sqrt(Math.max(1 - sum, 0))
    if (largest === 0) x = biggest
    else if (largest === 1) y = biggest
    else if (largest === 2) z = biggest
    else w = biggest
    return { x, y, z, w }
  }

  looseInput(out: VehicleInput): VehicleInput {
    out.steer = this.view.getInt8(this.at) / 127
    this.at += 1
    out.throttle = this.u8() / 255
    out.brake = this.u8() / 255
    readButtons(this.u8(), out)
    return out
  }

  /** What a driver asks for, kept to its ranges: nothing a client sends is taken as given. */
  input(out: VehicleInput): VehicleInput {
    out.steer = within(this.f32(), -1, 1)
    out.throttle = within(this.f32(), 0, 1)
    out.brake = within(this.f32(), 0, 1)
    readButtons(this.u8(), out)
    return out
  }
}
