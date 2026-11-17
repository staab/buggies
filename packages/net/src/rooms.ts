/**
 * The rooms of a server: one world of one game each, with its own arena and
 * its own clock, and the seats played in it. A room is made for a world
 * nobody is on yet, seats whoever comes into it — a player out of a portal,
 * a car nobody drives, a watcher with no seat — and closes behind the last
 * to leave. What goes on in it from tick to tick is the tick's business.
 */

import {
  DEFAULT_VEHICLE_PROFILE,
  HOLD_FOREVER,
  NO_PORTAL,
  NPC_FRAGILITY,
  RACERS_MOST,
  carriedOf,
  carryOver,
  changeVehicle,
  checkpointSpawn,
  freeSeat,
  keepOf,
  leaveSeat,
  legOf,
  planOf,
  portalSpawn,
  respawn,
  seatNpc,
  spawnWhere,
  takeSeat,
  type Arena,
  type RaceLeg,
  type RacerBot,
  type Seat,
  type VehicleSpawn,
} from '@buggies/game'
import { v3, vdistance, type Vec3 } from '@buggies/physics'

import { memberOfPass, startsAtOf, type GameMember, type GameRecord, type Racer } from './game-registry.ts'
import { InputTimeline } from './input-timeline.ts'
import { newChallenge } from './nostr.ts'
import { NO_SEAT, NO_TICK, PROTOCOL_VERSION, REJECT_MALFORMED_MESSAGE, REJECT_SERVER_FULL } from './protocol.ts'
import { keepBananas, welcomeKey } from './player-records.ts'
import { createRoomSnapshots, type RoomSnapshots } from './room-snapshot.ts'
import { INPUT_ALLOWANCE, type ArenaRequest, type Handshake, type Player, type ServerState } from './server-state.ts'
import { broadcastLobby, reject } from './telling.ts'
import type { TransportConnection } from './transport.ts'
import { NO_ARRIVAL, NO_PASS, encodeRacePlan, encodeWelcome, flagsOf, type GameMode, type HelloMessage } from './wire.ts'

/** How far apart two cars coming out of a portal must stand. */
const ARRIVAL_CLEAR = 3

/** What a room's watchers are let go with when the room they are watching closes: their pages find the race again. */
export const ROOM_CLOSED = 'the room has closed'

/** The leg of a room no course runs through: a free drive's, which is nobody's world of a race. */
export const NO_LEG = -1

/** How many worlds a game's ids are apart in a room's key: every world id is a 32-bit number, and so is a room key's low half. */
const WORLDS_PER_GAME = 0x1_0000_0000

/** What a game's world is known by among the rooms: the game's id over the world's, which is a number and no key built of names. */
export function roomKey(game: number, world: number): number {
  return game * WORLDS_PER_GAME + world
}

/** The room of one world of one game, if anyone is on it. */
export function roomFor(state: ServerState, game: number, world: number): Room | undefined {
  return state.rooms.get(roomKey(game, world))
}

/**
 * One world of one game. Each is a room of its own, with its own arena and
 * clock: a race's first world and a free drive on it are two rooms, and see
 * nothing of each other.
 */
export interface Room {
  readonly game: number
  readonly world: number
  /** Which leg of its game's course this world is, or `NO_LEG` where no course runs through it: a free drive's room. */
  readonly leg: number
  readonly mode: GameMode
  readonly arena: Arena
  readonly players: Map<number, Player>
  /** The player driving each seat, by seat id, so that a seat is found by itself rather than by looking at every player. */
  readonly drivers: Map<number, Player>
  /** The cars in it that nobody on a connection drives: a race's bots, or a free drive's traffic, by the seat each holds. */
  readonly bots: Map<number, RoomBot>
  /** The pass of the racer driving each seat, a player's or a bot's, by seat id: what a seat is placed by in the race. */
  readonly racers: Map<number, number>
  /** Who is watching it without a seat: they are told what a player is, and send nothing. */
  readonly spectators: Map<number, Spectator>
  /** What its snapshots are gathered into, and what the last told. */
  readonly snapshots: RoomSnapshots
  lastSnapshotBytes: number
}

