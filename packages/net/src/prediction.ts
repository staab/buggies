import {
  NEUTRAL_INPUT,
  advance,
  copyVehicleInput,
  createVehicleInput,
  createVehicleStepState,
  leaveSeat,
  readVehicleStepState,
  setPickup,
  takeSeat,
  writeVehicleStepState,
  type Arena,
  type Pickup,
  type Spilled,
  type Seat,
  type Vehicle,
  type VehicleInput,
  type VehicleStepState,
  type VehicleTuning,
} from '@buggies/game'
import { quat, v3, vcopy, vlength, vsub, type Quat, type Vec3 } from '@buggies/physics'

import { INPUT_TIMELINE_TICKS } from './protocol.ts'
import type { SnapshotMessage } from './wire.ts'

/** The most ticks a correction will be replayed over before giving up and snapping. */
export const MAX_REPLAY_TICKS = INPUT_TIMELINE_TICKS

const HISTORY_TICKS = MAX_REPLAY_TICKS * 2
const NO_TICK_RECORDED = -1

interface PredictionFrame {
  tick: number
  input: VehicleInput
  step: VehicleStepState
  translation: Vec3
  rotation: Quat
}

/**
 * What the local car was doing on each recent tick, so that when the server
 * says where it really was on one of them the ticks since can be run again
 * from there with the same inputs.
 */
class PredictionHistory {
  private readonly frames: PredictionFrame[] = []

  constructor() {
    for (let i = 0; i < HISTORY_TICKS; i++) {
      this.frames.push({
        tick: NO_TICK_RECORDED,
        input: createVehicleInput(),
        step: createVehicleStepState(),
        translation: v3(),
        rotation: quat(),
      })
    }
  }

  recordState(tick: number, vehicle: Vehicle): void {
    const frame = this.slotFor(tick)
    frame.tick = tick
    readVehicleStepState(frame.step, vehicle)
    vehicle.body.translation(frame.translation)
    vehicle.body.rotation(frame.rotation)
  }

  recordStep(tick: number, vehicle: Vehicle, input: VehicleInput): void {
    this.recordState(tick, vehicle)
    copyVehicleInput(this.slotFor(tick).input, input)
  }

  frameAt(tick: number): PredictionFrame | null {
    const frame = this.slotFor(tick)
    return frame.tick === tick ? frame : null
  }

  forget(): void {
    for (const frame of this.frames) frame.tick = NO_TICK_RECORDED
  }

  private slotFor(tick: number): PredictionFrame {
    return this.frames[tick % HISTORY_TICKS]!
  }
}

export type ReconcileOutcome = 'idle' | 'replayed' | 'resynced'

export interface PredictionStats {
  replayHorizonTicks: number
  lastCorrectionMetres: number
  lastCorrectionRadians: number
  ticksAheadOfServer: number
  hardResyncs: number
  /** How many ticks the last advance ran: one as a rule. */
  lastSteps: number
}

/** What one pump of the client produced, for the prediction to act on. */
export interface PredictionUpdate {
  estimatedServerTick: number
  /**
   * How many ticks to run once the snapshot has been taken in, given the
   * tick the mirror is then about to simulate: one as a rule, none or two
   * to hold the lead, many after a stall.
   */
  stepsFor: (nextTick: number) => number
  input: VehicleInput
  newestSnapshot: SnapshotMessage | null
}

/** Where the input a tick is simulated with goes: to the server, stamped with that tick. */
export type SendInput = (tick: number, input: VehicleInput) => void

function angleBetween(a: Quat, b: Quat): number {
  const alignment = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
  return 2 * Math.acos(Math.min(1, alignment))
}

/**
 * The local car, driven the moment a key is pressed rather than a round trip
 * later. It runs in a mirror of the server's arena: the same map, every seat,
 * with other people's cars carried along at their last known input so that
 * bumping into them is predicted too. When a snapshot disagrees with what was
 * predicted, the car is put where the server says it was and the ticks since
 * are replayed from there.
 */
export class LocalPrediction {
  readonly stats: PredictionStats = {
    replayHorizonTicks: 0,
    lastCorrectionMetres: 0,
    lastCorrectionRadians: 0,
    ticksAheadOfServer: 0,
    hardResyncs: 0,
    lastSteps: 1,
  }

