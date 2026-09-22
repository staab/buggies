import type { VehicleProfileId } from '@buggies/game'
import { lerp, qnlerp, quat, v3, vlength, type Quat, type Vec3 } from '@buggies/physics'

import { MS_PER_TICK } from './protocol.ts'
import type { SnapshotMessage, VehicleSnapshot } from './wire.ts'

/**
 * How far behind the newest snapshot other people's cars are drawn. Enough
 * that the next snapshot has usually arrived by the time it is needed, so
 * they move smoothly between the two rather than stepping.
 */
export const INTERPOLATION_DELAY_MS = 100

const MAX_BUFFERED_SNAPSHOTS = 32
const CLOCK_OFFSET_SMOOTHING = 0.05
const CLOCK_OFFSET_RESYNC_MS = 1000

/** Where a vehicle is drawn: a blend of the two snapshots around now. */
export interface VehicleRenderState {
  seat: number
  epoch: number
  profile: VehicleProfileId
  position: Vec3
  rotation: Quat
  linearVelocity: Vec3
  speed: number
  damage: number
  wrecked: boolean
}

interface BufferedSnapshot {
  serverTimeMs: number
  vehicles: VehicleSnapshot[]
  bySeat: Map<number, VehicleSnapshot>
}

function createRenderState(source: VehicleSnapshot): VehicleRenderState {
  return {
    seat: source.seat,
    epoch: source.epoch,
    profile: source.profile,
    position: v3(),
    rotation: quat(),
    linearVelocity: v3(),
    speed: 0,
    damage: 0,
    wrecked: false,
  }
}

function writeFrom(out: VehicleRenderState, source: VehicleSnapshot): void {
  out.profile = source.profile
  out.position.x = source.position.x
  out.position.y = source.position.y
  out.position.z = source.position.z
  out.rotation.x = source.rotation.x
  out.rotation.y = source.rotation.y
  out.rotation.z = source.rotation.z
  out.rotation.w = source.rotation.w
  out.linearVelocity.x = source.linearVelocity.x
  out.linearVelocity.y = source.linearVelocity.y
  out.linearVelocity.z = source.linearVelocity.z
  out.speed = vlength(out.linearVelocity)
  out.damage = source.damage
  out.wrecked = source.wrecked
}

function writeBlend(
  out: VehicleRenderState,
  older: VehicleSnapshot,
  newer: VehicleSnapshot,
  t: number,
): void {
  out.profile = newer.profile
  out.position.x = lerp(older.position.x, newer.position.x, t)
  out.position.y = lerp(older.position.y, newer.position.y, t)
  out.position.z = lerp(older.position.z, newer.position.z, t)
  qnlerp(out.rotation, older.rotation, newer.rotation, t)
  out.linearVelocity.x = lerp(older.linearVelocity.x, newer.linearVelocity.x, t)
  out.linearVelocity.y = lerp(older.linearVelocity.y, newer.linearVelocity.y, t)
  out.linearVelocity.z = lerp(older.linearVelocity.z, newer.linearVelocity.z, t)
  out.speed = vlength(out.linearVelocity)
  out.damage = newer.damage
  out.wrecked = newer.wrecked
}

/**
 * Snapshots as they arrive, and the server clock as they imply it. The
 * offset between local time and server tick is learned from every snapshot's
 * arrival, leaning toward the earliest arrivals since those had the least
 * delay on the way.
 */
export class SnapshotTimeline {
  private readonly buffer: BufferedSnapshot[] = []
  private readonly states = new Map<number, VehicleRenderState>()
  private readonly view: VehicleRenderState[] = []
  private clockOffsetMs: number | null = null

