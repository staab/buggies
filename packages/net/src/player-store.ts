/**
 * What the server keeps of each player for good, by their nostr key: the
 * achievements it has been paid, each once ever, whichever world, session
 * or connection it does it again on; and the bananas it held when it last
 * left a free drive, to start the next one with. The server asks this
 * before it pays and tells it after.
 */
export interface PlayerStore {
  /** The feats a key has been paid for, by id. */
  earned(pubkey: string): ReadonlySet<number>
  /** A feat paid to a key: never to be paid to it again. */
  record(pubkey: string, id: number): void
  /** How many bananas a key held when last it was told of, to start its next free drive with. */
  bananas(pubkey: string): number
  /** How many bananas a key holds now: a race's never reach it. */
  keepBananas(pubkey: string, bananas: number): void
}

/** What is kept of one key. */
export interface PlayerRecord {
  readonly earned: Set<number>
  bananas: number
}

/** A store kept in memory alone: forgotten when the server stops. What the server keeps when it is given nowhere to keep it, and what tests keep. */
export class MemoryPlayerStore implements PlayerStore {
  protected readonly byKey = new Map<string, PlayerRecord>()

  earned(pubkey: string): ReadonlySet<number> {
    return this.byKey.get(pubkey)?.earned ?? new Set()
  }

  record(pubkey: string, id: number): void {
    this.recordOf(pubkey).earned.add(id)
    this.changed()
  }

  bananas(pubkey: string): number {
    return this.byKey.get(pubkey)?.bananas ?? 0
  }

  keepBananas(pubkey: string, bananas: number): void {
    const record = this.recordOf(pubkey)
    if (record.bananas === bananas) return
    record.bananas = bananas
    this.changed()
  }

  /** Something kept has changed: nothing to do, kept in memory. */
  protected changed(): void {}

  private recordOf(pubkey: string): PlayerRecord {
    const known = this.byKey.get(pubkey)
    if (known !== undefined) return known
    const fresh: PlayerRecord = { earned: new Set(), bananas: 0 }
    this.byKey.set(pubkey, fresh)
    return fresh
  }
}
