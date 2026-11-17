import {
  HOLD_FOREVER,
  NEUTRAL_INPUT,
  advance,
  copyVehicleInput,
  createVehicleInput,
  leaveSeat,
  movedBody,
  placeRobot,
  seatRobotBody,
  seatSpiderBody,
  setPickup,
  takeSeat,
  type Arena,
  type Seat,
  type VehicleInput,
} from '@buggies/game'
import { vcopy } from '@buggies/physics'

import type { BananaLedger } from './ledger.ts'
import { INPUT_TIMELINE_TICKS } from './protocol.ts'
import { HELD, type RaceView, type SnapshotMessage } from './wire.ts'

/** How many ticks a watcher's mirror will step in one frame before it is simply put where the server's clock is. */
const MAX_MIRROR_TICKS = INPUT_TIMELINE_TICKS

/**
 * What taking the server's word did to a mirror: nothing new, a replay of
 * the ticks since, or a jump to where the server has everything.
 */
export type ReconcileOutcome = 'idle' | 'replayed' | 'resynced'

/**
 * The server's word for a world taken into a mirror of its arena: where
 * every car is and what it is carrying, what lies loose and what the props
 * are doing, the robots, the saucers, the spiders, the meteors and the
 * rockets. A player's mirror takes it and replays its own car on top of it;
 * a watcher's takes it and carries every car on. Neither owes the other
 * anything, so it is done once, here.
 */
export function writeSnapshotBodies(mirror: Arena, snapshot: SnapshotMessage, bananas: BananaLedger): void {
  for (const vehicle of snapshot.vehicles) {
    const seat = mirror.seats[vehicle.seat]
    if (seat === undefined) continue
    const { body } = seat.vehicle
    body.setTranslation(vehicle.position, true)
    body.setRotation(vehicle.rotation, true)
    body.setLinvel(vehicle.linearVelocity, true)
    body.setAngvel(vehicle.angularVelocity, true)
    movedBody(seat)
    // Being moved by the server is not being hit: the car reads its knocks
    // against the velocity it has just been given.
    vcopy(seat.vehicle.lastLinearVelocity, vehicle.linearVelocity)
    seat.vehicle.damage = vehicle.damage
    seat.vehicle.wrecked = vehicle.wrecked
    seat.score = vehicle.score
    seat.npc = vehicle.npc
    seat.collected = vehicle.collected
    seat.kills = vehicle.kills
    seat.robotKills = vehicle.robotKills
    seat.achievements = vehicle.achievements
    seat.lastAchievement = vehicle.lastAchievement
    seat.weapon = vehicle.weapon
    // Which key was down, so that a replay from here tells a press from a hold as the server will.
    seat.weaponHeld = vehicle.weaponHeld
    seat.burnLeft = vehicle.burnLeft
    seat.rocketsFired = vehicle.rocketsFired
    seat.stunnedTicks = vehicle.stunnedTicks
    seat.shockTicks = vehicle.shockTicks
    seat.magnetTicks = vehicle.magnetTicks
    seat.plowTicks = vehicle.plowTicks
    seat.lightsOn = vehicle.lightsOn
    seat.hornTicks = vehicle.hornTicks
    // Whether the signal key was down, so that a replay tells a press from a hold as the server will.
    seat.signalHeld = vehicle.signalHeld
  }
  // From the ledger, not this snapshot: a prop at rest is told of once, maybe in a snapshot since overtaken.
  for (const moved of bananas.takeProps()) {
    const prop = mirror.props[moved.id]
    if (prop === undefined) continue
    prop.body.setTranslation(moved.position, true)
    prop.body.setRotation(moved.rotation, true)
    prop.body.setLinvel(moved.linearVelocity, true)
    prop.body.setAngvel(moved.angularVelocity, true)
  }
  // The robots are where the server has them, their bodies put straight there.
  for (const known of snapshot.robots) {
    const robot = mirror.robots[known.id]
    if (robot === undefined) continue
    robot.road = known.road
    robot.along = known.along
    robot.direction = known.direction
    robot.legs = known.legs
    robot.target = known.target
    robot.beamTicks = known.beamTicks
    robot.cooldownTicks = known.cooldownTicks
    robot.damage = known.damage
    robot.deaths = known.deaths
    placeRobot(mirror.planet, robot)
    seatRobotBody(robot, true)
  }
  for (const known of snapshot.ufos) {
    const ufo = mirror.ufos[known.id]
    if (ufo === undefined) continue
    vcopy(ufo.position, known.position)
    ufo.state = known.state
    ufo.target = known.target
    ufo.stateTicks = known.stateTicks
    ufo.cooldownTicks = known.cooldownTicks
    ufo.legs = known.legs
    ufo.abductions = known.abductions
    ufo.damage = known.damage
    ufo.deaths = known.deaths
    vcopy(ufo.velocity, known.velocity)
    ufo.climb = known.climb
  }
  for (const known of snapshot.spiders) {
    const spider = mirror.spiders[known.id]
    if (spider === undefined) continue
    vcopy(spider.position, known.position)
    vcopy(spider.forward, known.forward)
    spider.legs = known.legs
    vcopy(spider.target, known.target)
    spider.stride = known.stride
    spider.bombTicks = known.bombTicks
    spider.damage = known.damage
    spider.deaths = known.deaths
    seatSpiderBody(spider, true)
  }
  mirror.meteors = snapshot.meteors.map((meteor) => ({
    id: meteor.id,
    from: { ...meteor.from },
    to: { ...meteor.to },
    bornTick: snapshot.tick - meteor.age,
  }))
  mirror.rockets = snapshot.rockets.map((rocket) => ({
    id: rocket.id,
    owner: rocket.owner,
    target: rocket.target,
    position: { ...rocket.position },
    velocity: { ...rocket.velocity },
    bornTick: snapshot.tick - rocket.age,
  }))
  // The bananas are the server's word alone: whatever the mirror took or
  // spilled since is put back as the server has it, to be taken again in
  // the replay if it was right.
  const { planet } = mirror
  bananas.pickups.forEach((known, slot) => {
    const mine = mirror.pickups[slot]
    if (mine !== undefined) setPickup(planet, mine, slot, known.generation, known.spawnTick)
  })
  mirror.loose = bananas.loose.slice()
  // Numbered on from where the server is, so a replay's drops get the numbers the server's will.
  mirror.looseNext = snapshot.looseNext
}

