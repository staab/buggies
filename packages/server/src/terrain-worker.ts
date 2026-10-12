import { parentPort } from 'node:worker_threads'

import { generateWorld, worldTransferables } from '@buggies/terrain'

// Asked for a world's id, a planet's or one of its other worlds', it makes that world and hands it back.
parentPort?.on('message', (id: number) => {
  const world = generateWorld(id)
  parentPort?.postMessage({ id, world }, worldTransferables(world))
})
