import { generateTerrain, type TerrainMap } from '@buggies/terrain'

/**
 * Maps, made off the page's thread so the page keeps drawing while an island
 * takes shape. One worker, kept between maps; requests are answered in turn.
 * Where there are no workers the map is made on the spot instead.
 */
export class TerrainSource {
  private worker: Worker | null = null
  private queue: Promise<unknown> = Promise.resolve()

  generate(seed: number): Promise<TerrainMap> {
    if (typeof Worker === 'undefined') return Promise.resolve(generateTerrain(seed))
    const worker = (this.worker ??= new Worker(new URL('./terrain.worker.ts', import.meta.url), {
      type: 'module',
    }))
    const next = this.queue.then(
      () =>
        new Promise<TerrainMap>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<TerrainMap>) => resolve(event.data)
          worker.onerror = (event) => reject(new Error(event.message))
          worker.postMessage(seed)
        }),
    )
    this.queue = next.catch(() => undefined)
    return next
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
