import {
  ACHIEVEMENTS,
  LOOSE_KINDS,
  NO_TARGET,
  UFO_STATES,
  VEHICLE_PROFILE_IDS,
  WEAPONS,
  createVehicleInput,
  type LooseKind,
  type UfoState,
  type VehicleInput,
  type VehicleProfileId,
  type Weapon,
} from '@buggies/game'
import type { Quat, Vec3 } from '@buggies/physics'

import { NO_TICK, SERVER_SNAPSHOT, UNACKNOWLEDGED_INPUT_TICK } from '../protocol.ts'
import { Reader, SPIN_STEP, VELOCITY_STEP, Writer, messageTypeOf, profileAt } from './fields.ts'

/** A snapshot up to its race, which follows when it has one, and then its vehicles. */
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
/** A vehicle with something to tell: its core and its extras. */
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

/** The `elapsed` of a race whose racers are still being seated: the cars are held still and the countdown has not started. */
export const HELD = -0x7fff

/**
 * The largest achievement id there is. Ids are kept as they always were, some
 * of them now retired, so this is not `ACHIEVEMENTS.length`.
 */
const ACHIEVEMENT_MOST = Math.max(0, ...ACHIEVEMENTS.map((achievement) => achievement.id))

/** A rocket or shot with no target, on the wire. */
const NOBODY_BYTE = 0xff

/** What a vehicle can carry, by the byte that says so: nothing first. */
const WEAPON_CODES: readonly Weapon[] = ['none', ...WEAPONS]
/** A vehicle as the server has it: where it is, how it moves, and everything it carries and has going on. */
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

/** How many bytes the race as this world sees it takes, header and racers. */
function raceBytes(race: RaceView | null): number {
  if (race === null) return 0
  return SNAPSHOT_RACE_BYTES + Math.min(race.racers.length, 0xff) * SNAPSHOT_RACER_BYTES
}

/** How many bytes the vehicles take: each as long as it has something to tell. */
function vehicleBytes(vehicles: readonly VehicleSnapshot[]): number {
  let bytes = 0
  for (let k = 0; k < vehicles.length; k++) bytes += hasExtras(vehicles[k]!) ? SNAPSHOT_VEHICLE_BYTES : SNAPSHOT_VEHICLE_CORE_BYTES
  return bytes
}

/** The weapon a byte says, or `null` if it is none of them. */
function weaponAt(code: number): Weapon | null {
  return WEAPON_CODES[code] ?? null
}

/** The kind of loose thing a byte says, or `null` if it is none of them. */
function looseAt(code: number): LooseKind | null {
  return LOOSE_KINDS[code] ?? null
}

/** The state of a saucer a byte says, or `null` if it is none of them. */
function ufoStateAt(code: number): UfoState | null {
  return UFO_STATES[code] ?? null
}

/** The target a byte says: `NO_TARGET` where it is nobody. */
function targetOf(byte: number): number {
  return byte === NOBODY_BYTE ? NO_TARGET : byte
}

