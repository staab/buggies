import {
  ACHIEVEMENTS,
  COUNT_KINDS,
  GAME_KINDS,
  NOT_RACING,
  RACE_LAPS_MOST,
  RACE_MARKS_MOST,
  UFO_STATES,
  NO_TARGET,
  LOOSE_KINDS,
  VEHICLE_PROFILE_IDS,
  WEAPONS,
  createVehicleInput,
  type CountKind,
  type Game,
  type GameKind,
  type GameRequest,
  type Race,
  type LooseKind,
  type UfoState,
  type VehicleInput,
  type VehicleProfileId,
  type Weapon,
} from '@buggies/game'
import type { Quat, Vec3 } from '@buggies/physics'

import {
  CLIENT_CHANGE_VEHICLE,
  CLIENT_GAME,
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
  SERVER_WELCOME,
  UNACKNOWLEDGED_INPUT_TICK,
} from './protocol.ts'

/**
 * Every message is a flat run of fixed-width fields, read and written in the
 * same order. Rapier keeps its numbers in single precision, so `f32` on the
 * wire loses nothing where a place is told. How things move and turn is
 * told more loosely, in whole steps finer than a mirror notices, since it
 * is told again every snapshot. A message is decoded by its declared size
 * alone: anything the wrong length is refused rather than read past.
 */

export const HELLO_BYTES = 13
export const WELCOME_BYTES = 19
export const REJECT_BYTES = 2
export const INPUT_BYTES = 18
export const RESPAWN_BYTES = 1
export const CHANGE_VEHICLE_BYTES = 2
/** A game asked for: what kind, how many, and how many marks its course has, each told after it. */
export const GAME_HEADER_BYTES = 5
export const GAME_MARK_BYTES = 12
export const ROOMS_REQUEST_BYTES = 1
export const ROOMS_HEADER_BYTES = 2
export const ROOM_BYTES = 5
export const PEEK_REQUEST_BYTES = 5
export const PEEK_HEADER_BYTES = 3
export const PEEK_MARK_BYTES = 14
export const SNAPSHOT_HEADER_BYTES = 26
/**
 * A vehicle in a snapshot: where it is and how it moves, how hurt it is and
 * what it was last driven with, always; and what it has won and what it has
 * going on, only when it has any, which a car nobody drives mostly has not.
 */
export const SNAPSHOT_VEHICLE_CORE_BYTES = 40
export const SNAPSHOT_VEHICLE_EXTRAS_BYTES = 34
/** The race on, if any, told after the header: who set it going and when, how many laps, and each of its marks. */
export const SNAPSHOT_RACE_BYTES = 6
export const SNAPSHOT_MARK_BYTES = 6
export const SNAPSHOT_VEHICLE_BYTES = SNAPSHOT_VEHICLE_CORE_BYTES + SNAPSHOT_VEHICLE_EXTRAS_BYTES
export const SNAPSHOT_PICKUP_BYTES = 6
export const SNAPSHOT_SPILLED_BYTES = 31
export const SNAPSHOT_REMOVED_BYTES = 2
export const SNAPSHOT_ROCKET_BYTES = 24
export const SNAPSHOT_PROP_BYTES = 33
export const SNAPSHOT_ROBOT_BYTES = 16
export const SNAPSHOT_UFO_BYTES = 41
export const SNAPSHOT_SPIDER_BYTES = 47
export const SNAPSHOT_METEOR_BYTES = 28

/** What a game is, by the byte that says so: none first. */
const GAME_CODES: readonly (GameKind | 'none')[] = ['none', ...GAME_KINDS]
/** What count a car plays for, by the byte that says so: none first. */
const COUNT_CODES: readonly (CountKind | 'none')[] = ['none', ...COUNT_KINDS]

/** A car in no race, on the wire. */
const NOT_RACING_BYTE = 0xff

/** How finely a race's mark is told: a way out of unit length, in steps of about 2 cm on the planet's ground. */
const MARK_STEP = 1 / 32767

/** What a vehicle can carry, by the byte that says so: nothing first. */
const WEAPON_CODES: readonly Weapon[] = ['none', ...WEAPONS]

/** A rocket or shot with no target, on the wire. */
const NOBODY_BYTE = 0xff

export interface HelloMessage {
  protocolVersion: number
  profile: VehicleProfileId
  /** Which world: the room to be seated in. */
  seed: number
  /** Which of its portals to come out of, having come through a portal to it, or `NO_ARRIVAL`. */
  arrival: number
  /** The pass the server gave the seat left for the portal, which carries over what it held; or `NO_PASS`. */
  pass: number
}

