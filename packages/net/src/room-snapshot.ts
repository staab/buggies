import { NO_TARGET, createVehicleInput, occupiedSeats, type Arena, type Seat, type VehicleInput } from '@buggies/game'
import { quat, v3, vcopy } from '@buggies/physics'

import type { LooseSnapshot, PickupSnapshot, PropSnapshot, RobotSnapshot, RocketSnapshot, SnapshotMessage, SpiderSnapshot, UfoSnapshot, VehicleSnapshot } from './wire.ts'

/**
 * What a room's snapshots are gathered into, kept from one to the next so
 * nothing is made mid-race, and what the last one told of the bananas, so
 * the next can tell only what differs.
 */
export interface RoomSnapshots {
  readonly vehicles: VehicleSnapshot[]
  readonly pickups: PickupSnapshot[]
  readonly loose: LooseSnapshot[]
  readonly removed: number[]
  readonly rockets: RocketSnapshot[]
  readonly robots: RobotSnapshot[]
  readonly ufos: UfoSnapshot[]
  readonly spiders: SpiderSnapshot[]
  readonly props: PropSnapshot[]
  /** Each slot's generation as last told, and which loose things were out. */
  readonly toldGenerations: number[]
  readonly toldLoose: Set<number>
  readonly looseNow: Set<number>
}

export function createRoomSnapshots(): RoomSnapshots {
  return {
    vehicles: [],
    pickups: [],
    loose: [],
    removed: [],
    rockets: [],
    robots: [],
    ufos: [],
    spiders: [],
    props: [],
    toldGenerations: [],
    toldLoose: new Set(),
    looseNow: new Set(),
  }
}

/**
 * Where everything in an arena is, for the wire. The vehicles and rockets
 * go every time; of the bananas, the whole word or only what changed since
 * the last snapshot told of them, as asked. The message points into the
 * room's scratch, so it is to be encoded before the next is gathered.
 */
export function gatherSnapshot(
  arena: Arena,
  out: RoomSnapshots,
  appliedInputOf: (seat: Seat) => VehicleInput,
  whole: boolean,
): SnapshotMessage {
  if (whole) out.removed.length = 0
  else gatherRemoved(arena, out)
  return {
    tick: arena.tick,
    ackInputTick: -1,
    full: whole,
    looseNext: arena.looseNext,
    vehicles: gatherVehicles(arena, out, appliedInputOf),
    pickups: gatherPickups(arena, out, whole),
    loose: gatherLoose(arena, out, whole),
    removed: out.removed,
    rockets: gatherRockets(arena, out),
    props: gatherProps(arena, out, whole),
    robots: gatherRobots(arena, out),
    ufos: gatherUfos(arena, out),
    spiders: gatherSpiders(arena, out),
  }
}

/** What this snapshot told of the bananas, for the next to tell only what differs. */
export function rememberTold(arena: Arena, out: RoomSnapshots): void {
  arena.pickups.forEach((pickup, slot) => (out.toldGenerations[slot] = pickup.generation))
  out.toldLoose.clear()
  for (const loose of arena.loose) out.toldLoose.add(loose.id)
}

