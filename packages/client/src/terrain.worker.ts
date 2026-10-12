import { generateWorld, worldTransferables } from '@buggies/terrain'

/**
 * Terrain generation takes seconds, and it is pure work on plain data, so it
 * is done off the page's thread: a seed comes in, a map goes back with its
 * big buffers handed over rather than copied.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<number>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope
// Every world is made as the server makes it, from its id.
scope.onmessage = (event) => {
  const map = generateWorld(event.data)
  scope.postMessage(map, worldTransferables(map))
}
