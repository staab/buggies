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
  CLIENT_ROOMS,
  NO_TICK,
  PROTOCOL_VERSION,
  SERVER_REJECT,
  SERVER_ROOMS,
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

export const HELLO_BYTES = 8
export const WELCOME_BYTES = 15
export const REJECT_BYTES = 2
export const INPUT_BYTES = 18
export const RESPAWN_BYTES = 1
export const ROOMS_REQUEST_BYTES = 1
export const ROOMS_HEADER_BYTES = 2
export const ROOM_BYTES = 5
export const SNAPSHOT_HEADER_BYTES = 14
export const SNAPSHOT_VEHICLE_BYTES = 72
export const SNAPSHOT_PICKUP_BYTES = 5
export const SNAPSHOT_SPILLED_BYTES = 28
export const SNAPSHOT_REMOVED_BYTES = 2

export interface HelloMessage {
  protocolVersion: number
  profile: VehicleProfileId
  /** Which island: the room to be seated in. */
  seed: number
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

/** An island with people on it. */
export interface RoomSummary {
  seed: number
  players: number
}

export interface VehicleSnapshot {
  seat: number
  epoch: number
  profile: VehicleProfileId
  position: Vec3
  rotation: Quat
  linearVelocity: Vec3
  angularVelocity: Vec3
  /** How beaten up the car is, 0 to 1, in steps of a 255th. */
  damage: number
  /** Blown up, and waiting to be put back. */
  wrecked: boolean
  /** Bananas taken since sitting down. */
  score: number
  /** What the driver was asking for on the tick this was taken. */
  appliedInput: VehicleInput
}

/** One of the map's pickup slots, as the server has it. */
export interface PickupSnapshot {
  slot: number
  /** How many pickups the slot has had: says where the current one is. */
  generation: number
  /** How many ticks after the snapshot's the current one appears; none, and it is out. */
  ticksUntilOut: number
}

/**
 * Where everything is on a tick. The vehicles are all there every time; the
 * bananas change rarely, so after a player's first snapshot only the slots
 * and spilled bananas that changed since the one before are sent, and every
 * snapshot has to be taken in, in order, for the word to stay whole.
 */
export interface SnapshotMessage {
  tick: number
  /**
   * The newest tick the server had an input of yours for when it took this.
   * Compared with `tick`, it says whether inputs are arriving in time.
   */
  ackInputTick: number
  /** Whether the bananas here are all of them, a fresh start, rather than what changed. */
  full: boolean
  vehicles: VehicleSnapshot[]
  /** The slots whose banana has moved on since the snapshot before; every slot when full. */
  pickups: PickupSnapshot[]
  /** The bananas spilled since the snapshot before; every one out when full. */
  spilled: SpilledSnapshot[]
  /** The spilled bananas gone since the snapshot before, taken or faded, by number. */
  removed: number[]
}

/** A banana spilled from a wreck, as the server has it. */
export interface SpilledSnapshot {
  id: number
  from: Vec3
  position: Vec3
  /** How many ticks before the snapshot's it was spilled. */
  age: number
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

