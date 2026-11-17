import {
  ACHIEVEMENTS,
  COUNTDOWN_TICKS,
  FINISH_GRACE_TICKS,
  MACHINE_GUN_DAMAGE,
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  NPC_CARS,
  ROBOTS,
  STANDINGS_TICKS,
  UFOS,
  DURABILITY,
  PICKUP_SLOTS,
  ROCKET_DAMAGE,
  armorShare,
  createArena,
  initPhysics,
  keyOf,
  portalSpawn,
  respawn,
  setPickup,
  spawnHere,
  takeSeat,
  withPortals,
  type Arena,
  type Loose,
  type Seat,
  type VehicleInput,
  type VehicleProfileId,
} from '@buggies/game'
import { uprightRotation, vdistance, type Vec3 } from '@buggies/physics'
import {
  ROAD_TUNNEL,
  STREET_WIDTH,
  generateWorld,
  groundDistance,
  moonOf,
  tangentFrame,
  upOf,
  type World,
  type WorldProp,
} from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { ConnectionFailure, NetClient } from './client.ts'
import { LobbyClient } from './lobby.ts'
import { newSecretKey, publicKeyOf } from './nostr.ts'
import { MemoryPlayerStore } from './player-store.ts'
import { LocalPrediction } from './prediction.ts'
import {
  INPUT_TIMELINE_TICKS,
  MS_PER_TICK,
  NO_SEAT,
  REJECT_IDLE,
  SLOTS_MOST,
  TICKS_PER_SECOND,
  TICKS_PER_SNAPSHOT,
  rejectLabel,
} from './protocol.ts'
import { SLOTS_START, gameStatus } from './game-registry.ts'
import { GameServer, ROOM_CLOSED, type ArenaRequest } from './server.ts'
import type { ClientTransport, ClientTransportHandlers, TransportConnection, TransportHandlers } from './transport.ts'
import {
  NO_ARRIVAL,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_ROBOT_BYTES,
  SNAPSHOT_UFO_BYTES,
  SNAPSHOT_VEHICLE_BYTES,
  decodeSnapshot,
  encodeInput,
  rulesOf,
  type GameMode,
  type GameOptions,
  type GameSlotView,
  type GameSummary,
  type WelcomeMessage,
} from './wire.ts'

/** The bananas a seat has been paid for its feats, on top of whatever else it holds. */
function paidForFeats(seat: Seat): number {
  return ACHIEVEMENTS.reduce((sum, achievement) => sum + (seat.progress.earned[achievement.id] === 1 ? achievement.reward : 0), 0)
}

/** Each world, by its id, made once: making one takes seconds. */
const worlds = new Map<number, World>()
function worldOf(id: number): World {
  let known = worlds.get(id)
  if (known === undefined) {
    known = generateWorld(id)
    worlds.set(id, known)
  }
  return known
}

/** What every snapshot carries while nothing else changes: the saucers and the robots, which never stop. A planet has no spiders. */
const STEADY_BYTES = SNAPSHOT_HEADER_BYTES + UFOS * SNAPSHOT_UFO_BYTES + ROBOTS * SNAPSHOT_ROBOT_BYTES

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
  /** Every message delivered to the client side, in order, for a test that reads the wire itself. */
  readonly received: Uint8Array[] = []

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
      const payload = this.toClient.shift()!.payload
      this.received.push(payload)
      this.clientHandlers?.onMessage(payload)
    }
  }

  private drop(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.server.onClose(this.connection)
    this.clientHandlers?.onClose(reason)
  }
}

/** A tab on the start screen: one lobby connection, in a game or browsing them. */
interface Tab {
  readonly client: LobbyClient
  readonly wire: Loopback
  readonly name: string
  readonly key: Uint8Array | null
}

interface Player {
  client: NetClient
  prediction: LocalPrediction
  wire: Loopback
  /** The tab the seat belongs to: its member is the pass the world connection drives with. */
  readonly tab: Tab
  readonly profile: VehicleProfileId
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

/** A connection watching a world without a seat in it: the welcome, the plan and the snapshots, and no input at all. */
interface Watcher {
  client: NetClient
  wire: Loopback
  welcome: WelcomeMessage
}

const DELAY_TICKS = 3

let map: World

/** A server, its games, and a way of putting players on it, all on one fake clock. */
class Session {
  readonly clock = { tick: 0 }
  readonly server: GameServer
  readonly tabs: Tab[] = []
  readonly players: Player[] = []
  readonly watchers: Watcher[] = []
  readonly events: string[] = []
  /** Whether the server is busy with something else, neither stepping nor reading nor sending. */
  serverStalled = false
  /** What the server keeps of each player's key, the keys it has taken players to have, and the feats it has paid, as seat and feat. */
  readonly store = new MemoryPlayerStore()
  readonly signedIn: string[] = []
  readonly achieved: string[] = []
  /** The free drive every player who does not make or join a game of their own plays in. */
  freeDrive = 0
  /** Cars nobody drives, a world at a time. */
  private readonly npcs: number
  /** Whether the server keeps its demo race going, and the seed it draws for it. */
  private readonly demoOn: boolean
  private readonly demoSeed: number
  private readonly arenaMaker: (request: ArenaRequest) => Arena | Promise<Arena>

  constructor(
    options: { npcs?: number; arenaFor?: (request: ArenaRequest) => Arena | Promise<Arena>; demo?: boolean; demoSeed?: number } = {},
  ) {
    this.npcs = options.npcs ?? 0
    // A demo race makes worlds of a seed nobody chose, which is seconds of the test's time: only a test of the demo asks for one.
    this.demoOn = options.demo ?? false
    this.demoSeed = options.demoSeed ?? map.seed
    this.arenaMaker = options.arenaFor ?? ((request) => this.makeArena(request))
    this.server = new GameServer(
      { worldFor: (world) => worldOf(world), arenaFor: (request) => this.arenaMaker(request) },
      {
        onJoined: (seat, _connection, room) => this.events.push(`joined ${room.game}:${room.world} ${seat.id}`),
        onLeft: (seat, _connection, room) => this.events.push(`left ${room.game}:${room.world} ${seat.id}`),
        onRejected: (_, reason) => this.events.push(`rejected: ${reason}`),
        onRespawned: (seat, why) => this.events.push(`respawned ${seat.id} ${why}`),
        onChangedVehicle: (seat) => this.events.push(`changed ${seat.id} ${seat.profile}`),
        onAchieved: (seat, achievement) => this.achieved.push(`${seat.id} ${achievement.id}`),
        onSignedIn: (_, pubkey) => this.signedIn.push(pubkey),
        onGameOpened: (game) => this.events.push(`opened game ${game.id} ${game.options.mode}`),
        onGameStarted: (game) => this.events.push(`started game ${game.id}`),
        onGameFinished: (game) => this.events.push(`finished game ${game.id}`),
        onGameClosed: (game) => this.events.push(`closed game ${game.id}`),
        onCourseFailed: (game, reason) => this.events.push(`no course for game ${game.id}: ${reason}`),
        onRoomOpened: (room) => this.events.push(`opened ${room.game}:${room.world}`),
        onRoomClosed: (room) => this.events.push(`closed ${room.game}:${room.world}`),
      },
      this.npcs,
      this.store,
      { demo: this.demoOn, demoSeed: () => this.demoSeed },
    )
  }

  /** An arena for a room, as the real server makes one: the world with only the portals the request keeps, and the game's rules. */
  makeArena(request: ArenaRequest): Arena {
    const world = worldOf(request.world)
    const planet = request.keep === null ? world : withPortals(world, request.keep)
    return createArena(planet, MAX_PLAYERS, { weapons: request.weapons, bananas: request.bananas })
  }

  /** The server's arena for a world of a game, which is not always the one the session started on. */
  arenaOf(game = this.freeDrive, world = map.seed): Arena {
    return this.server.roomFor(game, world)!.arena
  }

  get arena(): Arena {
    return this.arenaOf()
  }

  get nowMs(): number {
    return this.clock.tick * MS_PER_TICK
  }

  /** A tab on the start screen, under a name and with a nostr key of its own unless given one. */
  async tab(name = '', key: Uint8Array | null = newSecretKey(), jitterTicks = 0): Promise<Tab> {
    const wire = new Loopback(this.server, DELAY_TICKS, this.clock, jitterTicks)
    const client = new LobbyClient(wire.client, key, {})
    const tab: Tab = { client, wire, name, key }
    this.tabs.push(tab)
    await this.settle(client.connect(name))
    return tab
  }

  /**
   * Have a tab make a game of its own, and be its host in it: a race, or a
   * free drive its host has switched it over to, with the last of its bot's
   * slots left to bots and the rest taken out.
   */
  async host(tab: Tab, mode: GameMode, vehicle: VehicleProfileId, bots = 0): Promise<number> {
    const before = tab.client.game()?.id ?? 0
    tab.client.create(vehicle)
    await this.until(() => (tab.client.game()?.id ?? 0) !== before && tab.client.game()!.you !== 0)
    const made = tab.client.game()!
    if (mode === 'free') await this.edit(tab, { ...made.options, mode: 'free' })
    await this.leaveBots(tab, bots)
    return made.id
  }

  /** Take a game's bot slots out until it has as many left as asked for, the last of them first. */
  async leaveBots(tab: Tab, bots: number): Promise<void> {
    for (;;) {
      const slots = tab.client.game()?.slots ?? []
      if (slots.filter((slot) => slot.bot).length <= bots) return
      let at = slots.length - 1
      while (at >= 0 && !slots[at]!.bot) at -= 1
      if (at < 0) return
      tab.client.removeSlot(at)
      const before = slots.length
      await this.until(() => (tab.client.game()?.slots.length ?? before) < before)
    }
  }

  /** Have a tab join a game by its id, its host making room for it in a bot's slot if every slot is a player's. */
  async joinGame(tab: Tab, id: number, vehicle: VehicleProfileId): Promise<void> {
    if (tab.client.game()?.id !== id) await this.roomIn(id)
    tab.client.join(id, vehicle)
    await this.until(() => tab.client.game()?.id === id && tab.client.game()!.you !== 0)
  }

  /** Have the host of a game add a bot's slot to it, if every slot of it is a player's already. */
  private async roomIn(id: number): Promise<void> {
    const hosting = this.tabs.find((tab) => {
      const game = tab.client.game()
      return game !== null && game.id === id && game.you !== 0 && game.you === game.host
    })
    const game = hosting?.client.game()
    if (hosting === undefined || game === null || game === undefined || game.slots.some((slot) => slot.bot)) return
    hosting.client.addSlot()
    await this.until(() => hosting.client.game()!.slots.some((slot) => slot.bot))
  }

  /** Have a game's host change its world and rules, and wait for everyone to be told. */
  async edit(host: Tab, options: GameOptions): Promise<void> {
    const before = JSON.stringify(host.client.game()!.options)
    host.client.edit(options)
    await this.until(() => JSON.stringify(host.client.game()!.options) !== before)
  }

  /** Have a tab say it is ready, in a vehicle, and wait for the room to say so. */
  async ready(tab: Tab, vehicle: VehicleProfileId, ready = true): Promise<void> {
    const mine = (): GameSlotView | undefined => tab.client.game()?.slots.find((slot) => slot.member === tab.client.game()!.you)
    tab.client.ready(vehicle, ready)
    await this.until(() => mine()?.ready === ready && mine()?.vehicle === vehicle)
  }

  /** The harness's shared free drive, made by a tab of its own the first time anyone asks. */
  async shared(): Promise<number> {
    if (this.freeDrive !== 0) return this.freeDrive
    const host = await this.tab('host', null)
    this.freeDrive = await this.host(host, 'free', 'sportsCar')
    return this.freeDrive
  }

  /**
   * A player: a tab of its own in the shared free drive, ready in a vehicle,
   * and seated in a world of it, with a mirror of that world running.
   */
  async join(
    profile: VehicleProfileId = 'sportsCar',
    jitterTicks = 0,
    seed = map.seed,
    arrival = NO_ARRIVAL,
    name = '',
    key: Uint8Array | null = newSecretKey(),
  ): Promise<Player> {
    const game = await this.shared()
    const tab = await this.tab(name, key, jitterTicks)
    await this.joinGame(tab, game, profile)
    return this.play(tab, profile, seed, arrival)
  }

