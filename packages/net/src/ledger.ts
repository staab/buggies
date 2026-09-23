import type { Spilled } from '@buggies/game'

import type { SnapshotMessage } from './wire.ts'

/** One of the map's banana slots, as the server last had it. */
export interface KnownPickup {
  generation: number
  spawnTick: number
}

/**
 * What the server has said about the map's bananas: every slot, and every
 * banana spilled from a wreck. The first snapshot brings the whole of it and
 * the rest only what changed, so every one is taken in as it comes, in
 * order, and what is here is the server's word as of the newest.
 */
export class BananaLedger {
  /** Each slot's banana, by slot. */
  readonly pickups: KnownPickup[] = []
  private readonly spilledById = new Map<number, Spilled>()
  private spilledList: Spilled[] | null = null

  /** The spilled bananas out, oldest first. */
  get spilled(): readonly Spilled[] {
    return (this.spilledList ??= [...this.spilledById.values()])
  }

  take(snapshot: SnapshotMessage): void {
    if (snapshot.full) {
      this.pickups.length = 0
      this.spilledById.clear()
    }
    for (const pickup of snapshot.pickups) {
      const known = (this.pickups[pickup.slot] ??= { generation: 0, spawnTick: 0 })
      known.generation = pickup.generation
      known.spawnTick = snapshot.tick + pickup.ticksUntilOut
    }
    for (const id of snapshot.removed) this.spilledById.delete(id)
    for (const spilled of snapshot.spilled) {
      this.spilledById.set(spilled.id, {
        id: spilled.id,
        kind: spilled.kind,
        from: { ...spilled.from },
        position: { ...spilled.position },
        bornTick: snapshot.tick - spilled.age,
      })
    }
    if (snapshot.full || snapshot.removed.length > 0 || snapshot.spilled.length > 0) this.spilledList = null
  }
}
