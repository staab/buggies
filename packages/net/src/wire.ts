import {
  GOAL_KINDS,
  UFO_STATES,
  NO_TARGET,
  LOOSE_KINDS,
  VEHICLE_PROFILE_IDS,
  WEAPONS,
  createVehicleInput,
  type Goal,
  type GoalKind,
  type GoalRequest,
  type LooseKind,
  type UfoState,
  type VehicleInput,
  type VehicleProfileId,
  type Weapon,
} from '@buggies/game'
import type { Quat, Vec3 } from '@buggies/physics'

import {
  CLIENT_CHANGE_VEHICLE,
  CLIENT_GOAL,
  CLIENT_HELLO,
  CLIENT_INPUT,
  CLIENT_RESPAWN,
  CLIENT_ROOMS,
  CLIENT_PEEK,
  NO_TICK,
  PROTOCOL_VERSION,
  SERVER_REJECT,
  SERVER_ROOMS,
  SERVER_PEEK,
  SERVER_SNAPSHOT,
  SERVER_TRAVEL,
  SERVER_WELCOME,
  NO_PORTAL,
  UNACKNOWLEDGED_INPUT_TICK,
} from './protocol.ts'

/**
 * Every message is a flat run of fixed-width fields, read and written in the
 * same order. Rapier keeps its numbers in single precision, so `f32` on the
 * wire loses nothing, and a message is decoded by its declared size alone:
 * anything the wrong length is refused rather than read past.
 */

export const HELLO_BYTES = 9
export const WELCOME_BYTES = 15
export const REJECT_BYTES = 2
export const TRAVEL_BYTES = 6
export const INPUT_BYTES = 18
export const RESPAWN_BYTES = 1
export const CHANGE_VEHICLE_BYTES = 2
export const GOAL_BYTES = 12
export const ROOMS_REQUEST_BYTES = 1
export const ROOMS_HEADER_BYTES = 2
export const ROOM_BYTES = 5
export const PEEK_REQUEST_BYTES = 5
export const PEEK_HEADER_BYTES = 3
export const PEEK_MARK_BYTES = 14
export const SNAPSHOT_HEADER_BYTES = 24
/**
 * A vehicle in a snapshot: where it is and how it moves, how hurt it is and
 * what it was last driven with, always; and what it has won and what it has
 * going on, only when it has any, which a car nobody drives mostly has not.
 */
export const SNAPSHOT_VEHICLE_CORE_BYTES = 40
export const SNAPSHOT_VEHICLE_EXTRAS_BYTES = 47
export const SNAPSHOT_VEHICLE_BYTES = SNAPSHOT_VEHICLE_CORE_BYTES + SNAPSHOT_VEHICLE_EXTRAS_BYTES
export const SNAPSHOT_PICKUP_BYTES = 6
export const SNAPSHOT_SPILLED_BYTES = 31
export const SNAPSHOT_REMOVED_BYTES = 2
export const SNAPSHOT_ROCKET_BYTES = 31
export const SNAPSHOT_PROP_BYTES = 54
export const SNAPSHOT_ROBOT_BYTES = 16
export const SNAPSHOT_UFO_BYTES = 25
export const SNAPSHOT_SPIDER_BYTES = 35

/** What a goal is, by the byte that says so: none first. */
const GOAL_CODES: readonly (GoalKind | 'none')[] = ['none', ...GOAL_KINDS]

/** What a vehicle can carry, by the byte that says so: nothing first. */
const WEAPON_CODES: readonly Weapon[] = ['none', ...WEAPONS]

/** A rocket or shot with no target, on the wire. */
const NOBODY_BYTE = 0xff

export interface HelloMessage {
  protocolVersion: number
  profile: VehicleProfileId
  /** Which island: the room to be seated in. */
  seed: number
  /** Which of its portals the car comes out of, having driven through the one it leads from; or none. */
  arrival: number | null
}