/** A car in a room that nobody drives: a bot of a race, following its leg, or a free drive's traffic, going where it may. */
export interface RoomBot {
  /** The pass of the slot it belongs to: a race's racer is known by it. */
  readonly pass: number
  readonly name: string
  /** What drives it in a race; `null` in a free drive, where the seat is one of the traffic's own. */
  readonly bot: RacerBot | null
  /** The way it drives, when it is a race's: its leg's route, from where it is entered to where it is left. */
  readonly route: readonly Vec3[] | null
  /** Where its car was the last tick, which is how driving through the portal out is told. */
  readonly previous: Vec3
}

/** A connection watching a room: it takes no seat, and is told the plan, the snapshots and the standings as they come. */
export interface Spectator {
  readonly connection: TransportConnection
  /** Whether it has been told the whole of the bananas yet, or is to be told only what changed. */
  told: boolean
}

/**
 * Seat a hello in the world it asks for, of the game it says it is a
 * member of: made first if nobody is on it, and waited for if it takes a
 * while. Anything it may not join is refused, and nothing is seated.
 */
export function arrive(state: ServerState, connection: TransportConnection, hello: HelloMessage): void {
  const game = state.games.get(hello.game)
  if (game === undefined) {
    reject(state, connection, REJECT_MALFORMED_MESSAGE)
    return
  }
  // A hello with no car asks to watch the world rather than to be in it.
  if (hello.profile === null) {
    spectate(state, connection, hello, game)
    return
  }
  const member = hello.pass === NO_PASS ? undefined : memberOfPass(game, hello.pass)
  if (member === undefined) {
    reject(state, connection, REJECT_MALFORMED_MESSAGE)
    return
  }
  let racer: Racer | null = null
  let leg: RaceLeg | null = null
  let legIndex = 0
  if (game.options.mode === 'race') {
    const course = game.course
    const at = course === null ? null : legOf(course, hello.seed)
    const driving = game.racers.get(hello.pass)
    if (course === null || at === null || driving === undefined || (game.phase.kind !== 'starting' && game.phase.kind !== 'racing')) {
      reject(state, connection, REJECT_MALFORMED_MESSAGE)
      return
    }
    // On into the next world only by the portal that leads to it, with every gate before it passed.
    if (at.index !== driving.leg) {
      const leaving = course.legs[driving.leg]
      const through = leaving !== undefined && at.index === driving.leg + 1 && driving.checkpoint >= leaving.checkpoints.length - 1
      if (!through || hello.arrival !== at.leg.arrival) {
        reject(state, connection, REJECT_MALFORMED_MESSAGE)
        return
      }
    }
    racer = driving
    leg = at.leg
    legIndex = at.index
  } else if (!member.ready) {
    // A free drive is joined by being ready to drive in it.
    reject(state, connection, REJECT_MALFORMED_MESSAGE)
    return
  }

  const key = roomKey(hello.game, hello.seed)
  const existing = state.rooms.get(key)
  if (existing !== undefined) {
    seat(state, connection, hello, existing, game, member, racer, leg, legIndex)
    return
  }
  const request: ArenaRequest = {
    game: hello.game,
    world: hello.seed,
    keep: leg === null ? null : keepOf(leg),
    weapons: game.options.weapons,
    bananas: game.options.bananas,
  }
  const made = state.making.get(key) ?? state.sources.arenaFor(request)
  if (!(made instanceof Promise)) {
    seat(state, connection, hello, openRoom(state, request, made), game, member, racer, leg, legIndex)
    return
  }
  // Not made yet: they wait for it, and whoever else asks for it meanwhile waits with them.
  const handshake = state.handshaking.get(connection.id)
  if (handshake !== undefined) handshake.waiting = hello
  if (!state.making.has(key)) whenMade(state, key, request, made)
}

/**
 * Seat a watcher in a room of a race nobody has to be in: it is told the
 * welcome, the plan of this world and every snapshot, and takes no seat.
 * Only a room that is already open is watched, and only a race's (or the
 * demo's): a free drive is nobody's to watch.
 */
