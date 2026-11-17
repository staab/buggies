import {
  ACHIEVEMENTS,
  LOOSE_KINDS,
  NO_TARGET,
  UFO_STATES,
  VEHICLE_PROFILE_IDS,
  WEAPONS,
  createVehicleInput,
  type ArenaRules,
  type LooseKind,
  type UfoState,
  type VehicleInput,
  type VehicleProfileId,
  type Weapon,
} from '@buggies/game'
import type { Quat, Vec3 } from '@buggies/physics'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

import {
  CHECKPOINTS_LISTED,
  CLIENT_AUTH,
  CLIENT_CHANGE_VEHICLE,
  CLIENT_CREATE_GAME,
  CLIENT_GAME_EDIT,
  CLIENT_GAME_READY,
  CLIENT_GAME_START,
  CLIENT_HELLO,
  CLIENT_INPUT,
  CLIENT_JOIN_GAME,
  CLIENT_LEAVE_GAME,
  CLIENT_LOBBY,
  CLIENT_RESPAWN,
  CLIENT_SLOT_ADD,
  CLIENT_SLOT_REMOVE,
  CLIENT_SLOT_VEHICLE,
  GAMES_LISTED,
  KEEP_LISTED,
  NAME_MOST,
  NO_PROFILE,
  NO_TICK,
  PROTOCOL_VERSION,
  SERVER_GAME,
  SERVER_GAMES,
  SERVER_LOBBY,
  SERVER_LOBBY_WELCOME,
  SERVER_RACE_PLAN,
  SERVER_REJECT,
  SERVER_SIGNED_IN,
  SERVER_SNAPSHOT,
  SERVER_STANDINGS,
  SERVER_WELCOME,
  SLOTS_MOST,
  UNACKNOWLEDGED_INPUT_TICK,
} from './protocol.ts'
import { CHALLENGE_BYTES, PUBKEY_HEX, type NostrEvent } from './nostr.ts'

/** The bounds a message may not pass: kept equal by `course.ts` on the simulation's side. */
export { CHECKPOINTS_LISTED, GAMES_LISTED, KEEP_LISTED, SLOTS_MOST } from './protocol.ts'

/**
 * Every message is a flat run of fixed-width fields, read and written in the
 * same order. Rapier keeps its numbers in single precision, so `f32` on the
 * wire loses nothing where a place is told. How things move and turn is
 * told more loosely, in whole steps finer than a mirror notices, since it
 * is told again every snapshot. A message is decoded by its declared size
 * alone: anything the wrong length is refused rather than read past.
 */

/** A hello, up to its name's length; the name follows, in UTF-8. */
export const HELLO_BYTES = 18
export const WELCOME_BYTES = 25 + CHALLENGE_BYTES + PUBKEY_HEX / 2
/** The most an answer to a challenge may run to, in bytes. */
export const AUTH_MOST = 4096
export const SIGNED_IN_BYTES = 2 + PUBKEY_HEX / 2
/** The challenge a lobby connection answers, and the key it is already known by, as hex. */
export const LOBBY_WELCOME_BYTES = 1 + CHALLENGE_BYTES + PUBKEY_HEX / 2
export const REJECT_BYTES = 2
export const INPUT_BYTES = 18
export const RESPAWN_BYTES = 1
export const CHANGE_VEHICLE_BYTES = 2
/** A lobby connection's hello: the game it asks to be in, if any, and its name's length and the name after it. */
export const LOBBY_HELLO_BYTES = 8
/** A game to make: a race, and the vehicle its host starts in. */
export const CREATE_GAME_BYTES = 2
export const LEAVE_GAME_BYTES = 1
/** Ready to drive: in which vehicle, and whether ready or not. */
export const GAME_READY_BYTES = 3
/** A game's world and rules: what it is played for, its seed, weapon and banana flags, and how many worlds a race runs. */
export const GAME_EDIT_BYTES = 8
export const GAME_START_BYTES = 1
/** One more bot slot, and one taken away: the slot's index. */
export const SLOT_ADD_BYTES = 1
export const SLOT_REMOVE_BYTES = 2
/** A bot slot's vehicle: which slot, and which vehicle. */
export const SLOT_VEHICLE_BYTES = 3
/** Into a game: its id and the vehicle to drive in. */
export const JOIN_GAME_BYTES = 6
/** The games listed: how many, each with the length of its host's name and the name after it. */
export const GAMES_HEADER_BYTES = 2
export const GAME_SUMMARY_BYTES = 18
/** A game's room, up to the length of its fault: the fault follows, then the slots. */
export const GAME_VIEW_BYTES = 26
/** A slot of a game's room, up to the length of its name: the name follows. */
export const GAME_SLOT_BYTES = 10
/** A race plan up to its keep list, which follows; then its gates, and where the leg leads. */
export const RACE_PLAN_HEADER_BYTES = 8
export const RACE_PLAN_TAIL_BYTES = 9
/** Each world of the course, after the tail, as many as it says; and the most a plan lists. */
export const COURSE_WORLD_BYTES = 4
export const COURSE_WORLDS_LISTED = 8
export const KEEP_PORTAL_BYTES = 1
/** A gate: where it stands, which way it is driven through, and how near counts as through. */
export const CHECKPOINT_BYTES = 25
/** How a race finished: how many rows, each with the length of its name and the name after it. */
export const STANDINGS_HEADER_BYTES = 2
export const STANDING_BYTES = 9
/** A lobby: how many players, each with a seat and a name. */
export const LOBBY_HEADER_BYTES = 2
/** A player in a lobby: their seat and their name's length, then the name. */
export const LOBBY_PLAYER_BYTES = 2
export const SNAPSHOT_HEADER_BYTES = 26
/**
 * A vehicle in a snapshot: where it is and how it moves, how hurt it is and
 * what it was last driven with, always; and what it has won and what it has
 * going on, only when it has any, which a car nobody drives mostly has not.
 */
