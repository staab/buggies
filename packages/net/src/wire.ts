import {
  VEHICLE_PROFILE_IDS,
  createVehicleInput,
  type VehicleInput,
  type VehicleProfileId,
} from '@buggies/game'
import type { Quat, Vec3 } from '@buggies/physics'

import {
  CLIENT_HELLO,
  CLIENT_INPUT,
  CLIENT_RESPAWN,
  NO_TICK,
  PROTOCOL_VERSION,
  SERVER_REJECT,
  SERVER_SNAPSHOT,
  SERVER_WELCOME,
  UNACKNOWLEDGED_INPUT_TICK,
} from './protocol.ts'

/**
 * Every message is a flat run of fixed-width fields, read and written in the
 * same order. Rapier keeps its numbers in single precision, so `f32` on the
 * wire loses nothing, and a message is decoded by its declared size alone:
 * anything the wrong length is refused rather than read past.
 */

export const HELLO_BYTES = 4
export const WELCOME_BYTES = 15
export const REJECT_BYTES = 2
export const INPUT_BYTES = 18
export const RESPAWN_BYTES = 1
export const SNAPSHOT_HEADER_BYTES = 10
export const SNAPSHOT_VEHICLE_BYTES = 68

export interface HelloMessage {
  protocolVersion: number
  profile: VehicleProfileId
}

export interface WelcomeMessage {
  protocolVersion: number
  seed: number
  seat: number
  epoch: number
  tick: number
  maxPlayers: number
  profile: VehicleProfileId
}

export interface RejectMessage {
  reason: number
}

export interface VehicleSnapshot {
  seat: number
  epoch: number
  profile: VehicleProfileId
  position: Vec3
  rotation: Quat
  linearVelocity: Vec3
  angularVelocity: Vec3
  /** What the driver was asking for on the tick this was taken. */
  appliedInput: VehicleInput
}

export interface SnapshotMessage {
  tick: number
  /**
   * The newest tick the server had an input of yours for when it took this.
   * Compared with `tick`, it says whether inputs are arriving in time.
   */
  ackInputTick: number
  vehicles: VehicleSnapshot[]
}

class Writer {
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

  f32(value: number): void {
    this.view.setFloat32(this.at, value)
    this.at += 4
  }

  vec3(value: Vec3): void {
    this.f32(value.x)
    this.f32(value.y)
    this.f32(value.z)
  }

  quat(value: Quat): void {
    this.f32(value.x)
    this.f32(value.y)
    this.f32(value.z)
    this.f32(value.w)
  }

  input(value: VehicleInput): void {
    this.f32(value.steer)
    this.f32(value.throttle)
    this.f32(value.brake)
    this.u8(value.handbrake ? 1 : 0)
  }
}

class Reader {
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

  f32(): number {
    const value = this.view.getFloat32(this.at)
    this.at += 4
    return value
  }

  vec3(): Vec3 {
    return { x: this.f32(), y: this.f32(), z: this.f32() }
  }

  quat(): Quat {
    return { x: this.f32(), y: this.f32(), z: this.f32(), w: this.f32() }
  }

  input(out: VehicleInput): VehicleInput {
    out.steer = this.f32()
    out.throttle = this.f32()
    out.brake = this.f32()
    out.handbrake = this.u8() === 1
    return out
  }
}

export function messageTypeOf(payload: Uint8Array): number {
  return payload[0] ?? -1
}

function profileIndex(profile: VehicleProfileId): number {
  return VEHICLE_PROFILE_IDS.indexOf(profile)
}

export function encodeHello(profile: VehicleProfileId): Uint8Array {
  const writer = new Writer(HELLO_BYTES)
  writer.u8(CLIENT_HELLO)
  writer.u16(PROTOCOL_VERSION)
  writer.u8(profileIndex(profile))
  return writer.bytes
}

export function decodeHello(payload: Uint8Array): HelloMessage | null {
  if (payload.length !== HELLO_BYTES || messageTypeOf(payload) !== CLIENT_HELLO) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const profile = VEHICLE_PROFILE_IDS[reader.u8()]
  return profile === undefined ? null : { protocolVersion, profile }
}