export function spectate(state: ServerState, connection: TransportConnection, hello: HelloMessage, game: GameRecord): void {
  const at = game.course === null ? null : legOf(game.course, hello.seed)
  const room = roomFor(state, hello.game, hello.seed)
  const racing = game.options.mode === 'race' && (game.phase.kind === 'starting' || game.phase.kind === 'racing')
  if (at === null || room === undefined || !racing) {
    reject(state, connection, REJECT_MALFORMED_MESSAGE)
    return
  }
  state.handshaking.delete(connection.id)
  const spectator: Spectator = { connection, told: false }
  room.spectators.set(connection.id, spectator)
  state.watching.set(connection.id, room)
  connection.send(
    encodeWelcome({
      protocolVersion: PROTOCOL_VERSION,
      game: game.id,
      seed: room.world,
      seat: NO_SEAT,
      epoch: 0,
      tick: room.arena.tick,
      maxPlayers: RACERS_MOST,
      profile: DEFAULT_VEHICLE_PROFILE,
      pass: NO_PASS,
      race: true,
      flags: flagsOf(game.options),
      challenge: '',
      signedIn: '',
    }),
  )
  connection.send(encodeRacePlan(planOf(game.course!, at.index, game.id)))
}

/**
 * Once a world being made is ready, its room is made of it and everyone
 * waiting for it is seated there, by asking again. The room is made and
 * filled without a tick between, so that it is never stepped empty and
 * closed with the world still on its way.
 */
function whenMade(state: ServerState, key: number, request: ArenaRequest, made: Promise<Arena>): void {
  state.making.set(key, made)
  const waiting = (): Handshake[] => [...state.handshaking.values()].filter((handshake) => handshake.waiting !== null && roomKey(handshake.waiting.game, handshake.waiting.seed) === key)
  made.then(
    (arena) => {
      state.making.delete(key)
      if (state.disposed) {
        arena.world.free()
        return
      }
      const room = state.rooms.get(key) ?? openRoom(state, request, arena)
      // Made twice while it was being made: the room there is has this arena, and the other is nobody's.
      if (room.arena !== arena) arena.world.free()
      for (const handshake of waiting()) arrive(state, handshake.connection, handshake.waiting!)
      // Made for nobody after all: not worth stepping.
      closeIfEmpty(state, room)
    },
    () => {
      state.making.delete(key)
      for (const handshake of waiting()) reject(state, handshake.connection, REJECT_MALFORMED_MESSAGE)
    },
  )
}

/**
 * The room of a world of a game, made if it is not open yet, at once or
 * once the arena is: whoever asks for it while it is being made waits on
 * the same promise as everyone else.
 */
export function makeRoom(state: ServerState, request: ArenaRequest): Promise<Room> {
  const key = roomKey(request.game, request.world)
  const known = state.rooms.get(key)
  if (known !== undefined) return Promise.resolve(known)
  const made = state.making.get(key) ?? state.sources.arenaFor(request)
  if (!(made instanceof Promise)) return Promise.resolve(openRoom(state, request, made))
  state.making.set(key, made)
  return made.then(
    (arena) => {
      state.making.delete(key)
      if (state.disposed) {
        arena.world.free()
        throw new Error('the server is gone')
      }
      const room = state.rooms.get(key) ?? openRoom(state, request, arena)
      // Made twice while it was being made: the room there is has this arena, and the other is nobody's.
      if (room.arena !== arena) arena.world.free()
      return room
    },
    (error: unknown) => {
      state.making.delete(key)
      throw error
    },
  )
}

/** A room for a world nobody is on, its arena made from the world the request names. */
export function openRoom(state: ServerState, request: ArenaRequest, arena: Arena): Room {
  const game = state.games.get(request.game)
  const legs = game?.course?.legs ?? []
  const room: Room = {
    game: request.game,
    world: request.world,
    leg: legs.findIndex((leg) => leg.world === request.world),
    mode: game?.options.mode ?? 'free',
    arena,
    players: new Map(),
    drivers: new Map(),
    bots: new Map(),
    racers: new Map(),
    spectators: new Map(),
    snapshots: createRoomSnapshots(),
    lastSnapshotBytes: 0,
  }
  state.rooms.set(roomKey(room.game, room.world), room)
  holdRoom(state, room, game)
  // A free drive's bots roam its world as its traffic does, by their names, and are counted among it.
  if (game !== undefined && game.options.mode === 'free') seatFreeBots(room, game)
  topUpNpcs(state, room.arena)
  state.events.onRoomOpened?.(room)
  return room
}

