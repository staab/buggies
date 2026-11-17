/**
 * One tick of the whole server, which is all the clock ever asks of it:
 * every game's life, the bots of every race in their worlds, every room
 * stepped, every race's gates, the demo, and every connection's time kept.
 * Nothing here is any one game's or room's rule; it is only the order the
 * server does them in.
 */

import { NEUTRAL_INPUT, advance, awardAchievements, botInput, npcInput, respawnLost, type Seat, type VehicleInput } from '@buggies/game'
import { vcopy, type Vec3 } from '@buggies/physics'

import { tendDemo } from './demo.ts'
import { REJECT_HANDSHAKE_ORDER, REJECT_IDLE, TICKS_PER_SECOND, TICKS_PER_SNAPSHOT } from './protocol.ts'
import { keepBananas, paid, unpaid } from './player-records.ts'
import { placeAtCheckpoint, stepRace, tendGame } from './race.ts'
import { botThroughPortal, putStuckBotsBack, tendRaceBots } from './race-bots.ts'
import { NO_LEG, closeIfEmpty, leaveRoom, type Room } from './rooms.ts'
import { INPUT_ALLOWANCE, INPUTS_PER_TICK, gatherGames, gatherRooms, type ServerState } from './server-state.ts'
import { broadcastSnapshot, reject } from './telling.ts'

/** How often the bananas everyone holds are kept against their keys, besides when they leave: a server that stops loses no more than this. */
const BANANAS_KEPT_TICKS = TICKS_PER_SECOND * 10

/** A player heard nothing from for this long is let go: a tab left behind is not a driver. */
const IDLE_TIMEOUT_TICKS = TICKS_PER_SECOND * 15

/**
 * How long what a player left a room holding waits for them to come out of
 * a portal into the next, or back into it: long enough for their page to
 * make the world on the other side before it joins its room.
 */
const CARRY_TICKS = TICKS_PER_SECOND * 120

const HANDSHAKE_TIMEOUT_TICKS = TICKS_PER_SECOND * 5
/** How long someone may wait for their world to be made before giving up on it. */
const MAKING_TIMEOUT_TICKS = TICKS_PER_SECOND * 60

/** A leg with no way at all to follow, for a car that is not a bot of a race. */
const NO_ROUTE: readonly Vec3[] = []

/** One fixed step for every game and every room, then a look at every player and every handshake. */
export function stepServer(state: ServerState): void {
  state.clock += 1
  // Each list is gathered just before it is walked, so that a game or room closed part way is not walked after.
  for (const game of gatherGames(state)) tendGame(state, game)
  for (const game of gatherGames(state)) tendRaceBots(state, game)
  for (const room of gatherRooms(state)) stepRoom(state, room)
  for (const game of gatherGames(state)) if (game.phase.kind === 'racing') stepRace(state, game)
  tendDemo(state)
  if (state.clock % BANANAS_KEPT_TICKS === 0) for (const player of state.players.values()) keepBananas(state, player)
  expireHandshakes(state)
  tendPlayers(state)
  expireCarried(state)
}

/** One step of one room: its cars driven, its bots kept to their routes, its wrecks put back, its feats paid, and its word to everyone in it. */
function stepRoom(state: ServerState, room: Room): void {
  const { arena } = room
  const tick = arena.tick
  advance(arena, (seat) => inputOf(state, room, seat, tick))
  // A bot through the portal out of its leg leaves this room for the next.
  if (room.leg !== NO_LEG) {
    for (const [id, entry] of room.bots) {
      const seat = arena.seats[id]
      if (seat !== undefined && seat.occupied && entry.bot !== null) botThroughPortal(state, room, id, entry, seat)
    }
  }
  for (const seat of respawnLost(arena)) {
    // In a race a car comes back to the last gate its racer passed, not to the nearest road.
    placeAtCheckpoint(state, room, seat)
    state.events.onRespawned?.(seat, 'lost')
  }
  putStuckBotsBack(state, room)
  // What is left of this tick is where each bot's car is, for the next tick's crossing.
  for (const [id, entry] of room.bots) {
    const seat = arena.seats[id]
    if (seat !== undefined && seat.occupied) vcopy(entry.previous, seat.vehicle.frame.position)
  }
  for (const { seat, achievement } of awardAchievements(arena, (seat, feat) => unpaid(state, room, seat, feat.id))) paid(state, room, seat, achievement)
  if (arena.tick % TICKS_PER_SNAPSHOT === 0) broadcastSnapshot(state, room)
  // Out of its last player and its last bot, a room is not worth stepping.
  closeIfEmpty(state, room)
}

/** What the car in a seat is asked for this tick: a player's input, a bot's way along its route, or the traffic's own driving. */
function inputOf(state: ServerState, room: Room, seat: Seat, tick: number): VehicleInput {
  if (seat.npc) return npcInput(room.arena, seat, state.npcCommand)
  const entry = room.bots.get(seat.id)
  if (entry !== undefined && entry.bot !== null) return botInput(entry.bot, seat, entry.route ?? NO_ROUTE, state.botCommand, room.arena)
  return room.drivers.get(seat.id)?.timeline.consume(tick) ?? NEUTRAL_INPUT
}

/** Each tick a player may send a couple more inputs, and one silent for too long is let go. */
function tendPlayers(state: ServerState): void {
  for (const player of state.players.values()) {
    player.allowance = Math.min(INPUT_ALLOWANCE, player.allowance + INPUTS_PER_TICK)
    if (state.clock - player.heardTick <= IDLE_TIMEOUT_TICKS) continue
    // Let go at once, not again each tick until its connection is seen to close.
    reject(state, player.connection, REJECT_IDLE)
    leaveRoom(state, player)
  }
}

/** A connection that has said nothing for long enough, handshake or world, is let go. */
function expireHandshakes(state: ServerState): void {
  for (const handshake of state.handshaking.values()) {
    const timeout = handshake.waiting === null ? HANDSHAKE_TIMEOUT_TICKS : MAKING_TIMEOUT_TICKS
    if (state.clock - handshake.openedTick < timeout) continue
    reject(state, handshake.connection, REJECT_HANDSHAKE_ORDER)
  }
}

/** What players left their rooms holding waits only so long for them. */
function expireCarried(state: ServerState): void {
  for (const [pass, { tick }] of state.left) if (state.clock - tick > CARRY_TICKS) state.left.delete(pass)
}
