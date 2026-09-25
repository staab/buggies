import {
  MACHINE_GUN_AMMO_TICKS,
  MACHINE_GUN_DAMAGE,
  NEUTRAL_INPUT,
  PICKUP_SLOTS,
  ROCKET_DAMAGE,
  arm,
  createArena,
  initPhysics,
  respawnNearby,
  setPickup,
  takeSeat,
  type Arena,
  type VehicleInput,
  type VehicleProfileId,
} from '@buggies/game'
import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { ConnectionFailure, NetClient } from './client.ts'
import { LocalPrediction } from './prediction.ts'
import {
  INPUT_TIMELINE_TICKS,
  MS_PER_TICK,
  REJECT_IDLE,
  TICKS_PER_SECOND,
  TICKS_PER_SNAPSHOT,
  rejectLabel,
} from './protocol.ts'
import { fetchRooms } from './rooms.ts'
import { GameServer } from './server.ts'
import type {
  ClientTransport,
  ClientTransportHandlers,
  TransportConnection,
  TransportHandlers,
} from './transport.ts'
import { SNAPSHOT_HEADER_BYTES, SNAPSHOT_VEHICLE_BYTES, encodeInput } from './wire.ts'

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

/** A server and a way of putting players on it, all on one fake clock. */
class Session {
  readonly clock = { tick: 0 }
  readonly server: GameServer
  readonly players: Player[] = []
  readonly events: string[] = []

  constructor() {
    this.server = new GameServer(
      (seed) => createArena(seed === map.seed ? map : generateTerrain(seed, { size: 257 })),
      {
        onJoined: (seat) => this.events.push(`joined ${seat.id}`),
        onLeft: (seat) => this.events.push(`left ${seat.id}`),
        onRejected: (_, reason) => this.events.push(`rejected: ${reason}`),
        onRespawned: (seat, why) => this.events.push(`respawned ${seat.id} ${why}`),
        onRoomOpened: (seed) => this.events.push(`opened ${seed}`),
        onRoomClosed: (seed) => this.events.push(`closed ${seed}`),
      },
    )
  }

  /** The server's arena for the map every test plays on. */
  get arena(): Arena {
    return this.server.roomFor(map.seed)!.arena
  }

  get nowMs(): number {
    return this.clock.tick * MS_PER_TICK
  }

  async join(profile: VehicleProfileId = 'sportsCar', jitterTicks = 0, seed = map.seed): Promise<Player> {
    const wire = new Loopback(this.server, DELAY_TICKS, this.clock, jitterTicks)
    const client = new NetClient(wire.client, () => this.nowMs)
    const welcoming = client.connect(profile, seed)
    welcoming.catch(() => undefined)
    // The hello goes out once connect() has had a turn; then it has to get
    // there and the welcome has to come back. A refusal comes back the same way.
    for (let i = 0; i < DELAY_TICKS * 2 + 8 && client.welcome === null && client.closed === null; i++) {
      await Promise.resolve()
      this.step([wire])
    }
    const welcome = await welcoming
    const mirror = createArena(welcome.seed === map.seed ? map : generateTerrain(welcome.seed, { size: 257 }))
    takeSeat(mirror, welcome.seat, welcome.profile)
    const prediction = new LocalPrediction(mirror, welcome.seat, welcome.epoch, client.startTick, client.bananas)
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

/**
 * A wire with nothing in it: each side hears the other at once, and in
 * order, so a message sent before a hanging-up lands before it, as it does
 * over a socket.
 */
function direct(server: TransportHandlers): ClientTransport {
  let handlers: ClientTransportHandlers | null = null
  let closed = false
  const connection: TransportConnection = {
    id: 9999,
    send: (payload) => handlers?.onMessage(payload.slice()),
    close: (reason) => {
      closed = true
      handlers?.onClose(reason)
    },
  }
  return {
    connect: async (given) => {
      handlers = given
      server.onOpen(connection)
    },
    send: (payload) => {
      if (!closed) server.onMessage(connection, payload)
    },
    close: (reason) => {
      if (closed) return
      closed = true
      server.onClose(connection)
      handlers?.onClose(reason)
    },
  }
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
    expect(session.events).toEqual([`opened ${map.seed}`, 'joined 0', 'joined 1'])

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

  it('seats players by seed, a room each, and closes a room behind the last to leave', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const b = await session.join('tank', 0, map.seed + 1)
    expect(session.server.roomCount).toBe(2)
    expect(a.client.welcome!.seed).toBe(map.seed)
    expect(b.client.welcome!.seed).toBe(map.seed + 1)
    // Each is alone on their own island: the first seat of each.
    expect(a.client.welcome!.seat).toBe(0)
    expect(b.client.welcome!.seat).toBe(0)
    session.run(0.5)
    expect(a.client.playerCount).toBe(1)
    expect(b.client.playerCount).toBe(1)
    expect(session.events).toContain(`opened ${map.seed + 1}`)
    // The other island goes when its only player does.
    b.client.close('left')
    session.run(0.2)
    expect(session.server.roomCount).toBe(1)
    expect(session.events).toContain(`closed ${map.seed + 1}`)
    session.dispose()
  }, 120_000)

  it('tells of the bananas in full once, then only what changes, and the whole again to a newcomer', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    session.run(0.5)
    // The whole word, then nothing but the vehicles while nothing changes.
    expect(a.client.bananas.pickups).toHaveLength(PICKUP_SLOTS)
    expect(session.server.stats().snapshotBytes).toBe(SNAPSHOT_HEADER_BYTES + SNAPSHOT_VEHICLE_BYTES)

    // A slot moves on, and a banana is spilled: told once, and the mirror has them.
    const { arena } = session
    setPickup(arena.map, arena.water, arena.pickups[3]!, 3, 1, arena.tick + 480)
    arena.loose.push({
      id: 7,
      kind: 'banana',
      owner: 0,
      power: 0,
      from: { x: 1, y: 2, z: 3 },
      position: { x: 4, y: 5, z: 6 },
      bornTick: arena.tick,
    })
    session.run(0.5)
    expect(a.client.bananas.pickups[3]).toEqual({ generation: 1, spawnTick: arena.pickups[3]!.spawnTick })
    expect(a.prediction.pickups[3]!.generation).toBe(1)
    expect(a.prediction.loose.map((loose) => loose.id)).toEqual([7])
    expect(session.server.stats().snapshotBytes).toBe(SNAPSHOT_HEADER_BYTES + SNAPSHOT_VEHICLE_BYTES)

    // A banana the mirror takes on its own is put back as the server has it.
    setPickup(arena.map, arena.water, a.prediction.pickups[5]!, 5, 9, 0)
    session.run(0.2)
    expect(a.prediction.pickups[5]!.generation).toBe(0)

    // A newcomer is told the whole of it, as it stands now.
    const b = await session.join('tank')
    session.run(0.5)
    expect(b.client.bananas.pickups).toHaveLength(PICKUP_SLOTS)
    expect(b.prediction.pickups[3]!.generation).toBe(1)
    expect(b.prediction.loose.map((loose) => loose.id)).toEqual([7])

    // Gone on the server, gone from everyone.
    arena.loose.length = 0
    session.run(0.5)
    expect(a.prediction.loose).toHaveLength(0)
    expect(b.client.bananas.loose).toHaveLength(0)
    session.dispose()
  }, 120_000)