  push(snapshot: SnapshotMessage, receivedAtMs: number): void {
    const serverTimeMs = snapshot.tick * MS_PER_TICK
    const offsetSample = receivedAtMs - serverTimeMs

    if (
      this.clockOffsetMs === null ||
      offsetSample < this.clockOffsetMs ||
      Math.abs(offsetSample - this.clockOffsetMs) > CLOCK_OFFSET_RESYNC_MS
    ) {
      this.clockOffsetMs = offsetSample
    } else {
      this.clockOffsetMs += (offsetSample - this.clockOffsetMs) * CLOCK_OFFSET_SMOOTHING
    }

    const bySeat = new Map<number, VehicleSnapshot>()
    for (const vehicle of snapshot.vehicles) bySeat.set(vehicle.seat, vehicle)

    // Kept in server order, wherever it arrived in the queue.
    let index = this.buffer.length
    while (index > 0 && this.buffer[index - 1]!.serverTimeMs > serverTimeMs) index -= 1
    this.buffer.splice(index, 0, { serverTimeMs, vehicles: snapshot.vehicles, bySeat })
    while (this.buffer.length > MAX_BUFFERED_SNAPSHOTS) this.buffer.shift()
  }

  /** Whether any snapshot has arrived to set the clock by. */
  get hasClock(): boolean {
    return this.clockOffsetMs !== null
  }

  /** The server's tick right now, as best this side can tell. Zero until it can. */
  estimatedServerTick(nowMs: number): number {
    if (this.clockOffsetMs === null) return 0
    return Math.round((nowMs - this.clockOffsetMs) / MS_PER_TICK)
  }

  private renderServerTimeMs(nowMs: number): number {
    if (this.clockOffsetMs === null) return 0
    return nowMs - this.clockOffsetMs - INTERPOLATION_DELAY_MS
  }

  /** Every vehicle the server has told us about, where it was a moment ago. */
  sample(nowMs: number): readonly VehicleRenderState[] {
    this.view.length = 0
    if (this.buffer.length === 0) return this.view

    const renderTimeMs = this.renderServerTimeMs(nowMs)
    const oldest = this.buffer[0]!
    const newest = this.buffer[this.buffer.length - 1]!

    if (renderTimeMs >= newest.serverTimeMs) {
      this.emit(newest.vehicles)
    } else if (renderTimeMs <= oldest.serverTimeMs) {
      this.emit(oldest.vehicles)
    } else {
      let newerIndex = 1
      while (
        newerIndex < this.buffer.length - 1 &&
        this.buffer[newerIndex]!.serverTimeMs < renderTimeMs
      ) {
        newerIndex += 1
      }
      const older = this.buffer[newerIndex - 1]!
      const newer = this.buffer[newerIndex]!
      const span = newer.serverTimeMs - older.serverTimeMs
      const t = span <= 0 ? 1 : (renderTimeMs - older.serverTimeMs) / span
      // Everything older than the pair in use is done with.
      this.buffer.splice(0, newerIndex - 1)
      this.emitBlend(older, newer, t)
    }

    this.forgetAbsent()
    return this.view
  }

  private stateFor(vehicle: VehicleSnapshot): VehicleRenderState {
    const existing = this.states.get(vehicle.seat)
    if (existing !== undefined && existing.epoch === vehicle.epoch) return existing
    const created = createRenderState(vehicle)
    this.states.set(vehicle.seat, created)
    return created
  }

  private emit(vehicles: readonly VehicleSnapshot[]): void {
    for (const vehicle of vehicles) {
      const state = this.stateFor(vehicle)
      writeFrom(state, vehicle)
      this.view.push(state)
    }
  }

  private emitBlend(older: BufferedSnapshot, newer: BufferedSnapshot, t: number): void {
    for (const vehicle of newer.vehicles) {
      const state = this.stateFor(vehicle)
      const previous = older.bySeat.get(vehicle.seat)
      // A vehicle that was just put back on its spawn is drawn there, not
      // dragged across the map from wherever it sank.
      if (previous === undefined || previous.epoch !== vehicle.epoch) writeFrom(state, vehicle)
      else writeBlend(state, previous, vehicle, t)
      this.view.push(state)
    }
  }

  private forgetAbsent(): void {
    if (this.states.size <= this.view.length) return
    const live = new Set(this.view.map((state) => state.seat))
    for (const seat of [...this.states.keys()]) {
      if (!live.has(seat)) this.states.delete(seat)
    }
  }
}
