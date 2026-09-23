import { FIXED_TIMESTEP, createArena, initPhysics } from '@buggies/game'
import { GameServer, SNAPSHOTS_PER_SECOND, TICKS_PER_SECOND } from '@buggies/net'
import { generateTerrain } from '@buggies/terrain'

import { WebSocketServerTransport } from './ws-transport.ts'

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 8787)

/** How often the loop checks whether a step is due. Finer than a step. */
const PUMP_INTERVAL_MS = 4

/** The most steps taken in one go after a stall, so a hiccup is not a sprint. */
const MAX_CATCH_UP_TICKS = 8
const MAX_PUMP_DELTA = 0.25

const STATS_INTERVAL_MS = 10_000

function log(message: string): void {
  console.log(`[server] ${message}`)
}

await initPhysics()

// An island is made the first time anyone asks for its seed, in a room of
// its own. Generation takes a few seconds, during which every room waits.
const server = new GameServer(
  (seed) => {
    log(`generating seed ${seed}...`)
    return createArena(generateTerrain(seed))
  },
  {
    onJoined: (seat, connection, seed) => log(`joined seed=${seed} seat=${seat.id} ${seat.profile} connection=${connection}`),
    onLeft: (seat, connection, seed) => log(`left seed=${seed} seat=${seat.id} connection=${connection}`),
    onRejected: (connection, reason) => log(`rejected connection=${connection}: ${reason}`),
    onRespawned: (seat, why) => log(`respawned seat=${seat.id} (${why})`),
    onRoomOpened: (seed) => log(`room opened seed=${seed}`),
    onRoomClosed: (seed) => log(`room closed seed=${seed}`),
  },
)

const transport = new WebSocketServerTransport({ host, port })
const address = await transport.listen(server)

let last = performance.now()
let owed = 0

const pump = (): void => {
  const now = performance.now()
  owed += Math.min((now - last) / 1000, MAX_PUMP_DELTA)
  last = now
  let ticks = 0
  while (owed >= FIXED_TIMESTEP && ticks < MAX_CATCH_UP_TICKS) {
    server.advance()
    owed -= FIXED_TIMESTEP
    ticks += 1
  }
  if (owed >= FIXED_TIMESTEP) owed = 0
}

const pumpTimer = setInterval(pump, PUMP_INTERVAL_MS)
const statsTimer = setInterval(() => {
  if (server.playerCount > 0) log(`stats ${JSON.stringify(server.stats())}`)
}, STATS_INTERVAL_MS)

const shutdown = (): void => {
  clearInterval(pumpTimer)
  clearInterval(statsTimer)
  transport.close().then(
    () => {
      server.dispose()
      log('stopped')
      process.exit(0)
    },
    () => process.exit(1),
  )
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

log(`simulation ${TICKS_PER_SECOND}Hz, snapshots ${SNAPSHOTS_PER_SECOND}Hz, a room per seed`)
log(`listening on ws://${address.host}:${address.port}`)