/** No portal to come out of: the car starts where the world's spawns are. */
export const NO_ARRIVAL = 0xff
/** No seat left behind: nothing carried over. */
export const NO_PASS = 0

export interface WelcomeMessage {
  protocolVersion: number
  seed: number
  seat: number
  epoch: number
  tick: number
  maxPlayers: number
  profile: VehicleProfileId
  /** What to show the server on coming through a portal, for what this seat held to be carried over. */
  pass: number
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
  /** Bananas taken since sitting down, all told, other players' cars its weapons have wrecked, and robots they have brought down. */
  collected: number
  kills: number
  robotKills: number
  /** The count it is playing for, if any, how many games it has won, counted around past 255, and how many of the race's marks it has passed, or `NOT_RACING`. */
  game: Game | null
  gamesWon: number
  racePassed: number
  /** How many feats it has been paid for, counted around past 255, and the last of them. */
  achievements: number
  lastAchievement: number
  /** The weapon last picked, the weapon key held on the tick, and what is left of the banana last broken into. */
  weapon: Weapon
  weaponHeld: number
  burnLeft: number
  /** A car nobody drives. */
  npc: boolean
  /** How many rockets it has fired, which numbers the next. */
  rocketsFired: number
  /** How long it is stunned for, and how long its own shockwave is seen going for. */
  stunnedTicks: number
  shockTicks: number
  /** How much longer its magnet and plow last. */
  magnetTicks: number
  plowTicks: number
  /** Its siren on, its horn sounding for this much longer, and its signal key down on the tick: for show. */
  lightsOn: boolean
  hornTicks: number
  signalHeld: boolean
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
  velocity: Vec3
  climb: number
}

/** A giant spider, as the server has it. */
export interface SpiderSnapshot {
  id: number
  position: Vec3
  forward: Vec3
  legs: number
  target: Vec3
  stride: number
  bombTicks: number
  damage: number
  deaths: number
}

