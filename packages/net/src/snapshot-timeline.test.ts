import { describe, expect, it } from 'vitest'

import { MS_PER_TICK, TICKS_PER_SNAPSHOT } from './protocol.ts'
import { SnapshotTimeline } from './snapshot-timeline.ts'
import type { SnapshotMessage } from './wire.ts'

/** A snapshot with nothing in it, for the clock alone. */
function snapshotAt(tick: number): SnapshotMessage {
  return { tick, vehicles: [] } as unknown as SnapshotMessage
}

/** Snapshots for these ticks, each arriving this long after it was sent, from a server whose tick 0 was at local time 0. */
function feed(timeline: SnapshotTimeline, from: number, count: number, delayMs: (index: number) => number): number {
  let tick = from
  for (let index = 0; index < count; index++, tick += TICKS_PER_SNAPSHOT) timeline.push(snapshotAt(tick), tick * MS_PER_TICK + delayMs(index))
  return tick
}

describe('the server clock', () => {
  it('is not moved by snapshots held up behind a stall and let through together', () => {
    const timeline = new SnapshotTimeline()
    let tick = feed(timeline, 0, 40, () => 50)
    const before = timeline.estimatedServerTick(tick * MS_PER_TICK + 50)
    // A second and a half of nothing, then all of it at once, the oldest that much late.
    const stalledMs = 1500
    const arrivedMs = tick * MS_PER_TICK + stalledMs + 50
    for (let sent = tick; sent * MS_PER_TICK <= tick * MS_PER_TICK + stalledMs; sent += TICKS_PER_SNAPSHOT) {
      timeline.push(snapshotAt(sent), arrivedMs)
      expect(Math.abs(timeline.estimatedServerTick(arrivedMs) - Math.round((arrivedMs - 50) / MS_PER_TICK))).toBeLessThanOrEqual(1)
    }
    tick = feed(timeline, tick + Math.round(stalledMs / MS_PER_TICK) + TICKS_PER_SNAPSHOT, 10, () => 50)
    expect(timeline.estimatedServerTick(tick * MS_PER_TICK + 50) - before).toBe(tick - Math.round(before))
  })

  it('keeps to the quickest arrivals through jitter', () => {
    const timeline = new SnapshotTimeline()
    const tick = feed(timeline, 0, 200, (index) => 50 + ((index * 37) % 200))
    expect(Math.abs(timeline.estimatedServerTick(tick * MS_PER_TICK) - (tick - Math.round(50 / MS_PER_TICK)))).toBeLessThanOrEqual(1)
  })

  it('follows a server that has fallen behind for good', () => {
    const timeline = new SnapshotTimeline()
    let tick = feed(timeline, 0, 40, () => 50)
    // The server stalled for three seconds and carried on from where it was: every snapshot now seems three seconds late.
    tick = feed(timeline, tick, 60, () => 3050)
    expect(Math.abs(timeline.estimatedServerTick(tick * MS_PER_TICK + 3050) - tick)).toBeLessThanOrEqual(1)
  })
})