/** Through a portal: the room to join next, and which portal of this one was driven through. */
export interface TravelMessage {
  seed: number
  through: number
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
  /** Bananas held. */
  score: number
  /** Bananas taken since sitting down, all told, and cars its weapons have wrecked. */
  collected: number
  kills: number
  robotKills: number
  /** The goal it is playing for, if any, and how many it has reached, counted around past 255. */
  goal: Goal | null
  goalsWon: number
  /** What it is carrying, and how long the machine gun has left. */
  weapon: Weapon
  /** How many weapons it has won, counted around past 255. */
  wins: number
  ammoTicks: number
  /** Its own action: how long it has left, how long before it may go again, whether its lights are on, and whether its own key was down on the tick. */
  actionTicks: number
  cooldownTicks: number
  lightsOn: boolean
  abilityHeld: boolean
  /** A car nobody drives. */
  npc: boolean
  /** How many rockets it has fired, which numbers the next. */
  rocketsFired: number
  /** How long it is stunned for, and slowed for, by this share of a full slow. */
  stunnedTicks: number
  slowedTicks: number
  slowedBy: number
  /** How much longer its shield, magnet, plow, slipping on oil and grappling hook last, and whom the hook has caught, or NO_TARGET. */
  shieldTicks: number
  magnetTicks: number
  plowTicks: number
  slipTicks: number
  grappleTicks: number
  grappleTarget: number
  /** What the driver was asking for on the tick this was taken. */
  appliedInput: VehicleInput
}

/** A robot on its rounds, as the server has it: where it is follows from its road and how far along. */
export interface RobotSnapshot {
  id: number
  road: number
  along: number
  direction: number
  legs: number
  target: number
  beamTicks: number
  cooldownTicks: number
  /** How much of what brings it down it has taken, in steps of a 255th, and how many times it has been brought down, counted around past 255. */
  damage: number
  deaths: number
}

/** A flying saucer, as the server has it. */
export interface UfoSnapshot {
  id: number
  position: Vec3
  state: UfoState
  target: number
  stateTicks: number
  cooldownTicks: number
  legs: number
  abductions: number
  damage: number
  deaths: number
}

/** A giant spider, as the server has it. */
export interface SpiderSnapshot {
  id: number
  position: Vec3
  heading: number
  legs: number
  target: { x: number; z: number }
  stride: number
  bombTicks: number
  damage: number
  deaths: number
}

/** A rocket in the air, as the server has it. */
export interface RocketSnapshot {
  id: number
  owner: number
  /** The seat it is after, or NO_TARGET. */
  target: number
  position: Vec3
  velocity: Vec3
  /** How many ticks before the snapshot's it went. */
  age: number
  /** How much of a full blast it goes off with, in steps of a 255th. */
  power: number
}

/** A prop, as the server has it: where it is and how it is moving. */
export interface PropSnapshot {
  id: number
  position: Vec3
  rotation: Quat
  linearVelocity: Vec3
  angularVelocity: Vec3
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
  /**
   * The number the next loose thing gets. A mirror numbering what it
   * predicts from the same count gives it the same numbers the server will,
   * so the two are one thing on screen and not one gone and another come.
   */
  looseNext: number
  vehicles: VehicleSnapshot[]
  /** The slots whose banana has moved on since the snapshot before; every slot when full. */
  pickups: PickupSnapshot[]
  /** The bananas spilled since the snapshot before; every one out when full. */
  loose: LooseSnapshot[]
  /** The spilled bananas gone since the snapshot before, taken or faded, by number. */
  removed: number[]
  /** Every rocket in the air. */
  rockets: RocketSnapshot[]
  /** The props on the move since the snapshot before; every prop when full. */
  props: PropSnapshot[]
  /** Every robot and every saucer, every snapshot: there are only ever a few. */
  robots: RobotSnapshot[]
  ufos: UfoSnapshot[]
  spiders: SpiderSnapshot[]
}

