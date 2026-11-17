import { fileURLToPath } from 'node:url'

import { FIXED_TIMESTEP, MAX_PLAYERS, createArena, initPhysics, withPortals } from '@buggies/game'
import { GameServer, SNAPSHOTS_PER_SECOND, TICKS_PER_SECOND } from '@buggies/net'
import { MapMaker } from './maps.ts'
import { PlayerFile } from './player-file.ts'
import { serveClient } from './static.ts'
import { WebSocketServerTransport } from './ws-transport.ts'

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 8787)
/** Behind a reverse proxy, players are told apart by the address it forwards, not its own. */
const trustProxy = process.env.TRUST_PROXY === '1'
/** The built client, served on the same port; by default the workspace's own build, next door. */
const clientDir = process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../client/dist/', import.meta.url))
/** Where what is kept of each player's key, their achievements and their free-drive bananas, is written: by default `data/players.json` under where the server is run. */
const playersFile = process.env.PLAYERS_FILE ?? 'data/players.json'

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

// A world, a planet or one of its others, is made the first time anyone asks for its id,
// on a thread of its own, while every room already open goes on. A race's course
// is built from the same worlds, so it asks for them by id rather than making its own.
const maps = new MapMaker()
const players = new PlayerFile(playersFile)
const server = new GameServer(
  {
    worldFor: (world) => maps.worldFor(world),
    // A race's world keeps only the portals its leg runs through: a copy of the world,
    // since the one `MapMaker` keeps is shared with every other room of it.
    arenaFor: (request) =>
      maps.worldFor(request.world).then((world) => {
        const planet = request.keep === null ? world : withPortals(world, request.keep)
        return createArena(planet, MAX_PLAYERS, { weapons: request.weapons, bananas: request.bananas })
      }),
  },
  {
    onJoined: (seat, connection, room) => log(`joined ${room.key} seat=${seat.id} ${seat.profile} connection=${connection}`),
    onLeft: (seat, connection, room) => log(`left ${room.key} seat=${seat.id} connection=${connection}`),
    onRejected: (connection, reason) => log(`rejected connection=${connection}: ${reason}`),
    onRespawned: (seat, why) => log(`respawned seat=${seat.id} (${why})`),
    onChangedVehicle: (seat) => log(`changed vehicle seat=${seat.id} ${seat.profile}`),
    onAchieved: (seat, achievement) => log(`achievement seat=${seat.id} id=${achievement.id}`),
    onSignedIn: (seat, pubkey) => log(`signed in ${seat === null ? 'lobby' : `seat=${seat.id}`} key=${pubkey.slice(0, 12)}`),
    onGameOpened: (game) => log(`game ${game.id} opened: ${game.options.mode} by ${game.demo ? 'the server' : `member ${game.host}`}`),
    onGameStarted: (game) => log(`game ${game.id} started: ${game.course?.legs.length ?? 0} worlds, ${game.racers.size} racers`),
    onGameFinished: (game) => log(`game ${game.id} finished: ${game.standings.length} standing`),
    onGameClosed: (game) => log(`game ${game.id} closed`),
    onCourseFailed: (game, reason) => log(`game ${game.id} has no course: ${reason}`),
    onRoomOpened: (room) => log(`room opened ${room.key}`),
    onRoomClosed: (room) => log(`room closed ${room.key}`),
  },
  undefined,
  players,
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
  if (server.playerCount() > 0) log(`stats ${JSON.stringify(server.stats())}`)
}, STATS_INTERVAL_MS)

const shutdown = (): void => {
  clearInterval(pumpTimer)
  clearInterval(statsTimer)
  transport.close().then(
    () => {
      server.dispose()
      players.flush()
      void maps.close()
      log('stopped')
      process.exit(0)
    },
    () => process.exit(1),
  )
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

log(`simulation ${TICKS_PER_SECOND}Hz, snapshots ${SNAPSHOTS_PER_SECOND}Hz, a room per game and world`)
log(`listening on http://${address.host}:${address.port}, serving the client from ${clientDir}`)
log(`keeping players' achievements and free-drive bananas in ${playersFile}`)