export const SNAPSHOT_VEHICLE_CORE_BYTES = 40
export const SNAPSHOT_VEHICLE_EXTRAS_BYTES = 23
/** The race as one world sees it, if any, told after the header, and each of its racers after it. */
export const SNAPSHOT_RACE_BYTES = 9
export const SNAPSHOT_RACER_BYTES = 4
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

/** What a game is played for, by the byte that says so. */
const MODE_CODES: readonly GameMode[] = ['race', 'free']
/** Where a game is in its life, by the byte that says so. */
const STATUS_CODES: readonly GameStatus[] = ['open', 'preparing', 'starting', 'racing', 'finished']

/**
 * The largest achievement id there is. Ids are kept as they always were, some
 * of them now retired, so this is not `ACHIEVEMENTS.length`.
 */
const ACHIEVEMENT_MOST = Math.max(0, ...ACHIEVEMENTS.map((achievement) => achievement.id))

/** What a vehicle can carry, by the byte that says so: nothing first. */
const WEAPON_CODES: readonly Weapon[] = ['none', ...WEAPONS]

/** A rocket or shot with no target, on the wire. */
const NOBODY_BYTE = 0xff

export interface HelloMessage {
  protocolVersion: number
  /** The vehicle to drive, or `null` for a spectator, who takes no seat and drives nothing. */
  profile: VehicleProfileId | null
  /** Which game: the only game whose worlds and racers this connection may join. */
  game: number
  /** Which world: the room to be seated in. */
  seed: number
  /** Which of its portals to come out of, having come through a portal to it, or `NO_ARRIVAL`. */
  arrival: number
  /** The pass the game gave the member this seat belongs to; or `NO_PASS`. */
  pass: number
  /** What the player goes by, as cleaned by `cleanName`; empty if they gave none. */
  name: string
}

/** A lobby connection's hello: the game it asks to be in, 0 for browsing them, and the name it goes by. */
export interface LobbyHelloMessage {
  protocolVersion: number
  /** The game to join, or 0 to be told of them all. */
  game: number
  name: string
}

/** No portal to come out of: the car starts where the world's spawns are. */
export const NO_ARRIVAL = 0xff
/** No pass: the connection names no member of the game. */
export const NO_PASS = 0

export interface WelcomeMessage {
  protocolVersion: number
  /** The game this world is one of. */
  game: number
  seed: number
  seat: number
  epoch: number
  tick: number
  maxPlayers: number
  profile: VehicleProfileId
  /** The pass this member drives with: its world connection's pass, the same at every portal and after a dropped connection. */
  pass: number
  /** Whether a `SERVER_RACE_PLAN` follows this welcome: a race's world, rather than a free drive's. */
  race: boolean
  /** The game's options, as `flagsOf` writes them: weapons and bananas. */
  flags: number
  /** What to sign, to prove which nostr key is the player's: hex. */
  challenge: string
  /** The key the player has already proved theirs, come through a portal or back after a dropped connection: hex, or empty. */
  signedIn: string
}

/** The challenge a lobby connection answers, and the key the server already knows it by. */
export interface LobbyWelcomeMessage {
  challenge: string
  signedIn: string
}

/** The key a player has proved theirs, and how many achievements it has been paid all told. */
export interface SignedInMessage {
  pubkey: string
  earned: number
}

export interface RejectMessage {
  reason: number
}

/** Somebody in a world, by the name they go by: a player's, or a bot's. */
export interface LobbyPlayer {
  seat: number
  name: string
}

/** Who is in the world, by seat and name: the bots seated there among them. */
export interface LobbyMessage {
  players: LobbyPlayer[]
}

/** A name as it may be gone by: printable, its spaces single, trimmed, and no longer than `NAME_MOST` characters. */
export function cleanName(raw: string): string {
  const printable = raw.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim()
  return [...printable].slice(0, NAME_MOST).join('').trim()
}

/** What a game is played for: a race through the course's worlds, or driving about freely. */
export type GameMode = 'race' | 'free'

/** Where a game is in its life. Only an open game is joinable; a free drive is always open. */
export type GameStatus = 'open' | 'preparing' | 'starting' | 'racing' | 'finished'

/** What the host of a game has chosen: what it is played for, its seed, its rules, and how many worlds a race runs. */
export interface GameOptions {
  mode: GameMode
  seed: number
  weapons: boolean
  bananas: boolean
  /** How many worlds a race runs: `WORLDS_LEAST` to `WORLDS_MOST`. */
  raceLength: number
}

/** A game as the start screen lists it. */
export interface GameSummary {
  id: number
  seed: number
  mode: GameMode
  status: GameStatus
  /** The host's name; empty for the server's own demo, which nobody hosts. */
  host: string
  /** How many people are in it, and how many slots it has for them. */
  humans: number
  slots: number
  /** The world the race's leader is in, so a watcher knows where to follow it, or 0 when there is none. */
  leader: number
  /** The server's own race, which the start screen watches in the background rather than listing. */
  demo: boolean
}

