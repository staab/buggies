import { Worker } from 'node:worker_threads'

import type { TerrainMap } from '@buggies/terrain'

/** How many maps are kept once made, for an island or moon opened again soon after it was left. */
const KEPT = 8

/**
 * The maps the server plays on, made on a thread of their own so that
 * making one, seconds of work, never holds up the rooms already being
 * played; and the last few made kept, so that going back to one, or to
 * the moon and back, costs nothing.
 */
export class MapMaker {
  private readonly worker: Worker
  private readonly kept = new Map<number, Promise<TerrainMap>>()
  private readonly asked = new Map<number, { resolve(map: TerrainMap): void; reject(error: Error): void }>()

  constructor() {
    // From source while developing, where the worker is TypeScript too; from the build otherwise.
    const source = import.meta.url.endsWith('.ts')
    this.worker = new Worker(new URL(source ? './terrain-worker.ts' : './terrain-worker.js', import.meta.url))
    this.worker.on('message', ({ seed, map }: { seed: number; map: TerrainMap }) => {
      this.asked.get(seed)?.resolve(map)
      this.asked.delete(seed)
    })
    this.worker.on('error', (error) => {
      for (const { reject } of this.asked.values()) reject(error)
      this.asked.clear()
    })
    this.worker.unref()
  }

  /** The map for a seed: kept, being made, or made now. */
  mapFor(seed: number): Promise<TerrainMap> {
    const known = this.kept.get(seed)
    if (known !== undefined) {
      // The most lately asked for is the last to go.
      this.kept.delete(seed)
      this.kept.set(seed, known)
      return known
    }
    const made = new Promise<TerrainMap>((resolve, reject) => {
      this.asked.set(seed, { resolve, reject })
      this.worker.postMessage(seed)
    })
    made.catch(() => this.kept.delete(seed))
    this.kept.set(seed, made)
    while (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value!)
    return made
  }

  close(): Promise<number> {
    return this.worker.terminate()
  }
}