/** Seat a free drive's bots in a world just made: one of the traffic's own cars each, in its slot's vehicle, by its name. */
function seatFreeBots(room: Room, game: GameRecord): void {
  for (const slot of game.slots) {
    if (slot.kind !== 'bot') continue
    const free = freeSeat(room.arena)
    if (free === undefined) return
    const seat = seatNpc(room.arena, free.id)
    if (seat === null) return
    // A rover is the moon's own traffic: nothing else would drive there.
    if (seat.rover === null && seat.profile !== slot.vehicle) {
      changeVehicle(room.arena, seat, slot.vehicle)
      seat.tuning.damageToWreck /= NPC_FRAGILITY
    }
    room.bots.set(seat.id, { pass: slot.pass, name: slot.name, bot: null, route: null, previous: v3() })
  }
  broadcastLobby(room)
}

/**
 * A race's first world holds its cars still until the countdown is over:
 * from the moment the room is made, and no later than the tick the
 * countdown ends. Any other room, and every free-drive room, drives.
 */
export function holdRoom(state: ServerState, room: Room, game: GameRecord | undefined): void {
  const first = game?.course?.legs[0]
  if (game === undefined || first === undefined || first.world !== room.world) return
  const startsAt = startsAtOf(game)
  if (startsAt === NO_TICK) room.arena.holdUntil = game.phase.kind === 'starting' ? HOLD_FOREVER : 0
  else room.arena.holdUntil = room.arena.tick + Math.max(startsAt - state.clock, 0)
}

/** Put a member in a seat of a room, where the race has it or where it comes out of a portal. */
export function seat(
  state: ServerState,
  connection: TransportConnection,
  hello: HelloMessage,
  room: Room,
  game: GameRecord,
  member: GameMember,
  racer: Racer | null,
  leg: RaceLeg | null,
  legIndex: number,
): void {
  const { arena } = room
  // A car nobody drives gives up its seat to someone who will.
  let free = freeSeat(arena)
  const npc = arena.seats.find((seat) => seat.npc)
  if (free === undefined && npc !== undefined) {
    leaveSeat(arena, npc.id)
    room.bots.delete(npc.id)
    free = npc
  }
  if (free === undefined) {
    reject(state, connection, REJECT_SERVER_FULL)
    closeIfEmpty(state, room)
    return
  }

  state.handshaking.delete(connection.id)
  const seat = takeSeat(arena, free.id, member.vehicle)
  const left = state.left.get(member.drivePass)
  // Back in the room it was cut off from, rather than come into it from another: the room's word is where it was.
  const back = left !== undefined && left.game === game.id && left.world === room.world ? left : null
  // Come through a portal into this room, or back into the one it left: what it held waits for it.
  const through = hello.arrival !== NO_ARRIVAL
  const carried = back ?? (through && left !== undefined && left.game === game.id ? left : null)
  if (racer !== null && leg !== null && racer.leg !== legIndex) {
    racer.leg = legIndex
    racer.checkpoint = 0
  }
  if (back !== null) respawn(seat, back.where)
  else if (racer !== null && leg !== null && game.course !== null) placeOnLeg(room, game, seat, racer, leg, legIndex, hello.arrival)
  else if (hello.arrival !== NO_ARRIVAL) {
    // Come through a portal, the car comes out of the one it arrives by, beside anyone already there.
    const out = arrivalSpawn(arena, hello.arrival, seat)
    if (out !== null) respawn(seat, out)
  }
  // With what it held when it went, which is its own wallet, not the one its key keeps.
  if (carried !== null) {
    state.left.delete(member.drivePass)
    carryOver(seat, carried.carried)
    if (carried.pubkey !== null) member.pubkey = carried.pubkey
  }
  const identity = { name: member.name, challenge: newChallenge(), pubkey: member.pubkey }
  const player: Player = {
    connection,
    identity,
    room,
    seat,
    timeline: new InputTimeline(arena.tick),
    respawnedTick: arena.tick,
    told: false,
    allowance: INPUT_ALLOWANCE,
    dropped: 0,
    heardTick: state.clock,
    pass: member.drivePass,
  }
  if (identity.pubkey !== null) welcomeKey(state, player, identity.pubkey, carried === null)
  state.players.set(connection.id, player)
  room.players.set(connection.id, player)
  room.drivers.set(seat.id, player)
  if (racer !== null) room.racers.set(seat.id, racer.key)
  connection.send(
    encodeWelcome({
      protocolVersion: PROTOCOL_VERSION,
      game: game.id,
      seed: room.world,
      seat: seat.id,
      epoch: seat.epoch,
      tick: arena.tick,
      maxPlayers: RACERS_MOST,
      profile: seat.profile,
      pass: player.pass,
      race: room.mode === 'race',
      flags: flagsOf(game.options),
      challenge: identity.challenge,
      signedIn: identity.pubkey ?? '',
    }),
  )
  // In a race the gates of this world come before anything else does.
  if (racer !== null && leg !== null && game.course !== null) connection.send(encodeRacePlan(planOf(game.course, legIndex, game.id)))
  state.events.onJoined?.(seat, connection.id, room)
  broadcastLobby(room)
}

