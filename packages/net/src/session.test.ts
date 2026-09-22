import {
  NEUTRAL_INPUT,
  createArena,
  initPhysics,
  takeSeat,
  type Arena,
  type VehicleInput,
  type VehicleProfileId,
} from '@buggies/game'
import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { ConnectionFailure, NetClient } from './client.ts'
import { LocalPrediction } from './prediction.ts'
import { INPUT_TIMELINE_TICKS, MS_PER_TICK, TICKS_PER_SECOND, TICKS_PER_SNAPSHOT } from './protocol.ts'
import { GameServer } from './server.ts'
import type {
  ClientTransport,
  ClientTransportHandlers,
  TransportConnection,
  TransportHandlers,
} from './transport.ts'

/**
 * A wire made of queues. Messages are delivered when `deliver` is called,
 * which the test does once per tick, after holding them for a few ticks to
 * stand in for the network.
 */
class Loopback {
  private static nextId = 1
  private readonly toServer: { at: number; payload: Uint8Array }[] = []
  private readonly toClient: { at: number; payload: Uint8Array }[] = []
  private clientHandlers: ClientTransportHandlers | null = null
  private closed = false
  readonly connection: TransportConnection

  private jitterSeed = 12345

  constructor(
    private readonly server: TransportHandlers,
    private readonly delayTicks: number,
    private readonly clock: { tick: number },
    /** Up to this many ticks more, differing from message to message, as a jittery network would. */
    private readonly jitterTicks = 0,
  ) {
    const id = Loopback.nextId++
    this.connection = {
      id,
      send: (payload) => this.toClient.push({ at: clock.tick + this.delay(), payload: payload.slice() }),
      close: (reason) => this.drop(reason),
    }
  }

  /** The delay of the next message: the wire's, plus some jitter, the same run every time. */
  private delay(): number {
    if (this.jitterTicks === 0) return this.delayTicks
    this.jitterSeed = (this.jitterSeed * 1103515245 + 12345) & 0x7fffffff
    return this.delayTicks + (this.jitterSeed % (this.jitterTicks + 1))
  }

  get client(): ClientTransport {
    return {
      connect: async (handlers) => {
        this.clientHandlers = handlers
        this.server.onOpen(this.connection)
      },
      send: (payload) => this.toServer.push({ at: this.clock.tick + this.delay(), payload: payload.slice() }),
      close: (reason) => this.drop(reason),
    }
  }

  deliver(): void {
    while (this.toServer.length > 0 && this.toServer[0]!.at <= this.clock.tick) {
      if (!this.closed) this.server.onMessage(this.connection, this.toServer.shift()!.payload)
      else this.toServer.shift()
    }
    while (this.toClient.length > 0 && this.toClient[0]!.at <= this.clock.tick) {
      this.clientHandlers?.onMessage(this.toClient.shift()!.payload)
    }
  }

  private drop(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.server.onClose(this.connection)
    this.clientHandlers?.onClose(reason)
  }
}

interface Player {
  client: NetClient
  prediction: LocalPrediction
  wire: Loopback
  input: VehicleInput
  /** Another seat this player's mirror is watched on, for how much its car gets corrected. */
  watching: number | null
  largestWatchedCorrection: number
  /** How many times the prediction was pumped, and how many of those ran other than one tick. */
  pumps: number
  unevenPumps: number
  /** Not pumped at all for now, as a client busy generating its map is not. */
  paused: boolean
}

const DELAY_TICKS = 3

let map: TerrainMap

/**
 * Bombs would blow up a car driven flat out along the road, which is not
 * what these tests are about: none goes off in them.
 */
function defuse(arena: Arena): void {
  for (const pickup of arena.pickups) {
    if (pickup.kind === 'bomb') pickup.spawnTick = Number.MAX_SAFE_INTEGER
  }
}

/** A server and a way of putting players on it, all on one fake clock. */
class Session {
  readonly clock = { tick: 0 }
  readonly server: GameServer
  readonly arena: Arena
  readonly players: Player[] = []
  readonly events: string[] = []

  constructor() {
    this.arena = createArena(map)
    defuse(this.arena)
    this.server = new GameServer(this.arena, {
      onJoined: (seat) => this.events.push(`joined ${seat.id}`),
      onLeft: (seat) => this.events.push(`left ${seat.id}`),
      onRejected: (_, reason) => this.events.push(`rejected: ${reason}`),
      onRespawned: (seat, why) => this.events.push(`respawned ${seat.id} ${why}`),
    })
  }

