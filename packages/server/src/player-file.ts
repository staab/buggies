import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { MemoryPlayerStore } from '@buggies/net'

/** How long after something changes it is written down: changes close together are written once. */
const WRITE_AFTER_MS = 2000

/** What the file holds of each key. */
interface Kept {
  readonly achievements: readonly number[]
  readonly gems: number
  /** Kept only since bananas were remembered: none, in a file from before. */
  readonly bananas?: number
}

/**
 * What the server keeps of each player's nostr key, their achievements,
 * their gems and their bananas, kept in a file so it outlasts the server: read when the
 * server starts, and written a moment after anything changes, to a file
 * beside it first and then put in its place, so a crash part way through
 * never leaves half a file.
 */
export class PlayerFile extends MemoryPlayerStore {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    super()
    let text: string | null = null
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      // Nothing kept yet.
    }
    if (text === null) return
    const kept = JSON.parse(text) as Record<string, Kept>
    for (const [pubkey, { achievements, gems, bananas = 0 }] of Object.entries(kept)) this.byKey.set(pubkey, { earned: new Set(achievements), gems, bananas })
  }

  protected override changed(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.write()
    }, WRITE_AFTER_MS)
  }

  /** Write everything down now, whatever is waiting. */
  flush(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
    this.write()
  }

  private write(): void {
    const kept: Record<string, Kept> = {}
    for (const [pubkey, record] of this.byKey) kept[pubkey] = { achievements: [...record.earned].sort((a, b) => a - b), gems: record.gems, bananas: record.bananas }
    mkdirSync(dirname(this.path), { recursive: true })
    const fresh = `${this.path}.writing`
    writeFileSync(fresh, JSON.stringify(kept))
    renameSync(fresh, this.path)
  }
}