/** Something loose on the map, a banana or a bomb, as the server has it. */
export interface LooseSnapshot {
  id: number
  kind: LooseKind
  /** Whose it is: the seat it spilled from or was dropped by. */
  owner: number
  /** How much of a full bomb's blast it goes off with, in steps of a 255th; none for a banana. */
  power: number
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
    this.u8((value.handbrake ? 1 : 0) | (value.fire ? 2 : 0) | (value.ability ? 4 : 0))
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
    const parts = [value.x, value.y, value.z, value.w]
    let largest = 0
    for (let k = 1; k < 4; k++) if (Math.abs(parts[k]!) > Math.abs(parts[largest]!)) largest = k
    const sign = parts[largest]! < 0 ? -1 : 1
    this.u8(largest)
    for (let k = 0; k < 4; k++) if (k !== largest) this.i16((parts[k]! * sign * 32767) / Math.SQRT1_2)
  }

  /** A driver's input, near enough for a mirror to run a car on. */
  looseInput(value: VehicleInput): void {
    this.view.setInt8(this.at, Math.round(Math.min(Math.max(value.steer, -1), 1) * 127))
    this.at += 1
    this.u8(Math.round(Math.min(Math.max(value.throttle, 0), 1) * 255))
    this.u8(Math.round(Math.min(Math.max(value.brake, 0), 1) * 255))
    this.u8((value.handbrake ? 1 : 0) | (value.fire ? 2 : 0) | (value.ability ? 4 : 0))
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
  i16(): number {
    const value = this.view.getInt16(this.at)
    this.at += 2
    return value
  }

  steps(step: number): Vec3 {
    return { x: this.i16() * step, y: this.i16() * step, z: this.i16() * step }
  }

  rotation(): Quat | null {
    const largest = this.u8()
    if (largest > 3) return null
    const parts = [0, 0, 0, 0]
    let sum = 0
    for (let k = 0; k < 4; k++) {
      if (k === largest) continue
      parts[k] = (this.i16() / 32767) * Math.SQRT1_2
      sum += parts[k]! * parts[k]!
    }
    parts[largest] = Math.sqrt(Math.max(1 - sum, 0))
    return { x: parts[0]!, y: parts[1]!, z: parts[2]!, w: parts[3]! }
  }

  looseInput(out: VehicleInput): VehicleInput {
    out.steer = this.view.getInt8(this.at) / 127
    this.at += 1
    out.throttle = this.u8() / 255
    out.brake = this.u8() / 255
    const buttons = this.u8()
    out.handbrake = (buttons & 1) === 1
    out.fire = (buttons & 2) === 2
    out.ability = (buttons & 4) === 4
    return out
  }

  /** How far through the message it has read. */
  get offset(): number {
    return this.at
  }

  input(out: VehicleInput): VehicleInput {
    out.steer = within(this.f32(), -1, 1)
    out.throttle = within(this.f32(), 0, 1)
    out.brake = within(this.f32(), 0, 1)
    const buttons = this.u8()
    out.handbrake = (buttons & 1) === 1
    out.fire = (buttons & 2) === 2
    out.ability = (buttons & 4) === 4
    return out
  }
}

/** A share of something, 0 to 1, as the byte that says so. */
function share(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 1) * 255)
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

export function encodeHello(profile: VehicleProfileId, seed: number, arrival: number | null = null): Uint8Array {
  const writer = new Writer(HELLO_BYTES)
  writer.u8(CLIENT_HELLO)
  writer.u16(PROTOCOL_VERSION)
  writer.u8(profileIndex(profile))
  writer.u32(seed)
  writer.u8(arrival === null ? NO_PORTAL : Math.min(Math.max(arrival, 0), NO_PORTAL - 1))
  return writer.bytes
}

export function decodeHello(payload: Uint8Array): HelloMessage | null {
  if (payload.length !== HELLO_BYTES || messageTypeOf(payload) !== CLIENT_HELLO) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const profile = VEHICLE_PROFILE_IDS[reader.u8()]
  const seed = reader.u32()
  const portal = reader.u8()
  return profile === undefined ? null : { protocolVersion, profile, seed, arrival: portal === NO_PORTAL ? null : portal }
}

export function encodeTravel(message: TravelMessage): Uint8Array {
  const writer = new Writer(TRAVEL_BYTES)
  writer.u8(SERVER_TRAVEL)
  writer.u32(message.seed)
  writer.u8(message.through)
  return writer.bytes
}

