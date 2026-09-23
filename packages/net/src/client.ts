import type { VehicleInput, VehicleProfileId } from '@buggies/game'

import type { PredictionUpdate } from './prediction.ts'
import {
  INPUT_TIMELINE_TICKS,
  SERVER_REJECT,
  SERVER_SNAPSHOT,
  SERVER_WELCOME,
  UNACKNOWLEDGED_INPUT_TICK,
  rejectLabel,
} from './protocol.ts'
import { SnapshotTimeline, type VehicleRenderState } from './snapshot-timeline.ts'
import type { ClientTransport } from './transport.ts'
import {
  decodeReject,
  decodeSnapshot,
  decodeWelcome,
  encodeHello,
  encodeInput,
  encodeRespawn,
  messageTypeOf,
  type SnapshotMessage,
  type WelcomeMessage,
} from './wire.ts'

/**
 * How far ahead of the server's clock inputs are sent for, so they are there
 * waiting when the server reaches that tick rather than arriving after it.
 * The clock estimate lags by the one-way trip and the inputs take another,
 * so the lead has to cover a round trip; it starts here and learns the rest.
 */
const INITIAL_LEAD_TICKS = 4
const MIN_LEAD_TICKS = 2
const MAX_LEAD_TICKS = INPUT_TIMELINE_TICKS / 2

/**
 * How many ticks early an input should arrive: enough that jitter does not
 * make it late, not so many that the car answers later than it need to.
 */
const MIN_SLACK_TICKS = 1
const MAX_SLACK_TICKS = 4

/** Lead comes down slowly, so a good moment does not undo a bad second. */
const LEAD_RELAX_INTERVAL_MS = 1000

/**
 * The mirror steps once per local fixed step, whatever the server's clock is
 * doing: that is what keeps the car smooth. Only when it has drifted further
 * than this from the lead it should hold over the server's clock is it
 * nudged, a tick at a time. Behind, where inputs would arrive late, it
 * catches up a tick every step; ahead, which costs nothing but a little
 * lag, it gives a tick back no more often than this. Further behind than
 * `STALL_TICKS` it is not nudged but jumped, since that is a stall.
 */
const SLEW_SLACK_TICKS = 2
const SLEW_BACK_INTERVAL_MS = 250
const STALL_TICKS = INPUT_TIMELINE_TICKS / 2

export interface NetClientEvents {
  onClosed(reason: string): void
}

export class ConnectionFailure extends Error {}

/**
 * One player's side of the protocol: the handshake, a stream of inputs out,
 * a stream of snapshots in, and the clock offset that ties them together.
 */
export class NetClient {
  readonly timeline = new SnapshotTimeline()

  private readonly transport: ClientTransport
  private readonly clock: () => number
  private readonly events: Partial<NetClientEvents>

  private welcomeMessage: WelcomeMessage | null = null
  private newestSnapshot: SnapshotMessage | null = null
  private settleWelcome: { resolve(welcome: WelcomeMessage): void; reject(error: Error): void } | null = null
  private lastSentTick = -1
  private lead = INITIAL_LEAD_TICKS
  private leadRelaxedAtMs = 0
  private slewedAtMs = 0
  private closedReason: string | null = null
  private ackTick = UNACKNOWLEDGED_INPUT_TICK

  constructor(transport: ClientTransport, clock: () => number, events: Partial<NetClientEvents> = {}) {
    this.transport = transport
    this.clock = clock
    this.events = events
  }

  get welcome(): WelcomeMessage | null {
    return this.welcomeMessage
  }

  get closed(): string | null {
    return this.closedReason
  }

  get acknowledgedInputTick(): number {
    return this.ackTick
  }

  /** How many ticks ahead of the server's clock inputs are being sent for. */
  get leadTicks(): number {
    return this.lead
  }

  /** How many vehicles the server last said were on the map. */
  get playerCount(): number {
    return this.newestSnapshot?.vehicles.length ?? 0
  }

  /** Join the room for a seed, in a vehicle. */
  async connect(profile: VehicleProfileId, seed: number): Promise<WelcomeMessage> {
    try {
      await this.transport.connect({
        onMessage: (payload) => this.receive(payload),
        onClose: (reason) => this.handleClose(reason),
      })
      const welcome = new Promise<WelcomeMessage>((resolve, reject) => {
        this.settleWelcome = { resolve, reject }
      })
      this.transport.send(encodeHello(profile, seed))
      return await welcome
    } catch (error) {
      throw new ConnectionFailure(error instanceof Error ? error.message : String(error))
    }
  }