export function encodeWelcome(message: WelcomeMessage): Uint8Array {
  const writer = new Writer(WELCOME_BYTES)
  writer.u8(SERVER_WELCOME)
  writer.u16(message.protocolVersion)
  writer.u32(message.seed)
  writer.u8(message.seat)
  writer.u8(message.epoch)
  writer.u32(message.tick)
  writer.u8(message.maxPlayers)
  writer.u8(profileIndex(message.profile))
  return writer.bytes
}

export function decodeWelcome(payload: Uint8Array): WelcomeMessage | null {
  if (payload.length !== WELCOME_BYTES || messageTypeOf(payload) !== SERVER_WELCOME) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const seed = reader.u32()
  const seat = reader.u8()
  const epoch = reader.u8()
  const tick = reader.u32()
  const maxPlayers = reader.u8()
  const profile = VEHICLE_PROFILE_IDS[reader.u8()]
  if (profile === undefined) return null
  return { protocolVersion, seed, seat, epoch, tick, maxPlayers, profile }
}

export function encodeReject(message: RejectMessage): Uint8Array {
  const writer = new Writer(REJECT_BYTES)
  writer.u8(SERVER_REJECT)
  writer.u8(message.reason)
  return writer.bytes
}

export function decodeReject(payload: Uint8Array): RejectMessage | null {
  if (payload.length !== REJECT_BYTES || messageTypeOf(payload) !== SERVER_REJECT) return null
  return { reason: payload[1]! }
}

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

export function encodeRespawn(): Uint8Array {
  return Uint8Array.of(CLIENT_RESPAWN)
}

export function isRespawn(payload: Uint8Array): boolean {
  return payload.length === RESPAWN_BYTES && messageTypeOf(payload) === CLIENT_RESPAWN
}

export function encodeSnapshot(message: SnapshotMessage): Uint8Array {
  const writer = new Writer(SNAPSHOT_HEADER_BYTES + message.vehicles.length * SNAPSHOT_VEHICLE_BYTES)
  writer.u8(SERVER_SNAPSHOT)
  writer.u32(message.tick)
  writer.u32(message.ackInputTick < 0 ? NO_TICK : message.ackInputTick)
  writer.u8(message.vehicles.length)
  for (const vehicle of message.vehicles) {
    writer.u8(vehicle.seat)
    writer.u8(vehicle.epoch)
    writer.u8(profileIndex(vehicle.profile))
    writer.vec3(vehicle.position)
    writer.quat(vehicle.rotation)
    writer.vec3(vehicle.linearVelocity)
    writer.vec3(vehicle.angularVelocity)
    writer.input(vehicle.appliedInput)
  }
  return writer.bytes
}

/**
 * The same snapshot with a different acknowledgement, without encoding the
 * vehicles again: every player gets the same bodies and their own ack.
 */
export function withAck(snapshot: Uint8Array, ackInputTick: number): Uint8Array {
  const copy = snapshot.slice()
  new DataView(copy.buffer).setUint32(5, (ackInputTick < 0 ? NO_TICK : ackInputTick) >>> 0)
  return copy
}

export function decodeSnapshot(payload: Uint8Array): SnapshotMessage | null {
  if (payload.length < SNAPSHOT_HEADER_BYTES || messageTypeOf(payload) !== SERVER_SNAPSHOT) return null
  const reader = new Reader(payload)
  reader.u8()
  const tick = reader.u32()
  const ack = reader.u32()
  const count = reader.u8()
  if (payload.length !== SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_VEHICLE_BYTES) return null

  const vehicles: VehicleSnapshot[] = []
  for (let i = 0; i < count; i++) {
    const seat = reader.u8()
    const epoch = reader.u8()
    const profile = VEHICLE_PROFILE_IDS[reader.u8()]
    if (profile === undefined) return null
    vehicles.push({
      seat,
      epoch,
      profile,
      position: reader.vec3(),
      rotation: reader.quat(),
      linearVelocity: reader.vec3(),
      angularVelocity: reader.vec3(),
      appliedInput: reader.input(createVehicleInput()),
    })
  }
  return { tick, ackInputTick: ack === NO_TICK ? UNACKNOWLEDGED_INPUT_TICK : ack, vehicles }
}
