import { PLANET_TERRAIN, generateTerrain } from '@buggies/terrain'

import { terrainTransferables } from './terrain-transfer.ts'

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
// Every island is one wrapped round a planet, as the server makes them.
scope.onmessage = (event) => {
  const map = generateTerrain(event.data, PLANET_TERRAIN)
  scope.postMessage(map, terrainTransferables(map))
}