  /** Be ready, and go into a world of the game the tab is in. */
  async play(tab: Tab, profile: VehicleProfileId, seed = map.seed, arrival = NO_ARRIVAL): Promise<Player> {
    await this.ready(tab, profile)
    const { client, wire, prediction } = await this.open(tab, profile, seed, arrival)
    const player: Player = {
      client,
      wire,
      prediction,
      tab,
      profile,
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

  /**
   * Open a world connection for a player's tab: the same member, and so the
   * same pass, at every portal and after every dropped connection.
   */
  async enter(player: Player, seed = map.seed, arrival = NO_ARRIVAL): Promise<WelcomeMessage> {
    const opened = await this.open(player.tab, player.profile, seed, arrival)
    player.prediction.dispose()
    player.wire = opened.wire
    player.client = opened.client
    player.prediction = opened.prediction
    return opened.welcome
  }

  /** A world connection and the mirror of the world it is welcomed to, for a tab that is in a game. */
  private async open(
    tab: Tab,
    profile: VehicleProfileId,
    seed: number,
    arrival: number,
  ): Promise<{ client: NetClient; wire: Loopback; prediction: LocalPrediction; welcome: WelcomeMessage }> {
    const game = tab.client.game()
    if (game === null) throw new Error('this tab is in no game')
    const wire = new Loopback(this.server, DELAY_TICKS, this.clock, 0)
    const client = new NetClient(wire.client, () => this.nowMs, {}, tab.key)
    const welcoming = client.connect(profile, seed, game.id, arrival, game.drivePass, tab.name)
    welcoming.catch(() => undefined)
    // Its mirror is only made once the server has said where it is and, in a race, which gates this world holds.
    const welcome = await this.settle(welcoming, wire)
    const plan = await client.racePlan()
    const planet = plan === null ? worldOf(welcome.seed) : withPortals(worldOf(welcome.seed), plan.keep)
    const mirror = createArena(planet, MAX_PLAYERS, rulesOf(welcome.flags))
    takeSeat(mirror, welcome.seat, welcome.profile)
    const prediction = new LocalPrediction(mirror, welcome.seat, welcome.epoch, client.startTick(), client.bananas)
    return { client, wire, prediction, welcome }
  }

  /** Cut a player's world connection and open another, as a page that lost its link does. */
  async rejoin(player: Player, arrival = NO_ARRIVAL): Promise<WelcomeMessage> {
    player.client.close('cut off')
    await this.run(0.2)
    return this.enter(player, player.client.welcome()?.seed ?? map.seed, arrival)
  }

  /** Watch a world of a game without a seat in it, as a start screen's background does. */
  async watch(game: number, world: number): Promise<Watcher> {
    const wire = new Loopback(this.server, DELAY_TICKS, this.clock, 0)
    const client = new NetClient(wire.client, () => this.nowMs, {})
    const welcoming = client.watch(game, world)
    welcoming.catch(() => undefined)
    const welcome = await this.settle(welcoming, wire)
    const watcher: Watcher = { client, wire, welcome }
    this.watchers.push(watcher)
    return watcher
  }

  /** Turn the crank until a promise settles, stepping the session meanwhile. */
  async settle<T>(pending: Promise<T>, extraWire: Loopback | null = null): Promise<T> {
    let settled = false
    pending.then(
      () => (settled = true),
      () => (settled = true),
    )
    for (let i = 0; i < 600 && !settled; i++) {
      await Promise.resolve()
      this.step(extraWire === null ? [] : [extraWire])
    }
    return pending
  }

  /** Step until something is so. */
  async until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 1200 && !condition(); i++) {
      await Promise.resolve()
      this.step()
    }
    if (!condition()) throw new Error('the session never got there')
  }

  /** One server tick, with every connected client pumping once. */
  step(extraWires: Loopback[] = []): void {
    if (!this.serverStalled) this.server.advance()
    this.clock.tick += 1
    if (!this.serverStalled) {
      for (const tab of this.tabs) tab.wire.deliver()
      for (const player of this.players) player.wire.deliver()
      for (const watcher of this.watchers) watcher.wire.deliver()
      for (const wire of extraWires) wire.deliver()
    }
    for (const player of this.players) {
      if (player.paused) continue
      const update = player.client.pump(player.input)
      // Where the watched car stood in the mirror before the server's word,
      // against where the replay puts it at the same tick: the correction.
      const watched = player.watching === null ? null : player.prediction.seats[player.watching]!.vehicle
      const before = watched === null ? null : { ...watched.frame.position }
      const outcome = player.prediction.reconcile(update.newestSnapshot)
      if (watched !== null && before !== null && outcome === 'replayed') {
        player.largestWatchedCorrection = Math.max(player.largestWatchedCorrection, distance(before, watched.frame.position))
      }
      player.prediction.advance(update, (tick, input) => player.client.sendInput(tick, input))
      player.pumps += 1
      if (player.prediction.stats.lastSteps !== 1) player.unevenPumps += 1
    }
  }

  async run(seconds: number): Promise<void> {
    for (let i = 0; i < Math.round(seconds * TICKS_PER_SECOND); i++) {
      await Promise.resolve()
      this.step()
    }
  }

  serverPositionOf(player: Player): { x: number; y: number; z: number } {
    // In the room the player was welcomed to, which is not always the one the session started on.
    const welcome = player.client.welcome()!
    const { arena } = this.server.roomFor(player.tab.client.game()!.id, welcome.seed)!
    return { ...arena.seats[welcome.seat]!.vehicle.frame.position }
  }

  predictedPositionOf(player: Player): { x: number; y: number; z: number } {
    return { ...player.prediction.vehicle.frame.position }
  }

  dispose(): void {
    for (const player of this.players) player.prediction.dispose()
    for (const tab of this.tabs) tab.client.close('done')
    for (const watcher of this.watchers) watcher.client.close('done')
    this.server.dispose()
  }
}

/** How far a position is from the nearest road's centerline on a planet. */
function offRoad(map: World, position: Vec3): number {
  // Along the ground: every point brought down to the planet's radius, so a car's ride height over the road is no distance from it.
  const down = (p: Vec3): Vec3 => {
    const length = Math.hypot(p.x, p.y, p.z)
    return { x: (p.x / length) * map.radius, y: (p.y / length) * map.radius, z: (p.z / length) * map.radius }
  }
  const at = down(position)
  let nearest = Infinity
  for (const road of map.roads) {
    const count = road.closed ? road.points.length : road.points.length - 1
    for (let i = 0; i < count; i++) {
      const a = down(road.points[i]!)
      const b = down(road.points[(i + 1) % road.points.length]!)
      const vx = b.x - a.x
      const vy = b.y - a.y
      const vz = b.z - a.z
      const t = Math.min(Math.max(((at.x - a.x) * vx + (at.y - a.y) * vy + (at.z - a.z) * vz) / (vx * vx + vy * vy + vz * vz || 1), 0), 1)
      nearest = Math.min(nearest, vdistance(at, { x: a.x + vx * t, y: a.y + vy * t, z: a.z + vz * t }))
    }
  }
  return nearest
}

/**
 * Put one car on an open stretch of the highway, and another so far ahead
 * of it along the road, both facing the same way: out in the open, on the
 * ground or a bridge, with nothing but road between them.
 */
function lineUp(arena: Arena, first: Seat, second: Seat, meters: number): void {
  const road = arena.planet.roads.find((candidate) => candidate.kind === 'highway')!
  const count = road.points.length
  const at = (i: number): Vec3 => road.points[((i % count) + count) % count]!
  for (let start = 0; start < count; start++) {
    let end = start
    let gone = 0
    let open = true
    while (gone < meters + 20 && open) {
      open = road.structure[((end % count) + count) % count] !== ROAD_TUNNEL
      gone += vdistance(at(end + 1), at(end))
      end += 1
    }
    if (!open) continue
    const put = (seat: Seat, i: number): void => {
      const point = at(i)
      const next = at(i + 1)
      respawn(seat, spawnHere(point, { x: next.x - point.x, y: next.y - point.y, z: next.z - point.z }))
    }
    let ahead = start
    for (let walked = 0; walked < meters; ahead++) walked += vdistance(at(ahead + 1), at(ahead))
    put(first, start)
    put(second, ahead)
    return
  }
  throw new Error('no open stretch of highway')
}

/** How far apart two points are along the ground. */
const distance = groundDistance

/** The seats the bots of a game's world hold, by the seat each is in; none where its room is not open. */
function botsIn(session: Session, game: number, world: number): Seat[] {
  const room = session.server.roomFor(game, world)
  return room === undefined ? [] : [...room.bots.keys()].map((id) => room.arena.seats[id]!)
}

/**
 * Drive one racer through every gate of every leg of its course, in order,
 * and on through the portal each leg leads by, leaving it home at the end
 * of the last: the whole race, by the same rules a driver on the road meets.
 */
async function driveCourse(session: Session, racer: Player): Promise<void> {
  for (;;) {
    const plan = (await racer.client.racePlan())!
    const welcome = racer.client.welcome()!
    const { arena } = session.server.roomFor(racer.tab.client.game()!.id, welcome.seed)!
    const seat = arena.seats[welcome.seat]!
    for (const gate of plan.checkpoints) {
      respawn(seat, spawnHere(gate.at, gate.forward))
      await session.run(0.2)
    }
    if (plan.next === null) return
    await session.enter(racer, plan.next.world, plan.next.arrival)
  }
}

/** A prop standing on a point of the ground, facing any way. */
function propAt(kind: WorldProp['kind'], at: Vec3): WorldProp {
  const up = upOf(at)
  return { kind, at: { ...at }, turn: uprightRotation(up, tangentFrame(up).east) }
}

describe('a session', () => {
  beforeAll(async () => {
    await initPhysics()
    map = worldOf(5)
  }, 120_000)

  it('seats two players who each see the other driving', async () => {
    const session = new Session()
    const a = await session.join('pickup')
    const b = await session.join('raceCar')
    expect(a.client.welcome()!.seat).not.toBe(b.client.welcome()!.seat)
    expect(a.client.welcome()!.seed).toBe(map.seed)
    expect(session.events).toContain(`opened ${session.freeDrive}:${map.seed}`)
    expect(session.events).toContain(`joined ${session.freeDrive}:${map.seed} 0`)

    a.input.throttle = 1
    await session.run(4)

    // A drove; the server moved A; B was told, and shows A where the server has it.
    const aOnServer = session.serverPositionOf(a)
    expect(distance(aOnServer, session.arena.seats[0]!.spawn.position)).toBeGreaterThan(10)
    const aSeenByB = b.client.sample().find((state) => state.seat === a.client.welcome()!.seat)!
    expect(aSeenByB.profile).toBe('pickup')
    // Drawn a little behind the present on purpose, never far.
    expect(distance(aSeenByB.position, aOnServer)).toBeLessThan(8)
    expect(aSeenByB.speed).toBeGreaterThan(3)

    // B only rolled (no brake was held, and a spawn can be on a slope), and A
    // sees B where the server has B.
    const bOnServer = session.serverPositionOf(b)
    expect(distance(bOnServer, session.arena.seats[1]!.spawn.position)).toBeLessThan(20)
    const bSeenByA = a.client.sample().find((state) => state.seat === b.client.welcome()!.seat)!
    expect(bSeenByA.profile).toBe('raceCar')
    expect(bSeenByA.speed).toBeLessThan(8)
    expect(distance(bSeenByA.position, bOnServer)).toBeLessThan(2)
    expect(session.server.playerCount()).toBe(2)
    session.dispose()
  }, 120_000)

  it('predicts the local car ahead of the server and keeps it in line', async () => {
    const session = new Session()
    const a = await session.join()
    a.input.throttle = 1
    a.input.steer = 0.3
    await session.run(5)

    // Inputs have learned to arrive just ahead of their tick over this wire:
    // a round trip, plus the slack they keep, and the car runs that far ahead of the server.
    expect(a.client.leadTicks()).toBeGreaterThanOrEqual(DELAY_TICKS * 2)
    expect(a.client.leadTicks()).toBeLessThanOrEqual(DELAY_TICKS * 2 + TICKS_PER_SNAPSHOT + 3)
    expect(a.client.acknowledgedInputTick()).toBeGreaterThan(0)
    expect(a.prediction.stats.ticksAheadOfServer).toBeGreaterThan(0)
    expect(a.prediction.stats.ticksAheadOfServer).toBeLessThan(INPUT_TIMELINE_TICKS / 2)
    expect(session.server.stats().inputsHeld).toBeLessThan(TICKS_PER_SECOND)

    // The prediction reconciles every snapshot with a small correction, never
    // a snap: identical physics from identical inputs should barely disagree.
    expect(a.prediction.stats.replayHorizonTicks).toBeGreaterThan(0)
    expect(a.prediction.stats.lastCorrectionMeters).toBeLessThan(0.5)
    expect(a.prediction.stats.hardResyncs).toBeLessThanOrEqual(1)

    // Predicted where the server will put it, give or take the lead.
    const predicted = session.predictedPositionOf(a)
    await session.run(a.prediction.stats.ticksAheadOfServer / TICKS_PER_SECOND)
    expect(distance(predicted, session.serverPositionOf(a))).toBeLessThan(1.5)
    session.dispose()
  }, 120_000)

  it('plays on a planet: the car set down upright on the sphere, and its prediction kept in line with the server as it drives', async () => {
    const earlier = map
    map = worldOf(1)
    try {
      const session = new Session()
      const a = await session.join('sportsCar')
      a.input.throttle = 1
      let worst = 0
      for (let i = 0; i < 5 * TICKS_PER_SECOND; i++) {
        await session.step()
        worst = Math.max(worst, a.prediction.stats.lastCorrectionMeters)
      }
      const seat = session.arena.seats[a.client.welcome()!.seat]!
      expect(seat.vehicle.wrecked).toBe(false)
      expect(a.prediction.vehicle.speed).toBeGreaterThan(15)
      const { up, frame } = seat.vehicle
      expect(up.x * frame.up.x + up.y * frame.up.y + up.z * frame.up.z).toBeGreaterThan(0.9)
      expect(worst).toBeLessThan(0.5)
      session.dispose()
    } finally {
      map = earlier
    }
  }, 180_000)

  it('keeps the fastest car in line at full speed, snapshot after snapshot', async () => {
    const session = new Session()
    // On a planet whose highway runs straight from the spawn for as long as it takes to reach full speed, and no longer.
    const a = await session.join('raceCar', 0, worldOf(11).seed)
    a.input.throttle = 1
    let worst = 0
    for (let i = 0; i < 5 * TICKS_PER_SECOND; i++) {
      await session.step()
      worst = Math.max(worst, a.prediction.stats.lastCorrectionMeters)
    }
    expect(a.prediction.vehicle.speed).toBeGreaterThan(40)
    // Corrections at speed stay a small fraction of a car length: anything
    // more shows as the car jumping about.
    expect(worst).toBeLessThan(0.5)
    expect(a.prediction.stats.hardResyncs).toBeLessThanOrEqual(1)
    session.dispose()
  }, 120_000)

  it('carries a car far off along in the mirror without simulating it, and simulates it again once it comes near', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const b = await session.join('sportsCar')
    const own = session.arena.seats[a.client.welcome()!.seat]!
    const other = session.arena.seats[b.client.welcome()!.seat]!
    const mirrored = (): Seat => a.prediction.seats[other.id]!
    // Far down the highway: out of the mirror's world, coasting round the planet on the server's word.
    lineUp(session.arena, own, other, 200)
    await session.run(1)
    expect(mirrored().coasting).toBe(true)
    expect(mirrored().vehicle.body.isEnabled()).toBe(false)
    expect(a.prediction.seats[own.id]!.coasting).toBe(false)
    // Still where the server has it, near enough.
    const told = session.serverPositionOf(b)
    const seen = mirrored().vehicle.body.translation()
    expect(Math.hypot(seen.x - told.x, seen.y - told.y, seen.z - told.z)).toBeLessThan(3)
    // Come near, it is in the world again, to be run into.
    lineUp(session.arena, own, other, 20)
    await session.run(1)
    expect(mirrored().coasting).toBe(false)
    expect(mirrored().vehicle.body.isEnabled()).toBe(true)
    // The server never coasts anyone.
    expect(session.arena.seats.some((seat) => seat.coasting)).toBe(false)
    session.dispose()
  }, 120_000)

  it("keeps another player's car steady in the mirror, driving straight or weaving", async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const b = await session.join('sportsCar')
    a.watching = b.client.welcome()!.seat
    // Not flat out: at full speed the car outruns the bend in the highway ahead of the spawn.
    b.input = { ...NEUTRAL_INPUT, throttle: 0.6 }
    await session.run(5)
    expect(session.serverPositionOf(b).x).not.toBe(session.predictedPositionOf(a).x)
    // Straight and steady, the mirror's guess is right and stays right.
    expect(a.largestWatchedCorrection).toBeLessThan(0.6)

    // Weaving, every change of steering is a surprise to the mirror, and
    // each one is a nudge, not a jump.
    a.largestWatchedCorrection = 0
    for (let i = 0; i < 8; i++) {
      b.input = { ...NEUTRAL_INPUT, throttle: 0.6, steer: i % 2 === 0 ? 0.4 : -0.4 }
      await session.run(0.5)
    }
    expect(a.largestWatchedCorrection).toBeGreaterThan(0)
    expect(a.largestWatchedCorrection).toBeLessThan(1.5)
    session.dispose()
  }, 120_000)

