import { createServer } from 'node:http'

import { createGame, initPhysics, type GameState } from '@buggies/game'
import { generateTerrain } from '@buggies/terrain'

const port = Number(process.env.PORT ?? 3000)
const seed = Number(process.env.SEED ?? 1)

// A match runs headlessly on the server, on the same physics the client uses.
// Real-time transport will drive the inputs; for now this just proves the
// shared packages are wired in.
await initPhysics()
const state: GameState = createGame({ map: generateTerrain(seed) })

const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json')
  response.end(
    JSON.stringify({
      seed,
      tick: state.tick,
      spawn: state.spawn,
      grounded: state.vehicle.groundedCount,
    }),
  )
})

server.listen(port, () => {
  console.log(`@buggies/server listening on http://localhost:${port}`)
})