  /** What a driver asks for, kept to its ranges: nothing a client sends is taken as given. */
  input(out: VehicleInput): VehicleInput {
    out.steer = within(this.f32(), -1, 1)
    out.throttle = within(this.f32(), 0, 1)
    out.brake = within(this.f32(), 0, 1)
    out.handbrake = this.u8() === 1
    return out
  }
}

/** A number a client sent, kept to its range; one that is not a number at all is nothing. */
function within(value: number, low: number, high: number): number {
  if (value >= low && value <= high) return value
  if (value > high) return high
  if (value < low) return low
  return 0
}

export function messageTypeOf(payload: Uint8Array): number {
  return payload[0] ?? -1
}

function profileIndex(profile: VehicleProfileId): number {
  return VEHICLE_PROFILE_IDS.indexOf(profile)
}

export function encodeHello(profile: VehicleProfileId, seed: number): Uint8Array {
  const writer = new Writer(HELLO_BYTES)
  writer.u8(CLIENT_HELLO)
  writer.u16(PROTOCOL_VERSION)
  writer.u8(profileIndex(profile))
  writer.u32(seed)
  return writer.bytes
}

export function decodeHello(payload: Uint8Array): HelloMessage | null {
  if (payload.length !== HELLO_BYTES || messageTypeOf(payload) !== CLIENT_HELLO) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const profile = VEHICLE_PROFILE_IDS[reader.u8()]
  const seed = reader.u32()
  return profile === undefined ? null : { protocolVersion, profile, seed }
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

export function encodeRoomsRequest(): Uint8Array {
  return Uint8Array.of(CLIENT_ROOMS)
}

export function isRoomsRequest(payload: Uint8Array): boolean {
  return payload.length === ROOMS_REQUEST_BYTES && messageTypeOf(payload) === CLIENT_ROOMS
}

export function encodeRooms(rooms: readonly RoomSummary[]): Uint8Array {
  const writer = new Writer(ROOMS_HEADER_BYTES + rooms.length * ROOM_BYTES)
  writer.u8(SERVER_ROOMS)
  writer.u8(rooms.length)
  for (const room of rooms) {
    writer.u32(room.seed)
    writer.u8(Math.min(room.players, 0xff))
  }
  return writer.bytes
}

export function decodeRooms(payload: Uint8Array): RoomSummary[] | null {
  if (payload.length < ROOMS_HEADER_BYTES || messageTypeOf(payload) !== SERVER_ROOMS) return null
  const reader = new Reader(payload)
  reader.u8()
  const count = reader.u8()
  if (payload.length !== ROOMS_HEADER_BYTES + count * ROOM_BYTES) return null
  const rooms: RoomSummary[] = []
  for (let i = 0; i < count; i++) rooms.push({ seed: reader.u32(), players: reader.u8() })
  return rooms
}

export function encodeSnapshot(message: SnapshotMessage): Uint8Array {
  const writer = new Writer(
    SNAPSHOT_HEADER_BYTES +
      message.vehicles.length * SNAPSHOT_VEHICLE_BYTES +
      message.pickups.length * SNAPSHOT_PICKUP_BYTES +
      message.spilled.length * SNAPSHOT_SPILLED_BYTES +
      message.removed.length * SNAPSHOT_REMOVED_BYTES,
  )
  writer.u8(SERVER_SNAPSHOT)
  writer.u32(message.tick)
  writer.u32(message.ackInputTick < 0 ? NO_TICK : message.ackInputTick)
  writer.u8(message.full ? 1 : 0)
  writer.u8(message.vehicles.length)
  writer.u8(message.pickups.length)
  writer.u8(message.spilled.length)
  writer.u8(message.removed.length)
  for (const vehicle of message.vehicles) {
    writer.u8(vehicle.seat)
    writer.u8(vehicle.epoch)
    writer.u8(profileIndex(vehicle.profile))
    writer.vec3(vehicle.position)
    writer.quat(vehicle.rotation)
    writer.vec3(vehicle.linearVelocity)
    writer.vec3(vehicle.angularVelocity)
    writer.u8(Math.round(Math.min(Math.max(vehicle.damage, 0), 1) * 255))
    writer.u8(vehicle.wrecked ? 1 : 0)
    writer.u16(Math.min(vehicle.score, 0xffff))
    writer.input(vehicle.appliedInput)
  }
  for (const pickup of message.pickups) {
    writer.u8(pickup.slot)
    writer.u16(pickup.generation & 0xffff)
    writer.u16(Math.min(Math.max(pickup.ticksUntilOut, 0), 0xffff))
  }
  for (const spilled of message.spilled) {
    writer.u16(spilled.id)
    writer.vec3(spilled.from)
    writer.vec3(spilled.position)
    writer.u16(Math.min(Math.max(spilled.age, 0), 0xffff))
  }
  for (const id of message.removed) writer.u16(id)
  return writer.bytes
}

/**
 * The same snapshot with a different acknowledgement, without encoding the
 * vehicles again: every player gets the same bodies and their own ack. It is
 * a copy, since a socket keeps hold of what it is given until it has gone out.
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
  const full = reader.u8() === 1
  const count = reader.u8()
  const pickupCount = reader.u8()
  const spilledCount = reader.u8()
  const removedCount = reader.u8()
  const expected =
    SNAPSHOT_HEADER_BYTES +
    count * SNAPSHOT_VEHICLE_BYTES +
    pickupCount * SNAPSHOT_PICKUP_BYTES +
    spilledCount * SNAPSHOT_SPILLED_BYTES +
    removedCount * SNAPSHOT_REMOVED_BYTES
  if (payload.length !== expected) return null

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
      damage: reader.u8() / 255,
      wrecked: reader.u8() === 1,
      score: reader.u16(),
      appliedInput: reader.input(createVehicleInput()),
    })
  }
  const pickups: PickupSnapshot[] = []
  for (let i = 0; i < pickupCount; i++) {
    pickups.push({ slot: reader.u8(), generation: reader.u16(), ticksUntilOut: reader.u16() })
  }
  const spilled: SpilledSnapshot[] = []
  for (let i = 0; i < spilledCount; i++) {
    spilled.push({ id: reader.u16(), from: reader.vec3(), position: reader.vec3(), age: reader.u16() })
  }
  const removed: number[] = []
  for (let i = 0; i < removedCount; i++) removed.push(reader.u16())
  return {
    tick,
    ackInputTick: ack === NO_TICK ? UNACKNOWLEDGED_INPUT_TICK : ack,
    full,
    vehicles,
    pickups,
    spilled,
    removed,
  }
}
