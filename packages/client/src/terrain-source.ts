import { generateWorld, type World } from '@buggies/terrain'

import { islandPixels, paintIsland, type IslandPicture } from './island-picture.ts'

/** How many island pictures are kept: one for each game on the start screen, and a few more. */
export const PICTURES_KEPT = 16

/** What the page asks the terrain worker for: a world by its id, or an island drawn flat, by its id and a width in pixels. */
export type TerrainRequest = { kind: 'world'; world: number } | { kind: 'picture'; world: number; pixels: number }

/** What the terrain worker answers with, one for the one request it was given. */
export type TerrainReply = { kind: 'world'; world: World } | { kind: 'picture'; picture: IslandPicture }

/**
 * Maps, made off the page's thread so the page keeps drawing while an island
 * takes shape. One worker, kept between maps; requests are answered in turn.
 * Where there are no workers the map is made on the spot instead.
 */
export class TerrainSource {
  private worker: Worker | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly pictures = new Map<string, Promise<HTMLCanvasElement>>()

  generate(world: number): Promise<World> {
    if (typeof Worker === 'undefined') return Promise.resolve(generateWorld(world))
    return this.ask({ kind: 'world', world }, (reply) => (reply.kind === 'world' ? reply.world : null))
  }

  /**
   * An island drawn flat, `pixels` across and half as tall, made off the
   * page's thread and painted here. The same island at the same width is
   * painted once and kept; the oldest goes when there are too many.
   */
  picture(world: number, pixels: number): Promise<HTMLCanvasElement> {
    const key = `${world}:${pixels}`
    const kept = this.pictures.get(key)
    if (kept !== undefined) return kept
    const asked =
      typeof Worker === 'undefined'
        ? Promise.resolve(islandPixels(generateWorld(world), pixels))
        : this.ask({ kind: 'picture', world, pixels }, (reply) => (reply.kind === 'picture' ? reply.picture : null))
    const made = asked.then(paintIsland)
    this.pictures.set(key, made)
    // One that could not be made is asked for afresh next time.
    made.catch(() => {
      if (this.pictures.get(key) === made) this.pictures.delete(key)
    })
    while (this.pictures.size > PICTURES_KEPT) {
      const oldest = this.pictures.keys().next().value
      if (oldest === undefined) break
      this.pictures.delete(oldest)
    }
    return made
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pictures.clear()
  }

  /**
   * One request at a time down the one worker, each answered before the next
   * is sent, so an answer is always for the request that asked for it.
   */
  private ask<T>(request: TerrainRequest, take: (reply: TerrainReply) => T | null): Promise<T> {
    const worker = (this.worker ??= new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' }))
    const next = this.queue.then(
      () =>
        new Promise<T>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<TerrainReply>) => {
            const taken = take(event.data)
            if (taken === null) reject(new Error(`the terrain worker answered a ${event.data.kind} when asked for a ${request.kind}`))
            else resolve(taken)
          }
          worker.onerror = (event) => reject(new Error(event.message))
          worker.postMessage(request)
        }),
    )
    this.queue = next.catch(() => undefined)
    return next
  }
}
