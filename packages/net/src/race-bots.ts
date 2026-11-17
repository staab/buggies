/**
 * The bots of a race, as far as a room is concerned: where each is put on
 * the grid of a world, which portal takes it on to the next, and where one
 * that has got itself stuck is put back. It is the same seat as a player's
 * and the same gates, driven by `botInput` along the leg's route; what a
 * bot is racing for is the race's business, not this.
 */

import {
  NO_PORTAL,
  botPutBackSpot,
  botSetBack,
  botStuck,
  createRacerBot,
  freeSeat,
  keepOf,
  leaveSeat,
  nextWorld,
  portalCrossed,
  respawn,
  takeSeat,
  type RaceLeg,
  type Seat,
} from '@buggies/game'
import { v3, vcopy, type Vec3 } from '@buggies/physics'

import { botOfPass, type GameRecord, type Racer } from './game-registry.ts'
import { placeAtCheckpoint } from './race.ts'
import { arrivalSpawn, makeRoom, roomFor, roomKey, type Room, type RoomBot } from './rooms.ts'
import type { ArenaRequest, ServerState } from './server-state.ts'
import { broadcastLobby } from './telling.ts'

/**
 * Seat every bot racer of a race that is between worlds: on the grid of
 * the first, or at the portal it comes out of in the next. The world a bot
 * is to be put in is made here, if nobody has made it yet, while the bot
 * waits.
 */
export function tendRaceBots(state: ServerState, game: GameRecord): void {
  const course = game.course
  if (game.options.mode !== 'race' || course === null) return
  if (game.phase.kind !== 'starting' && game.phase.kind !== 'racing') return
  for (const racer of game.racers.values()) {
    if (!racer.bot) continue
    const leg = course.legs[racer.leg]
    if (leg === undefined) continue
    const room = roomFor(state, game.id, leg.world)
    if (room === undefined) {
      if (state.making.has(roomKey(game.id, leg.world))) continue
      const request: ArenaRequest = { game: game.id, world: leg.world, keep: keepOf(leg), weapons: game.options.weapons, bananas: game.options.bananas }
      void makeRoom(state, request).catch(() => undefined)
      continue
    }
    if (seatedRacer(room, racer.key)) continue
    seatBot(room, game, racer, leg)
  }
}

/** Whether a racer of this pass already has a seat in the room: a bot of it, whose car nobody on a connection drives. */
function seatedRacer(room: Room, pass: number): boolean {
  for (const seated of room.racers.values()) if (seated === pass) return true
  return false
}

/** Put a bot racer in a free seat of a race's world, where the race has it: on the grid, or out of the portal it arrives by. */
function seatBot(room: Room, game: GameRecord, racer: Racer, leg: RaceLeg): void {
  const { arena } = room
  const free = freeSeat(arena)
  if (free === undefined) return
  const slot = botOfPass(game, racer.key)
  const vehicle = slot?.kind === 'bot' ? slot.vehicle : racer.vehicle
  const seat = takeSeat(arena, free.id, vehicle)
  seat.npc = false
  seat.driver = null
  seat.rover = null
  const entry: RoomBot = { pass: racer.key, name: racer.name, bot: createRacerBot(racer.slot), route: leg.route, previous: v3() }
  room.bots.set(seat.id, entry)
  room.racers.set(seat.id, racer.key)
  const grid = leg.arrival === NO_PORTAL && game.phase.kind === 'starting' ? (leg.grid[racer.grid] ?? leg.grid[leg.grid.length - 1]) : undefined
  if (grid !== undefined) respawn(seat, grid)
  else {
    const out = arrivalSpawn(arena, leg.arrival, seat)
    if (out !== null) respawn(seat, out)
  }
  // Set down, it is nowhere it crossed to get there.
  vcopy(entry.previous, seat.vehicle.frame.position)
  broadcastLobby(room)
}

/**
 * A bot through the portal out of its leg: out of this room, to be seated in
 * the next one the tick its world is ready. Its racer keeps everything but
 * the leg it is on, and the gates it has still to pass there.
 */
export function botThroughPortal(state: ServerState, room: Room, id: number, entry: RoomBot, seat: Seat): void {
  const game = state.games.get(room.game)
  if (game === undefined) return
  const course = game.course
  if (course === null) return
  const leg = course.legs[room.leg]
  if (leg === undefined || leg.exit === NO_PORTAL) return
  const racer = game.racers.get(entry.pass)
  if (racer === undefined || racer.leg !== room.leg) return
  // Only the portal out takes a bot on, and only once the gates up to it are passed: the exit is its next gate, or the one it has just gone through.
  if (racer.checkpoint < leg.checkpoints.length - 1) return
  if (portalCrossed(room.arena.planet, entry.previous, seat.vehicle.frame.position) !== leg.exit) return
  if (nextWorld(course, room.leg) === null) return
  leaveBotSeat(room, id)
  racer.leg = room.leg + 1
  racer.checkpoint = 0
}

/** The seat a bot held goes, with its name off the island's list: it is between the rooms of the race. */
function leaveBotSeat(room: Room, id: number): void {
  leaveSeat(room.arena, id)
  room.bots.delete(id)
  room.racers.delete(id)
  broadcastLobby(room)
}

/**
 * Put a bot back on its route once it has been stuck long enough to need it:
 * a few points back from where it got to, clear of every other car, rather
 * than at its last gate, so that one stopped on the grid or in the way is
 * got round instead of run into again.
 */
export function putStuckBotsBack(state: ServerState, room: Room): void {
  const { arena } = room
  // At the grid a bot is held, not stuck: its clock runs whether or not the car is being driven.
  if (arena.tick < arena.holdUntil) {
    for (const { bot } of room.bots.values()) {
      if (bot === null) continue
      bot.stuckFor = 0
      bot.blockedFor = 0
      bot.reverseFor = 0
    }
    return
  }
  for (const [id, entry] of room.bots) {
    if (entry.bot === null || !botStuck(entry.bot)) continue
    const seat = arena.seats[id]
    const spot = entry.route === null ? null : botPutBackSpot(entry.route, entry.bot.along, carsElsewhere(arena.seats, seat))
    botSetBack(entry.bot, spot === null ? entry.bot.along : spot.along)
    if (seat === undefined) continue
    if (spot === null) placeAtCheckpoint(state, room, seat)
    else respawn(seat, spot.spawn)
  }
}

/** Where every car in a room but one is, as a bot is to be put back clear of them. */
function carsElsewhere(seats: readonly Seat[], mine: Seat | undefined): Vec3[] {
  const cars: Vec3[] = []
  for (const seat of seats) if (seat.occupied && seat !== mine) cars.push(seat.vehicle.frame.position)
  return cars
}
