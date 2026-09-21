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
  private skippedTicks = 0
  private lead = INITIAL_LEAD_TICKS
  private leadRelaxedAtMs = 0
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

  async connect(profile: VehicleProfileId): Promise<WelcomeMessage> {
    try {
      await this.transport.connect({
        onMessage: (payload) => this.receive(payload),
        onClose: (reason) => this.handleClose(reason),
      })
      const welcome = new Promise<WelcomeMessage>((resolve, reject) => {
        this.settleWelcome = { resolve, reject }
      })
      this.transport.send(encodeHello(profile))
      return await welcome
    } catch (error) {
      throw new ConnectionFailure(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Send the current input for every tick the server is about to reach that
   * has not been sent for yet, and say what the prediction should do about it.
   */
  pump(input: VehicleInput): PredictionUpdate {
    const estimatedServerTick = this.timeline.estimatedServerTick(this.clock())
    const skippedBefore = this.skippedTicks
    this.sendInputThrough(estimatedServerTick + this.lead, input)
    return {
      estimatedServerTick,
      sentThroughTick: this.lastSentTick,
      skippedTicks: this.skippedTicks - skippedBefore,
      input,
      newestSnapshot: this.newestSnapshot,
    }
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

  private sendInputThrough(targetTick: number, input: VehicleInput): void {
    if (this.welcomeMessage === null || this.closedReason !== null) return
    // After a long stall the oldest owed ticks are already past what the
    // server will accept, so they are skipped rather than sent for nothing.
    const oldestWorthSending = targetTick - INPUT_TIMELINE_TICKS
    if (this.lastSentTick < oldestWorthSending) {
      this.skippedTicks += oldestWorthSending - this.lastSentTick
      this.lastSentTick = oldestWorthSending
    }
    while (this.lastSentTick < targetTick) {
      this.lastSentTick += 1
      this.transport.send(encodeInput(this.lastSentTick, input))
    }
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
      this.lastSentTick = welcome.tick + this.lead - 1
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
