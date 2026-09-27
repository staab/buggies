import type { TerrainMap } from '@buggies/terrain'

/**
 * The buffers a map carries that are worth handing over rather than copying
 * when it crosses from the worker that made it: the heightfield, a planet's
 * ground and the district map are megabytes, everything else is small enough to clone.
 */
export function terrainTransferables(map: TerrainMap): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (array: { buffer: ArrayBufferLike }): void => {
    if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer)
  }
  add(map.heightfield.heights)
  if (map.world !== undefined) {
    add(map.world.ground.heights)
    add(map.world.water)
    add(map.world.districtOf)
    for (const road of map.world.roads) add(road.widths)
  }
  add(map.districtOf)
  for (const road of map.roads) add(road.structure)
  return [...buffers]
}
