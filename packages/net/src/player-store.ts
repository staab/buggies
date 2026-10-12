/**
 * What the server keeps of each player for good, by their nostr key: the
 * achievements it has been paid, each once ever, whichever island,
 * session or connection it does it again on; and the gems its games and
 * races have won it, which it keeps from one session to the next. The
 * server asks this before it pays and tells it after.
 */
export interface PlayerStore {
  /** The feats a key has been paid for, by id. */
  earned(pubkey: string): ReadonlySet<number>
  /** A feat paid to a key: never to be paid to it again. */
  record(pubkey: string, id: number): void
  /** How many gems a key has won, all told. */
  gems(pubkey: string): number
  /** Gems won by a key, added to what it has; and what it has now. */
  addGems(pubkey: string, gems: number): number
}

/** What is kept of one key. */
export interface PlayerRecord {
  readonly earned: Set<number>
  gems: number
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

  gems(pubkey: string): number {
    return this.byKey.get(pubkey)?.gems ?? 0
  }

  addGems(pubkey: string, gems: number): number {
    const record = this.recordOf(pubkey)
    record.gems += gems
    this.changed()
    return record.gems
  }

  /** Something kept has changed: nothing to do, kept in memory. */
  protected changed(): void {}

  private recordOf(pubkey: string): PlayerRecord {
    const known = this.byKey.get(pubkey)
    if (known !== undefined) return known
    const fresh: PlayerRecord = { earned: new Set(), gems: 0 }
    this.byKey.set(pubkey, fresh)
    return fresh
  }
}