export function decodeTravel(payload: Uint8Array): TravelMessage | null {
  if (payload.length !== TRAVEL_BYTES || messageTypeOf(payload) !== SERVER_TRAVEL) return null
  const reader = new Reader(payload)
  reader.u8()
  return { seed: reader.u32(), through: reader.u8() }
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

export function encodeChangeVehicle(profile: VehicleProfileId): Uint8Array {
  return Uint8Array.of(CLIENT_CHANGE_VEHICLE, profileIndex(profile))
}

/** The vehicle a change asks for, or null if it is not one. */
export function decodeChangeVehicle(payload: Uint8Array): VehicleProfileId | null {
  if (payload.length !== CHANGE_VEHICLE_BYTES || messageTypeOf(payload) !== CLIENT_CHANGE_VEHICLE) return null
  return VEHICLE_PROFILE_IDS[payload[1]!] ?? null
}

export function encodeGoal(goal: GoalRequest | null): Uint8Array {
  const writer = new Writer(GOAL_BYTES)
  writer.u8(CLIENT_GOAL)
  writer.u8(goal === null ? 0 : GOAL_CODES.indexOf(goal.kind))
  writer.u16(goal === null ? 0 : Math.min(Math.max(goal.target, 0), 0xffff))
  writer.f32(goal?.x ?? 0)
  writer.f32(goal?.z ?? 0)
  return writer.bytes
}

/** The goal a message asks for, `null` for none, or `undefined` if it is not a goal message at all. */
export function decodeGoal(payload: Uint8Array): GoalRequest | null | undefined {
  if (payload.length !== GOAL_BYTES || messageTypeOf(payload) !== CLIENT_GOAL) return undefined
  const reader = new Reader(payload)
  reader.u8()
  const kind = GOAL_CODES[reader.u8()]
  const target = reader.u16()
  const x = reader.f32()
  const z = reader.f32()
  if (kind === undefined) return undefined
  return kind === 'none' ? null : { kind, target, x, z }
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

/** How finely a vehicle's velocity is told, in m/s, and its spin, in rad/s: finer than a mirror notices, over the few ticks it runs on from them. */
const VELOCITY_STEP = 1 / 100
const SPIN_STEP = 1 / 1000

/**
 * Whether a vehicle has anything to tell beyond where it is and how it
 * moves: anyone driven does, and a car nobody drives only while something
 * is going on with it.
 */
function hasExtras(vehicle: VehicleSnapshot): boolean {
  if (!vehicle.npc) return true
  return (
    vehicle.score !== 0 ||
    vehicle.collected !== 0 ||
    vehicle.kills !== 0 ||
    vehicle.robotKills !== 0 ||
    vehicle.goal !== null ||
    vehicle.goalsWon !== 0 ||
    vehicle.weapon !== 'none' ||
    vehicle.wins !== 0 ||
    vehicle.ammoTicks !== 0 ||
    vehicle.actionTicks !== 0 ||
    vehicle.cooldownTicks !== 0 ||
    vehicle.stunnedTicks !== 0 ||
    vehicle.slowedTicks !== 0 ||
    vehicle.rocketsFired !== 0 ||
    vehicle.shieldTicks !== 0 ||
    vehicle.magnetTicks !== 0 ||
    vehicle.plowTicks !== 0 ||
    vehicle.slipTicks !== 0 ||
    vehicle.grappleTicks !== 0 ||
    vehicle.grappleTarget !== NO_TARGET
  )
}

function vehicleBytes(vehicles: readonly VehicleSnapshot[]): number {
  let bytes = 0
  for (const vehicle of vehicles) bytes += SNAPSHOT_VEHICLE_CORE_BYTES + (hasExtras(vehicle) ? SNAPSHOT_VEHICLE_EXTRAS_BYTES : 0)
  return bytes
}

/** A vehicle with nothing going on: what one told of without its extras has. */
function quietVehicle(): Omit<VehicleSnapshot, 'seat' | 'epoch' | 'profile' | 'position' | 'rotation' | 'linearVelocity' | 'angularVelocity' | 'damage' | 'wrecked' | 'lightsOn' | 'abilityHeld' | 'npc' | 'appliedInput'> {
  return {
    score: 0,
    collected: 0,
    kills: 0,
    robotKills: 0,
    goal: null,
    goalsWon: 0,
    weapon: 'none',
    wins: 0,
    ammoTicks: 0,
    actionTicks: 0,
    cooldownTicks: 0,
    stunnedTicks: 0,
    slowedTicks: 0,
    slowedBy: 0,
    rocketsFired: 0,
    shieldTicks: 0,
    magnetTicks: 0,
    plowTicks: 0,
    slipTicks: 0,
    grappleTicks: 0,
    grappleTarget: NO_TARGET,
  }
}

export function encodeSnapshot(message: SnapshotMessage): Uint8Array {
  const writer = new Writer(
    SNAPSHOT_HEADER_BYTES +
      vehicleBytes(message.vehicles) +
      message.pickups.length * SNAPSHOT_PICKUP_BYTES +
      message.loose.length * SNAPSHOT_SPILLED_BYTES +
      message.removed.length * SNAPSHOT_REMOVED_BYTES +
      message.rockets.length * SNAPSHOT_ROCKET_BYTES +
      message.props.length * SNAPSHOT_PROP_BYTES +
      message.robots.length * SNAPSHOT_ROBOT_BYTES +
      message.ufos.length * SNAPSHOT_UFO_BYTES +
      message.spiders.length * SNAPSHOT_SPIDER_BYTES,
  )
  writer.u8(SERVER_SNAPSHOT)
  writer.u32(message.tick)
  writer.u32(message.ackInputTick < 0 ? NO_TICK : message.ackInputTick)
  writer.u8(message.full ? 1 : 0)
  writer.u16(message.looseNext)
  writer.u8(message.vehicles.length)
  writer.u16(message.pickups.length)
  writer.u16(message.loose.length)
  writer.u16(message.removed.length)
  writer.u8(message.rockets.length)
  writer.u8(message.props.length)
  writer.u8(message.robots.length)
  writer.u8(message.ufos.length)
  writer.u8(message.spiders.length)
  for (const vehicle of message.vehicles) {
    const extras = hasExtras(vehicle)
    writer.u8(vehicle.seat)
    writer.u8(vehicle.epoch)
    writer.u8(profileIndex(vehicle.profile))
    writer.u8(
      (vehicle.lightsOn ? 1 : 0) | (vehicle.abilityHeld ? 2 : 0) | (vehicle.npc ? 4 : 0) | (vehicle.wrecked ? 8 : 0) | (extras ? 16 : 0),
    )
    writer.vec3(vehicle.position)
    writer.rotation(vehicle.rotation)
    writer.steps(vehicle.linearVelocity, VELOCITY_STEP)
    writer.steps(vehicle.angularVelocity, SPIN_STEP)
    // Rounded down: a car short of a wreck on the server is never a full 1 on the client.
    writer.u8(Math.floor(Math.min(Math.max(vehicle.damage, 0), 1) * 255))
    writer.looseInput(vehicle.appliedInput)
    if (!extras) continue
    writer.u16(Math.min(vehicle.score, 0xffff))
    writer.u16(Math.min(vehicle.collected, 0xffff))
    writer.u16(Math.min(vehicle.kills, 0xffff))
    writer.u16(Math.min(vehicle.robotKills, 0xffff))
    writer.u8(vehicle.goal === null ? 0 : GOAL_CODES.indexOf(vehicle.goal.kind))
    writer.u16(Math.min(vehicle.goal?.target ?? 0, 0xffff))
    writer.u16(Math.min(Math.max(vehicle.goal?.from ?? 0, 0), 0xffff))
    writer.f32(vehicle.goal?.x ?? 0)
    writer.f32(vehicle.goal?.z ?? 0)
    writer.u8(vehicle.goalsWon & 0xff)
    writer.u8(Math.max(WEAPON_CODES.indexOf(vehicle.weapon), 0))
    writer.u8(vehicle.wins & 0xff)
    writer.u16(Math.min(Math.max(vehicle.ammoTicks, 0), 0xffff))
    writer.u16(Math.min(Math.max(vehicle.actionTicks, 0), 0xffff))
    writer.u16(Math.min(Math.max(vehicle.cooldownTicks, 0), 0xffff))
    writer.u16(Math.min(Math.max(vehicle.stunnedTicks, 0), 0xffff))
    writer.u8(Math.min(Math.max(vehicle.slowedTicks, 0), 0xff))
    writer.u8(Math.round(Math.min(Math.max(vehicle.slowedBy, 0), 1) * 255))
    writer.u16(vehicle.rocketsFired & 0xffff)
    for (const ticks of [vehicle.shieldTicks, vehicle.magnetTicks, vehicle.plowTicks, vehicle.slipTicks, vehicle.grappleTicks]) {
      writer.u16(Math.min(Math.max(ticks, 0), 0xffff))
    }
    writer.u8(vehicle.grappleTarget === NO_TARGET ? NOBODY_BYTE : vehicle.grappleTarget)
  }
  for (const pickup of message.pickups) {
    writer.u16(pickup.slot)
    writer.u16(pickup.generation & 0xffff)
    writer.u16(Math.min(Math.max(pickup.ticksUntilOut, 0), 0xffff))
  }
  for (const loose of message.loose) {
    writer.u16(loose.id)
    writer.u8(Math.max(LOOSE_KINDS.indexOf(loose.kind), 0))
    writer.u8(loose.owner === NO_TARGET ? NOBODY_BYTE : loose.owner)
    writer.u8(share(loose.power))
    writer.vec3(loose.from)
    writer.vec3(loose.position)
    writer.u16(Math.min(Math.max(loose.age, 0), 0xffff))
  }
  for (const id of message.removed) writer.u16(id)
  for (const rocket of message.rockets) {
    writer.u16(rocket.id)
    writer.u8(rocket.owner)
    writer.u8(rocket.target === NO_TARGET ? NOBODY_BYTE : rocket.target)
    writer.vec3(rocket.position)
    writer.vec3(rocket.velocity)
    writer.u16(Math.min(Math.max(rocket.age, 0), 0xffff))
    writer.u8(share(rocket.power))
  }
  for (const prop of message.props) {
    writer.u16(prop.id)
    writer.vec3(prop.position)
    writer.quat(prop.rotation)
    writer.vec3(prop.linearVelocity)
    writer.vec3(prop.angularVelocity)
  }  for (const robot of message.robots) {
    writer.u8(robot.id)
    writer.u16(robot.road)
    writer.f32(robot.along)
    writer.u8(robot.direction > 0 ? 1 : 0)
    writer.u16(robot.legs & 0xffff)
    writer.u8(robot.target === NO_TARGET ? NOBODY_BYTE : robot.target)
    writer.u8(Math.min(Math.max(robot.beamTicks, 0), 0xff))
    writer.u16(Math.min(Math.max(robot.cooldownTicks, 0), 0xffff))
    writer.u8(Math.round(Math.min(Math.max(robot.damage, 0), 1) * 255))
    writer.u8(robot.deaths & 0xff)
  }
  for (const ufo of message.ufos) {
    writer.u8(ufo.id)
    writer.vec3(ufo.position)
    writer.u8(UFO_STATES.indexOf(ufo.state))
    writer.u8(ufo.target === NO_TARGET ? NOBODY_BYTE : ufo.target)
    writer.u16(Math.min(Math.max(ufo.stateTicks, 0), 0xffff))
    writer.u16(Math.min(Math.max(ufo.cooldownTicks, 0), 0xffff))
    writer.u16(ufo.legs & 0xffff)
    writer.u16(ufo.abductions & 0xffff)
    writer.u8(Math.round(Math.min(Math.max(ufo.damage, 0), 1) * 255))
    writer.u8(ufo.deaths & 0xff)
  }
  for (const spider of message.spiders) {
    writer.u8(spider.id)
    writer.vec3(spider.position)
    writer.f32(spider.heading)
    writer.u16(spider.legs & 0xffff)
    writer.f32(spider.target.x)
    writer.f32(spider.target.z)
    writer.f32(spider.stride)
    writer.u16(Math.min(Math.max(spider.bombTicks, 0), 0xffff))
    writer.u8(Math.round(Math.min(Math.max(spider.damage, 0), 1) * 255))
    writer.u8(spider.deaths & 0xff)
  }


  return writer.bytes
}

/**
 * The same snapshot with a different acknowledgment, without encoding the
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
  const looseNext = reader.u16()
  const count = reader.u8()
  const pickupCount = reader.u16()
  const looseCount = reader.u16()
  const removedCount = reader.u16()
  const rocketCount = reader.u8()
  const propCount = reader.u8()
  const robotCount = reader.u8()
  const ufoCount = reader.u8()
  const spiderCount = reader.u8()
  const rest =
    pickupCount * SNAPSHOT_PICKUP_BYTES +
    looseCount * SNAPSHOT_SPILLED_BYTES +
    removedCount * SNAPSHOT_REMOVED_BYTES +
    rocketCount * SNAPSHOT_ROCKET_BYTES +
    propCount * SNAPSHOT_PROP_BYTES +
    robotCount * SNAPSHOT_ROBOT_BYTES +
    ufoCount * SNAPSHOT_UFO_BYTES +
    spiderCount * SNAPSHOT_SPIDER_BYTES
  if (payload.length < SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_VEHICLE_CORE_BYTES + rest) return null

  const vehicles: VehicleSnapshot[] = []
  for (let i = 0; i < count; i++) {
    // Each vehicle is as long as what it has to tell: never past what the rest of the message needs.
    if (payload.length - reader.offset - rest < SNAPSHOT_VEHICLE_CORE_BYTES) return null
    const seat = reader.u8()
    const epoch = reader.u8()
    const profile = VEHICLE_PROFILE_IDS[reader.u8()]
    if (profile === undefined) return null
    const flags = reader.u8()
    const position = reader.vec3()
    const rotation = reader.rotation()
    if (rotation === null) return null
    const linearVelocity = reader.steps(VELOCITY_STEP)
    const angularVelocity = reader.steps(SPIN_STEP)
    const damage = reader.u8() / 255
    const appliedInput = reader.looseInput(createVehicleInput())
    const vehicle: VehicleSnapshot = {
      ...quietVehicle(),
      seat,
      epoch,
      profile,
      position,
      rotation,
      linearVelocity,
      angularVelocity,
      damage,
      wrecked: (flags & 8) === 8,
      lightsOn: (flags & 1) === 1,
      abilityHeld: (flags & 2) === 2,
      npc: (flags & 4) === 4,
      appliedInput,
    }
    vehicles.push(vehicle)
    if ((flags & 16) === 0) continue
    if (payload.length - reader.offset - rest < SNAPSHOT_VEHICLE_EXTRAS_BYTES) return null
    vehicle.score = reader.u16()
    vehicle.collected = reader.u16()
    vehicle.kills = reader.u16()
    vehicle.robotKills = reader.u16()
    const goalKind = GOAL_CODES[reader.u8()]
    const target = reader.u16()
    const from = reader.u16()
    const x = reader.f32()
    const z = reader.f32()
    if (goalKind === undefined) return null
    vehicle.goal = goalKind === 'none' ? null : { kind: goalKind, target, from, x, z }
    vehicle.goalsWon = reader.u8()
    const weapon = WEAPON_CODES[reader.u8()]
    if (weapon === undefined) return null
    vehicle.weapon = weapon
    vehicle.wins = reader.u8()
    vehicle.ammoTicks = reader.u16()
    vehicle.actionTicks = reader.u16()
    vehicle.cooldownTicks = reader.u16()
    vehicle.stunnedTicks = reader.u16()
    vehicle.slowedTicks = reader.u8()
    vehicle.slowedBy = reader.u8() / 255
    vehicle.rocketsFired = reader.u16()
    vehicle.shieldTicks = reader.u16()
    vehicle.magnetTicks = reader.u16()
    vehicle.plowTicks = reader.u16()
    vehicle.slipTicks = reader.u16()
    vehicle.grappleTicks = reader.u16()
    const hooked = reader.u8()
    vehicle.grappleTarget = hooked === NOBODY_BYTE ? NO_TARGET : hooked
  }
  if (payload.length - reader.offset !== rest) return null
  const pickups: PickupSnapshot[] = []
  for (let i = 0; i < pickupCount; i++) {
    pickups.push({ slot: reader.u16(), generation: reader.u16(), ticksUntilOut: reader.u16() })
  }
  const loose: LooseSnapshot[] = []
  for (let i = 0; i < looseCount; i++) {
    const id = reader.u16()
    const kind = LOOSE_KINDS[reader.u8()]
    if (kind === undefined) return null
    const owner = reader.u8()
    loose.push({
      id,
      kind,
      owner: owner === NOBODY_BYTE ? NO_TARGET : owner,
      power: reader.u8() / 255,
      from: reader.vec3(),
      position: reader.vec3(),
      age: reader.u16(),
    })
  }
  const removed: number[] = []
  for (let i = 0; i < removedCount; i++) removed.push(reader.u16())
  const rockets: RocketSnapshot[] = []
  for (let i = 0; i < rocketCount; i++) {
    const id = reader.u16()
    const owner = reader.u8()
    const target = reader.u8()
    rockets.push({
      id,
      owner,
      target: target === NOBODY_BYTE ? NO_TARGET : target,
      position: reader.vec3(),
      velocity: reader.vec3(),
      age: reader.u16(),
      power: reader.u8() / 255,
    })
  }
  const props: PropSnapshot[] = []
  for (let i = 0; i < propCount; i++) {
    props.push({
      id: reader.u16(),
      position: reader.vec3(),
      rotation: reader.quat(),
      linearVelocity: reader.vec3(),
      angularVelocity: reader.vec3(),
    })
  }
  const robots: RobotSnapshot[] = []
  for (let i = 0; i < robotCount; i++) {
    const id = reader.u8()
    const road = reader.u16()
    const along = reader.f32()
    const direction = reader.u8() === 1 ? 1 : -1
    const legs = reader.u16()
    const target = reader.u8()
    robots.push({
      id,
      road,
      along,
      direction,
      legs,
      target: target === NOBODY_BYTE ? NO_TARGET : target,
      beamTicks: reader.u8(),
      cooldownTicks: reader.u16(),
      damage: reader.u8() / 255,
      deaths: reader.u8(),
    })
  }
  const ufos: UfoSnapshot[] = []
  for (let i = 0; i < ufoCount; i++) {
    const id = reader.u8()
    const position = reader.vec3()
    const state = UFO_STATES[reader.u8()]
    if (state === undefined) return null
    const target = reader.u8()
    ufos.push({
      id,
      position,
      state,
      target: target === NOBODY_BYTE ? NO_TARGET : target,
      stateTicks: reader.u16(),
      cooldownTicks: reader.u16(),
      legs: reader.u16(),
      abductions: reader.u16(),
      damage: reader.u8() / 255,
      deaths: reader.u8(),
    })
  }
  const spiders: SpiderSnapshot[] = []
  for (let i = 0; i < spiderCount; i++) {
    spiders.push({
      id: reader.u8(),
      position: reader.vec3(),
      heading: reader.f32(),
      legs: reader.u16(),
      target: { x: reader.f32(), z: reader.f32() },
      stride: reader.f32(),
      bombTicks: reader.u16(),
      damage: reader.u8() / 255,
      deaths: reader.u8(),
    })
  }
  return {
    tick,
    ackInputTick: ack === NO_TICK ? UNACKNOWLEDGED_INPUT_TICK : ack,
    full,
    looseNext,
    vehicles,
    pickups,
    loose,
    removed,
    rockets,
    props,
    robots,
    ufos,
    spiders,
  }
}

/** A car on an island, for a peek at it from the menu: driven or not, and which seat. */
export interface IslandMark {
  kind: IslandMarkKind
  /** Its seat, for its color. */
  seat: number
  position: Vec3
}
export type IslandMarkKind = 'player' | 'npc'
const MARK_KINDS: readonly IslandMarkKind[] = ['player', 'npc']

export function encodePeekRequest(seed: number): Uint8Array {
  const writer = new Writer(PEEK_REQUEST_BYTES)
  writer.u8(CLIENT_PEEK)
  writer.u32(seed >>> 0)
  return writer.bytes
}

/** The island a peek asks after, or `null` if it is not a peek. */
export function decodePeekRequest(payload: Uint8Array): number | null {
  if (payload.length !== PEEK_REQUEST_BYTES || messageTypeOf(payload) !== CLIENT_PEEK) return null
  const reader = new Reader(payload)
  reader.u8()
  return reader.u32()
}

export function encodePeek(marks: readonly IslandMark[]): Uint8Array {
  const count = Math.min(marks.length, 0xffff)
  const writer = new Writer(PEEK_HEADER_BYTES + count * PEEK_MARK_BYTES)
  writer.u8(SERVER_PEEK)
  writer.u16(count)
  for (const mark of marks.slice(0, count)) {
    writer.u8(MARK_KINDS.indexOf(mark.kind))
    writer.u8(mark.seat === NO_TARGET ? NOBODY_BYTE : mark.seat)
    writer.vec3(mark.position)
  }
  return writer.bytes
}

export function decodePeek(payload: Uint8Array): IslandMark[] | null {
  if (payload.length < PEEK_HEADER_BYTES || messageTypeOf(payload) !== SERVER_PEEK) return null
  const reader = new Reader(payload)
  reader.u8()
  const count = reader.u16()
  if (payload.length !== PEEK_HEADER_BYTES + count * PEEK_MARK_BYTES) return null
  const marks: IslandMark[] = []
  for (let i = 0; i < count; i++) {
    const kind = MARK_KINDS[reader.u8()]
    const seat = reader.u8()
    const position = reader.vec3()
    if (kind === undefined) return null
    marks.push({ kind, seat: seat === NOBODY_BYTE ? NO_TARGET : seat, position })
  }
  return marks
}