  get nowMs(): number {
    return this.clock.tick * MS_PER_TICK
  }

  async join(profile: VehicleProfileId = 'sportsCar', jitterTicks = 0): Promise<Player> {
    const wire = new Loopback(this.server, DELAY_TICKS, this.clock, jitterTicks)
    const client = new NetClient(wire.client, () => this.nowMs)
    const welcoming = client.connect(profile)
    welcoming.catch(() => undefined)
    // The hello goes out once connect() has had a turn; then it has to get
    // there and the welcome has to come back. A refusal comes back the same way.
    for (let i = 0; i < DELAY_TICKS * 2 + 8 && client.welcome === null && client.closed === null; i++) {
      await Promise.resolve()
      this.step([wire])
    }
    const welcome = await welcoming
    const mirror = createArena(map)
    defuse(mirror)
    takeSeat(mirror, welcome.seat, welcome.profile)
    const prediction = new LocalPrediction(mirror, welcome.seat, welcome.epoch, client.startTick)
    const player: Player = {
      client,
      prediction,
      wire,
      input: { ...NEUTRAL_INPUT },
      watching: null,
      largestWatchedCorrection: 0,
      pumps: 0,
      unevenPumps: 0,
      paused: false,
    }
    this.players.push(player)
    return player
  }

  /** One server tick, with every connected client pumping once. */
  step(extraWires: Loopback[] = []): void {
    this.server.advance()
    this.clock.tick += 1
    for (const wire of extraWires) wire.deliver()
    for (const player of this.players) {
      player.wire.deliver()
      if (player.paused) continue
      const update = player.client.pump(player.input)
      // Where the watched car stood in the mirror before the server's word,
      // against where the replay puts it at the same tick: the correction.
      const watched = player.watching === null ? null : player.prediction.seats[player.watching]!.vehicle
      const before = watched === null ? null : { ...watched.frame.position }
      const outcome = player.prediction.reconcile(update.newestSnapshot)
      if (watched !== null && before !== null && outcome === 'replayed') {
        player.largestWatchedCorrection = Math.max(
          player.largestWatchedCorrection,
          distance(before, watched.frame.position),
        )
      }
      player.prediction.advance(update, (tick, input) => player.client.sendInput(tick, input))
      player.pumps += 1
      if (player.prediction.stats.lastSteps !== 1) player.unevenPumps += 1
    }
  }

  run(seconds: number): void {
    for (let i = 0; i < Math.round(seconds * TICKS_PER_SECOND); i++) this.step()
  }

  serverPositionOf(player: Player): { x: number; y: number; z: number } {
    return { ...this.arena.seats[player.client.welcome!.seat]!.vehicle.frame.position }
  }

  predictedPositionOf(player: Player): { x: number; y: number; z: number } {
    return { ...player.prediction.vehicle.frame.position }
  }

  dispose(): void {
    for (const player of this.players) player.prediction.dispose()
    this.server.dispose()
  }
}