  private readonly mirror: Arena
  private readonly seat: Seat
  private readonly history = new PredictionHistory()
  private readonly appliedInputs = new Map<number, VehicleInput>()
  private readonly lastSentInput = createVehicleInput()
  private readonly stepInput = createVehicleInput()
  private readonly displacement = v3()

  private epoch: number
  private reconciledThroughTick: number
  private newestSnapshot: SnapshotMessage | null = null

  constructor(mirror: Arena, seat: number, epoch: number, tick: number) {
    this.mirror = mirror
    this.seat = mirror.seats[seat]!
    this.epoch = epoch
    mirror.tick = tick
    this.reconciledThroughTick = tick
    this.history.recordState(tick, this.seat.vehicle)
  }

  get vehicle(): Vehicle {
    return this.seat.vehicle
  }

  /**
   * Every seat of the mirror, other players' included: their cars are the
   * bodies the local car is driven against, run ahead from the last
   * snapshot on the inputs the server last saw them give.
   */
  get seats(): readonly Seat[] {
    return this.mirror.seats
  }

  get tuning(): VehicleTuning {
    return this.seat.tuning
  }

  /** The map's bananas and bombs as the mirror has them: the server's word, run ahead. */
  get pickups(): readonly Pickup[] {
    return this.mirror.pickups
  }

  /** Bananas spilled from wrecks, as the mirror has them. */
  get spilled(): readonly Spilled[] {
    return this.mirror.spilled
  }

  /** Bananas taken, as predicted; the server's count catches up with it. */
  get score(): number {
    return this.seat.score
  }

  get submersion(): number {
    return this.seat.submersion
  }

  /** Bring the mirror into line with the newest snapshot, if there is a new one. */
  reconcile(snapshot: SnapshotMessage | null): ReconcileOutcome {
    if (snapshot === null || snapshot.tick <= this.reconciledThroughTick) return 'idle'
    this.reconciledThroughTick = snapshot.tick
    this.newestSnapshot = snapshot

    const own = snapshot.vehicles.find((vehicle) => vehicle.seat === this.seat.id)
    if (own === undefined) return 'idle'

    this.seatVehicles(snapshot)
    this.rememberAppliedInputs(snapshot)

    const predictedThroughTick = this.mirror.tick
    const horizon = predictedThroughTick - snapshot.tick
    const predicted = this.history.frameAt(snapshot.tick)
    const fresh = own.epoch !== this.epoch
    this.epoch = own.epoch

    // Nothing to replay from: a respawn, a snapshot from before anything was
    // predicted, or one so old the history has moved on. Start over from it.
    if (predicted === null || fresh || horizon < 0 || horizon > MAX_REPLAY_TICKS) {
      this.restartFrom(snapshot, predictedThroughTick, fresh)
      return 'resynced'
    }

    this.stats.replayHorizonTicks = horizon
    this.stats.lastCorrectionMetres = vlength(vsub(this.displacement, predicted.translation, own.position))
    this.stats.lastCorrectionRadians = angleBetween(predicted.rotation, own.rotation)

    this.writeSnapshotBodies(snapshot)
    writeVehicleStepState(this.seat.vehicle, predicted.step)
    // How beaten up the car is, and whether it is a wreck, is the server's
    // word, not the prediction's: a wreck predicted that the server never
    // saw would otherwise never be driven again.
    this.seat.vehicle.damage = own.damage
    this.seat.vehicle.wrecked = own.wrecked
    this.mirror.tick = snapshot.tick
    while (this.mirror.tick < predictedThroughTick) {
      const recorded = this.history.frameAt(this.mirror.tick)
      this.recordAndStep(recorded?.input ?? this.lastSentInput)
    }
    return 'replayed'
  }

  /** The tick the mirror is about to simulate. */
  get tick(): number {
    return this.mirror.tick
  }

  /**
   * Run the mirror on, the steps the client asks for from where the
   * snapshot has left it, sending the input each tick is simulated with as
   * it goes.
   */
  advance(update: PredictionUpdate, send: SendInput): void {
    const steps = update.stepsFor(this.mirror.tick)
    const target = this.mirror.tick + steps
    if (steps > MAX_REPLAY_TICKS) {
      this.jumpTo(target)
    } else {
      while (this.mirror.tick < target) {
        send(this.mirror.tick, update.input)
        this.recordAndStep(update.input)
      }
      copyVehicleInput(this.lastSentInput, update.input)
    }
    this.stats.lastSteps = steps
    this.history.recordState(this.mirror.tick, this.seat.vehicle)
    this.stats.ticksAheadOfServer = this.mirror.tick - update.estimatedServerTick
  }