  /** The tick the mirror should start on: the lead ahead of the server's clock at the welcome. */
  get startTick(): number {
    return (this.welcomeMessage?.tick ?? 0) + this.lead
  }

  /** Once per local fixed step: the newest word from the server, and the input to run on. */
  pump(input: VehicleInput): PredictionUpdate {
    return {
      estimatedServerTick: this.timeline.estimatedServerTick(this.clock()),
      stepsFor: (nextTick) => this.stepsFor(nextTick),
      input,
      newestSnapshot: this.newestSnapshot,
    }
  }

  /**
   * How many ticks the prediction should run this step, given that its
   * mirror is about to simulate `nextTick`: one, nearly always; none or two
   * now and then, to hold the lead over the server's clock; many after a
   * stall. Asked once the snapshot has been taken in, since that can move
   * the mirror.
   */
  stepsFor(nextTick: number): number {
    if (!this.timeline.hasClock) return 1
    const nowMs = this.clock()
    const behind = this.timeline.estimatedServerTick(nowMs) + this.lead - nextTick
    if (behind > STALL_TICKS) return behind
    if (behind > SLEW_SLACK_TICKS) return 2
    if (behind < -SLEW_SLACK_TICKS && nowMs - this.slewedAtMs >= SLEW_BACK_INTERVAL_MS) {
      this.slewedAtMs = nowMs
      return 0
    }
    return 1
  }

  /** Send the input the mirror is simulating a tick with, stamped with that tick. */
  sendInput(tick: number, input: VehicleInput): void {
    if (this.welcomeMessage === null || this.closedReason !== null) return
    if (tick <= this.lastSentTick) return
    this.lastSentTick = tick
    this.transport.send(encodeInput(tick, input))
  }

  requestRespawn(): void {
    if (this.welcomeMessage === null || this.closedReason !== null) return
    this.transport.send(encodeRespawn())
  }

  /** Everyone else, where they were a moment ago. */
  sample(): readonly VehicleRenderState[] {
    return this.timeline.sample(this.clock())
  }

  close(reason: string): void {
    this.transport.close(reason)
  }

  private receive(payload: Uint8Array): void {
    const type = messageTypeOf(payload)

    if (type === SERVER_WELCOME) {
      const welcome = decodeWelcome(payload)
      if (welcome === null) {
        this.settleWelcome?.reject(new Error('malformed welcome'))
        return
      }
      this.welcomeMessage = welcome
      this.settleWelcome?.resolve(welcome)
      this.settleWelcome = null
      return
    }

    if (type === SERVER_REJECT) {
      const message = decodeReject(payload)
      this.handleClose(message === null ? 'malformed reject' : rejectLabel(message.reason))
      return
    }

    if (type !== SERVER_SNAPSHOT || this.welcomeMessage === null) return
    const snapshot = decodeSnapshot(payload)
    if (snapshot === null) return
    this.ackTick = snapshot.ackInputTick
    this.newestSnapshot = snapshot
    this.timeline.push(snapshot, this.clock())
    if (snapshot.ackInputTick !== UNACKNOWLEDGED_INPUT_TICK) {
      this.adjustLead(snapshot.ackInputTick - snapshot.tick, this.clock())
    }
  }

  /**
   * Inputs arriving late are held over on the server, so the car answers a
   * tick late; arriving needlessly early, it answers late by choice. Move the
   * lead until they land just ahead of the tick they are for.
   */
  private adjustLead(slack: number, nowMs: number): void {
    if (slack < MIN_SLACK_TICKS) {
      this.lead = Math.min(MAX_LEAD_TICKS, this.lead + 1)
      this.leadRelaxedAtMs = nowMs
    } else if (slack > MAX_SLACK_TICKS && nowMs - this.leadRelaxedAtMs >= LEAD_RELAX_INTERVAL_MS) {
      this.lead = Math.max(MIN_LEAD_TICKS, this.lead - 1)
      this.leadRelaxedAtMs = nowMs
    }
  }

  private handleClose(reason: string): void {
    if (this.closedReason !== null) return
    this.closedReason = reason
    this.settleWelcome?.reject(new Error(reason))
    this.settleWelcome = null
    this.events.onClosed?.(reason)
  }
}