function gatherVehicles(
  arena: Arena,
  out: RoomSnapshots,
  appliedInputOf: (seat: Seat) => VehicleInput,
): VehicleSnapshot[] {
  const { vehicles } = out
  let count = 0
  for (const seat of occupiedSeats(arena)) {
    const { body } = seat.vehicle
    const vehicle = (vehicles[count] ??= {
      seat: 0,
      epoch: 0,
      profile: seat.profile,
      position: v3(),
      rotation: quat(),
      linearVelocity: v3(),
      angularVelocity: v3(),
      damage: 0,
      wrecked: false,
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
      lightsOn: false,
      abilityHeld: false,
      npc: false,
      rocketsFired: 0,
      stunnedTicks: 0,
      slowedTicks: 0,
      slowedBy: 0,
      shieldTicks: 0,
      magnetTicks: 0,
      plowTicks: 0,
      slipTicks: 0,
      grappleTicks: 0,
      grappleTarget: NO_TARGET,
      appliedInput: createVehicleInput(),
    })
    vehicle.seat = seat.id
    vehicle.epoch = seat.epoch
    vehicle.profile = seat.profile
    body.translation(vehicle.position)
    body.rotation(vehicle.rotation)
    body.linvel(vehicle.linearVelocity)
    body.angvel(vehicle.angularVelocity)
    vehicle.damage = seat.vehicle.damage
    vehicle.wrecked = seat.vehicle.wrecked
    vehicle.score = seat.score
    vehicle.npc = seat.npc
    vehicle.collected = seat.collected
    vehicle.kills = seat.kills
    vehicle.robotKills = seat.robotKills
    vehicle.goal = seat.goal
    vehicle.goalsWon = seat.goalsWon
    vehicle.weapon = seat.weapon
    vehicle.wins = seat.wins
    vehicle.ammoTicks = seat.ammoTicks
    vehicle.actionTicks = seat.actionTicks
    vehicle.cooldownTicks = seat.cooldownTicks
    vehicle.lightsOn = seat.lightsOn
    vehicle.abilityHeld = seat.abilityHeld
    vehicle.rocketsFired = seat.rocketsFired
    vehicle.stunnedTicks = seat.stunnedTicks
    vehicle.slowedTicks = seat.slowedTicks
    vehicle.slowedBy = seat.slowedBy
    vehicle.shieldTicks = seat.shieldTicks
    vehicle.magnetTicks = seat.magnetTicks
    vehicle.plowTicks = seat.plowTicks
    vehicle.slipTicks = seat.slipTicks
    vehicle.grappleTicks = seat.grappleTicks
    vehicle.grappleTarget = seat.grappleTarget
    Object.assign(vehicle.appliedInput, appliedInputOf(seat))
    count += 1
  }
  vehicles.length = count
  return vehicles
}

/** The slots whose banana has moved on since the last snapshot told of them, or every slot. */
function gatherPickups(arena: Arena, out: RoomSnapshots, all: boolean): PickupSnapshot[] {
  const { pickups } = out
  let count = 0
  arena.pickups.forEach((pickup, slot) => {
    if (!all && pickup.generation === out.toldGenerations[slot]) return
    const entry = (pickups[count] ??= { slot: 0, generation: 0, ticksUntilOut: 0 })
    entry.slot = slot
    entry.generation = pickup.generation
    entry.ticksUntilOut = Math.max(pickup.spawnTick - arena.tick, 0)
    count += 1
  })
  pickups.length = count
  return pickups
}

/** The loose things come since the last snapshot told of them, or every one out. */
function gatherLoose(arena: Arena, out: RoomSnapshots, all: boolean): LooseSnapshot[] {
  const { loose } = out
  let count = 0
  for (const thing of arena.loose) {
    if (!all && out.toldLoose.has(thing.id)) continue
    const entry = (loose[count] ??= { id: 0, kind: 'banana', owner: 0, power: 0, from: v3(), position: v3(), age: 0 })
    entry.id = thing.id
    entry.kind = thing.kind
    entry.owner = thing.owner
    entry.power = thing.power
    vcopy(entry.from, thing.from)
    vcopy(entry.position, thing.position)
    entry.age = arena.tick - thing.bornTick
    count += 1
  }
  loose.length = count
  return loose
}

/** The loose things the last snapshot told of that are gone since, taken, set off or faded. */
function gatherRemoved(arena: Arena, out: RoomSnapshots): number[] {
  const { removed, looseNow, toldLoose } = out
  removed.length = 0
  looseNow.clear()
  for (const thing of arena.loose) looseNow.add(thing.id)
  for (const id of toldLoose) if (!looseNow.has(id)) removed.push(id)
  return removed
}