/**
 * Where everything is, written to the wire. Twenty times a second for every
 * player and watcher, so the numbers are kept to their fields by plain
 * arithmetic rather than by a call: a helper per field, measured, costs a
 * fifth again as much as the clamp it wraps.
 */
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
  const race = message.race
  if (race !== null) {
    writer.u8(race.world)
    writer.u8(race.ofWorlds)
    writer.i32(race.elapsed)
    writer.u8(race.over ? 1 : 0)
    writer.u8(Math.min(race.racing, 0xff))
    writer.u8(Math.min(race.racers.length, 0xff))
    for (const racer of race.racers) {
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
    writer.u8(VEHICLE_PROFILE_IDS.indexOf(vehicle.profile))
    writer.u8((vehicle.lightsOn ? 1 : 0) | (vehicle.signalHeld ? 2 : 0) | (vehicle.npc ? 4 : 0) | (vehicle.wrecked ? 8 : 0) | (extras ? 16 : 0))
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
    writer.u8(Math.round(Math.min(Math.max(loose.power, 0), 1) * 255))
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

/** Whether the vehicle just read had anything more to tell. */
interface VehicleRead {
  extras: boolean
}

/**
 * Where a vehicle in a snapshot is, how it moves and everything it carries:
 * as much of it as every vehicle tells, which is all of it but the extras.
 * Whether the extras follow is left in `told` for the caller to read them.
 */
function decodeVehicle(reader: Reader, told: VehicleRead): VehicleSnapshot | null {
  const seat = reader.u8()
  const epoch = reader.u8()
  const profile = profileAt(reader.u8())
  if (profile === null) return null
  const flags = reader.u8()
  const position = reader.vec3()
  const rotation = reader.rotation()
  if (rotation === null) return null
  const linearVelocity = reader.steps(VELOCITY_STEP)
  const angularVelocity = reader.steps(SPIN_STEP)
  const damage = reader.u8() / 255
  const appliedInput = reader.looseInput(createVehicleInput())
  told.extras = (flags & 16) === 16
  return {
    seat,
    epoch,
    profile,
    position,
    rotation,
    linearVelocity,
    angularVelocity,
    damage,
    wrecked: (flags & 8) === 8,
    score: 0,
    collected: 0,
    kills: 0,
    robotKills: 0,
    achievements: 0,
    lastAchievement: 0,
    weapon: 'none',
    weaponHeld: 0,
    burnLeft: 0,
    npc: (flags & 4) === 4,
    rocketsFired: 0,
    stunnedTicks: 0,
    shockTicks: 0,
    magnetTicks: 0,
    plowTicks: 0,
    lightsOn: (flags & 1) === 1,
    hornTicks: 0,
    signalHeld: (flags & 2) === 2,
    appliedInput,
  }
}

/** What a vehicle has won and what it has going on: what a vehicle with anything to tell says after its core. */
function readVehicleExtras(reader: Reader, vehicle: VehicleSnapshot): boolean {
  vehicle.score = reader.u16()
  vehicle.collected = reader.u16()
  vehicle.kills = reader.u16()
  vehicle.robotKills = reader.u16()
  vehicle.achievements = reader.u8()
  vehicle.lastAchievement = reader.u8()
  if (vehicle.lastAchievement > ACHIEVEMENT_MOST) return false
  const weapon = weaponAt(reader.u8())
  if (weapon === null) return false
  vehicle.weapon = weapon
  const held = reader.u8()
  if (held > WEAPONS.length) return false
  vehicle.weaponHeld = held
  vehicle.burnLeft = reader.u8()
  vehicle.rocketsFired = reader.u16()
  vehicle.stunnedTicks = reader.u16()
  vehicle.shockTicks = reader.u8()
  vehicle.magnetTicks = reader.u16()
  vehicle.plowTicks = reader.u16()
  vehicle.hornTicks = reader.u8()
  return true
}

/** What a snapshot says, or `null` if the message is not one: cut short, too long, or claiming what it cannot hold. */
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
  const length = payload.length
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
  if (length - reader.offset() - rest < count * SNAPSHOT_VEHICLE_CORE_BYTES) return null

  const vehicles: VehicleSnapshot[] = []
  const told: VehicleRead = { extras: false }
  for (let i = 0; i < count; i++) {
    // Each vehicle is as long as what it has to tell: never past what the rest of the message needs.
    if (length - reader.offset() - rest < SNAPSHOT_VEHICLE_CORE_BYTES) return null
    const vehicle = decodeVehicle(reader, told)
    if (vehicle === null) return null
    vehicles.push(vehicle)
    if (!told.extras) continue
    if (length - reader.offset() - rest < SNAPSHOT_VEHICLE_EXTRAS_BYTES) return null
    if (!readVehicleExtras(reader, vehicle)) return null
  }
  // What is left is exactly the rest: a message longer than it says is refused, as a shorter one is.
  if (length - reader.offset() !== rest) return null
  const pickups: PickupSnapshot[] = []
  for (let i = 0; i < pickupCount; i++) {
    pickups.push({ slot: reader.u16(), generation: reader.u16(), ticksUntilOut: reader.u16() })
  }
  const loose: LooseSnapshot[] = []
  for (let i = 0; i < looseCount; i++) {
    const id = reader.u16()
    const kind = looseAt(reader.u8())
    if (kind === null) return null
    loose.push({
      id,
      kind,
      owner: targetOf(reader.u8()),
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
      target: targetOf(target),
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
      target: targetOf(target),
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
    const state = ufoStateAt(reader.u8())
    if (state === null) return null
    const target = reader.u8()
    ufos.push({
      id,
      position,
      state,
      target: targetOf(target),
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
