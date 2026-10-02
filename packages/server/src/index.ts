import { fileURLToPath } from 'node:url'

import { FIXED_TIMESTEP, createArena, initPhysics } from '@buggies/game'
import { GameServer, SNAPSHOTS_PER_SECOND, TICKS_PER_SECOND } from '@buggies/net'
import { MapMaker } from './maps.ts'
import { serveClient } from './static.ts'
import { WebSocketServerTransport } from './ws-transport.ts'

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 8787)
/** Behind a reverse proxy, players are told apart by the address it forwards, not its own. */
const trustProxy = process.env.TRUST_PROXY === '1'
/** The built client, served on the same port; by default the workspace's own build, next door. */
const clientDir = process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../client/dist/', import.meta.url))

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

// A planet, or its moon, is made the first time anyone asks for its seed,
// in a room of its own. Generation takes a few seconds, on a thread of its
// own, while every room already open goes on.
const maps = new MapMaker()
const server = new GameServer(
  async (seed) => {
    log(`generating seed ${seed}...`)
    const started = performance.now()
    const world = await maps.worldFor(seed)
    const arena = createArena(world)
    log(`seed ${seed} ready in ${Math.round(performance.now() - started)}ms`)
    return arena
  },
  {
    onJoined: (seat, connection, seed) => log(`joined seed=${seed} seat=${seat.id} ${seat.profile} connection=${connection}`),
    onLeft: (seat, connection, seed) => log(`left seed=${seed} seat=${seat.id} connection=${connection}`),
    onRejected: (connection, reason) => log(`rejected connection=${connection}: ${reason}`),
    onRespawned: (seat, why) => log(`respawned seat=${seat.id} (${why})`),
    onChangedVehicle: (seat) => log(`changed vehicle seat=${seat.id} ${seat.profile}`),
    onGameSet: (seat) => log(`game seat=${seat.id} ${seat.game === null ? 'none' : `${seat.game.kind} ${seat.game.target}`}`),
    onGameWon: (seat) => log(`game won seat=${seat.id}`),
    onRaceStarted: (seat, racers) => log(`race started seat=${seat.id} racers=${racers.length}`),
    onRaceEnded: (seed, winner) => log(`race ended seed=${seed} winner=${winner === null ? 'none' : winner.id}`),
    onRoomOpened: (seed) => log(`room opened seed=${seed}`),
    onRoomClosed: (seed) => log(`room closed seed=${seed}`),
  },
)

const transport = new WebSocketServerTransport({ host, port }, { trustProxy, onRequest: serveClient(clientDir) })
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
      void maps.close()
      log('stopped')
      process.exit(0)
    },
    () => process.exit(1),
  )
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

log(`simulation ${TICKS_PER_SECOND}Hz, snapshots ${SNAPSHOTS_PER_SECOND}Hz, a room per seed`)
log(`listening on http://${address.host}:${address.port}, serving the client from ${clientDir}`)