/** Whoever the server has on the map, the mirror has too, in the same car. */
export function seatVehicles(mirror: Arena, snapshot: SnapshotMessage): void {
  for (const seat of mirror.seats) {
    const present = snapshot.vehicles.find((vehicle) => vehicle.seat === seat.id)
    if (present === undefined) {
      if (seat.occupied) leaveSeat(mirror, seat.id)
    } else if (!seat.occupied || seat.profile !== present.profile) {
      takeSeat(mirror, seat.id, present.profile)
    }
  }
}

/** The input each car was last driven with, as the server said: what a mirror carries the cars on between snapshots. */
export function rememberAppliedInputs(inputs: Map<number, VehicleInput>, snapshot: SnapshotMessage): void {
  for (const vehicle of snapshot.vehicles) {
    const known = inputs.get(vehicle.seat)
    if (known !== undefined) copyVehicleInput(known, vehicle.appliedInput)
    else inputs.set(vehicle.seat, copyVehicleInput(createVehicleInput(), vehicle.appliedInput))
  }
}

/**
 * A mirror of the server's arena with nobody of one's own in it: the cars
 * are where the server last said, and are then carried on at the input it
 * last saw their drivers give, so a watcher sees the race go rather than
 * jump from snapshot to snapshot. There is no car here to answer a key, so
 * nothing is predicted ahead of the server: its word is taken as it comes,
 * and every car replayed up to where the mirror had got to on it.
 */
export class SpectatorMirror {
  /** The mirror of the server's arena: its seats, its bananas and its machines. */
  readonly arena: Arena
  /** How the race this world is one of stands, as the server last said; `null` in a free drive. */
  race: RaceView | null = null

  private readonly bananas: BananaLedger
  private readonly appliedInputs = new Map<number, VehicleInput>()
  private appliedThroughTick = -1

  /** `tick` is the tick to start the mirror on, a lead ahead of the server's clock. */
  constructor(arena: Arena, tick: number, bananas: BananaLedger) {
    this.arena = arena
    arena.mirror = true
    arena.tick = tick
    this.bananas = bananas
  }

  /** The tick the mirror is about to simulate. */
  tick(): number {
    return this.arena.tick
  }

  /**
   * Take the server's newest word, if it is newer than the last taken in,
   * and run the mirror back up to where it was on it, the cars carried on
   * at the input the server last saw. The run is bounded, so that a wild
   * clock or a stall cannot hold up a frame.
   */
  take(snapshot: SnapshotMessage | null): ReconcileOutcome {
    if (snapshot === null || snapshot.tick <= this.appliedThroughTick) return 'idle'
    this.appliedThroughTick = snapshot.tick
    seatVehicles(this.arena, snapshot)
    rememberAppliedInputs(this.appliedInputs, snapshot)
    writeSnapshotBodies(this.arena, snapshot, this.bananas)
    this.race = snapshot.race
    const through = Math.max(this.arena.tick, snapshot.tick)
    this.arena.tick = snapshot.tick
    // Too far behind to walk to in one frame: the mirror is left where the
    // server's word has it, and the next snapshot starts it over properly.
    if (through - snapshot.tick > MAX_MIRROR_TICKS) this.arena.tick = through
    else while (this.arena.tick < through) this.step()
    return 'resynced'
  }

  /**
   * Once per local fixed step: run the mirror the ticks a frame steps to, as
   * the client's clock asks for them, the cars held by a countdown as the
   * server holds them. Nothing is sent for them, and nothing is sent back.
   */
  run(stepsFor: (nextTick: number) => number): void {
    const steps = stepsFor(this.arena.tick)
    if (steps < 0 || steps > MAX_MIRROR_TICKS) {
      // After a stall, or after the server's clock has gone back: too far to
      // simulate in one frame, so the mirror is moved to it and carries on.
      this.arena.tick += steps
      return
    }
    for (let step = 0; step < steps; step++) this.step()
  }

  dispose(): void {
    this.arena.world.free()
  }

  private step(): void {
    this.holdCars()
    advance(this.arena, this.inputFor)
  }

  /** A race holds the cars it has not let go of yet: while it seats them, and through the 3-2-1 after it. */
  private holdCars(): void {
    const race = this.race
    if (race === null || race.elapsed > 0) this.arena.holdUntil = 0
    else this.arena.holdUntil = race.elapsed === HELD ? HOLD_FOREVER : this.arena.tick - race.elapsed
  }

  private readonly inputFor = (seat: Seat): VehicleInput => this.appliedInputs.get(seat.id) ?? NEUTRAL_INPUT
}