/** One slot of a game's room: a player's, or a bot's until a player takes it. */
export interface GameSlotView {
  /** Its index among the game's slots. */
  slot: number
  bot: boolean
  /** The member in it, or 0 for a bot. */
  member: number
  name: string
  vehicle: VehicleProfileId
  /** A bot is always ready. */
  ready: boolean
  /** Gone into the world: a race has started, or a free drive's member is driving. */
  driving: boolean
}

/** A game as its room sees it, for one member. */
export interface GameView {
  id: number
  status: GameStatus
  /** The member who alone may change the options, the slots or start the race. */
  host: number
  options: GameOptions
  /** Every slot, in order: the players among them and the bots. */
  slots: readonly GameSlotView[]
  /** The reading client's member id, 0 if it is only browsing. */
  you: number
  /** The pass this member drives with: its world connection's pass. */
  drivePass: number
  /** Why the host's last Start failed (a course that could not be built), or null. */
  fault: string | null
}

/** A gate to drive through, as the client draws it: across the road, facing the way it is driven. */
export interface CheckpointView {
  at: Vec3
  forward: Vec3
  /** How near its middle counts as through, in metres. */
  radius: number
}

/** One leg of a race's course, as the client is told it: the gates to pass, and the portal on out. */
export interface RacePlan {
  game: number
  /** 1-based index of this world in the course. */
  world: number
  ofWorlds: number
  /** The portals this world keeps for the race, as indices into it as generated: everything else is gone. */
  keep: readonly number[]
  checkpoints: readonly CheckpointView[]
  /** The leg's exit portal, as an index into the kept portals, or `null` on the last leg. */
  exit: number | null
  /** Where the exit portal leads: null on the last leg. */
  next: { world: number; arrival: number } | null
  /** Every world of the course, in the order it is raced. */
  worlds: readonly number[]
}

/** A racer as the race's world sees it. */
export interface RaceRacerView {
  seat: number
  /** 1 upward once it has finished; 0 while it races. */
  place: number
  /** How many gates of this leg it has passed. */
  checkpoint: number
  finished: boolean
}

/** How a race is going in one world. */
export interface RaceView {
  world: number
  ofWorlds: number
  /** Ticks since driving began: negative during the 3-2-1, and `HELD` while racers are still being seated. */
  elapsed: number
  over: boolean
  /** How many race, in every world of the course: the "of" of a racer's place. */
  racing: number
  /** The racers in this world. */
  racers: readonly RaceRacerView[]
}

/** The `elapsed` of a race whose racers are still being seated: the cars are held still and the countdown has not started. */
export const HELD = -0x7fff

/** One row of a race's standings. */
export interface Standing {
  place: number
  name: string
  vehicle: VehicleProfileId
  /** How long it took to finish, in seconds; meaningless for a racer that did not. */
  seconds: number
  dnf: boolean
  /** Driven by a bot, not a person. */
  bot: boolean
}

/**
 * What a game's host has switched on: the arena's rules, as the welcome's
 * flags say them and the mirror's arena is made with.
 */
export type GameRules = ArenaRules

/** What a game's mode is, as the byte that says so. */
export function modeCode(mode: GameMode): number {
  return Math.max(MODE_CODES.indexOf(mode), 0)
}

/** The mode a byte says, or `null` if it is none of them. */
export function modeOf(code: number): GameMode | null {
  return MODE_CODES[code] ?? null
}

/** Where a game is in its life, as the byte that says so. */
export function statusCode(status: GameStatus): number {
  return Math.max(STATUS_CODES.indexOf(status), 0)
}

/** The status a byte says, or `null` if it is none of them. */
export function statusOf(code: number): GameStatus | null {
  return STATUS_CODES[code] ?? null
}

/** The rules a welcome's flags say: weapons in the lowest bit, bananas over it. */
export function rulesOf(flags: number): GameRules {
  return { weapons: (flags & 1) === 1, bananas: (flags & 2) === 2 }
}

/** The flags that say a game's rules, for a welcome. */
export function flagsOf(options: GameOptions): number {
  return (options.weapons ? 1 : 0) | (options.bananas ? 2 : 0)
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
  /** The race as this world sees it, if this world is a race's; `null` in free drive. */
  race: RaceView | null
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

/** Text as UTF-8, by way of the escapes a URI makes of it: this package runs where there may be no `TextEncoder`. */
function utf8(text: string): Uint8Array {
  const escaped = encodeURIComponent(text)
  const bytes: number[] = []
  for (let k = 0; k < escaped.length; k++) {
    if (escaped[k] === '%') {
      bytes.push(parseInt(escaped.slice(k + 1, k + 3), 16))
      k += 2
    } else bytes.push(escaped.charCodeAt(k))
  }
  return Uint8Array.from(bytes)
}

/** UTF-8 as text, or `null` if it is not UTF-8. */
function fromUtf8(bytes: Uint8Array): string | null {
  try {
    return decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''))
  } catch {
    return null
  }
}

/** A name cleaned and in UTF-8, as it goes on the wire. */
function nameBytes(name: string): Uint8Array {
  return utf8(cleanName(name))
}

export function encodeHello(profile: VehicleProfileId | null, game: number, seed: number, arrival = NO_ARRIVAL, pass = NO_PASS, name = ''): Uint8Array {
  const named = nameBytes(name)
  const writer = new Writer(HELLO_BYTES + named.length)
  writer.u8(CLIENT_HELLO)
  writer.u16(PROTOCOL_VERSION)
  writer.u8(profile === null ? NO_PROFILE : profileIndex(profile))
  writer.u32(game >>> 0)
  writer.u32(seed)
  writer.u8(arrival)
  writer.u32(pass)
  writer.u8(named.length)
  writer.raw(named)
  return writer.bytes
}

