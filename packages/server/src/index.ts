import { createServer } from 'node:http'

import { createGame } from '@buggies/game'

const port = Number(process.env.PORT ?? 3000)

// A match runs headlessly on the server. Real-time transport will drive the
// inputs; for now this just proves the shared game package is wired in.
const state = createGame()

const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ tick: state.tick, vehicles: Object.keys(state.vehicles) }))
})

server.listen(port, () => {
  console.log(`@buggies/server listening on http://localhost:${port}`)
})