/** Where a racer's car goes in a world of the course it joins: the grid it starts from, the portal it comes out of, or its last gate. */
function placeOnLeg(room: Room, game: GameRecord, seat: Seat, racer: Racer, leg: RaceLeg, legIndex: number, arrival: number): void {
  const course = game.course
  if (course === null) return
  if (leg.arrival === NO_PORTAL && legIndex === 0) {
    if (game.phase.kind !== 'starting') {
      respawn(seat, checkpointSpawn(course, room.arena.planet, racer.leg, racer.checkpoint, racer.grid))
      return
    }
    const grid = leg.grid[racer.grid] ?? leg.grid[leg.grid.length - 1]
    if (grid !== undefined) respawn(seat, grid)
    return
  }
  // Out of the portal a car arrives by, beside anyone already there.
  const out = arrivalSpawn(room.arena, arrival, seat)
  if (out !== null) respawn(seat, out)
}

/** Let a player go, holding on to what they held. The last one out closes the room, unless it is about to be joined again. */
export function leaveRoom(state: ServerState, player: Player, keepRoom = false): void {
  const { connection, room, seat } = player
  state.players.delete(connection.id)
  room.players.delete(connection.id)
  room.drivers.delete(seat.id)
  room.racers.delete(seat.id)
  keepBananas(state, player)
  // Gone through a portal, or cut off, as far as anyone here knows: what they held waits for them.
  state.left.set(player.pass, {
    carried: carriedOf(seat),
    pubkey: player.identity.pubkey,
    tick: state.clock,
    game: room.game,
    world: room.world,
    where: spawnWhere(seat),
  })
  leaveSeat(room.arena, seat.id)
  topUpNpcs(state, room.arena)
  state.events.onLeft?.(seat, connection.id, room)
  broadcastLobby(room)
  // An empty room is not worth stepping.
  if (!keepRoom) closeIfEmpty(state, room)
}

/** Close a room: its world goes, and whoever was watching it is let go to find the race again. */
export function closeRoom(state: ServerState, room: Room): void {
  if (state.rooms.get(roomKey(room.game, room.world)) !== room) return
  state.rooms.delete(roomKey(room.game, room.world))
  room.arena.world.free()
  // Whoever is watching it finds the race again from the start screen.
  for (const [id, spectator] of room.spectators) {
    room.spectators.delete(id)
    state.watching.delete(id)
    spectator.connection.close(ROOM_CLOSED)
  }
  state.events.onRoomClosed?.(room)
}

/** Close a room nobody is in any more: no player, and no bot either. */
export function closeIfEmpty(state: ServerState, room: Room): void {
  if (room.players.size === 0 && room.bots.size === 0) closeRoom(state, room)
}

/** Seat cars nobody drives in the last seats, until there are as many as an island has, or no seat is left. */
export function topUpNpcs(state: ServerState, arena: Arena): void {
  let count = arena.seats.filter((seat) => seat.npc).length
  for (let id = arena.seats.length - 1; id >= 0 && count < state.npcs; id--) {
    if (arena.seats[id]!.occupied) continue
    if (seatNpc(arena, id) === null) return
    count++
  }
}

/** Where a car comes out of a portal: the first place out of it that no other car in play is standing on. */
export function arrivalSpawn(arena: Arena, portal: number, seat: Seat): VehicleSpawn | null {
  for (let place = 0; place < 8; place++) {
    const out = portalSpawn(arena.planet, portal, place)
    if (out === null) return null
    const taken = arena.seats.some((other) => other !== seat && other.occupied && vdistance(other.vehicle.frame.position, out.position) < ARRIVAL_CLEAR)
    if (!taken) return out
  }
  return portalSpawn(arena.planet, portal, 0)
}