  dispose(): void {
    this.mirror.world.free()
  }

  private recordAndStep(input: VehicleInput): void {
    this.history.recordStep(this.mirror.tick, this.seat.vehicle, input)
    copyVehicleInput(this.stepInput, input)
    advance(this.mirror, this.inputFor)
  }

  private readonly inputFor = (seat: Seat): VehicleInput => {
    if (seat === this.seat) return this.stepInput
    return this.appliedInputs.get(seat.id) ?? NEUTRAL_INPUT
  }

  /**
   * Take the server's word for where everything is and run the local car
   * back up to where it was, on the input it was last given: the ticks in
   * between were never recorded, so this is a fresh start rather than a
   * replay. The run is bounded so that a wild clock cannot stall a frame.
   */
  private restartFrom(snapshot: SnapshotMessage, throughTick: number, fresh: boolean): void {
    this.writeSnapshotBodies(snapshot)
    // A car the server has just put back has had its steering and timers
    // reset too, not only its pose.
    if (fresh) writeVehicleStepState(this.seat.vehicle, createVehicleStepState())
    const from = Math.max(snapshot.tick, throughTick - MAX_REPLAY_TICKS)
    this.mirror.tick = from
    this.history.forget()
    this.history.recordState(from, this.seat.vehicle)
    while (this.mirror.tick < throughTick) this.recordAndStep(this.lastSentInput)
    this.stats.replayHorizonTicks = throughTick - from
    this.stats.hardResyncs += 1
  }

  /**
   * After a long stall the mirror is too far behind to simulate its way
   * forward in one frame; it is moved to the newest snapshot and carries on
   * from there, and the next snapshot starts it over properly.
   */
  private jumpTo(tick: number): void {
    if (this.newestSnapshot !== null) this.writeSnapshotBodies(this.newestSnapshot)
    this.mirror.tick = tick
    this.history.forget()
    this.history.recordState(tick, this.seat.vehicle)
    this.stats.replayHorizonTicks = 0
    this.stats.hardResyncs += 1
  }

  private writeSnapshotBodies(snapshot: SnapshotMessage): void {
    for (const vehicle of snapshot.vehicles) {
      const seat = this.mirror.seats[vehicle.seat]
      if (seat === undefined) continue
      const { body } = seat.vehicle
      body.setTranslation(vehicle.position, true)
      body.setRotation(vehicle.rotation, true)
      body.setLinvel(vehicle.linearVelocity, true)
      body.setAngvel(vehicle.angularVelocity, true)
      // Being moved by the server is not being hit: the car reads its knocks
      // against the velocity it has just been given.
      vcopy(seat.vehicle.lastLinearVelocity, vehicle.linearVelocity)
      seat.vehicle.damage = vehicle.damage
      seat.vehicle.wrecked = vehicle.wrecked
      seat.score = vehicle.score
    }
    const { map, water } = this.mirror
    for (const [slot, pickup] of snapshot.pickups.entries()) {
      const mine = this.mirror.pickups[slot]
      if (mine !== undefined) setPickup(map, water, mine, slot, pickup.generation, snapshot.tick + pickup.ticksUntilOut)
    }
    this.mirror.spilled = snapshot.spilled.map((spilled) => ({
      from: { ...spilled.from },
      position: { ...spilled.position },
      bornTick: snapshot.tick - spilled.age,
    }))
  }

  /** Whoever the server has on the map, the mirror has too, in the same car. */
  private seatVehicles(snapshot: SnapshotMessage): void {
    for (const seat of this.mirror.seats) {
      const present = snapshot.vehicles.find((vehicle) => vehicle.seat === seat.id)
      if (present === undefined) {
        if (seat.occupied) leaveSeat(this.mirror, seat.id)
      } else if (!seat.occupied || seat.profile !== present.profile) {
        takeSeat(this.mirror, seat.id, present.profile)
      }
    }
  }

  private rememberAppliedInputs(snapshot: SnapshotMessage): void {
    for (const vehicle of snapshot.vehicles) {
      if (vehicle.seat === this.seat.id) continue
      const known = this.appliedInputs.get(vehicle.seat)
      if (known !== undefined) copyVehicleInput(known, vehicle.appliedInput)
      else this.appliedInputs.set(vehicle.seat, copyVehicleInput(createVehicleInput(), vehicle.appliedInput))
    }
  }
}