  it('fires what a player is holding: everyone sees the rocket go, and the car it is after feels it', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const b = await session.join('tank')
    const { arena } = session
    const aSeat = arena.seats[a.client.welcome!.seat]!
    const bSeat = arena.seats[b.client.welcome!.seat]!
    session.run(0.5)
    // The tank is put down on the road thirty metres ahead of the sports car, which is handed a rocket.
    const { position, forward } = aSeat.vehicle.frame
    bSeat.vehicle.body.setTranslation({ x: position.x + forward.x * 30, y: position.y, z: position.z + forward.z * 30 }, true)
    session.step()
    respawnNearby(arena, bSeat)
    arm(aSeat, 'rocket')
    session.run(0.5)
    expect(a.prediction.ownSeat.weapon).toBe('rocket')
    expect(b.prediction.seats[aSeat.id]!.weapon).toBe('rocket')

    // The button goes down: the rocket goes, after the tank, and the tank's mirror has it in the air too.
    a.input.fire = true
    session.run(0.3)
    a.input.fire = false
    expect(aSeat.weapon).toBe('none')
    expect(a.prediction.ownSeat.weapon).toBe('none')
    expect(arena.rockets).toHaveLength(1)
    expect(arena.rockets[0]!.target).toBe(bSeat.id)
    expect(b.prediction.rockets).toHaveLength(1)
    expect(b.prediction.rockets[0]!.id).toBe(arena.rockets[0]!.id)
    session.run(1.5)
    expect(arena.rockets).toHaveLength(0)
    expect(bSeat.vehicle.damage).toBeCloseTo(ROCKET_DAMAGE, 5)
    expect(b.prediction.vehicle.damage).toBeCloseTo(ROCKET_DAMAGE, 1)
    expect(aSeat.vehicle.damage).toBe(0)

    // A bomb dropped is numbered the same in the sports car's own prediction as on the server, so
    // it is one bomb on screen from the drop onward, not one gone and another come.
    arm(aSeat, 'bomb')
    session.run(0.5)
    a.input.fire = true
    session.run(0.05)
    a.input.fire = false
    const predicted = a.prediction.loose.find((loose) => loose.kind === 'bomb')
    expect(predicted).toBeDefined()
    expect(arena.loose.some((loose) => loose.kind === 'bomb')).toBe(false)
    session.run(0.5)
    const dropped = arena.loose.find((loose) => loose.kind === 'bomb')
    expect(dropped?.id).toBe(predicted!.id)
    expect(a.prediction.loose.filter((loose) => loose.kind === 'bomb').map((loose) => loose.id)).toEqual([dropped!.id])
    expect(b.prediction.loose.filter((loose) => loose.kind === 'bomb').map((loose) => loose.id)).toEqual([dropped!.id])

    // A machine gun, held for a second: shots the tank takes, and ammunition the sports car spends.
    arm(aSeat, 'machineGun')
    session.run(0.5)
    a.input.fire = true
    session.run(1)
    a.input.fire = false
    session.run(0.3)
    expect(bSeat.vehicle.damage).toBeGreaterThan(ROCKET_DAMAGE + 5 * MACHINE_GUN_DAMAGE)
    expect(aSeat.ammoTicks).toBeLessThan(MACHINE_GUN_AMMO_TICKS - 50)
    expect(a.prediction.ownSeat.ammoTicks).toBe(aSeat.ammoTicks)
    session.dispose()
  }, 120_000)

  it('sends a prop that is on the move to every mirror, and one nobody has touched to none', async () => {
    // A small island may have no props of its own: a few cones are set out on it for the test, and taken away after.
    const spawn = map.roads[0]!.points[0]!
    const cones = 3
    for (let k = 0; k < cones; k++) map.props.push({ kind: 'cone', x: spawn.x + k * 3, z: spawn.z, bottom: spawn.y, yaw: 0 })
    const session = new Session()
    const a = await session.join()
    const b = await session.join()
    session.run(1)
    // Everything at rest: the snapshots carry no props.
    expect(session.arena.props.length).toBeGreaterThanOrEqual(cones)
    for (const prop of session.arena.props) prop.body.sleep()
    session.run(0.5)
    expect(session.server.stats().snapshotBytes).toBe(SNAPSHOT_HEADER_BYTES + 2 * SNAPSHOT_VEHICLE_BYTES)
    // A cone knocked into the air on the server is seen flying on both mirrors.
    const cone = session.arena.props.find((prop) => prop.kind === 'cone')!
    cone.body.setLinvel({ x: 3, y: 6, z: 0 }, true)
    session.run(0.5)
    const at = cone.body.translation()
    for (const player of [a, b]) {
      const mirrored = player.prediction.props[cone.id]!.body.translation()
      expect(Math.hypot(mirrored.x - at.x, mirrored.y - at.y, mirrored.z - at.z)).toBeLessThan(1.5)
    }
    session.dispose()
    map.props.length -= cones
  }, 120_000)

  it('keeps inputs to their ranges, drops a flood of them, and lets go of a player heard nothing from', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const b = await session.join('tank')
    // Whatever is asked for, the car is driven within its ranges.
    a.input.steer = 5
    a.input.throttle = -3
    a.input.brake = Number.NaN
    session.run(0.5)
    const seat = a.client.welcome!.seat
    const seen = b.client.pump(b.input).newestSnapshot!.vehicles.find((vehicle) => vehicle.seat === seat)!
    expect(seen.appliedInput).toEqual({ steer: 1, throttle: 0, brake: 0, handbrake: false, fire: false, ability: false })

    // Inputs past what an honest client could send are dropped, not driven, and not held against them.
    const before = session.server.stats().inputsDropped
    for (let i = 0; i < 400; i++) a.wire.client.send(encodeInput(session.arena.tick + 1 + (i % 32), NEUTRAL_INPUT))
    session.run(0.2)
    expect(session.server.stats().inputsDropped - before).toBeGreaterThan(200)
    expect(a.client.closed).toBeNull()

    // Nothing heard for long enough, and the seat is given up.
    a.paused = true
    session.run(16)
    expect(a.client.closed).toBe(rejectLabel(REJECT_IDLE))
    expect(session.events).toContain(`left ${seat}`)
    expect(b.client.closed).toBeNull()
    session.dispose()
  }, 120_000)

  it('tells anyone asking which islands are busy, busiest first, and lets them go', async () => {
    const session = new Session()
    await session.join('sportsCar', 0, map.seed + 1)
    await session.join('tank')
    await session.join('pickup')
    expect(session.server.popularRooms()).toEqual([
      { seed: map.seed, players: 2 },
      { seed: map.seed + 1, players: 1 },
    ])
    // Asked over the wire: told the same, and not seated.
    expect(await fetchRooms(direct(session.server))).toEqual([
      { seed: map.seed, players: 2 },
      { seed: map.seed + 1, players: 1 },
    ])
    expect(session.server.playerCount).toBe(3)
    expect(session.events.filter((event) => event.startsWith('joined'))).toHaveLength(3)
    // A connection that goes before the answer leaves nothing to offer.
    const gone = direct(session.server)
    const empty = fetchRooms(gone)
    gone.close('gone')
    expect(await empty).toEqual([])
    // Nor does a server that cannot be reached.
    const unreachable: ClientTransport = {
      connect: () => Promise.reject(new Error('could not reach')),
      send: () => {},
      close: () => {},
    }
    expect(await fetchRooms(unreachable)).toEqual([])
    session.dispose()
  }, 120_000)
})