export function decodeHello(payload: Uint8Array): HelloMessage | null {
  if (payload.length < HELLO_BYTES || messageTypeOf(payload) !== CLIENT_HELLO) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  // A spectator says so with its profile byte, and drives none.
  const profileByte = reader.u8()
  const profile = profileByte === NO_PROFILE ? null : (VEHICLE_PROFILE_IDS[profileByte] ?? null)
  const game = reader.u32()
  const seed = reader.u32()
  const arrival = reader.u8()
  const pass = reader.u32()
  const length = reader.u8()
  if (profileByte !== NO_PROFILE && profile === null) return null
  if (payload.length !== HELLO_BYTES + length) return null
  const name = reader.text(length)
  return name === null ? null : { protocolVersion, profile, game, seed, arrival, pass, name: cleanName(name) }
}

export function encodeWelcome(message: WelcomeMessage): Uint8Array {
  const writer = new Writer(WELCOME_BYTES)
  writer.u8(SERVER_WELCOME)
  writer.u16(message.protocolVersion)
  writer.u32(message.game)
  writer.u32(message.seed)
  writer.u8(message.seat)
  writer.u8(message.epoch)
  writer.u32(message.tick)
  writer.u8(message.maxPlayers)
  writer.u8(profileIndex(message.profile))
  writer.u32(message.pass)
  writer.u8(message.race ? 1 : 0)
  writer.u8(message.flags)
  writer.bytes.set(hexBytes(message.challenge, CHALLENGE_BYTES), WELCOME_BYTES - CHALLENGE_BYTES - PUBKEY_HEX / 2)
  writer.bytes.set(hexBytes(message.signedIn, PUBKEY_HEX / 2), WELCOME_BYTES - PUBKEY_HEX / 2)
  return writer.bytes
}

export function decodeWelcome(payload: Uint8Array): WelcomeMessage | null {
  if (payload.length !== WELCOME_BYTES || messageTypeOf(payload) !== SERVER_WELCOME) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const game = reader.u32()
  const seed = reader.u32()
  const seat = reader.u8()
  const epoch = reader.u8()
  const tick = reader.u32()
  const maxPlayers = reader.u8()
  const profile = VEHICLE_PROFILE_IDS[reader.u8()]
  const pass = reader.u32()
  const race = reader.u8()
  const flags = reader.u8()
  if (profile === undefined || race > 1 || (flags & ~3) !== 0) return null
  const challenge = bytesToHex(payload.subarray(WELCOME_BYTES - CHALLENGE_BYTES - PUBKEY_HEX / 2, WELCOME_BYTES - PUBKEY_HEX / 2))
  const signedIn = bytesToHex(payload.subarray(WELCOME_BYTES - PUBKEY_HEX / 2))
  return {
    protocolVersion,
    game,
    seed,
    seat,
    epoch,
    tick,
    maxPlayers,
    profile,
    pass,
    race: race === 1,
    flags,
    challenge,
    signedIn: /^0+$/.test(signedIn) ? '' : signedIn,
  }
}

/** Hex as so many bytes, all naughts where it is empty. */
function hexBytes(hex: string, length: number): Uint8Array {
  return hex === '' ? new Uint8Array(length) : hexToBytes(hex)
}

/** A signed answer to the welcome's challenge. */
export function encodeAuth(event: NostrEvent): Uint8Array {
  const text = utf8(JSON.stringify(event))
  const bytes = new Uint8Array(1 + text.length)
  bytes[0] = CLIENT_AUTH
  bytes.set(text, 1)
  return bytes
}

