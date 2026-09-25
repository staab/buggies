import { createVehicleInput, occupiedSeats, type Arena, type Seat, type VehicleInput } from '@buggies/game'
import { quat, v3, vcopy } from '@buggies/physics'

import type { LooseSnapshot, PickupSnapshot, PropSnapshot, RocketSnapshot, SnapshotMessage, VehicleSnapshot } from './wire.ts'

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
      weapon: 'none',
      ammoTicks: 0,
      actionTicks: 0,
      cooldownTicks: 0,
      lightsOn: false,
      stunnedTicks: 0,
      slowedTicks: 0,
      slowedBy: 0,
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
    vehicle.weapon = seat.weapon
    vehicle.ammoTicks = seat.ammoTicks
    vehicle.actionTicks = seat.actionTicks
    vehicle.cooldownTicks = seat.cooldownTicks
    vehicle.lightsOn = seat.lightsOn
    vehicle.stunnedTicks = seat.stunnedTicks
    vehicle.slowedTicks = seat.slowedTicks
    vehicle.slowedBy = seat.slowedBy
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
    const entry = (loose[count] ??= { id: 0, kind: 'banana', from: v3(), position: v3(), age: 0 })
    entry.id = thing.id
    entry.kind = thing.kind
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
/** The props on the move, or every prop when the whole is asked for: a newcomer has them where the map stands them, not where they have been knocked to. */
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
    const entry = (rockets[count] ??= { id: 0, owner: 0, target: 0, position: v3(), velocity: v3(), age: 0 })
    entry.id = rocket.id
    entry.owner = rocket.owner
    entry.target = rocket.target
    vcopy(entry.position, rocket.position)
    vcopy(entry.velocity, rocket.velocity)
    entry.age = arena.tick - rocket.bornTick
    count += 1
  }
  rockets.length = count
  return rockets
}
