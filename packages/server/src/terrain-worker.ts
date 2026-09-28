import { parentPort } from 'node:worker_threads'

import { generateTerrain, type TerrainMap } from '@buggies/terrain'

/** The buffers a map carries that are worth handing over rather than copying: the heightfield and the district map are megabytes. */
function transferables(map: TerrainMap): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (array: { buffer: ArrayBufferLike }): void => {
    if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer)
  }
  add(map.heightfield.heights)
  add(map.districtOf)
  for (const road of map.roads) add(road.structure)
  return [...buffers]
}

// Asked for a seed, it makes that island, or moon, and hands it back.
parentPort?.on('message', (seed: number) => {
  const map = generateTerrain(seed)
  parentPort?.postMessage({ seed, map }, transferables(map))
})