/** The event an answer carries, unchecked; or `null` if it is not one. */
export function decodeAuth(payload: Uint8Array): unknown {
  if (messageTypeOf(payload) !== CLIENT_AUTH || payload.length > AUTH_MOST) return null
  const text = fromUtf8(payload.subarray(1))
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export function encodeSignedIn(message: SignedInMessage): Uint8Array {
  const bytes = new Uint8Array(SIGNED_IN_BYTES)
  bytes[0] = SERVER_SIGNED_IN
  bytes.set(hexBytes(message.pubkey, PUBKEY_HEX / 2), 1)
  bytes[SIGNED_IN_BYTES - 1] = Math.min(message.earned, 0xff)
  return bytes
}

export function decodeSignedIn(payload: Uint8Array): SignedInMessage | null {
  if (payload.length !== SIGNED_IN_BYTES || messageTypeOf(payload) !== SERVER_SIGNED_IN) return null
  return { pubkey: bytesToHex(payload.subarray(1, SIGNED_IN_BYTES - 1)), earned: payload[SIGNED_IN_BYTES - 1]! }
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

/** A lobby connection's hello: the game it asks to be in, 0 for browsing them, and the name it goes by. */
export function encodeLobbyHello(game = 0, name = ''): Uint8Array {
  const named = nameBytes(name)
  const writer = new Writer(LOBBY_HELLO_BYTES + named.length)
  writer.u8(CLIENT_LOBBY)
  writer.u16(PROTOCOL_VERSION)
  writer.u32(game >>> 0)
  writer.u8(named.length)
  writer.raw(named)
  return writer.bytes
}

export function decodeLobbyHello(payload: Uint8Array): LobbyHelloMessage | null {
  if (payload.length < LOBBY_HELLO_BYTES || messageTypeOf(payload) !== CLIENT_LOBBY) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const game = reader.u32()
  const length = reader.u8()
  if (payload.length !== LOBBY_HELLO_BYTES + length) return null
  const name = reader.text(length)
  return name === null ? null : { protocolVersion, game, name: cleanName(name) }
}

/** A game to make: a race, and the vehicle its host starts in. */
export function encodeCreateGame(vehicle: VehicleProfileId): Uint8Array {
  return Uint8Array.of(CLIENT_CREATE_GAME, profileIndex(vehicle))
}

/** The vehicle a create asks for, or null if it is not one. */
export function decodeCreateGame(payload: Uint8Array): VehicleProfileId | null {
  if (payload.length !== CREATE_GAME_BYTES || messageTypeOf(payload) !== CLIENT_CREATE_GAME) return null
  return VEHICLE_PROFILE_IDS[payload[1]!] ?? null
}

export function encodeLeaveGame(): Uint8Array {
  return Uint8Array.of(CLIENT_LEAVE_GAME)
}

export function isLeaveGame(payload: Uint8Array): boolean {
  return payload.length === LEAVE_GAME_BYTES && messageTypeOf(payload) === CLIENT_LEAVE_GAME
}

/** Ready to drive in this vehicle, or no longer ready. */
export function encodeGameReady(vehicle: VehicleProfileId, ready: boolean): Uint8Array {
  return Uint8Array.of(CLIENT_GAME_READY, profileIndex(vehicle), ready ? 1 : 0)
}

/** What a ready asks for, or null if it is not one. */
export function decodeGameReady(payload: Uint8Array): { vehicle: VehicleProfileId; ready: boolean } | null {
  if (payload.length !== GAME_READY_BYTES || messageTypeOf(payload) !== CLIENT_GAME_READY) return null
  const vehicle = VEHICLE_PROFILE_IDS[payload[1]!]
  const ready = payload[2]!
  if (vehicle === undefined || ready > 1) return null
  return { vehicle, ready: ready === 1 }
}

/** One more bot slot to fill, up to `SLOTS_MOST`: by the game's host alone. */
export function encodeSlotAdd(): Uint8Array {
  return Uint8Array.of(CLIENT_SLOT_ADD)
}

/** Whether this is a slot asked for, and a bot's until a player takes it. */
export function isSlotAdd(payload: Uint8Array): boolean {
  return payload.length === SLOT_ADD_BYTES && messageTypeOf(payload) === CLIENT_SLOT_ADD
}

/** A bot slot taken away, by its index: by the game's host alone. */
export function encodeSlotRemove(slot: number): Uint8Array {
  return Uint8Array.of(CLIENT_SLOT_REMOVE, Math.min(Math.max(slot, 0), 0xff))
}

/** The slot a remove asks for, or null if it is not one. */
export function decodeSlotRemove(payload: Uint8Array): number | null {
  if (payload.length !== SLOT_REMOVE_BYTES || messageTypeOf(payload) !== CLIENT_SLOT_REMOVE) return null
  const slot = payload[1]!
  return slot < SLOTS_MOST ? slot : null
}

/** The vehicle a bot slot is to be driven in, by the slot's index: by the game's host alone. */
export function encodeSlotVehicle(slot: number, vehicle: VehicleProfileId): Uint8Array {
  return Uint8Array.of(CLIENT_SLOT_VEHICLE, Math.min(Math.max(slot, 0), 0xff), profileIndex(vehicle))
}

/** The slot a vehicle asks for and the vehicle itself, or null if it is not one. */
export function decodeSlotVehicle(payload: Uint8Array): { slot: number; vehicle: VehicleProfileId } | null {
  if (payload.length !== SLOT_VEHICLE_BYTES || messageTypeOf(payload) !== CLIENT_SLOT_VEHICLE) return null
  const slot = payload[1]!
  const vehicle = VEHICLE_PROFILE_IDS[payload[2]!]
  if (slot >= SLOTS_MOST || vehicle === undefined) return null
  return { slot, vehicle }
}

/** The world and the rules of a game, as its host changes them. */
export function encodeGameEdit(options: GameOptions): Uint8Array {
  const writer = new Writer(GAME_EDIT_BYTES)
  writer.u8(CLIENT_GAME_EDIT)
  writer.u8(modeCode(options.mode))
  writer.u32(options.seed >>> 0)
  writer.u8(flagsOf(options))
  writer.u8(Math.min(Math.max(options.raceLength, 0), 0xff))
  return writer.bytes
}

/** The options an edit asks for, or null if it is not one. */
export function decodeGameEdit(payload: Uint8Array): GameOptions | null {
  if (payload.length !== GAME_EDIT_BYTES || messageTypeOf(payload) !== CLIENT_GAME_EDIT) return null
  const reader = new Reader(payload)
  reader.u8()
  const mode = modeOf(reader.u8())
  const seed = reader.u32()
  const flags = reader.u8()
  const raceLength = reader.u8()
  if (mode === null || (flags & ~3) !== 0) return null
  return { mode, seed, ...rulesOf(flags), raceLength }
}

export function encodeGameStart(): Uint8Array {
  return Uint8Array.of(CLIENT_GAME_START)
}

export function isGameStart(payload: Uint8Array): boolean {
  return payload.length === GAME_START_BYTES && messageTypeOf(payload) === CLIENT_GAME_START
}

/** Into the game with this id, in this vehicle. */
export function encodeJoinGame(game: number, vehicle: VehicleProfileId): Uint8Array {
  const writer = new Writer(JOIN_GAME_BYTES)
  writer.u8(CLIENT_JOIN_GAME)
  writer.u32(game >>> 0)
  writer.u8(profileIndex(vehicle))
  return writer.bytes
}

/** The game a join asks for and the vehicle to drive in it, or null if it is not a join. */
export function decodeJoinGame(payload: Uint8Array): { game: number; vehicle: VehicleProfileId } | null {
  if (payload.length !== JOIN_GAME_BYTES || messageTypeOf(payload) !== CLIENT_JOIN_GAME) return null
  const vehicle = VEHICLE_PROFILE_IDS[payload[5]!]
  if (vehicle === undefined) return null
  const reader = new Reader(payload)
  reader.u8()
  return { game: reader.u32(), vehicle }
}

/** Who is on the island, by name. */
export function encodeLobby(message: LobbyMessage): Uint8Array {
  const players = message.players.slice(0, 0xff).map((player) => ({ seat: player.seat, name: nameBytes(player.name) }))
  let length = LOBBY_HEADER_BYTES
  for (const player of players) length += LOBBY_PLAYER_BYTES + player.name.length
  const writer = new Writer(length)
  writer.u8(SERVER_LOBBY)
  writer.u8(players.length)
  for (const player of players) {
    writer.u8(player.seat)
    writer.u8(player.name.length)
    writer.raw(player.name)
  }
  return writer.bytes
}

export function decodeLobby(payload: Uint8Array): LobbyMessage | null {
  if (payload.length < LOBBY_HEADER_BYTES || messageTypeOf(payload) !== SERVER_LOBBY) return null
  const reader = new Reader(payload)
  reader.u8()
  const playerCount = reader.u8()
  const players: LobbyPlayer[] = []
  for (let k = 0; k < playerCount; k++) {
    if (reader.left() < LOBBY_PLAYER_BYTES) return null
    const seat = reader.u8()
    const length = reader.u8()
    if (reader.left() < length) return null
    const name = reader.text(length)
    if (name === null) return null
    players.push({ seat, name })
  }
  return reader.left() === 0 ? { players } : null
}

/** The challenge a lobby connection answers, and the key it is already known by. */
export function encodeLobbyWelcome(message: LobbyWelcomeMessage): Uint8Array {  const bytes = new Uint8Array(LOBBY_WELCOME_BYTES)
  bytes[0] = SERVER_LOBBY_WELCOME
  bytes.set(hexBytes(message.challenge, CHALLENGE_BYTES), 1)
  bytes.set(hexBytes(message.signedIn, PUBKEY_HEX / 2), LOBBY_WELCOME_BYTES - PUBKEY_HEX / 2)
  return bytes
}

export function decodeLobbyWelcome(payload: Uint8Array): LobbyWelcomeMessage | null {
  if (payload.length !== LOBBY_WELCOME_BYTES || messageTypeOf(payload) !== SERVER_LOBBY_WELCOME) return null
  const challenge = bytesToHex(payload.subarray(1, 1 + CHALLENGE_BYTES))
  const signedIn = bytesToHex(payload.subarray(LOBBY_WELCOME_BYTES - PUBKEY_HEX / 2))
  return { challenge, signedIn: /^0+$/.test(signedIn) ? '' : signedIn }
}

/** The games the server has, as the start screen lists them. */
export function encodeGames(games: readonly GameSummary[]): Uint8Array {
  const listed = games.slice(0, Math.min(GAMES_LISTED, 0xff)).map((game) => ({ game, host: nameBytes(game.host) }))
  let length = GAMES_HEADER_BYTES
  for (const { host } of listed) length += GAME_SUMMARY_BYTES + host.length
  const writer = new Writer(length)
  writer.u8(SERVER_GAMES)
  writer.u8(listed.length)
  for (const { game, host } of listed) {
    writer.u32(game.id >>> 0)
    writer.u32(game.seed >>> 0)
    writer.u8(modeCode(game.mode))
    writer.u8(statusCode(game.status))
    writer.u8(Math.min(Math.max(game.humans, 0), 0xff))
    writer.u8(Math.min(Math.max(game.slots, 0), 0xff))
    writer.u32(game.leader >>> 0)
    writer.u8(game.demo ? 1 : 0)
    writer.u8(host.length)
    writer.raw(host)
  }
  return writer.bytes
}

export function decodeGames(payload: Uint8Array): GameSummary[] | null {
  if (payload.length < GAMES_HEADER_BYTES || messageTypeOf(payload) !== SERVER_GAMES) return null
  const reader = new Reader(payload)
  reader.u8()
  const count = reader.u8()
  if (count > GAMES_LISTED) return null
  const games: GameSummary[] = []
  for (let k = 0; k < count; k++) {
    if (reader.left() < GAME_SUMMARY_BYTES) return null
    const id = reader.u32()
    const seed = reader.u32()
    const mode = modeOf(reader.u8())
    const status = statusOf(reader.u8())
    const humans = reader.u8()
    const slots = reader.u8()
    const leader = reader.u32()
    const demo = reader.u8()
    const length = reader.u8()
    if (reader.left() < length) return null
    const host = reader.text(length)
    if (mode === null || status === null || demo > 1 || host === null) return null
    games.push({ id, seed, mode, status, host, humans, slots, leader, demo: demo === 1 })
  }
  return reader.left() === 0 ? games : null
}

/** One game's room, as one of its members sees it. */
export function encodeGame(view: GameView, you: number, drivePass: number): Uint8Array {
  // A fault is a line a host reads, not a document: what fits its length byte.
  const fault = utf8(view.fault ?? '').subarray(0, 0xff)
  const slots = view.slots.slice(0, SLOTS_MOST).map((slot) => ({ slot, name: nameBytes(slot.name) }))
  let length = GAME_VIEW_BYTES + fault.length + 1
  for (const { name } of slots) length += GAME_SLOT_BYTES + name.length
  const writer = new Writer(length)
  writer.u8(SERVER_GAME)
  writer.u32(view.id >>> 0)
  writer.u8(statusCode(view.status))
  writer.u32(view.host >>> 0)
  writer.u8(modeCode(view.options.mode))
  writer.u32(view.options.seed >>> 0)
  writer.u8(flagsOf(view.options))
  writer.u8(Math.min(Math.max(view.options.raceLength, 0), 0xff))
  writer.u32(you >>> 0)
  writer.u32(drivePass >>> 0)
  writer.u8(fault.length)
  writer.raw(fault)
  writer.u8(slots.length)
  for (const { slot, name } of slots) {
    writer.u8(slot.slot)
    writer.u8(slot.bot ? 1 : 0)
    writer.u32(slot.member >>> 0)
    writer.u8(name.length)
    writer.raw(name)
    writer.u8(profileIndex(slot.vehicle))
    writer.u8(slot.ready ? 1 : 0)
    writer.u8(slot.driving ? 1 : 0)
  }
  return writer.bytes
}

export function decodeGame(payload: Uint8Array): GameView | null {
  if (payload.length < GAME_VIEW_BYTES + 1 || messageTypeOf(payload) !== SERVER_GAME) return null
  const reader = new Reader(payload)
  reader.u8()
  const id = reader.u32()
  const status = statusOf(reader.u8())
  const host = reader.u32()
  const mode = modeOf(reader.u8())
  const seed = reader.u32()
  const flags = reader.u8()
  const raceLength = reader.u8()
  const you = reader.u32()
  const drivePass = reader.u32()
  const faultLength = reader.u8()
  if (status === null || mode === null || (flags & ~3) !== 0 || reader.left() < faultLength) return null
  const fault = reader.text(faultLength)
  if (fault === null || reader.left() < 1) return null
  const count = reader.u8()
  if (count > SLOTS_MOST) return null
  const slots: GameSlotView[] = []
  for (let k = 0; k < count; k++) {
    if (reader.left() < GAME_SLOT_BYTES) return null
    const slot = reader.u8()
    const bot = reader.u8()
    const member = reader.u32()
    const length = reader.u8()
    // The name, then its vehicle, its readiness and whether it is driving.
    if (reader.left() < length + 1 + 1 + 1) return null
    const name = reader.text(length)
    const vehicle = VEHICLE_PROFILE_IDS[reader.u8()]
    const ready = reader.u8()
    const driving = reader.u8()
    if (slot >= SLOTS_MOST || bot > 1 || name === null || vehicle === undefined || ready > 1 || driving > 1) return null
    slots.push({ slot, bot: bot === 1, member, name, vehicle, ready: ready === 1, driving: driving === 1 })
  }
  if (reader.left() !== 0) return null
  const options: GameOptions = { mode, seed, ...rulesOf(flags), raceLength }
  return { id, status, host, options, slots, you, drivePass, fault: fault === '' ? null : fault }
}

/** The leg of a race's course this world is, with its gates and where it leads. */
export function encodeRacePlan(plan: RacePlan): Uint8Array {
  const keep = plan.keep.slice(0, KEEP_LISTED)
  const checkpoints = plan.checkpoints.slice(0, CHECKPOINTS_LISTED)
  const worlds = plan.worlds.slice(0, COURSE_WORLDS_LISTED)
  const writer = new Writer(
    RACE_PLAN_HEADER_BYTES + keep.length * KEEP_PORTAL_BYTES + checkpoints.length * CHECKPOINT_BYTES + RACE_PLAN_TAIL_BYTES + worlds.length * COURSE_WORLD_BYTES,
  )
  writer.u8(SERVER_RACE_PLAN)
  writer.u32(plan.game >>> 0)
  writer.u8(plan.world)
  writer.u8(plan.ofWorlds)
  writer.u8(keep.length)
  for (const portal of keep) writer.u8(portal)
  writer.u8(checkpoints.length)
  for (const checkpoint of checkpoints) {
    writer.vec3(checkpoint.at)
    writer.vec3(checkpoint.forward)
    writer.u8(Math.min(Math.max(checkpoint.radius, 0), 0xff))
  }
  writer.u8(plan.next === null ? 0 : 1)
  writer.u32(plan.next?.world ?? 0)
  writer.u8(plan.next?.arrival ?? NO_ARRIVAL)
  writer.u8(plan.exit ?? NO_ARRIVAL)
  writer.u8(worlds.length)
  for (const world of worlds) writer.u32(world >>> 0)
  return writer.bytes
}

export function decodeRacePlan(payload: Uint8Array): RacePlan | null {
  if (payload.length < RACE_PLAN_HEADER_BYTES || messageTypeOf(payload) !== SERVER_RACE_PLAN) return null
  const reader = new Reader(payload)
  reader.u8()
  const game = reader.u32()
  const world = reader.u8()
  const ofWorlds = reader.u8()
  const keepCount = reader.u8()
  if (keepCount > KEEP_LISTED || reader.left() < keepCount * KEEP_PORTAL_BYTES + RACE_PLAN_TAIL_BYTES) return null
  const keep: number[] = []
  for (let k = 0; k < keepCount; k++) keep.push(reader.u8())
  const checkpointCount = reader.u8()
  if (checkpointCount > CHECKPOINTS_LISTED || reader.left() < checkpointCount * CHECKPOINT_BYTES + RACE_PLAN_TAIL_BYTES - 1) return null
  const checkpoints: CheckpointView[] = []
  for (let k = 0; k < checkpointCount; k++) {
    checkpoints.push({ at: reader.vec3(), forward: reader.vec3(), radius: reader.u8() })
  }
  const nextFlag = reader.u8()
  const nextWorld = reader.u32()
  const nextArrival = reader.u8()
  const exit = reader.u8()
  if (nextFlag > 1) return null
  const worldCount = reader.u8()
  if (worldCount > COURSE_WORLDS_LISTED || reader.left() !== worldCount * COURSE_WORLD_BYTES) return null
  const worlds: number[] = []
  for (let k = 0; k < worldCount; k++) worlds.push(reader.u32())
  return {
    game,
    world,
    ofWorlds,
    keep,
    checkpoints,
    exit: exit === NO_ARRIVAL ? null : exit,
    next: nextFlag === 0 ? null : { world: nextWorld, arrival: nextArrival },
    worlds,
  }
}

/** How the race finished: places, names, vehicles and times. */
export function encodeStandings(standings: readonly Standing[]): Uint8Array {
  const rows = standings.slice(0, 0xff).map((standing) => ({ standing, name: nameBytes(standing.name) }))
  let length = STANDINGS_HEADER_BYTES
  for (const { name } of rows) length += STANDING_BYTES + name.length
  const writer = new Writer(length)
  writer.u8(SERVER_STANDINGS)
  writer.u8(rows.length)
  for (const { standing, name } of rows) {
    writer.u8(Math.min(Math.max(standing.place, 0), 0xff))
    writer.u8(name.length)
    writer.raw(name)
    writer.u8(profileIndex(standing.vehicle))
    writer.u32(Math.min(Math.max(Math.round(standing.seconds), 0), 0xffffffff) >>> 0)
    writer.u8(standing.dnf ? 1 : 0)
    writer.u8(standing.bot ? 1 : 0)
  }
  return writer.bytes
}

export function decodeStandings(payload: Uint8Array): Standing[] | null {
  if (payload.length < STANDINGS_HEADER_BYTES || messageTypeOf(payload) !== SERVER_STANDINGS) return null
  const reader = new Reader(payload)
  reader.u8()
  const count = reader.u8()
  const standings: Standing[] = []
  for (let k = 0; k < count; k++) {
    if (reader.left() < STANDING_BYTES) return null
    const place = reader.u8()
    const length = reader.u8()
    // The name, then its vehicle, its time, whether it finished and whether a bot drove it.
    if (reader.left() < length + 1 + 4 + 1 + 1) return null
    const name = reader.text(length)
    const vehicle = VEHICLE_PROFILE_IDS[reader.u8()]
    const seconds = reader.u32()
    const dnf = reader.u8()
    const bot = reader.u8()
    if (name === null || vehicle === undefined || dnf > 1 || bot > 1) return null
    standings.push({ place, name, vehicle, seconds, dnf: dnf === 1, bot: bot === 1 })
  }
  return reader.left() === 0 ? standings : null
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
    vehicle.achievements !== 0 ||
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

function raceBytes(race: RaceView | null): number {
  if (race === null) return 0
  return SNAPSHOT_RACE_BYTES + Math.min(race.racers.length, 0xff) * SNAPSHOT_RACER_BYTES
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
    achievements: 0,
    lastAchievement: 0,
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
  writer.u8(message.race === null ? 0 : 1)
  writer.u8(message.meteors.length)
  if (message.race !== null) {
    writer.u8(message.race.world)
    writer.u8(message.race.ofWorlds)
    writer.i32(message.race.elapsed)
    writer.u8(message.race.over ? 1 : 0)
    writer.u8(Math.min(message.race.racing, 0xff))
    writer.u8(Math.min(message.race.racers.length, 0xff))
    for (const racer of message.race.racers) {
      writer.u8(racer.seat)
      writer.u8(racer.place)
      writer.u8(racer.checkpoint)
      writer.u8(racer.finished ? 1 : 0)
    }
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
    writer.u8(vehicle.achievements & 0xff)
    writer.u8(Math.min(Math.max(vehicle.lastAchievement, 0), 0xff))
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
  const hasRace = reader.u8()
  const meteorCount = reader.u8()
  if (hasRace > 1) return null
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
  let race: RaceView | null = null
  if (hasRace === 1) {
    if (reader.left() < SNAPSHOT_RACE_BYTES) return null
    const world = reader.u8()
    const ofWorlds = reader.u8()
    const elapsed = reader.i32()
    const over = reader.u8()
    const racing = reader.u8()
    const racerCount = reader.u8()
    if (over > 1 || reader.left() < racerCount * SNAPSHOT_RACER_BYTES) return null
    const racers: RaceRacerView[] = []
    for (let k = 0; k < racerCount; k++) {
      const seat = reader.u8()
      const place = reader.u8()
      const checkpoint = reader.u8()
      const finished = reader.u8()
      if (finished > 1) return null
      racers.push({ seat, place, checkpoint, finished: finished === 1 })
    }
    race = { world, ofWorlds, elapsed, over: over === 1, racing, racers }
  }
  if (payload.length - reader.offset - rest < count * SNAPSHOT_VEHICLE_CORE_BYTES) return null

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
    vehicle.achievements = reader.u8()
    vehicle.lastAchievement = reader.u8()
    if (vehicle.lastAchievement > ACHIEVEMENT_MOST) return null
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
