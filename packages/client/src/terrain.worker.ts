import { generateWorld, worldTransferables } from '@buggies/terrain'

import { islandPixels } from './island-picture.ts'
import type { TerrainReply, TerrainRequest } from './terrain-source.ts'

/**
 * Terrain generation takes seconds, and it is pure work on plain data, so it
 * is done off the page's thread: a world's id comes in and the world goes
 * back with its big buffers handed over rather than copied; or the id and a
 * width, and the island's picture goes back, its pixels handed over the same
 * way.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<TerrainRequest>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

/** The worker's own side of the page: what it is sent, and what it may send back and hand over. */
const scope = self as unknown as WorkerScope
scope.onmessage = (event) => {
  const request = event.data
  if (request.kind === 'picture') {
    const picture = islandPixels(generateWorld(request.world), request.pixels)
    const reply: TerrainReply = { kind: 'picture', picture }
    scope.postMessage(reply, [picture.pixels.buffer])
    return
  }
  const reply: TerrainReply = { kind: 'world', world: generateWorld(request.world) }
  scope.postMessage(reply, worldTransferables(reply.world))
}
