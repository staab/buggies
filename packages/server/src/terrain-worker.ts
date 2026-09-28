import { parentPort } from 'node:worker_threads'

import { generateWorld, type World } from '@buggies/terrain'

/**
 * The buffers a world carries that are worth handing over rather than
 * copying: the ground's grids are megabytes, and the decks, rails, curbs,
 * shells and kickers are meshes of their own.
 */
export function transferables(world: World): ArrayBuffer[] {
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
  for (const kicker of world.kickers) add(kicker)
  for (const road of world.roads) {
    add(road.widths)
    add(road.structure)
  }
  return [...buffers]
}

// Asked for a planet's seed, or its moon's, it makes that world and hands it back.
parentPort?.on('message', (id: number) => {
  const world = generateWorld(id)
  parentPort?.postMessage({ id, world }, transferables(world))
})
