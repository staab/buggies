import type { Loose } from '@buggies/game'

import type { PropSnapshot, SnapshotMessage } from './wire.ts'

/** One of the map's banana slots, as the server last had it. */
export interface KnownPickup {
  generation: number
  spawnTick: number
}

/**
 * What the server has said about the map's bananas and props: every slot,
 * every banana spilled from a wreck, and every prop it has told of. The
 * first snapshot brings the whole of it and the rest only what changed, so
 * every one is taken in as it comes, in order, and what is here is the
 * server's word as of the newest.
 */
export class BananaLedger {
  /** Each slot's banana, by slot. */
  readonly pickups: KnownPickup[] = []
  private readonly looseById = new Map<number, Loose>()
  private looseList: Loose[] | null = null
  /** The props told of since they were last handed over, each as the server last had it. */
  private readonly propsHeard = new Map<number, PropSnapshot>()

  /** The spilled bananas out, oldest first. */
  get loose(): readonly Loose[] {
    return (this.looseList ??= [...this.looseById.values()])
  }

  take(snapshot: SnapshotMessage): void {
    if (snapshot.full) {
      this.pickups.length = 0
      this.looseById.clear()
    }
    for (const pickup of snapshot.pickups) {
      const known = (this.pickups[pickup.slot] ??= { generation: 0, spawnTick: 0 })
      known.generation = pickup.generation
      known.spawnTick = snapshot.tick + pickup.ticksUntilOut
    }
    for (const id of snapshot.removed) this.looseById.delete(id)
    for (const loose of snapshot.loose) {
      this.looseById.set(loose.id, {
        id: loose.id,
        kind: loose.kind,
        owner: loose.owner,
        power: loose.power,
        from: { ...loose.from },
        position: { ...loose.position },
        bornTick: snapshot.tick - loose.age,
      })
    }
    if (snapshot.full || snapshot.removed.length > 0 || snapshot.loose.length > 0) this.looseList = null
    for (const prop of snapshot.props) this.propsHeard.set(prop.id, prop)
  }

  /** The props told of since this was last asked, each as the server last had it; asking hands them over. */
  takeProps(): PropSnapshot[] {
    const heard = [...this.propsHeard.values()]
    this.propsHeard.clear()
    return heard
  }
}