/** Every rocket in the air: few, and short-lived, so all of them every time. */
/** The props on the move, or every prop when the whole is asked for, since a newcomer's copy starts with them where the map stands them. */
function gatherProps(arena: Arena, out: RoomSnapshots, all: boolean): PropSnapshot[] {
  const { props } = out
  let count = 0
  for (const prop of arena.props) {
    if (!all && prop.body.isSleeping()) continue
    if (count >= 0xff) break
    const entry = (props[count] ??= { id: 0, position: v3(), rotation: quat(), linearVelocity: v3(), angularVelocity: v3() })
    entry.id = prop.id
    prop.body.translation(entry.position)
    prop.body.rotation(entry.rotation)
    prop.body.linvel(entry.linearVelocity)
    prop.body.angvel(entry.angularVelocity)
    count += 1
  }
  props.length = count
  return props
}

function gatherRockets(arena: Arena, out: RoomSnapshots): RocketSnapshot[] {
  const { rockets } = out
  let count = 0
  for (const rocket of arena.rockets) {
    const entry = (rockets[count] ??= { id: 0, owner: 0, target: 0, position: v3(), velocity: v3(), age: 0, power: 1 })
    entry.id = rocket.id
    entry.owner = rocket.owner
    entry.target = rocket.target
    entry.power = rocket.power
    vcopy(entry.position, rocket.position)
    vcopy(entry.velocity, rocket.velocity)
    entry.age = arena.tick - rocket.bornTick
    count += 1
  }
  rockets.length = count
  return rockets
}

/** Every robot, where it is on its rounds and what its eyes are on. */
function gatherRobots(arena: Arena, out: RoomSnapshots): RobotSnapshot[] {
  const { robots } = out
  arena.robots.forEach((robot, index) => {
    const entry = (robots[index] ??= {
      id: 0,
      road: 0,
      along: 0,
      direction: 1,
      legs: 0,
      target: NO_TARGET,
      beamTicks: 0,
      cooldownTicks: 0,
      damage: 0,
      deaths: 0,
    })
    entry.id = robot.id
    entry.road = robot.road
    entry.along = robot.along
    entry.direction = robot.direction
    entry.legs = robot.legs
    entry.target = robot.target
    entry.beamTicks = robot.beamTicks
    entry.cooldownTicks = robot.cooldownTicks
    entry.damage = robot.damage
    entry.deaths = robot.deaths
  })
  robots.length = arena.robots.length
  return robots
}

/** Every saucer, where it is and what it is about. */
function gatherUfos(arena: Arena, out: RoomSnapshots): UfoSnapshot[] {
  const { ufos } = out
  arena.ufos.forEach((ufo, index) => {
    const entry = (ufos[index] ??= {
      id: 0,
      position: v3(),
      state: 'roam',
      target: NO_TARGET,
      stateTicks: 0,
      cooldownTicks: 0,
      legs: 0,
      abductions: 0,
      damage: 0,
      deaths: 0,
    })
    entry.id = ufo.id
    vcopy(entry.position, ufo.position)
    entry.state = ufo.state
    entry.target = ufo.target
    entry.stateTicks = ufo.stateTicks
    entry.cooldownTicks = ufo.cooldownTicks
    entry.legs = ufo.legs
    entry.abductions = ufo.abductions
    entry.damage = ufo.damage
    entry.deaths = ufo.deaths
  })
  ufos.length = arena.ufos.length
  return ufos
}

/** Every spider, where it is and how far on its walk. */
function gatherSpiders(arena: Arena, out: RoomSnapshots): SpiderSnapshot[] {
  const { spiders } = out
  arena.spiders.forEach((spider, index) => {
    const entry = (spiders[index] ??= { id: 0, position: v3(), forward: v3(), legs: 0, target: v3(), stride: 0, bombTicks: 0, damage: 0, deaths: 0 })
    entry.id = spider.id
    vcopy(entry.position, spider.position)
    vcopy(entry.forward, spider.forward)
    entry.legs = spider.legs
    vcopy(entry.target, spider.target)
    entry.stride = spider.stride
    entry.bombTicks = spider.bombTicks
    entry.damage = spider.damage
    entry.deaths = spider.deaths
  })
  spiders.length = arena.spiders.length
  return spiders
}