/** A meteor coming down, as the server has it. */
export interface MeteorSnapshot {
  id: number
  from: Vec3
  to: Vec3
  /** How many ticks before the snapshot's it was first seen. */
  age: number
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
  /** The race on over the island, if any. */
  race: Race | null
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
  /** Every meteor coming down. */
  meteors: MeteorSnapshot[]
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
    const scale = (sign * 32767) / Math.SQRT1_2
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
    const parts = [0, 0, 0, 0]
    let sum = 0
    for (let k = 0; k < 4; k++) {
      if (k === largest) continue
      const part = (this.i16() / 32767) * Math.SQRT1_2
      parts[k] = part
      sum += part * part
    }
    parts[largest] = Math.sqrt(Math.max(1 - sum, 0))
    return { x: parts[0]!, y: parts[1]!, z: parts[2]!, w: parts[3]! }
  }

  looseInput(out: VehicleInput): VehicleInput {
    out.steer = this.view.getInt8(this.at) / 127
    this.at += 1
    out.throttle = this.u8() / 255
    out.brake = this.u8() / 255
    readButtons(this.u8(), out)
    return out
  }

  /** How far through the message it has read. */
  get offset(): number {
    return this.at
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

/** The buttons of an input, in a byte: the handbrake in the lowest bit, the weapon selected over it, then the signal key and the fire key. */
function buttons(value: VehicleInput): number {
  const key = Number.isInteger(value.weapon) && value.weapon > 0 && value.weapon <= WEAPONS.length ? value.weapon : 0
  return (value.handbrake ? 1 : 0) | (key << 1) | (value.signal ? SIGNAL_BIT : 0) | (value.fire ? FIRE_BIT : 0)
}

/** The signal key's bit, over the four the weapon selected takes, and the fire key's over that. */
const SIGNAL_BIT = 1 << 5
const FIRE_BIT = 1 << 6

/** An input's buttons from their byte; a weapon key past the last is none. */
function readButtons(byte: number, out: VehicleInput): void {
  out.handbrake = (byte & 1) === 1
  const key = (byte >> 1) & 0xf
  out.weapon = key <= WEAPONS.length ? key : 0
  out.signal = (byte & SIGNAL_BIT) !== 0
  out.fire = (byte & FIRE_BIT) !== 0
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

export function encodeHello(profile: VehicleProfileId, seed: number, arrival = NO_ARRIVAL, pass = NO_PASS): Uint8Array {
  const writer = new Writer(HELLO_BYTES)
  writer.u8(CLIENT_HELLO)
  writer.u16(PROTOCOL_VERSION)
  writer.u8(profileIndex(profile))
  writer.u32(seed)
  writer.u8(arrival)
  writer.u32(pass)
  return writer.bytes
}

export function decodeHello(payload: Uint8Array): HelloMessage | null {
  if (payload.length !== HELLO_BYTES || messageTypeOf(payload) !== CLIENT_HELLO) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const profile = VEHICLE_PROFILE_IDS[reader.u8()]
  const seed = reader.u32()
  const arrival = reader.u8()
  const pass = reader.u32()
  return profile === undefined ? null : { protocolVersion, profile, seed, arrival, pass }
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
  writer.u32(message.pass)
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
  const pass = reader.u32()
  if (profile === undefined) return null
  return { protocolVersion, seed, seat, epoch, tick, maxPlayers, profile, pass }
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

export function encodeGame(game: GameRequest | null): Uint8Array {
  const course = (game?.course ?? []).slice(0, RACE_MARKS_MOST)
  const writer = new Writer(GAME_HEADER_BYTES + course.length * GAME_MARK_BYTES)
  writer.u8(CLIENT_GAME)
  writer.u8(game === null ? 0 : GAME_CODES.indexOf(game.kind))
  writer.u16(game === null ? 0 : Math.min(Math.max(game.target, 0), 0xffff))
  writer.u8(course.length)
  for (const mark of course) writer.vec3(mark)
  return writer.bytes
}

/** The game a message asks for, `null` for none, or `undefined` if it is not a game message at all. */
export function decodeGame(payload: Uint8Array): GameRequest | null | undefined {
  if (payload.length < GAME_HEADER_BYTES || messageTypeOf(payload) !== CLIENT_GAME) return undefined
  const reader = new Reader(payload)
  reader.u8()
  const kind = GAME_CODES[reader.u8()]
  const target = reader.u16()
  const marks = reader.u8()
  if (kind === undefined || marks > RACE_MARKS_MOST || payload.length !== GAME_HEADER_BYTES + marks * GAME_MARK_BYTES) return undefined
  const course: Vec3[] = []
  for (let k = 0; k < marks; k++) course.push(reader.vec3())
  return kind === 'none' ? null : { kind, target, course }
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

/**
 * How finely a body's velocity is told, in m/s, and its spin, in rad/s:
 * finer than a mirror notices over the few ticks it runs on from them, and
 * wide enough, at ±327 m/s and ±32 rad/s, for anything driven, flown or
 * knocked flying.
 */
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
    vehicle.game !== null ||
    vehicle.gamesWon !== 0 ||
    vehicle.achievements !== 0 ||
    vehicle.racePassed !== NOT_RACING ||
    vehicle.weapon !== 'none' ||
    vehicle.weaponHeld !== 0 ||
    vehicle.burnLeft !== 0 ||
    vehicle.stunnedTicks !== 0 ||
    vehicle.shockTicks !== 0 ||
    vehicle.rocketsFired !== 0 ||
    vehicle.magnetTicks !== 0 ||
    vehicle.plowTicks !== 0 ||
    vehicle.hornTicks !== 0
  )
}

function raceBytes(race: Race | null): number {
  return race === null ? 0 : SNAPSHOT_RACE_BYTES + Math.min(race.course.length, RACE_MARKS_MOST) * SNAPSHOT_MARK_BYTES
}

function vehicleBytes(vehicles: readonly VehicleSnapshot[]): number {
  let bytes = 0
  for (const vehicle of vehicles) bytes += SNAPSHOT_VEHICLE_CORE_BYTES + (hasExtras(vehicle) ? SNAPSHOT_VEHICLE_EXTRAS_BYTES : 0)
  return bytes
}

/** What a vehicle told of without its extras has: nothing going on. */
function quietVehicle(): Omit<
  VehicleSnapshot,
  'seat' | 'epoch' | 'profile' | 'position' | 'rotation' | 'linearVelocity' | 'angularVelocity' | 'damage' | 'wrecked' | 'lightsOn' | 'signalHeld' | 'npc' | 'appliedInput'
> {
  return {
    score: 0,
    collected: 0,
    kills: 0,
    robotKills: 0,
    game: null,
    gamesWon: 0,
    achievements: 0,
    lastAchievement: 0,
    racePassed: NOT_RACING,
    weapon: 'none',
    weaponHeld: 0,
    burnLeft: 0,
    stunnedTicks: 0,
    shockTicks: 0,
    rocketsFired: 0,
    magnetTicks: 0,
    plowTicks: 0,
    hornTicks: 0,
  }
}

export function encodeSnapshot(message: SnapshotMessage): Uint8Array {
  const writer = new Writer(
    SNAPSHOT_HEADER_BYTES +
      raceBytes(message.race) +
      vehicleBytes(message.vehicles) +
      message.pickups.length * SNAPSHOT_PICKUP_BYTES +
      message.loose.length * SNAPSHOT_SPILLED_BYTES +
      message.removed.length * SNAPSHOT_REMOVED_BYTES +
      message.rockets.length * SNAPSHOT_ROCKET_BYTES +
      message.props.length * SNAPSHOT_PROP_BYTES +
      message.robots.length * SNAPSHOT_ROBOT_BYTES +
      message.ufos.length * SNAPSHOT_UFO_BYTES +
      message.spiders.length * SNAPSHOT_SPIDER_BYTES +
      message.meteors.length * SNAPSHOT_METEOR_BYTES,
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
  writer.u8(message.race === null ? 0 : Math.min(message.race.course.length, RACE_MARKS_MOST))
  writer.u8(message.meteors.length)
  if (message.race !== null) {
    writer.u8(message.race.starter)
    writer.u32(message.race.startTick >>> 0)
    writer.u8(Math.min(Math.max(message.race.laps, 1), RACE_LAPS_MOST))
    for (const mark of message.race.course.slice(0, RACE_MARKS_MOST)) writer.steps(mark, MARK_STEP)
  }
  for (const vehicle of message.vehicles) {
    const extras = hasExtras(vehicle)
    writer.u8(vehicle.seat)
    writer.u8(vehicle.epoch)
    writer.u8(profileIndex(vehicle.profile))
    writer.u8(
      (vehicle.lightsOn ? 1 : 0) | (vehicle.signalHeld ? 2 : 0) | (vehicle.npc ? 4 : 0) | (vehicle.wrecked ? 8 : 0) | (extras ? 16 : 0),
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
    writer.u8(vehicle.game === null ? 0 : COUNT_CODES.indexOf(vehicle.game.kind))
    writer.u16(Math.min(vehicle.game?.target ?? 0, 0xffff))
    writer.u16(Math.min(Math.max(vehicle.game?.from ?? 0, 0), 0xffff))
    writer.u32((vehicle.game?.startTick ?? 0) >>> 0)
    writer.u8(vehicle.gamesWon & 0xff)
    writer.u8(vehicle.achievements & 0xff)
    writer.u8(Math.min(Math.max(vehicle.lastAchievement, 0), 0xff))
    writer.u8(vehicle.racePassed === NOT_RACING ? NOT_RACING_BYTE : Math.min(vehicle.racePassed, RACE_MARKS_MOST * RACE_LAPS_MOST))
    writer.u8(Math.max(WEAPON_CODES.indexOf(vehicle.weapon), 0))
    writer.u8(Math.min(Math.max(vehicle.weaponHeld, 0), WEAPONS.length))
    writer.u8(Math.min(Math.max(vehicle.burnLeft, 0), 0xff))
    writer.u16(vehicle.rocketsFired & 0xffff)
    writer.u16(Math.min(Math.max(vehicle.stunnedTicks, 0), 0xffff))
    writer.u8(Math.min(Math.max(vehicle.shockTicks, 0), 0xff))
    writer.u16(Math.min(Math.max(vehicle.magnetTicks, 0), 0xffff))
    writer.u16(Math.min(Math.max(vehicle.plowTicks, 0), 0xffff))
    writer.u8(Math.min(Math.max(vehicle.hornTicks, 0), 0xff))
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
    writer.steps(rocket.velocity, VELOCITY_STEP)
    writer.u16(Math.min(Math.max(rocket.age, 0), 0xffff))
  }
  for (const prop of message.props) {
    writer.u16(prop.id)
    writer.vec3(prop.position)
    writer.rotation(prop.rotation)
    writer.steps(prop.linearVelocity, VELOCITY_STEP)
    writer.steps(prop.angularVelocity, SPIN_STEP)
  }
  for (const robot of message.robots) {
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
    writer.vec3(ufo.velocity)
    writer.f32(ufo.climb)
  }
  for (const spider of message.spiders) {
    writer.u8(spider.id)
    writer.vec3(spider.position)
    writer.vec3(spider.forward)
    writer.u16(spider.legs & 0xffff)
    writer.vec3(spider.target)
    writer.f32(spider.stride)
    writer.u16(Math.min(Math.max(spider.bombTicks, 0), 0xffff))
    writer.u8(Math.round(Math.min(Math.max(spider.damage, 0), 1) * 255))
    writer.u8(spider.deaths & 0xff)
  }
  for (const meteor of message.meteors) {
    writer.u16(meteor.id)
    writer.vec3(meteor.from)
    writer.vec3(meteor.to)
    writer.u16(Math.min(Math.max(meteor.age, 0), 0xffff))
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
  const raceMarks = reader.u8()
  const meteorCount = reader.u8()
  if (raceMarks > RACE_MARKS_MOST) return null
  const rest =
    pickupCount * SNAPSHOT_PICKUP_BYTES +
    looseCount * SNAPSHOT_SPILLED_BYTES +
    removedCount * SNAPSHOT_REMOVED_BYTES +
    rocketCount * SNAPSHOT_ROCKET_BYTES +
    propCount * SNAPSHOT_PROP_BYTES +
    robotCount * SNAPSHOT_ROBOT_BYTES +
    ufoCount * SNAPSHOT_UFO_BYTES +
    spiderCount * SNAPSHOT_SPIDER_BYTES +
    meteorCount * SNAPSHOT_METEOR_BYTES
  const raceTold = raceMarks === 0 ? 0 : SNAPSHOT_RACE_BYTES + raceMarks * SNAPSHOT_MARK_BYTES
  if (payload.length < SNAPSHOT_HEADER_BYTES + raceTold + count * SNAPSHOT_VEHICLE_CORE_BYTES + rest) return null
  let race: Race | null = null
  if (raceMarks > 0) {
    const starter = reader.u8()
    const startTick = reader.u32()
    const laps = reader.u8()
    if (laps < 1 || laps > RACE_LAPS_MOST) return null
    const course: Vec3[] = []
    for (let k = 0; k < raceMarks; k++) course.push(reader.steps(MARK_STEP))
    race = { course, laps, starter, startTick }
  }

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
      signalHeld: (flags & 2) === 2,
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
    const gameKind = COUNT_CODES[reader.u8()]
    const target = reader.u16()
    const from = reader.u16()
    const startTick = reader.u32()
    if (gameKind === undefined) return null
    vehicle.game = gameKind === 'none' ? null : { kind: gameKind, target, from, startTick }
    vehicle.gamesWon = reader.u8()
    vehicle.achievements = reader.u8()
    vehicle.lastAchievement = reader.u8()
    if (vehicle.lastAchievement >= ACHIEVEMENTS.length) return null
    const passed = reader.u8()
    if (passed !== NOT_RACING_BYTE && passed > RACE_MARKS_MOST * RACE_LAPS_MOST) return null
    vehicle.racePassed = passed === NOT_RACING_BYTE ? NOT_RACING : passed
    const weapon = WEAPON_CODES[reader.u8()]
    if (weapon === undefined) return null
    vehicle.weapon = weapon
    const held = reader.u8()
    if (held > WEAPONS.length) return null
    vehicle.weaponHeld = held
    vehicle.burnLeft = reader.u8()
    vehicle.rocketsFired = reader.u16()
    vehicle.stunnedTicks = reader.u16()
    vehicle.shockTicks = reader.u8()
    vehicle.magnetTicks = reader.u16()
    vehicle.plowTicks = reader.u16()
    vehicle.hornTicks = reader.u8()
  }
  // What is left is exactly the rest: a message longer than it says is refused, as a shorter one is.
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
      velocity: reader.steps(VELOCITY_STEP),
      age: reader.u16(),
    })
  }
  const props: PropSnapshot[] = []
  for (let i = 0; i < propCount; i++) {
    const id = reader.u16()
    const position = reader.vec3()
    const rotation = reader.rotation()
    if (rotation === null) return null
    props.push({ id, position, rotation, linearVelocity: reader.steps(VELOCITY_STEP), angularVelocity: reader.steps(SPIN_STEP) })
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
      velocity: reader.vec3(),
      climb: reader.f32(),
    })
  }
  const spiders: SpiderSnapshot[] = []
  for (let i = 0; i < spiderCount; i++) {
    spiders.push({
      id: reader.u8(),
      position: reader.vec3(),
      forward: reader.vec3(),
      legs: reader.u16(),
      target: reader.vec3(),
      stride: reader.f32(),
      bombTicks: reader.u16(),
      damage: reader.u8() / 255,
      deaths: reader.u8(),
    })
  }
  const meteors: MeteorSnapshot[] = []
  for (let i = 0; i < meteorCount; i++) {
    meteors.push({ id: reader.u16(), from: reader.vec3(), to: reader.vec3(), age: reader.u16() })
  }
  return {
    tick,
    ackInputTick: ack === NO_TICK ? UNACKNOWLEDGED_INPUT_TICK : ack,
    full,
    looseNext,
    race,
    vehicles,
    pickups,
    loose,
    removed,
    rockets,
    props,
    robots,
    ufos,
    spiders,
    meteors,
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