/** How far a position is from the nearest road point on a map. */
function offRoad(map: TerrainMap, position: { x: number; z: number }): number {
  let nearest = Infinity
  for (const road of map.roads) {
    for (const point of road.points) {
      nearest = Math.min(nearest, Math.hypot(point.x - position.x, point.z - position.z))
    }
  }
  return nearest
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

describe('a session', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(5, { size: 257 })
  }, 60_000)

  it('seats two players who each see the other driving', async () => {
    const session = new Session()
    const a = await session.join('pickup')
    const b = await session.join('raceCar')
    expect(a.client.welcome!.seat).not.toBe(b.client.welcome!.seat)
    expect(a.client.welcome!.seed).toBe(map.seed)
    expect(session.events).toEqual(['joined 0', 'joined 1'])

    a.input.throttle = 1
    session.run(4)

    // A drove; the server moved A; B was told, and shows A where the server has it.
    const aOnServer = session.serverPositionOf(a)
    expect(distance(aOnServer, session.arena.seats[0]!.spawn.position)).toBeGreaterThan(10)
    const aSeenByB = b.client.sample().find((state) => state.seat === a.client.welcome!.seat)!
    expect(aSeenByB.profile).toBe('pickup')
    // Drawn a little behind the present on purpose, never far.
    expect(distance(aSeenByB.position, aOnServer)).toBeLessThan(8)
    expect(aSeenByB.speed).toBeGreaterThan(3)

    // B only rolled (no brake was held, and a spawn can be on a slope), and A
    // sees B where the server has B.
    const bOnServer = session.serverPositionOf(b)
    expect(distance(bOnServer, session.arena.seats[1]!.spawn.position)).toBeLessThan(20)
    const bSeenByA = a.client.sample().find((state) => state.seat === b.client.welcome!.seat)!
    expect(bSeenByA.profile).toBe('raceCar')
    expect(bSeenByA.speed).toBeLessThan(8)
    expect(distance(bSeenByA.position, bOnServer)).toBeLessThan(2)
    expect(session.server.playerCount).toBe(2)
    session.dispose()
  })

  it('predicts the local car ahead of the server and keeps it in line', async () => {
    const session = new Session()
    const a = await session.join()
    a.input.throttle = 1
    a.input.steer = 0.3
    session.run(5)

    // Inputs have learned to arrive just ahead of their tick over this wire:
    // a round trip, plus a little, and the car runs that far ahead of the server.
    expect(a.client.leadTicks).toBeGreaterThanOrEqual(DELAY_TICKS * 2)
    expect(a.client.leadTicks).toBeLessThanOrEqual(DELAY_TICKS * 2 + TICKS_PER_SNAPSHOT + 2)
    expect(a.client.acknowledgedInputTick).toBeGreaterThan(0)
    expect(a.prediction.stats.ticksAheadOfServer).toBeGreaterThan(0)
    expect(a.prediction.stats.ticksAheadOfServer).toBeLessThan(INPUT_TIMELINE_TICKS / 2)
    expect(session.server.stats().inputsHeld).toBeLessThan(TICKS_PER_SECOND)

    // The prediction reconciles every snapshot with a small correction, never
    // a snap: identical physics from identical inputs should barely disagree.
    expect(a.prediction.stats.replayHorizonTicks).toBeGreaterThan(0)
    expect(a.prediction.stats.lastCorrectionMetres).toBeLessThan(0.5)
    expect(a.prediction.stats.hardResyncs).toBeLessThanOrEqual(1)

    // Predicted where the server will put it, give or take the lead.
    const predicted = session.predictedPositionOf(a)
    session.run((a.prediction.stats.ticksAheadOfServer) / TICKS_PER_SECOND)
    expect(distance(predicted, session.serverPositionOf(a))).toBeLessThan(1.5)
    session.dispose()
  })

  it('keeps the fastest car in line at full speed, snapshot after snapshot', async () => {
    const session = new Session()
    const a = await session.join('raceCar')
    a.input.throttle = 1
    let worst = 0
    for (let i = 0; i < 8 * TICKS_PER_SECOND; i++) {
      session.step()
      worst = Math.max(worst, a.prediction.stats.lastCorrectionMetres)
    }
    expect(a.prediction.vehicle.speed).toBeGreaterThan(40)
    // Corrections at speed stay a small fraction of a car length: anything
    // more shows as the car jumping about.
    expect(worst).toBeLessThan(0.5)
    expect(a.prediction.stats.hardResyncs).toBeLessThanOrEqual(1)
    session.dispose()
  })

  it('keeps another player\'s car steady in the mirror, driving straight or weaving', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const b = await session.join('sportsCar')
    a.watching = b.client.welcome!.seat
    b.input = { ...NEUTRAL_INPUT, throttle: 1 }
    session.run(5)
    expect(session.serverPositionOf(b).x).not.toBe(session.predictedPositionOf(a).x)
    // Straight and flat out, the mirror's guess is right and stays right.
    expect(a.largestWatchedCorrection).toBeLessThan(0.6)

    // Weaving, every change of steering is a surprise to the mirror, and
    // each one is a nudge, not a jump.
    a.largestWatchedCorrection = 0
    for (let i = 0; i < 8; i++) {
      b.input = { ...NEUTRAL_INPUT, throttle: 1, steer: i % 2 === 0 ? 0.4 : -0.4 }
      session.run(0.5)
    }
    expect(a.largestWatchedCorrection).toBeGreaterThan(0)
    expect(a.largestWatchedCorrection).toBeLessThan(1.5)
    session.dispose()
  })

  it('runs the local car one tick per step through a jittery wire, with rare nudges', async () => {
    const session = new Session()
    // Every message up to three ticks late on top of the wire's delay, so
    // snapshots arrive in fits and starts.
    const a = await session.join('sportsCar', 3)
    a.input = { ...NEUTRAL_INPUT, throttle: 1, steer: 0.2 }
    session.run(2)
    a.pumps = 0
    a.unevenPumps = 0
    session.run(8)
    // The car is stepped once per fixed step nearly every time: it never
    // lurches or stalls to follow the arrivals.
    expect(a.unevenPumps / a.pumps).toBeLessThan(0.03)
    expect(a.prediction.stats.lastCorrectionMetres).toBeLessThan(0.5)
    expect(a.prediction.stats.hardResyncs).toBeLessThanOrEqual(1)
    expect(a.client.leadTicks).toBeLessThanOrEqual(DELAY_TICKS * 2 + 3 + TICKS_PER_SNAPSHOT + 2)
    session.dispose()
  })

  it('catches up a client that spent seconds generating its map before it first drove', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    // Welcomed, then busy for three seconds while the server runs on and
    // its snapshots pile up on the wire.
    a.paused = true
    session.run(3)
    a.paused = false
    a.input = { ...NEUTRAL_INPUT, throttle: 1 }
    const before = session.serverPositionOf(a)
    const heldBefore = session.server.stats().inputsHeld
    session.run(4)
    // The car drives: its inputs reach the server on ticks it will accept,
    // within a moment of the client coming back.
    expect(distance(before, session.serverPositionOf(a))).toBeGreaterThan(20)
    expect(session.server.stats().inputsHeld - heldBefore).toBeLessThan(TICKS_PER_SECOND)
    // The mirror sits its lead ahead of the server, not seconds ahead or behind.
    expect(a.prediction.stats.ticksAheadOfServer).toBeGreaterThan(0)
    expect(a.prediction.stats.ticksAheadOfServer).toBeLessThan(INPUT_TIMELINE_TICKS / 2)
    expect(a.prediction.stats.lastCorrectionMetres).toBeLessThan(0.5)
    expect(a.prediction.stats.hardResyncs).toBeLessThanOrEqual(2)
    session.dispose()
  })

  it('puts a player back on request, and the prediction follows the new epoch', async () => {
    const session = new Session()
    const a = await session.join()
    a.input.throttle = 1
    session.run(3)
    expect(distance(session.serverPositionOf(a), session.arena.seats[0]!.spawn.position)).toBeGreaterThan(5)

    const resyncs = a.prediction.stats.hardResyncs
    a.input.throttle = 0
    a.client.requestRespawn()
    session.run(1)
    expect(session.events).toContain('respawned 0 asked')
    // Back on the road nearest to where it was, not at its spawn, and the prediction there with it.
    expect(offRoad(session.arena.map, session.serverPositionOf(a))).toBeLessThan(1)
    expect(a.prediction.stats.hardResyncs).toBe(resyncs + 1)
    expect(distance(session.predictedPositionOf(a), session.serverPositionOf(a))).toBeLessThan(1)
    session.dispose()
  })

  it('frees a seat when its player leaves, and hands it on with a new epoch', async () => {
    const session = new Session()
    const a = await session.join()
    const b = await session.join()
    const epoch = a.client.welcome!.epoch
    session.run(1)
    expect(b.client.sample()).toHaveLength(2)

    a.client.close('done')
    session.players.splice(session.players.indexOf(a), 1)
    session.run(1)
    expect(session.events).toContain('left 0')
    expect(session.server.playerCount).toBe(1)
    expect(b.client.sample()).toHaveLength(1)

    const again = await session.join()
    expect(again.client.welcome!.seat).toBe(0)
    expect(again.client.welcome!.epoch).not.toBe(epoch)
    a.prediction.dispose()
    session.dispose()
  })

  it('refuses a ninth player', async () => {
    const session = new Session()
    for (let i = 0; i < 8; i++) await session.join()
    expect(session.server.playerCount).toBe(8)
    await expect(session.join()).rejects.toBeInstanceOf(ConnectionFailure)
    expect(session.events).toContain('rejected: server is full')
    session.dispose()
  }, 60_000)
})
