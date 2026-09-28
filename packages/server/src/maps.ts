import { Worker } from 'node:worker_threads'

import type { World } from '@buggies/terrain'

/** How many worlds are kept once made, for a planet or moon opened again soon after it was left. */
const KEPT = 8

/**
 * The worlds the server plays on, made on a thread of their own so that
 * making one, seconds of work, never holds up the rooms already being
 * played; and the last few made kept, so that going back to one, or to
 * the moon and back, costs nothing.
 */
export class MapMaker {
  private readonly worker: Worker
  private readonly kept = new Map<number, Promise<World>>()
  private readonly asked = new Map<number, { resolve(world: World): void; reject(error: Error): void }>()

  constructor() {
    // From source while developing, where the worker is TypeScript too; from the build otherwise.
    const source = import.meta.url.endsWith('.ts')
    this.worker = new Worker(new URL(source ? './terrain-worker.ts' : './terrain-worker.js', import.meta.url))
    this.worker.on('message', ({ id, world }: { id: number; world: World }) => {
      this.asked.get(id)?.resolve(world)
      this.asked.delete(id)
    })
    this.worker.on('error', (error) => {
      for (const { reject } of this.asked.values()) reject(error)
      this.asked.clear()
    })
    this.worker.unref()
  }

  /** The world for an id, a planet's seed or its moon's: kept, being made, or made now. */
  worldFor(id: number): Promise<World> {
    const known = this.kept.get(id)
    if (known !== undefined) {
      // The most lately asked for is the last to go.
      this.kept.delete(id)
      this.kept.set(id, known)
      return known
    }
    const made = new Promise<World>((resolve, reject) => {
      this.asked.set(id, { resolve, reject })
      this.worker.postMessage(id)
    })
    made.catch(() => this.kept.delete(id))
    this.kept.set(id, made)
    while (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value!)
    return made
  }

  close(): Promise<number> {
    return this.worker.terminate()
  }
}
