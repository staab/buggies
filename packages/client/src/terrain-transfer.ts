import type { World } from '@buggies/terrain'

/**
 * The buffers a planet carries that are worth handing over rather than
 * copying when it crosses from the worker that made it: its ground, bored
 * and whole, its water, its districts and the meshes built on it run to
 * megabytes; everything else is small enough to clone.
 */
export function terrainTransferables(world: World): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (array: { buffer: ArrayBufferLike }): void => {
    if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer)
  }
  for (const array of [world.ground.heights, world.bored, world.holes, world.water, world.districtOf]) add(array)
  for (const mesh of [world.decks, world.rails, world.curbs, ...world.shells]) {
    add(mesh.positions)
    add(mesh.indices)
  }
  add(world.decks.surfaces)
  for (const road of world.roads) {
    add(road.widths)
    add(road.structure)
  }
  return [...buffers]
}