  it('runs the local car one tick per step through a jittery wire, with rare nudges', async () => {
    const session = new Session()
    // Every message up to three ticks late on top of the wire's delay, so
    // snapshots arrive in fits and starts.
    const a = await session.join('sportsCar', 3)
    a.input = { ...NEUTRAL_INPUT, throttle: 1, steer: 0.2 }
    await session.run(2)
    a.pumps = 0
    a.unevenPumps = 0
    await session.run(8)
    // The car is stepped once per fixed step nearly every time: it never
    // lurches or stalls to follow the arrivals.
    expect(a.unevenPumps / a.pumps).toBeLessThan(0.03)
    expect(a.prediction.stats.lastCorrectionMeters).toBeLessThan(0.5)
    expect(a.prediction.stats.hardResyncs).toBeLessThanOrEqual(1)
    expect(a.client.leadTicks()).toBeLessThanOrEqual(DELAY_TICKS * 2 + 3 + TICKS_PER_SNAPSHOT + 3)
    session.dispose()
  }, 120_000)

  it('catches up a client that spent seconds generating its map before it first drove', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    // Welcomed, then busy for three seconds while the server runs on and
    // its snapshots pile up on the wire.
    a.paused = true
    await session.run(3)
    a.paused = false
    a.input = { ...NEUTRAL_INPUT, throttle: 1 }
    const before = session.serverPositionOf(a)
    const heldBefore = session.server.stats().inputsHeld
    await session.run(4)
    // The car drives: its inputs reach the server on ticks it will accept,
    // within a moment of the client coming back.
    expect(distance(before, session.serverPositionOf(a))).toBeGreaterThan(20)
    expect(session.server.stats().inputsHeld - heldBefore).toBeLessThan(TICKS_PER_SECOND)
    // The mirror sits its lead ahead of the server, not seconds ahead or behind.
    expect(a.prediction.stats.ticksAheadOfServer).toBeGreaterThan(0)
    expect(a.prediction.stats.ticksAheadOfServer).toBeLessThan(INPUT_TIMELINE_TICKS / 2)
    expect(a.prediction.stats.lastCorrectionMeters).toBeLessThan(0.5)
    expect(a.prediction.stats.hardResyncs).toBeLessThanOrEqual(2)
    session.dispose()
  }, 120_000)

  it('lets a driver carry on once the server is back from seconds spent on something else', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    a.input = { ...NEUTRAL_INPUT, throttle: 1 }
    await session.run(2)
    // The server is busy for three seconds, making another world, and
    // then picks up where it left off: its clock is now that far behind.
    session.serverStalled = true
    await session.run(3)
    session.serverStalled = false
    await session.run(1)
    const before = session.serverPositionOf(a)
    const resyncsBefore = a.prediction.stats.hardResyncs
    await session.run(3)
    // The car drives on the server again, and the mirror holds its lead
    // over the server's new clock rather than the one it had before.
    expect(distance(before, session.serverPositionOf(a))).toBeGreaterThan(20)
    expect(a.prediction.stats.ticksAheadOfServer).toBeGreaterThan(0)
    expect(a.prediction.stats.ticksAheadOfServer).toBeLessThan(INPUT_TIMELINE_TICKS / 2)
    expect(a.prediction.stats.hardResyncs - resyncsBefore).toBe(0)
    expect(a.prediction.stats.lastCorrectionMeters).toBeLessThan(0.5)
    session.dispose()
  }, 120_000)

  it('sets a player come through a portal down out of the one they arrive by, beside whoever came with them', async () => {
    const session = new Session()
    const moon = moonOf(map.seed)
    const a = await session.join('sportsCar', 0, moon, 0)
    const b = await session.join('sportsCar', 0, moon, 0)
    expect(a.client.welcome()!.seed).toBe(moon)
    await session.run(0.5)
    const world = worldOf(moon)
    const exit = portalSpawn(world, 0)!
    const at = session.serverPositionOf(a)
    expect(Math.hypot(at.x - exit.position.x, at.y - exit.position.y, at.z - exit.position.z)).toBeLessThan(2)
    // The second out stands beside the first, not on it.
    expect(distance(session.serverPositionOf(b), at)).toBeGreaterThan(2)
    session.dispose()
  }, 120_000)

  it('carries what a player held through a portal, for the pass its member drives with, and nobody else', async () => {
    const session = new Session()
    const a = await session.join()
    const seat = session.arena.seats[a.client.welcome()!.seat]!
    seat.score = 7
    seat.collected = 12
    const game = a.tab.client.game()!
    expect(game.drivePass).not.toBe(0)
    // The same tab goes on to the moon: the same member, and so the same pass, with what it held.
    const moon = moonOf(map.seed)
    const welcome = await session.enter(a, moon, 0)
    expect(welcome.seed).toBe(moon)
    await session.run(0.2)
    const moonArena = session.arenaOf(game.id, moon)
    const carried = moonArena.seats[welcome.seat]!
    expect(carried.score).toBe(7 + paidForFeats(carried))
    expect(carried.collected).toBe(12)

    // A pass no member of the game drives with gets a connection nowhere.
    const stranger = new Loopback(session.server, DELAY_TICKS, session.clock, 0)
    const client = new NetClient(stranger.client, () => session.nowMs, {})
    const refusing = client.connect('sportsCar', moon, game.id, NO_ARRIVAL, (game.drivePass ^ 1) >>> 0, 'Cy')
    await expect(session.settle(refusing, stranger)).rejects.toBeInstanceOf(ConnectionFailure)
    session.dispose()
  }, 120_000)

  it('puts a player who lost the connection back where they were, with what they held', async () => {
    const session = new Session()
    const a = await session.join()
    a.input.throttle = 1
    await session.run(3)
    const seat = session.arena.seats[a.client.welcome()!.seat]!
    seat.score = 7
    const at = { ...session.serverPositionOf(a) }
    expect(distance(at, seat.spawn.position)).toBeGreaterThan(5)
    const welcome = await session.rejoin(a)
    const backSeat = session.arena.seats[welcome.seat]!
    expect(backSeat.score - paidForFeats(backSeat)).toBe(7)
    expect(distance(session.serverPositionOf(a), at)).toBeLessThan(3)
    session.dispose()
  }, 120_000)

  it('lets go of a connection that has gone quiet when its player joins again with its pass', async () => {
    const session = new Session()
    const a = await session.join()
    const seat = session.arena.seats[a.client.welcome()!.seat]!
    seat.score = 7
    // Cut off without the connection closing: the server still has them seated.
    const cut = a.client
    a.paused = true
    await session.run(0.2)

    // Back with the same pass, the connection the server still had is let go, once.
    const welcome = await session.enter(a)
    expect(session.server.playerCount()).toBe(1)
    expect(session.server.roomCount()).toBe(1)
    const backSeat = session.arena.seats[welcome.seat]!
    expect(backSeat.score - paidForFeats(backSeat)).toBe(7)
    expect(cut.closed()).toBe('joined again')
    session.dispose()
  }, 120_000)

  it('gives up on a server that has said nothing for seconds', async () => {
    const session = new Session()
    const a = await session.join()
    await session.run(1)
    session.serverStalled = true
    await session.run(6)
    expect(a.client.closed()).toBe('nothing heard from the server')
    session.dispose()
  }, 120_000)

  it('puts a player back on request, and the prediction follows the new epoch', async () => {
    const session = new Session()
    const a = await session.join()
    a.input.throttle = 1
    await session.run(3)
    expect(distance(session.serverPositionOf(a), session.arena.seats[0]!.spawn.position)).toBeGreaterThan(5)

    const resyncs = a.prediction.stats.hardResyncs
    a.input.throttle = 0
    a.client.requestRespawn()
    await session.run(1)
    expect(session.events).toContain('respawned 0 asked')
    // Back on the road nearest to where it was, within its roadway, not at its spawn, and the prediction there with it.
    expect(offRoad(session.arena.planet, session.serverPositionOf(a))).toBeLessThan(STREET_WIDTH / 2)
    expect(a.prediction.stats.hardResyncs).toBe(resyncs + 1)
    expect(distance(session.predictedPositionOf(a), session.serverPositionOf(a))).toBeLessThan(1)
    session.dispose()
  }, 120_000)

  it('makes a game, has another join it, hands the host on when the host leaves, and tells everyone live', async () => {
    const session = new Session()
    const browse = await session.tab('Watcher', null)
    expect(browse.client.games()).toEqual([])

    const ada = await session.tab('Ada')
    const game = await session.host(ada, 'race', 'sportsCar', 3)
    // The start screen is told of it without asking again: a race of the host's and three bots'.
    await session.until(() => browse.client.games().length === 1)
    expect(browse.client.games()[0]).toMatchObject({ id: game, mode: 'race', status: 'open', host: 'Ada', humans: 1, slots: 4, leader: 0, demo: false })
    expect(ada.client.game()).toMatchObject({ id: game, you: 1, host: 1, options: { mode: 'race' } })
    expect(ada.client.game()!.slots.map((slot) => [slot.name, slot.bot])).toEqual([
      ['Ada', false],
      ['Axle', true],
      ['Bolt', true],
      ['Cinder', true],
    ])

    const bo = await session.tab('Bo')
    await session.joinGame(bo, game, 'tank')
    await session.until(() => browse.client.games()[0]?.humans === 2)
    // Everyone in the room sees the newcomer take a bot's slot, in the vehicle they chose.
    await session.until(() => ada.client.game()!.slots.filter((slot) => !slot.bot).length === 2)
    expect(ada.client.game()!.slots.map((slot) => [slot.name, slot.vehicle, slot.bot])).toEqual([
      ['Ada', 'sportsCar', false],
      ['Bo', 'tank', false],
      ['Bolt', 'police', true],
      ['Cinder', 'goKart', true],
    ])

    // The host leaving hands the game on to the earliest member left, and the room is told.
    ada.client.leave()
    await session.until(() => bo.client.game()?.host === 2)
    expect(ada.client.game()!.you).toBe(0)
    await session.until(() => browse.client.games()[0]?.host === 'Bo')
    // And its slot a bot's again, under the game's next name.
    await session.until(() => bo.client.game()!.slots.filter((slot) => !slot.bot).length === 1)
    expect(bo.client.game()!.slots.map((slot) => [slot.name, slot.bot])).toEqual([
      ['Dash', true],
      ['Bo', false],
      ['Bolt', true],
      ['Cinder', true],
    ])

    // The last of them leaving takes the game with them.
    bo.client.leave()
    await session.until(() => browse.client.games().length === 0)
    expect(session.server.gameCount()).toBe(0)
    session.dispose()
  }, 120_000)

  it('lets only the host change the world and rules, and starts nothing until everyone is ready', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const game = await session.host(ada, 'race', 'sportsCar')
    const bo = await session.tab('Bo')
    await session.joinGame(bo, game, 'tank')
    await session.until(() => ada.client.game()!.slots.filter((slot) => !slot.bot).length === 2)
    const start = ada.client.game()!.options

    // Not the host: nothing changes.
    bo.client.edit({ ...start, seed: 4242, weapons: false })
    await session.run(0.5)
    expect(ada.client.game()!.options).toEqual(start)

    // The host: everyone sees it.
    await session.edit(ada, { mode: 'race', seed: 4242, weapons: false, bananas: true, raceLength: 2 })
    await session.until(() => bo.client.game()!.options.seed === 4242)
    expect(bo.client.game()!.options).toEqual({ mode: 'race', seed: 4242, weapons: false, bananas: true, raceLength: 2 })

    // Ready but for one of them, there is no start.
    await session.ready(ada, 'sportsCar')
    ada.client.start()
    await session.run(0.5)
    expect(ada.client.game()!.status).toBe('open')

    // Every one of them ready, and the race starts preparing.
    await session.ready(bo, 'tank')
    ada.client.start()
    await session.until(() => ada.client.game()!.status !== 'open')
    expect(ada.client.game()!.fault).toBeNull()
    session.dispose()
  }, 180_000)

  it('runs a race through two worlds: the countdown, the gates in order, a winner and the standings', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const bo = await session.tab('Bo')
    // Cy only looks at the lobby, and sees the race go by in it.
    const cy = await session.tab('Cy')
    const id = await session.host(ada, 'race', 'sportsCar')
    await session.joinGame(bo, id, 'tank')
    await session.until(() => ada.client.game()!.slots.filter((slot) => !slot.bot).length === 2)
    // The planet every test plays on, three worlds long, with everything on.
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    await session.ready(ada, 'sportsCar')
    await session.ready(bo, 'tank')
    ada.client.start()
    // The course is made off the tick, and the room says so.
    await session.until(() => ada.client.game()!.status === 'starting')
    expect(ada.client.game()!.status).toBe('starting')

    // Both racers go into the first world of the course, which is the planet.
    const a = await session.play(ada, 'sportsCar', map.seed)
    const b = await session.play(bo, 'tank', map.seed)
    const plan = await a.client.racePlan()
    expect(plan).toMatchObject({ game: id, world: 1, ofWorlds: 2 })
    expect(plan!.checkpoints.length).toBeGreaterThanOrEqual(3)
    // Only the portals the course keeps are in this world at all.
    const room = session.server.roomFor(id, map.seed)!
    expect(room.arena.planet.portals).toHaveLength(plan!.keep.length)

    // On the grid, and held there: the throttle does nothing until the countdown is over.
    await session.until(() => a.client.welcome() !== null && b.client.welcome() !== null)
    a.input.throttle = 1
    const grid = { ...session.arenaOf(id).seats[a.client.welcome()!.seat]!.vehicle.frame.position }
    await session.run(1)
    expect(distance(session.serverPositionOf(a), grid)).toBeLessThan(3)
    expect(session.events).toContain(`started game ${id}`)
    expect(a.prediction.race).not.toBeNull()
    expect(a.prediction.race!.elapsed).toBeLessThan(0)
    expect(a.prediction.race!.racers.map((racer) => racer.place)).toEqual([1, 2])

    // The countdown over, both drive.
    await session.run(COUNTDOWN_TICKS / TICKS_PER_SECOND + 0.5)
    expect(gameStatus(session.server.gameFor(id)!)).toBe('racing')
    await session.until(() => cy.client.games().find((game) => game.id === id)?.status === 'racing')
    expect(a.prediction.race!.elapsed).toBeGreaterThanOrEqual(0)
    await session.run(1.5)
    expect(distance(session.serverPositionOf(a), grid)).toBeGreaterThan(5)

    // A gate passed out of order is not passed: B lies on the second gate, and its checkpoint stays put.
    const gates = plan!.checkpoints
    const seatA = session.arenaOf(id).seats[a.client.welcome()!.seat]!
    const seatB = session.arenaOf(id).seats[b.client.welcome()!.seat]!
    respawn(seatB, spawnHere(gates[1]!.at, gates[1]!.forward))
    await session.run(0.2)
    expect(session.server.gameFor(id)!.racers.get(b.tab.client.game()!.drivePass)!.checkpoint).toBe(0)

    // In order, each gate is passed as it is come to.
    for (let gate = 0; gate < gates.length - 1; gate++) {
      respawn(seatA, spawnHere(gates[gate]!.at, gates[gate]!.forward))
      await session.run(0.2)
      expect(session.server.gameFor(id)!.racers.get(a.tab.client.game()!.drivePass)!.checkpoint).toBe(gate + 1)
    }

    // The last gate of this leg is the portal out, and the next world may only be entered once it is the next gate:
    // B, still on its way to the first, is turned away at the door of the second.
    const next = plan!.next!
    expect(plan!.exit).not.toBeNull()
    const wire = new Loopback(session.server, DELAY_TICKS, session.clock, 0)
    const turnedAway = new NetClient(wire.client, () => session.nowMs, {})
    await expect(
      session.settle(turnedAway.connect('tank', next.world, id, next.arrival, bo.client.game()!.drivePass, 'Bo'), wire),
    ).rejects.toBeInstanceOf(ConnectionFailure)
    expect(session.server.gameFor(id)!.racers.get(bo.client.game()!.drivePass)!.leg).toBe(0)
    respawn(seatA, spawnHere(gates[gates.length - 1]!.at, gates[gates.length - 1]!.forward))
    await session.run(0.2)
    expect(session.server.gameFor(id)!.racers.get(a.tab.client.game()!.drivePass)!.checkpoint).toBe(gates.length)

    // Through the portal: the same racer, on the next leg, with its progress kept.
    const through = await session.enter(a, next.world, next.arrival)
    expect(through.game).toBe(id)
    const second = await a.client.racePlan()
    expect(second).toMatchObject({ world: 2, ofWorlds: 2, next: null, exit: null })
    expect(session.server.gameFor(id)!.racers.get(a.tab.client.game()!.drivePass)!.leg).toBe(1)
    // The first gate of the new leg is not passed by coming out of the portal.
    await session.run(0.2)
    expect(session.server.gameFor(id)!.racers.get(a.tab.client.game()!.drivePass)!.checkpoint).toBe(0)

    // Home first: every gate of the last leg, the last of them the line.
    const home = session.server.roomFor(id, next.world)!
    const seatHome = home.arena.seats[a.client.welcome()!.seat]!
    for (const gate of second!.checkpoints) {
      respawn(seatHome, spawnHere(gate.at, gate.forward))
      await session.run(0.2)
    }
    const racer = session.server.gameFor(id)!.racers.get(a.tab.client.game()!.drivePass)!
    expect(racer.finishedAt).toBeGreaterThan(0)
    expect(racer.place).toBe(1)
    expect(seatHome.racesWon).toBe(1)

    // The standings arrive, with a place for everyone still racing: B is a DNF.
    await session.run(FINISH_GRACE_TICKS / TICKS_PER_SECOND + 1)
    const standings = a.client.standings()
    expect(standings).toHaveLength(2)
    expect(standings![0]).toMatchObject({ place: 1, name: 'Ada', vehicle: 'sportsCar', dnf: false })
    expect(standings![1]).toMatchObject({ place: 2, name: 'Bo', vehicle: 'tank', dnf: true })
    expect(a.prediction.race!.over).toBe(true)
    await session.until(() => cy.client.games().find((game) => game.id === id)?.status === 'finished')

    // Shown long enough, and the game goes, with its rooms and its seats.
    await session.run(STANDINGS_TICKS / TICKS_PER_SECOND + 1)
    expect(session.server.gameFor(id)).toBeUndefined()
    expect(session.server.roomFor(id, map.seed)).toBeUndefined()
    expect(session.server.roomFor(id, next.world)).toBeUndefined()
    expect(session.events).toContain(`closed game ${id}`)
    await session.until(() => cy.client.games().every((game) => game.id !== id))
    session.dispose()
  }, 300_000)

  it('runs a race through three worlds, the one home winning and the other a DNF', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const bo = await session.tab('Bo')
    const id = await session.host(ada, 'race', 'sportsCar')
    await session.joinGame(bo, id, 'tank')
    await session.until(() => ada.client.game()!.slots.filter((slot) => !slot.bot).length === 2)
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 3 })
    await session.ready(ada, 'sportsCar')
    await session.ready(bo, 'tank')
    ada.client.start()
    await session.until(() => ada.client.game()!.status === 'starting')

    // Three worlds, each a world of its own: the planet the race was made on, then two others.
    const course = session.server.gameFor(id)!.course!
    expect(course.legs).toHaveLength(3)
    expect(new Set(course.legs.map((leg) => leg.world)).size).toBe(3)
    expect(course.legs[0]!.world).toBe(map.seed)

    const a = await session.play(ada, 'sportsCar', map.seed)
    // The other never moves from the grid, and is a DNF at the end of it.
    await session.play(bo, 'tank', map.seed)
    await session.run(COUNTDOWN_TICKS / TICKS_PER_SECOND + 0.5)
    expect(gameStatus(session.server.gameFor(id)!)).toBe('racing')
    expect(a.prediction.race!.ofWorlds).toBe(3)

    // Every gate of every leg, in order, and on through the portal the last of each leads by. B never moves.
    await driveCourse(session, a)
    const racer = session.server.gameFor(id)!.racers.get(a.tab.client.game()!.drivePass)!
    expect(racer).toMatchObject({ leg: 2, place: 1 })
    expect(racer.finishedAt).toBeGreaterThan(0)

    // The last leg's world is a world of the course, and its gates were the ones on the plan.
    const last = course.legs[2]!
    expect(session.server.roomFor(id, last.world)).toBeDefined()

    // Called over a grace after the winner, with the one who never came a DNF.
    await session.run(FINISH_GRACE_TICKS / TICKS_PER_SECOND + 1)
    const standings = a.client.standings()
    expect(standings).toHaveLength(2)
    expect(standings![0]).toMatchObject({ place: 1, name: 'Ada', dnf: false })
    expect(standings![1]).toMatchObject({ place: 2, name: 'Bo', dnf: true })
    expect(standings![1]!.seconds).toBe(0)
    session.dispose()
  }, 300_000)

  it('runs a race for one player alone, called over as soon as it is home', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const id = await session.host(ada, 'race', 'sportsCar')
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    await session.ready(ada, 'sportsCar')
    ada.client.start()
    await session.until(() => ada.client.game()!.status === 'starting')
    const a = await session.play(ada, 'sportsCar', map.seed)
    await session.run(COUNTDOWN_TICKS / TICKS_PER_SECOND + 0.5)

    // One racer, and a place of its own in a race of one.
    expect(a.prediction.race!.racers).toHaveLength(1)
    expect(a.prediction.race!.racers[0]!.place).toBe(1)
    await driveCourse(session, a)

    // Nobody left to wait for: the standings come at once, with the one place filled and no DNF.
    await session.run(0.5)
    expect(gameStatus(session.server.gameFor(id)!)).toBe('finished')
    const standings = a.client.standings()
    expect(standings).toHaveLength(1)
    expect(standings![0]).toMatchObject({ place: 1, name: 'Ada', vehicle: 'sportsCar', dnf: false })
    expect(standings![0]!.seconds).toBeGreaterThan(0)
    await session.run(STANDINGS_TICKS / TICKS_PER_SECOND + 1)
    expect(session.server.gameFor(id)).toBeUndefined()
    session.dispose()
  }, 300_000)

  it('lets a racer whose connection was cut rejoin mid-race with its progress kept', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const id = await session.host(ada, 'race', 'sportsCar')
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    await session.ready(ada, 'sportsCar')
    ada.client.start()
    await session.until(() => ada.client.game()!.status === 'starting')
    const a = await session.play(ada, 'sportsCar', map.seed)
    const plan = (await a.client.racePlan())!
    await session.run(COUNTDOWN_TICKS / TICKS_PER_SECOND + 0.5)

    // Two gates passed, then the wire goes.
    const pass = ada.client.game()!.drivePass
    const { arena } = session.server.roomFor(id, map.seed)!
    const seat = arena.seats[a.client.welcome()!.seat]!
    for (const gate of plan.checkpoints.slice(0, 2)) {
      respawn(seat, spawnHere(gate.at, gate.forward))
      await session.run(0.2)
    }
    expect(session.server.gameFor(id)!.racers.get(pass)!.checkpoint).toBe(2)
    a.client.close('cut off')
    await session.run(0.5)
    // Its place in the race is kept while it is gone, though the world's room closes behind it.
    expect(session.server.gameFor(id)!.racers.get(pass)!.checkpoint).toBe(2)
    expect(session.server.roomFor(id, map.seed)).toBeUndefined()

    // Back with the same pass: the same racer, on its own leg, at its own gates.
    const back = await session.rejoin(a)
    expect(back.game).toBe(id)
    expect(back.pass).toBe(pass)
    const racer = session.server.gameFor(id)!.racers.get(pass)!
    expect(racer).toMatchObject({ leg: 0, checkpoint: 2 })

    // And it drives on from there, the gate it had come to counted, not the ones before it.
    const again = session.arenaOf(id)
    const carSeat = again.seats[back.seat]!
    const next = plan.checkpoints[2]!
    respawn(carSeat, spawnHere(next.at, next.forward))
    await session.run(0.2)
    expect(racer.checkpoint).toBe(3)
    session.dispose()
  }, 300_000)

  it('keeps a free drive in its own game when a car goes through a portal, and coming back', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const game = a.tab.client.game()!
    const moon = moonOf(map.seed)

    // Out of the planet's portal onto the moon: a second room of the same game, not a game of its own.
    const there = await session.enter(a, moon, 0)
    expect(there.game).toBe(game.id)
    expect(there.pass).toBe(game.drivePass)
    expect(there.race).toBe(false)
    await session.run(0.2)
    expect(session.server.roomFor(game.id, moon)).toBeDefined()
    expect(session.server.gameCount()).toBe(1)
    expect(session.server.roomCount()).toBe(1)
    expect(session.server.roomFor(game.id, moon)!.players.size).toBe(1)

    // And back out of the moon's portal to the planet: still its game, its member and its seat.
    const back = await session.enter(a, map.seed, 0)
    expect(back.game).toBe(game.id)
    expect(back.pass).toBe(game.drivePass)
    expect(a.tab.client.game()!.you).toBeGreaterThan(0)
    await session.run(0.2)
    expect(session.server.gameCount()).toBe(1)
    expect(session.server.roomFor(game.id, moon)).toBeUndefined()
    expect(session.server.roomFor(game.id, map.seed)!.players.size).toBe(1)
    session.dispose()
  }, 120_000)

  it('puts a racer back at the last gate it passed when it asks for its car back', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const id = await session.host(ada, 'race', 'sportsCar')
    await session.ready(ada, 'sportsCar')
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    ada.client.start()
    await session.until(() => ada.client.game()!.status === 'starting')
    const a = await session.play(ada, 'sportsCar', map.seed)
    const plan = await a.client.racePlan()
    await session.run(COUNTDOWN_TICKS / TICKS_PER_SECOND + 0.5)

    const { arena } = session.server.roomFor(id, map.seed)!
    const seat = arena.seats[a.client.welcome()!.seat]!
    const passed = plan!.checkpoints[0]!
    respawn(seat, spawnHere(passed.at, passed.forward))
    await session.run(0.2)
    // Driven away from it, then put back: at the gate it passed, not where it was, nor at the one to come.
    a.input.throttle = 1
    await session.run(2)
    expect(distance(session.serverPositionOf(a), passed.at)).toBeGreaterThan(5)
    a.client.requestRespawn()
    await session.run(0.5)
    expect(groundDistance(session.serverPositionOf(a), passed.at)).toBeLessThan(3)
    session.dispose()
  }, 300_000)

  it('keeps two games on one world in rooms of their own', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const bo = await session.tab('Bo')
    const first = await session.host(ada, 'free', 'sportsCar')
    const second = await session.host(bo, 'free', 'tank')
    expect(first).not.toBe(second)
    const a = await session.play(ada, 'sportsCar')
    const b = await session.play(bo, 'tank')
    // One world, two rooms: each game's own arena, and its own driver in it.
    expect(session.server.roomCount()).toBe(2)
    const one = session.server.roomFor(first, map.seed)!
    const other = session.server.roomFor(second, map.seed)!
    expect(one.arena).not.toBe(other.arena)
    expect([...one.players.values()].map((player) => player.seat.id)).toEqual([a.client.welcome()!.seat])
    expect([...other.players.values()].map((player) => player.seat.id)).toEqual([b.client.welcome()!.seat])
    // Neither sees the other's car.
    await session.run(0.5)
    expect(a.client.playerCount()).toBe(1)
    expect(b.client.playerCount()).toBe(1)
    session.dispose()
  }, 120_000)

  it("keeps a race's bananas out of a player's balance and a free drive's there, with feats recorded in both", async () => {
    const key = newSecretKey()
    const pubkey = publicKeyOf(key)
    const first = ACHIEVEMENTS.find((feat) => feat.title === 'First Banana')!
    const session = new Session()
    // A free drive starts from the balance the key held last time, and keeps it.
    session.store.keepBananas(pubkey, 20)
    const free = await session.join('sportsCar', 0, map.seed, NO_ARRIVAL, 'Ada', key)
    const freeSeat = session.arena.seats[free.client.welcome()!.seat]!
    expect(freeSeat.score).toBeGreaterThanOrEqual(20)
    freeSeat.collected = Math.max(freeSeat.collected, 1)
    await session.run(0.5)
    expect(session.store.earned(pubkey).has(first.id)).toBe(true)
    freeSeat.score = 37
    free.client.close('done for the day')
    await session.run(0.5)
    expect(session.store.bananas(pubkey)).toBe(37)

    // A race starts at nothing, whatever the key holds, and throws away what it ends with.
    const ada = await session.tab('Ada', key)
    const id = await session.host(ada, 'race', 'sportsCar')
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    await session.ready(ada, 'sportsCar')
    ada.client.start()
    await session.until(() => ada.client.game()!.status === 'starting')
    const racer = await session.play(ada, 'sportsCar', map.seed)
    const raceSeat = session.arenaOf(id).seats[racer.client.welcome()!.seat]!
    // The 37 bananas the key holds are not in the race's wallet.
    expect(raceSeat.score).toBeLessThan(20)
    // A feat earned in a race is the key's for good.
    const other = ACHIEVEMENTS.find((feat) => feat.id !== first.id && feat.reward > 0)!
    raceSeat.collected = 1
    raceSeat.score = 11
    await session.run(0.5)
    expect(session.store.earned(pubkey).has(other.id) || session.store.earned(pubkey).has(first.id)).toBe(true)
    racer.client.close('gone')
    await session.run(0.5)
    expect(session.store.bananas(pubkey)).toBe(37)
    session.dispose()
  }, 300_000)

  it('fires nothing in a game without weapons, and costs nothing in one without bananas', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const id = await session.host(ada, 'free', 'sportsCar')
    // Weapons off: the fire key does nothing at all.
    await session.edit(ada, { mode: 'free', seed: ada.client.game()!.options.seed, weapons: false, bananas: true, raceLength: 3 })
    const a = await session.play(ada, 'sportsCar')
    const { arena } = session.server.roomFor(id, map.seed)!
    const seat = arena.seats[a.client.welcome()!.seat]!
    seat.score = 10
    a.input = { ...NEUTRAL_INPUT, weapon: keyOf('rocket'), fire: true }
    await session.run(0.5)
    expect(arena.rockets).toHaveLength(0)
    expect(seat.weapon).toBe('none')

    // Bananas off with weapons on: a rocket, and no banana spent on it.
    const bo = await session.tab('Bo')
    const bananasOff = await session.host(bo, 'free', 'tank')
    await session.edit(bo, { mode: 'free', seed: bo.client.game()!.options.seed, weapons: true, bananas: false, raceLength: 3 })
    const b = await session.play(bo, 'tank')
    const other = session.server.roomFor(bananasOff, map.seed)!.arena
    const otherSeat = other.seats[b.client.welcome()!.seat]!
    b.input = { ...NEUTRAL_INPUT, weapon: keyOf('rocket'), fire: true }
    await session.run(0.5)
    // No bananas taken, so nothing held beyond what its feats paid it.
    expect(otherSeat.score - paidForFeats(otherSeat)).toBe(0)
    expect(other.rockets.length).toBeGreaterThan(0)
    session.dispose()
  }, 180_000)

  it('tells everyone on the island who else is on it, by the name they gave', async () => {
    const session = new Session()
    const a = await session.join('sportsCar', 0, map.seed, NO_ARRIVAL, '  Ada\u0007 ')
    const b = await session.join('sportsCar', 0, map.seed, NO_ARRIVAL, 'Bo')
    await session.run(0.5)
    const seatA = a.client.welcome()!.seat
    const seatB = b.client.welcome()!.seat
    for (const player of [a, b]) {
      expect(player.client.lobby().players).toEqual([
        { seat: seatA, name: 'Ada' },
        { seat: seatB, name: 'Bo' },
      ])
    }
    // Gone, they are gone from the list.
    b.client.close('left')
    await session.run(0.5)
    expect(a.client.lobby().players).toEqual([{ seat: seatA, name: 'Ada' }])
    session.dispose()
  }, 120_000)

  it("pays a player's nostr key each achievement once, ever, and pays nothing to a player who proves no key", async () => {
    const session = new Session()
    const first = ACHIEVEMENTS.find((feat) => feat.title === 'First Banana')!
    const key = newSecretKey()
    const pubkey = publicKeyOf(key)
    const a = await session.join('sportsCar', 0, map.seed, NO_ARRIVAL, 'Ada', key)
    await session.run(0.5)
    expect(a.client.signedIn()).toBe(pubkey)
    expect(session.signedIn).toContain(pubkey)
    const seatA = session.arena.seats[a.client.welcome()!.seat]!
    seatA.collected = Math.max(seatA.collected, 1)
    await session.run(0.5)
    expect(session.achieved).toContain(`${seatA.id} ${first.id}`)
    expect(session.store.earned(pubkey).has(first.id)).toBe(true)

    // Back another day with the same key: what it has been paid is marked off.
    const paidBefore = session.achieved.length
    const back = await session.join('sportsCar', 0, map.seed, NO_ARRIVAL, 'Ada', key)
    await session.run(0.5)
    const seatBack = session.arena.seats[back.client.welcome()!.seat]!
    expect(seatBack.progress.earned[first.id]).toBe(1)
    seatBack.collected = Math.max(seatBack.collected, 1)
    await session.run(1)
    expect(session.achieved.slice(paidBefore).filter((paid) => paid.endsWith(` ${first.id}`))).toEqual([])

    // A player with no key to prove is paid nothing.
    const stranger = await session.join('sportsCar', 0, map.seed, NO_ARRIVAL, 'Cy', null)
    const seatC = session.arena.seats[stranger.client.welcome()!.seat]!
    seatC.collected = 5
    await session.run(1)
    expect(stranger.client.signedIn()).toBeNull()
    expect(session.achieved.filter((paid) => paid.startsWith(`${seatC.id} `))).toEqual([])
    session.dispose()
  }, 120_000)

  it('takes eight players and no more, in a bot’s slot each', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const game = await session.host(ada, 'free', 'sportsCar', SLOTS_START - 1)
    // Four slots to begin with: three of them bots', which players take.
    expect(ada.client.game()!.slots).toHaveLength(SLOTS_START)
    for (let i = 1; i < SLOTS_START; i++) {
      const tab = await session.tab(`member ${i}`)
      await session.joinGame(tab, game, 'sportsCar')
    }
    expect(ada.client.game()!.slots.every((slot) => !slot.bot)).toBe(true)
    expect(ada.client.game()!.slots).toHaveLength(SLOTS_START)

    // A game with no bot's slot left is full, and the next is told so by seeing no game.
    const fifth = await session.tab('member 4')
    fifth.client.join(game, 'sportsCar')
    await session.run(0.5)
    expect(fifth.client.game()).toBeNull()
    expect(ada.client.game()!.slots).toHaveLength(SLOTS_START)

    // The host adds a bot's slot, and a player takes it: eight is as many as a game has.
    for (let i = SLOTS_START; i < SLOTS_MOST; i++) {
      ada.client.addSlot()
      await session.until(() => ada.client.game()!.slots.length === i + 1)
      const tab = await session.tab(`member ${i}`)
      await session.joinGame(tab, game, 'sportsCar')
    }
    expect(ada.client.game()!.slots).toHaveLength(SLOTS_MOST)
    expect(ada.client.game()!.slots.every((slot) => !slot.bot)).toBe(true)
    // Not even the host may add a ninth.
    ada.client.addSlot()
    await session.run(0.5)
    expect(ada.client.game()!.slots).toHaveLength(SLOTS_MOST)
    session.dispose()
  }, 120_000)

  it('fills the seats nobody takes with cars nobody drives', async () => {
    const island = worldOf(11)
    const session = new Session({ npcs: NPC_CARS })
    const ada = await session.tab('Ada')
    const game = await session.host(ada, 'free', 'sportsCar')
    const a = await session.play(ada, 'sportsCar', island.seed)
    const { arena } = session.server.roomFor(game, island.seed)!
    const seat = arena.seats[a.client.welcome()!.seat]!
    expect(seat.npc).toBe(false)
    expect(arena.seats.filter((other) => other.npc)).toHaveLength(NPC_CARS)
    await session.run(1)
    // They drive themselves, and the player count is of people.
    expect(session.server.playerCount()).toBe(1)
    expect(arena.seats.filter((other) => other.npc).some((other) => other.vehicle.speed > 1)).toBe(true)
    session.dispose()
  }, 180_000)

  it('goes on stepping the rooms open while another world is made, and seats whoever waits for it once it is', async () => {
    const moon = moonOf(map.seed)
    // The moon is made somewhere else, and is ready only when the test says.
    let finish: (arena: Arena) => void = () => {}
    const made = new Promise<Arena>((resolve) => {
      finish = resolve
    })
    const session = new Session({
      arenaFor: (request) => {
        if (request.world === moon) return made
        const planet = request.keep === null ? worldOf(request.world) : withPortals(worldOf(request.world), request.keep)
        return createArena(planet, MAX_PLAYERS, { weapons: request.weapons, bananas: request.bananas })
      },
    })
    const ada = await session.tab('Ada')
    const game = await session.host(ada, 'free', 'sportsCar')
    const driver = await session.play(ada, 'sportsCar')
    const { arena } = session.server.roomFor(game, map.seed)!
    const bo = await session.tab('Bo')
    await session.joinGame(bo, game, 'tank')
    await session.ready(bo, 'tank')

    // Bo asks for the moon while it is being made, and waits for it.
    const wire = new Loopback(session.server, DELAY_TICKS, session.clock, 0)
    const waiting = new NetClient(wire.client, () => session.nowMs, {})
    const welcoming = waiting.connect('tank', moon, game, NO_ARRIVAL, bo.client.game()!.drivePass, 'Bo')
    welcoming.catch(() => undefined)
    const before = arena.tick
    for (let i = 0; i < 60; i++) {
      await Promise.resolve()
      session.step([wire])
    }
    // The island goes on stepping while the moon is made, and nobody is seated on it yet.
    expect(arena.tick - before).toBe(60)
    expect(session.server.roomFor(game, moon)).toBeUndefined()
    expect(waiting.welcome()).toBeNull()

    finish(session.makeArena({ game, world: moon, keep: null, weapons: true, bananas: true }))
    const welcome = await session.settle(welcoming, wire)
    expect(welcome.seed).toBe(moon)
    const room = session.server.roomFor(game, moon)!
    expect(room.players.size).toBe(1)
    // Both rooms step on together from here.
    const moonBefore = room.arena.tick
    const islandBefore = arena.tick
    await session.run(0.5)
    expect(room.arena.tick - moonBefore).toBe(30)
    expect(arena.tick - islandBefore).toBe(30)
    expect(driver.client.closed()).toBeNull()
    session.dispose()
  }, 180_000)

  it('tells each car nobody drives by what its own driver asks of it, never by what a player sent last', async () => {
    const session = new Session({ npcs: NPC_CARS })
    const ada = await session.tab('Ada')
    const game = await session.host(ada, 'free', 'semi')
    const a = await session.play(ada, 'semi')
    const { arena } = session.server.roomFor(game, map.seed)!
    // The player leans on the fire key with a weapon selected, tick after tick.
    a.input = { ...NEUTRAL_INPUT, weapon: 9, fire: true, throttle: 1 }
    await session.run(1)
    const told = a.wire.received
      .map((payload) => decodeSnapshot(payload))
      .filter((snapshot) => snapshot !== null)
      .at(-1)!
    const npcs = arena.seats.filter((seat) => seat.npc).map((seat) => seat.id)
    expect(npcs.length).toBeGreaterThan(0)
    const seen = told.vehicles.filter((vehicle) => npcs.includes(vehicle.seat))
    expect(seen.length).toBe(npcs.length)
    for (const vehicle of seen) expect(vehicle.appliedInput.weapon).toBe(0)
    expect(told.vehicles.find((vehicle) => vehicle.seat === a.client.welcome()!.seat)!.appliedInput.weapon).toBe(9)
    session.dispose()
  }, 180_000)

  it('swaps a player into another vehicle where they are, keeping the seat and its bananas', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    a.input.throttle = 1
    await session.run(3)
    const seat = session.arena.seats[a.client.welcome()!.seat]!
    seat.score = 7
    const before = session.serverPositionOf(a)
    expect(distance(before, seat.spawn.position)).toBeGreaterThan(5)

    a.input.throttle = 0
    a.client.changeVehicle('tank')
    await session.run(1)
    expect(session.events).toContain('changed 0 tank')
    expect(session.server.playerCount()).toBe(1)
    // The same seat, in a tank, where the sports car was, with the bananas it had.
    expect(seat.profile).toBe('tank')
    expect(seat.score).toBe(7)
    expect(distance(session.serverPositionOf(a), before)).toBeLessThan(3)
    // The prediction is in a tank too, where the server has it.
    expect(a.prediction.ownSeat.profile).toBe('tank')
    expect(distance(session.predictedPositionOf(a), session.serverPositionOf(a))).toBeLessThan(1)
    session.dispose()
  }, 120_000)

  it('frees a seat when its player leaves, and hands it on with a new epoch', async () => {
    const session = new Session()
    const a = await session.join()
    const b = await session.join()
    const epoch = a.client.welcome()!.epoch
    await session.run(1)
    expect(b.client.sample()).toHaveLength(2)

    a.client.close('done')
    await session.run(1)
    expect(session.events).toContain(`left ${session.freeDrive}:${map.seed} 0`)
    expect(session.server.playerCount()).toBe(1)
    expect(b.client.sample()).toHaveLength(1)

    const again = await session.join()
    expect(again.client.welcome()!.seat).toBe(0)
    expect(again.client.welcome()!.epoch).not.toBe(epoch)
    session.dispose()
  }, 120_000)

  it('tells of the bananas in full once, then only what changes, and the whole again to a newcomer', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    // Everything at rest: whatever props are still settling put to sleep.
    await session.run(3)
    for (const prop of session.arena.props) prop.body.sleep()
    await session.run(0.5)

    // The whole word, then nothing but the vehicles while nothing changes.
    expect(a.client.bananas.pickups).toHaveLength(PICKUP_SLOTS)
    expect(session.server.stats().snapshotBytes).toBe(STEADY_BYTES + SNAPSHOT_VEHICLE_BYTES)

    // A slot moves on, and a banana is spilled: told once, and the mirror has them.
    const { arena } = session
    setPickup(arena.planet, arena.pickups[3]!, 3, 1, arena.tick + 480)
    arena.loose.push({
      id: 7,
      kind: 'banana',
      owner: 0,
      power: 0,
      from: { x: 1, y: 2, z: 3 },
      position: { x: 4, y: 5, z: 6 },
      bornTick: arena.tick,
    })
    await session.run(0.5)
    expect(a.client.bananas.pickups[3]).toEqual({ generation: 1, spawnTick: arena.pickups[3]!.spawnTick })
    expect(a.prediction.pickups[3]!.generation).toBe(1)
    expect(a.prediction.loose.map((loose) => loose.id)).toEqual([7])
    expect(session.server.stats().snapshotBytes).toBe(STEADY_BYTES + SNAPSHOT_VEHICLE_BYTES)

    // A banana the mirror takes on its own is put back as the server has it.
    setPickup(arena.planet, a.prediction.pickups[5]!, 5, 9, 0)
    await session.run(0.2)
    expect(a.prediction.pickups[5]!.generation).toBe(0)

    // A newcomer is told the whole of it, as it stands now.
    const b = await session.join('tank')
    await session.run(0.5)
    expect(b.client.bananas.pickups).toHaveLength(PICKUP_SLOTS)
    expect(b.prediction.pickups[3]!.generation).toBe(1)
    expect(b.prediction.loose.map((loose) => loose.id)).toEqual([7])

    // Gone on the server, gone from everyone.
    arena.loose.length = 0
    await session.run(0.5)
    expect(a.prediction.loose).toHaveLength(0)
    expect(b.client.bananas.loose).toHaveLength(0)
    session.dispose()
  }, 120_000)

  it('fires the weapon whose key is held: everyone sees the rocket go, and the car it is after feels it', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const b = await session.join('tank')
    const { arena } = session
    const aSeat = arena.seats[a.client.welcome()!.seat]!
    const bSeat = arena.seats[b.client.welcome()!.seat]!
    await session.run(0.5)
    // The tank is put down on the road thirty meters ahead of the sports car, which is handed bananas to spend.
    lineUp(arena, aSeat, bSeat, 30)
    aSeat.score = 20
    await session.run(0.5)
    expect(a.prediction.ownSeat.score).toBe(20)

    // The rocket is selected and the fire key goes down: the rocket goes, after the tank, and the tank's mirror has it in the air too.
    a.input.weapon = keyOf('rocket')
    a.input.fire = true
    await session.run(0.3)
    a.input.fire = false
    expect(aSeat.weapon).toBe('rocket')
    expect(aSeat.score - paidForFeats(aSeat)).toBe(18)
    expect(arena.rockets).toHaveLength(1)
    expect(arena.rockets[0]!.target).toBe(bSeat.id)
    expect(b.prediction.rockets).toHaveLength(1)
    expect(b.prediction.rockets[0]!.id).toBe(arena.rockets[0]!.id)
    await session.run(0.5)
    expect(b.prediction.seats[aSeat.id]!.weapon).toBe('rocket')
    await session.run(1)
    expect(arena.rockets).toHaveLength(0)
    expect(bSeat.vehicle.damage).toBeCloseTo((ROCKET_DAMAGE * armorShare(bSeat.tuning)) / DURABILITY, 5)
    expect(b.prediction.vehicle.damage).toBeCloseTo((ROCKET_DAMAGE * armorShare(bSeat.tuning)) / DURABILITY, 1)
    expect(aSeat.vehicle.damage).toBe(0)

    // A mine field laid is numbered the same in the sports car's own prediction as on the server, so
    // it is the same mines on screen from the drop onward, not some gone and others come.
    a.input.weapon = keyOf('mines')
    a.input.fire = true
    await session.run(0.05)
    a.input.fire = false
    const mines = (loose: readonly Loose[]): number[] => loose.filter((thing) => thing.kind === 'mine').map((thing) => thing.id)
    const predicted = mines(a.prediction.loose)
    expect(predicted.length).toBeGreaterThan(0)
    expect(mines(arena.loose)).toEqual([])
    await session.run(0.5)
    expect(mines(arena.loose)).toEqual(predicted)
    expect(mines(a.prediction.loose)).toEqual(predicted)
    expect(mines(b.prediction.loose)).toEqual(predicted)

    // A machine gun, held for a second: shots the tank takes, and a banana the sports car burns.
    const left = aSeat.score - paidForFeats(aSeat)
    a.input.weapon = keyOf('machineGun')
    a.input.fire = true
    await session.run(1)
    a.input.fire = false
    await session.run(0.3)
    expect(bSeat.vehicle.damage).toBeGreaterThan(((ROCKET_DAMAGE + 5 * MACHINE_GUN_DAMAGE) * armorShare(bSeat.tuning)) / DURABILITY)
    expect(aSeat.score - paidForFeats(aSeat)).toBeLessThan(left)
    expect(a.prediction.ownSeat.score).toBe(aSeat.score)
    expect(a.prediction.ownSeat.burnLeft).toBe(aSeat.burnLeft)
    session.dispose()
  }, 120_000)

  it('keeps a mine field and a rocket on screen from the press onward, however long the key is held', async () => {
    const session = new Session()
    const a = await session.join('pickup')
    const b = await session.join('tank')
    const { arena } = session
    await session.run(0.5)
    // The tank is put down on the road thirty meters ahead of the pickup, facing away from it, so
    // that its rocket has nothing to go after and flies on for as long as the test watches it.
    const aSeat = arena.seats[a.client.welcome()!.seat]!
    const bSeat = arena.seats[b.client.welcome()!.seat]!
    lineUp(arena, aSeat, bSeat, 30)
    aSeat.score = 10
    bSeat.score = 10
    await session.run(0.5)
    const mines = (loose: readonly Loose[]): number[] => loose.filter((thing) => thing.kind === 'mine').map((thing) => thing.id)
    // The pickup's key goes down and stays down. The mines are predicted at once, and the server has
    // them soon after with the same numbers; in between, the snapshots that know nothing of them say
    // the key was up, so the replay from them lays them again rather than losing them for a moment.
    a.input.weapon = keyOf('mines')
    a.input.fire = true
    await session.run(0.05)
    const predicted = mines(a.prediction.loose)
    expect(predicted.length).toBeGreaterThan(0)
    expect(mines(arena.loose)).toEqual([])
    let told = false
    for (let i = 0; i < 30; i++) {
      session.step()
      told ||= mines(arena.loose).length > 0
      if (!told) expect(mines(a.prediction.loose)).toEqual(predicted)
    }
    expect(told).toBe(true)
    expect(mines(arena.loose)).toEqual(predicted)
    a.input.fire = false
    // The tank's rocket is one rocket from the press onward, the same way: the mirror never loses
    // it before the server has had it, though the server's may go off on something before long.
    b.input.weapon = keyOf('rocket')
    b.input.fire = true
    await session.run(0.05)
    const fired = b.prediction.rockets.map((rocket) => rocket.id)
    expect(fired).toHaveLength(1)
    told = false
    for (let i = 0; i < 20; i++) {
      session.step()
      told ||= arena.rockets.length > 0
      if (!told) expect(b.prediction.rockets.map((rocket) => rocket.id)).toEqual(fired)
    }
    expect(told).toBe(true)
    session.dispose()
  }, 120_000)

  it('sends a prop that is on the move to every mirror, and one nobody has touched to none', async () => {
    // A small island may have no props of its own: a few crates are set out on it for the test, and taken away after.
    const road = map.roads[0]!
    const props = map.props as WorldProp[]
    const crates = 3
    for (let k = 0; k < crates; k++) props.push(propAt('crate', road.points[k * 2]!))
    const session = new Session()
    const a = await session.join()
    const b = await session.join()
    await session.run(1)
    // Everything at rest: the snapshots carry no props.
    expect(session.arena.props.length).toBeGreaterThanOrEqual(crates)
    for (const prop of session.arena.props) prop.body.sleep()
    await session.run(0.5)
    expect(session.server.stats().snapshotBytes).toBe(STEADY_BYTES + 2 * SNAPSHOT_VEHICLE_BYTES)
    // A crate knocked into the air on the server is seen flying on both mirrors.
    const crate = session.arena.props.find((prop) => prop.kind === 'crate')!
    crate.body.setLinvel({ x: 3, y: 6, z: 0 }, true)
    await session.run(0.5)
    const at = crate.body.translation()
    for (const player of [a, b]) {
      const mirrored = player.prediction.props[crate.id]!.body.translation()
      expect(Math.hypot(mirrored.x - at.x, mirrored.y - at.y, mirrored.z - at.z)).toBeLessThan(1.5)
    }
    session.dispose()
    props.length -= crates
  }, 120_000)

  it('shows a player who joins late the props where they were knocked to, not where the map has them', async () => {
    const road = map.roads[0]!
    const spawn = road.points[0]!
    const props = map.props as WorldProp[]
    props.push(propAt('crate', spawn))
    const session = new Session()
    await session.join()
    // The crate is moved further along the road and dropped, tumbling, to come to rest there before anyone else
    // arrives, so that no snapshot of the changes carries it and only the whole one can.
    const crate = session.arena.props.at(-1)!
    const along = road.points.find((point) => distance(point, spawn) > 12)!
    const up = upOf(along)
    crate.body.setTranslation({ x: along.x + up.x, y: along.y + up.y, z: along.z + up.z }, true)
    crate.body.setAngvel({ x: 0, y: 0, z: 6 }, true)
    for (let second = 0; second < 10 && !crate.body.isSleeping(); second++) await session.run(1)
    expect(crate.body.isSleeping()).toBe(true)
    const at = crate.body.translation()
    expect(distance(at, spawn)).toBeGreaterThan(5)
    const late = await session.join()
    await session.run(0.5)
    const mirrored = late.prediction.props[crate.id]!.body.translation()
    expect(Math.hypot(mirrored.x - at.x, mirrored.y - at.y, mirrored.z - at.z)).toBeLessThan(0.05)
    session.dispose()
    props.length -= 1
  }, 120_000)

  it('keeps inputs to their ranges, drops a flood of them, and lets go of a player heard nothing from', async () => {
    const session = new Session()
    const a = await session.join('sportsCar')
    const b = await session.join('tank')
    // Whatever is asked for, the car is driven within its ranges.
    a.input.steer = 5
    a.input.throttle = -3
    a.input.brake = Number.NaN
    await session.run(0.5)
    const seat = a.client.welcome()!.seat
    const seen = b.client.pump(b.input).newestSnapshot!.vehicles.find((vehicle) => vehicle.seat === seat)!
    expect(seen.appliedInput).toEqual({ steer: 1, throttle: 0, brake: 0, handbrake: false, weapon: 0, fire: false, signal: false })

    // Inputs past what an honest client could send are dropped, not driven, and not held against them.
    const before = session.server.stats().inputsDropped
    for (let i = 0; i < 400; i++) a.wire.client.send(encodeInput(session.arena.tick + 1 + (i % 32), NEUTRAL_INPUT))
    await session.run(0.2)
    expect(session.server.stats().inputsDropped - before).toBeGreaterThan(200)
    expect(a.client.closed()).toBeNull()

    // Nothing heard for long enough, and the seat is given up.
    a.paused = true
    await session.run(16)
    expect(a.client.closed()).toBe(rejectLabel(REJECT_IDLE))
    expect(session.events).toContain(`left ${session.freeDrive}:${map.seed} ${seat}`)
    // Once, not again each tick until the connection is seen to close.
    expect(session.events.filter((event) => event === `rejected: ${rejectLabel(REJECT_IDLE)}`)).toHaveLength(1)
    expect(b.client.closed()).toBeNull()
    session.dispose()
  }, 120_000)

  it('lets only the host add and remove bots, and say what car they drive', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    // A race of the host's and two bots', one of which a player takes.
    const game = await session.host(ada, 'race', 'sportsCar', 2)
    const bo = await session.tab('Bo')
    await session.joinGame(bo, game, 'tank')
    expect(ada.client.game()!.slots.map((slot) => [slot.slot, slot.name, slot.vehicle, slot.bot, slot.ready])).toEqual([
      [0, 'Ada', 'sportsCar', false, false],
      [1, 'Bo', 'tank', false, false],
      [2, 'Bolt', 'police', true, true],
    ])

    // Not the host: no slot is added, removed or put in another car.
    const slots = ada.client.game()!.slots.length
    bo.client.addSlot()
    bo.client.removeSlot(2)
    bo.client.setBotVehicle(2, 'semi')
    await session.run(0.5)
    expect(ada.client.game()!.slots).toHaveLength(slots)
    expect(ada.client.game()!.slots[2]).toMatchObject({ name: 'Bolt', vehicle: 'police', bot: true })

    // The host adds a bot's slot, in the car its slot is laid out for, and puts it in another.
    ada.client.addSlot()
    await session.until(() => ada.client.game()!.slots.length === slots + 1)
    expect(ada.client.game()!.slots[slots]).toMatchObject({ slot: slots, name: 'Dash', vehicle: 'goKart', bot: true, member: 0 })
    ada.client.setBotVehicle(slots, 'semi')
    await session.until(() => ada.client.game()!.slots[slots]!.vehicle === 'semi')

    // A player's slot is nobody's to remove...
    ada.client.removeSlot(1)
    await session.run(0.5)
    expect(ada.client.game()!.slots).toHaveLength(slots + 1)
    // ...and a bot's is the host's, down to the players alone.
    ada.client.removeSlot(2)
    await session.until(() => ada.client.game()!.slots.length === slots)
    expect(ada.client.game()!.slots.map((slot) => [slot.name, slot.bot])).toEqual([
      ['Ada', false],
      ['Bo', false],
      ['Dash', true],
    ])
    ada.client.removeSlot(slots - 1)
    await session.until(() => ada.client.game()!.slots.length === slots - 1)
    expect(ada.client.game()!.slots.map((slot) => [slot.name, slot.bot])).toEqual([
      ['Ada', false],
      ['Bo', false],
    ])
    session.dispose()
  }, 120_000)

  it('leaves no world of the old kind behind when a free drive is switched to a race', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    // A free drive with two bots, driven in: the world is made, and the bots keep it open after Ada goes.
    const game = await session.host(ada, 'free', 'sportsCar', 2)
    const a = await session.play(ada, 'sportsCar')
    expect(session.server.roomFor(game, map.seed)?.bots.size).toBe(2)
    a.client.close('gone for now')
    await session.run(0.5)
    expect(a.client.closed()).toBe('gone for now')
    expect(session.server.roomFor(game, map.seed)).toBeDefined()

    // Ready no longer, the free drive may be changed; as a race, its world is nobody's any more.
    await session.ready(ada, 'sportsCar', false)
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    await session.until(() => session.server.roomFor(game, map.seed) === undefined)
    session.dispose()
  }, 120_000)

  it('lets a watcher watch a race with no seat, and lets it go when its room does', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const id = await session.host(ada, 'race', 'sportsCar')
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    await session.ready(ada, 'sportsCar')
    ada.client.start()
    await session.until(() => ada.client.game()!.status === 'starting')
    const a = await session.play(ada, 'sportsCar', map.seed)

    // A watcher is welcomed to the world with no seat in it, and told the gates of this leg.
    const watcher = await session.watch(id, map.seed)
    expect(watcher.welcome.seat).toBe(NO_SEAT)
    expect(watcher.welcome.race).toBe(true)
    expect(watcher.welcome.game).toBe(id)
    expect(await watcher.client.racePlan()).toMatchObject({ game: id, world: 1, ofWorlds: 2 })

    // It is told where the cars are, though it drives none of them.
    await session.run(0.5)
    const seat = a.client.welcome()!.seat
    expect(watcher.client.sample().map((state) => state.seat)).toEqual([seat])
    expect(session.server.playerCount()).toBe(1)
    expect(session.server.stats().spectators).toBe(1)

    // Driving begins, and the watcher sees the car go.
    await session.run(COUNTDOWN_TICKS / TICKS_PER_SECOND + 0.5)
    const before = { ...watcher.client.sample()[0]!.position }
    a.input.throttle = 1
    await session.run(1.5)
    expect(distance(before, watcher.client.sample()[0]!.position)).toBeGreaterThan(5)

    // The room closing behind its last racer lets the watcher go, to find the race again.
    a.client.close('cut off')
    await session.run(0.5)
    expect(watcher.client.closed()).toBe(ROOM_CLOSED)
    session.dispose()
  }, 300_000)

  it('gives the world of a race’s leader, and follows it as the leader goes on', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const bo = await session.tab('Bo')
    // Cy only browses the start screen, where the race is followed.
    const cy = await session.tab('Cy')
    const id = await session.host(ada, 'race', 'sportsCar')
    await session.joinGame(bo, id, 'tank')
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    await session.ready(ada, 'sportsCar')
    await session.ready(bo, 'tank')
    ada.client.start()
    await session.until(() => ada.client.game()!.status === 'starting')
    const a = await session.play(ada, 'sportsCar', map.seed)
    const b = await session.play(bo, 'tank', map.seed)
    const leader = (): number => cy.client.games().find((each) => each.id === id)?.leader ?? -1
    // Nobody has a place yet: the race is followed where it starts.
    expect(leader()).toBe(map.seed)
    // The countdown over, the gates are the ones that count.
    await session.run(COUNTDOWN_TICKS / TICKS_PER_SECOND + 0.5)
    expect(gameStatus(session.server.gameFor(id)!)).toBe('racing')

    // B through the first gate takes the lead, and is still on this world.
    const plan = (await a.client.racePlan())!
    const seatB = session.arenaOf(id).seats[b.client.welcome()!.seat]!
    respawn(seatB, spawnHere(plan.checkpoints[0]!.at, plan.checkpoints[0]!.forward))
    await session.run(0.3)
    expect(session.server.gameFor(id)!.racers.get(bo.client.game()!.drivePass)!.place).toBe(1)
    expect(leader()).toBe(map.seed)

    // Out of this world's portal: the leader is followed through to the next.
    for (const gate of plan.checkpoints) {
      respawn(seatB, spawnHere(gate.at, gate.forward))
      await session.run(0.2)
    }
    const through = await session.enter(b, plan.next!.world, plan.next!.arrival)
    expect(through.seed).toBe(plan.next!.world)
    await session.until(() => leader() === plan.next!.world)
    session.dispose()
  }, 300_000)

  it('races a race of one player and two bots through two worlds, both bots crossing the portal and finishing', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const id = await session.host(ada, 'race', 'sportsCar', 2)
    await session.edit(ada, { mode: 'race', seed: map.seed, weapons: true, bananas: true, raceLength: 2 })
    await session.ready(ada, 'sportsCar')
    ada.client.start()
    await session.until(() => ada.client.game()!.status === 'starting')
    const a = await session.play(ada, 'sportsCar', map.seed)
    const game = session.server.gameFor(id)!
    const bots = [...game.racers.values()].filter((racer) => racer.bot)
    expect(bots.map((racer) => racer.name)).toEqual(['Axle', 'Bolt'])

    // The bots take their places on the grid with the player, and count as seated.
    await session.until(() => session.server.roomFor(id, map.seed)?.bots.size === bots.length)
    await session.run(COUNTDOWN_TICKS / TICKS_PER_SECOND + 0.5)
    expect(gameStatus(game)).toBe('racing')

    // Every gate of every leg, the bots driven through them in order, and out of the portal each leg leads by.
    const course = game.course!
    for (let leg = 0; leg < course.legs.length; leg++) {
      const one = course.legs[leg]!
      const out = leg < course.legs.length - 1
      await session.until(() => botsIn(session, id, one.world).length === bots.length)
      // The last gate of a leg the portal leads on from is the way out of it, and takes the bots to the next.
      for (let gate = 0; gate < one.checkpoints.length - (out ? 1 : 0); gate++) {
        for (const seat of botsIn(session, id, one.world)) respawn(seat, spawnHere(one.checkpoints[gate]!.at, one.checkpoints[gate]!.forward))
        await session.run(0.25)
        for (const racer of bots) expect(racer.checkpoint).toBeGreaterThanOrEqual(gate + 1)
      }
      if (!out) continue
      const exit = one.checkpoints[one.checkpoints.length - 1]!
      for (const seat of botsIn(session, id, one.world)) respawn(seat, spawnHere(exit.at, exit.forward))
      await session.until(() => bots.every((racer) => racer.leg === leg + 1))
      expect(botsIn(session, id, one.world)).toHaveLength(0)
    }
    // Home, both of them, before the player who never moved.
    expect(bots.every((racer) => racer.finishedAt > 0)).toBe(true)
    await session.run(FINISH_GRACE_TICKS / TICKS_PER_SECOND + 1)
    const standings = a.client.standings()
    expect(standings).toHaveLength(3)
    expect(standings![0]).toMatchObject({ place: 1, name: 'Axle', bot: true, dnf: false })
    expect(standings![1]).toMatchObject({ place: 2, name: 'Bolt', bot: true, dnf: false })
    expect(standings![2]).toMatchObject({ place: 3, name: 'Ada', bot: false, dnf: true })
    session.dispose()
  }, 300_000)

  it('seats a free drive’s bots in its world as traffic, by their names, and takes them with the game', async () => {
    const session = new Session()
    const ada = await session.tab('Ada')
    const game = await session.host(ada, 'free', 'sportsCar', 2)
    const a = await session.play(ada, 'sportsCar')
    const room = session.server.roomFor(game, map.seed)!
    expect(room.bots.size).toBe(2)
    // Seat by seat, the bots first, and every name on the island told to everyone on it.
    const bots = [...room.bots.entries()].map(([seat, bot]) => ({ seat, name: bot.name, car: room.arena.seats[seat]! }))
    expect(bots.map((bot) => bot.name)).toEqual(['Axle', 'Bolt'])
    expect(a.client.lobby().players).toEqual([
      { seat: 0, name: 'Axle' },
      { seat: 1, name: 'Bolt' },
      { seat: 2, name: 'Ada' },
    ])
    // They drive themselves about, as the traffic does.
    const before = bots.map((bot) => ({ ...bot.car.vehicle.frame.position }))
    await session.run(3)
    expect(bots.some((bot, at) => distance(bot.car.vehicle.frame.position, before[at]!) > 20)).toBe(true)
    expect(bots.every((bot) => bot.car.npc)).toBe(true)
    session.dispose()
  }, 300_000)

  it('gives a traffic bot’s seat to a player without leaving the bot behind on the island’s list', async () => {
    // Every seat of the free drive holds a car nobody drives, the game's own bots among them.
    const session = new Session({ npcs: MAX_PLAYERS })
    const ada = await session.tab('Ada')
    const game = await session.host(ada, 'free', 'sportsCar', 2)
    const a = await session.play(ada, 'sportsCar')
    const room = session.server.roomFor(game, map.seed)!
    // Ada takes the first of them, Axle's: Axle's car and its name go with the seat.
    expect(room.bots).toHaveLength(1)
    expect([...room.bots.values()].map((bot) => bot.name)).toEqual(['Bolt'])
    expect(a.client.lobby().players.map((player) => player.name)).toEqual(['Ada', 'Bolt'])
    session.dispose()
  }, 300_000)

  it('keeps a demo race going while somebody browses the start screen, and lets it go when nobody does', async () => {
    const session = new Session({ demo: true })
    const ada = await session.tab('Ada')
    // The start screen is told of it: a race nobody hosts, of four bots.
    await session.until(() => ada.client.games().some((each) => each.demo))
    const demo = (): GameSummary | undefined => ada.client.games().find((each) => each.demo)
    expect(demo()).toMatchObject({ mode: 'race', host: '', humans: 0, slots: SLOTS_START, demo: true })
    // It gets going of its own accord, its bots on the grid of the first world.
    await session.until(() => demo()?.status === 'starting' || demo()?.status === 'racing')
    const id = demo()!.id
    await session.until(() => session.server.roomFor(id, map.seed)?.bots.size === SLOTS_START)
    expect(session.server.gameFor(id)!.racers.size).toBe(SLOTS_START)

    // A player with a game of their own is not browsing: the demo goes.
    await session.host(ada, 'race', 'sportsCar')
    await session.until(() => !ada.client.games().some((each) => each.demo))
    expect(session.server.gameFor(id)).toBeUndefined()

    // Back on the start screen, a new demo is made, its own self.
    ada.client.leave()
    await session.until(() => ada.client.games().some((each) => each.demo))
    expect(demo()!.id).not.toBe(id)
    session.dispose()
  }, 300_000)
})
