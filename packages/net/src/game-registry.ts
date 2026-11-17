/**
 * Every game on the server: what it is played for, who hosts it, what its
 * host has chosen, who is in it and where it is in its life. Plain data and
 * functions over it, so that the same rules hold whatever drives it; the
 * server owns one of these a game and steps them.
 */

import {
  COUNTDOWN_TICKS,
  DEFAULT_VEHICLE_PROFILE,
  SEATING_TICKS,
  STANDINGS_TICKS,
  WORLDS_DEFAULT,
  WORLDS_LEAST,
  WORLDS_MOST,
  type Course,
} from '@buggies/game'
import type { VehicleProfileId } from '@buggies/game'
import { planetSeedOf } from '@buggies/terrain'
import { NO_TICK, SLOTS_MOST, TICKS_PER_SECOND } from './protocol.ts'
import type { TransportConnection } from './transport.ts'
import { NO_PASS, type GameOptions, type GameSlotView, type GameStatus, type GameSummary, type GameView, type Standing } from './wire.ts'

/** The names a game's bots go by, in the order it first seats one, and the cars their slots are laid out for. */
export const BOT_NAMES: readonly string[] = ['Axle', 'Bolt', 'Cinder', 'Dash', 'Ember', 'Flick', 'Gauge', 'Hex']
export const BOT_VEHICLES: readonly VehicleProfileId[] = ['raceCar', 'sportsCar', 'police', 'goKart', 'duneBuggy', 'pickup', 'smallCar', 'ambulance']

/** How many slots a game is made with: the host's and three bots'. */
export const SLOTS_START = 4

/** One player in a game room: one lobby connection, one vehicle, one seat in a world. */
export interface GameMember {
  readonly id: number
  readonly connection: TransportConnection
  readonly name: string
  /** Learned by `CLIENT_AUTH` on the lobby connection; `null` until it is. */
  pubkey: string | null
  vehicle: VehicleProfileId
  ready: boolean
  /**
   * What the member shows to be seated in a world room, and to be met again
   * by after a portal or a dropped connection: minted when it joins and kept
   * for the game's life. It is also the world connection's pass, so a member
   * is one pass from the start screen to the finish line.
   */
  readonly drivePass: number
  /** What it was given to sign with its nostr key, on its lobby connection. */
  readonly challenge: string
}

/**
 * A place in a game, in the order its room lists them: a player's, or a
 * bot's until a player takes it. A bot's pass numbers its racer while the
 * race lasts, as a member's numbers theirs; no connection drives by it.
 */
export type Slot = { kind: 'player'; member: number } | { kind: 'bot'; name: string; vehicle: VehicleProfileId; pass: number }

/** One racer in a race, from its start to the finish line, wherever it is: it outlives any one room. */
export interface Racer {
  /** The pass its seat is known by: a member's drive pass, or a bot's own. */
  readonly key: number
  /** The slot it holds, which is how fast a bot dares go. */
  readonly slot: number
  /** Its place in the line the racers start in, from the order they were seated. */
  readonly grid: number
  readonly name: string
  readonly vehicle: VehicleProfileId
  /** Driven by a bot rather than a person. */
  readonly bot: boolean
  /** 0-based index of the course leg it is on, and of the next gate in that leg. */
  leg: number
  checkpoint: number
  /** The server tick it crossed the finish line, or 0. */
  finishedAt: number
  /** 1 upward once it has finished and while it races: where it stands, from the last placing. */
  place: number
}

/**
 * Where a game is in its life, and the ticks that moved it on. One value
 * rather than a status and a handful of ticks that are only meaningful in
 * some of its states, so that a game cannot be, say, racing with no start.
 */
export type GamePhase =
  | { readonly kind: 'open' }
  | { readonly kind: 'preparing' }
  /** Its racers take their places: the countdown begins once they are all there or by `seatedBy`, and ends at `startsAt`. */
  | { readonly kind: 'starting'; readonly seatedBy: number; readonly startsAt: number | null }
  /** Driving from `startsAt`; `overAt` is set once the race is called over, and its standings still to be posted. */
  | { readonly kind: 'racing'; readonly startsAt: number; readonly overAt: number | null }
  /** Over, its standings up until it is deleted at `closesAt`. */
  | { readonly kind: 'finished'; readonly startsAt: number; readonly overAt: number; readonly closesAt: number }

/** A game on the server, from the moment its host makes it until its standings have been shown. */
export interface GameRecord {
  /** Server-wide, never reused, from 1 upward. */
  readonly id: number
  /** Whether this is the server's own demo race, which nobody hosts and nobody joins. */
  readonly demo: boolean
  /** The member who created it, and who alone may change its options, its slots or start it; 0 for the demo. */
  host: number
  options: GameOptions
  /** Every slot, in order: the players among them and the bots. */
  readonly slots: Slot[]
  /** By member id, in the order they joined. */
  readonly members: Map<number, GameMember>
  phase: GamePhase
  /** The race's course, once the host has started it and the worlds are made. */
  course: Course | null
  /** Every racer, by the pass it drives with: it outlives any one room. */
  readonly racers: Map<number, Racer>
  /** How the race finished, frozen when it is called over. */
  standings: readonly Standing[]
  /** Why the last Start failed, for the room to show, or `null`. */
  lastFault: string | null
  /** The member id the next joiner gets. */
  nextMember: number
  /** How many bots the game has seated all told, which is how far down the pool its next one's name is. */
  nextBot: number
}

/** What one step of a game changed about where it is in its life. */
export interface GameEffect {
  /** The countdown has just begun: every racer is on the grid, or their waiting time is up. */
  countdown: boolean
  /** Driving has begun. */
  started: boolean
  /** The race is over and the standings stand. */
  finished: boolean
  /** The game is to be deleted. */
  closed: boolean
}

/** Nothing changed about where the game is in its life, which is what most steps are. */
const NO_EFFECT: GameEffect = { countdown: false, started: false, finished: false, closed: false }

/** Where the game is in its life, as the wire names it. */
export function gameStatus(game: GameRecord): GameStatus {
  return game.phase.kind
}

/** Whether a race of it is under way: its countdown, or its driving. That is what the start screen may watch. */
export function raceUnderWay(game: GameRecord): boolean {
  return game.phase.kind === 'starting' || game.phase.kind === 'racing'
}

/** The tick driving began or will, or `NO_TICK` until the countdown has. */
export function startsAtOf(game: GameRecord): number {
  return 'startsAt' in game.phase ? (game.phase.startsAt ?? NO_TICK) : NO_TICK
}

/** The tick the race was called over, or `NO_TICK` while it has not been. */
export function overAtOf(game: GameRecord): number {
  return 'overAt' in game.phase ? (game.phase.overAt ?? NO_TICK) : NO_TICK
}

/** Whether the game waits for its host to start it: nothing is driven in it yet. */
export function gameOpen(game: GameRecord): boolean {
  return game.phase.kind === 'open'
}

/** The game its host has just made, before anything is in it: a planet of its own to start on, every rule on, a race three worlds long. */
function emptyGame(id: number, demo: boolean, options: GameOptions): GameRecord {
  return {
    id,
    demo,
    host: 0,
    options,
    slots: [],
    members: new Map(),
    phase: { kind: 'open' },
    course: null,
    racers: new Map(),
    standings: [],
    lastFault: null,
    nextMember: 1,
    nextBot: 0,
  }
}

/** A game its host has just made, in the vehicle they joined in, with the pass they drive it by. */
export function createGame(
  id: number,
  connection: TransportConnection,
  name: string,
  vehicle: VehicleProfileId,
  challenge: string,
  seed: number,
  pass: number,
): GameRecord {
  const game = emptyGame(id, false, { mode: 'race', seed: planetSeedOf(seed), weapons: true, bananas: true, raceLength: WORLDS_DEFAULT })
  // The first slot is the host's from the moment it takes it, as a player takes any bot's slot.
  game.slots.push({ kind: 'bot', name: BOT_NAMES[0]!, vehicle, pass: NO_PASS })
  const member = addMember(game, connection, name, vehicle, challenge, pass)
  if (member === null) throw new Error('a game of its own has room for its host')
  // A new game has four slots: the host's and three bots', which a player may take.
  while (game.slots.length < SLOTS_START) addBotSlot(game)
  game.host = member.id
  return game
}

/** The server's own demo race: four bots, two worlds, and nobody hosting it. */
export function createDemoGame(id: number, seed: number): GameRecord {
  const game = emptyGame(id, true, { mode: 'race', seed: planetSeedOf(seed), weapons: true, bananas: true, raceLength: WORLDS_LEAST })
  while (game.slots.length < SLOTS_START) addBotSlot(game)
  return game
}

/** The pass a bot's slot is known by: no connection drives by it, so it only has to keep out of the game's own members' way. */
function newBotPass(game: GameRecord): number {
  for (;;) {
    const pass = Math.floor(Math.random() * 0x1_0000_0000)
    if (pass === NO_PASS) continue
    if ([...game.members.values()].some((member) => member.drivePass === pass)) continue
    if (game.slots.some((slot) => slot.kind === 'bot' && slot.pass === pass)) continue
    return pass
  }
}

/** A bot in a new slot at the end of the game's: named from the pool in the order the game seats them, in the car its slot is laid out for. */
function addBotSlot(game: GameRecord): Slot {
  const at = game.slots.length
  const slot: Slot = {
    kind: 'bot',
    name: nextBotName(game),
    vehicle: BOT_VEHICLES[at % BOT_VEHICLES.length]!,
    pass: newBotPass(game),
  }
  game.slots.push(slot)
  return slot
}

/** Put a player in the game, if it is joinable and has a bot's slot to take; `null` when it has not. */
export function addMember(
  game: GameRecord,
  connection: TransportConnection,
  name: string,
  vehicle: VehicleProfileId,
  challenge: string,
  pass: number,
): GameMember | null {
  if (!joinable(game)) return null
  const at = game.slots.findIndex((slot) => slot.kind === 'bot')
  if (at < 0) return null
  const member: GameMember = { id: game.nextMember, connection, name, pubkey: null, vehicle, ready: false, drivePass: pass, challenge }
  game.nextMember += 1
  game.members.set(member.id, member)
  game.slots[at] = { kind: 'player', member: member.id }
  return member
}

/** Whether a game may still be joined: a race while it waits, a free drive at any time, with a bot's slot to spare. The server's own demo race is nobody's to join. */
export function joinable(game: GameRecord): boolean {
  if (game.demo) return false
  if (game.options.mode === 'race' && !gameOpen(game)) return false
  return game.slots.some((slot) => slot.kind === 'bot')
}

/**
 * Take a player out of the game: its seat in the race with it, and its slot
 * a bot's again, in the car it left. The earliest of those left hosts it; a
 * game nobody is left in is the server's to delete.
 */
export function removeMember(game: GameRecord, member: number): void {
  const gone = game.members.get(member)
  if (gone === undefined) return
  game.members.delete(member)
  game.racers.delete(gone.drivePass)
  const at = game.slots.findIndex((slot) => slot.kind === 'player' && slot.member === member)
  if (at >= 0) game.slots[at] = { kind: 'bot', name: nextBotName(game), vehicle: gone.vehicle, pass: newBotPass(game) }
  if (game.host !== member) return
  const heir = game.members.keys().next()
  game.host = heir.done ? 0 : heir.value
}

/** The name the game's next bot goes by, which is how many it has had. */
function nextBotName(game: GameRecord): string {
  const name = BOT_NAMES[game.nextBot % BOT_NAMES.length]!
  game.nextBot += 1
  return name
}

/** What a game's host may change, worked into what the game holds: what it is played for, a planet seed, and a race 2 to 4 worlds long. */
function cleanOptions(options: GameOptions): GameOptions {
  return {
    mode: options.mode === 'free' ? 'free' : 'race',
    seed: planetSeedOf(options.seed),
    weapons: options.weapons,
    bananas: options.bananas,
    raceLength: Math.min(Math.max(Math.round(options.raceLength), WORLDS_LEAST), WORLDS_MOST),
  }
}

/**
 * Change what the game is played for and by what rules: by the host alone,
 * and only while nothing is being driven — a race before it starts, a free
 * drive while nobody is out in it. Whether it happened.
 */
export function editGame(game: GameRecord, member: number, options: GameOptions): boolean {
  if (game.host !== member || !mayEditOptions(game)) return false
  game.options = cleanOptions(options)
  game.lastFault = null
  return true
}

/** Whether the host may change the game's options: a race before it starts, a free drive nobody is out in. */
function mayEditOptions(game: GameRecord): boolean {
  return game.options.mode === 'race' ? gameOpen(game) : !anyoneDriving(game)
}

/**
 * Whether the host may still change the game's slots: a race before it
 * starts, and a free drive at any time, since a slot is no rule of the
 * world already being driven in.
 */
function slotsEditable(game: GameRecord): boolean {
  return game.options.mode === 'free' || gameOpen(game)
}

/** Whether anyone in a free drive is out in the world: its rules may not change under them. */
function anyoneDriving(game: GameRecord): boolean {
  for (const member of game.members.values()) if (member.ready) return true
  return false
}

/** Add a bot's slot at the end of the game's, up to as many slots as there are, if the host may still change them. */
export function addSlot(game: GameRecord, member: number): boolean {
  if (game.host !== member || !slotsEditable(game) || game.slots.length >= SLOTS_MOST) return false
  addBotSlot(game)
  return true
}

/** Take a bot's slot out of the game: never a player's, nor the last slot there is. Whether it went. */
export function removeSlot(game: GameRecord, member: number, slot: number): boolean {
  if (game.host !== member || !slotsEditable(game) || game.slots.length <= 1) return false
  const found = game.slots[slot]
  if (found === undefined || found.kind !== 'bot') return false
  game.slots.splice(slot, 1)
  return true
}

/** Put a bot's slot in another car: not a player's, and only while the game may still be changed. Whether it went. */
export function setBotVehicle(game: GameRecord, member: number, slot: number, vehicle: VehicleProfileId): boolean {
  if (game.host !== member || !slotsEditable(game)) return false
  const found = game.slots[slot]
  if (found === undefined || found.kind !== 'bot') return false
  found.vehicle = vehicle
  return true
}

/** Ready to drive in this vehicle, or no longer ready. */
export function setReady(game: GameRecord, member: number, vehicle: VehicleProfileId, ready: boolean): void {
  const found = game.members.get(member)
  if (found === undefined) return
  found.vehicle = vehicle
  found.ready = ready
}

/** The race's course is to be built, and the room says so: its host's Start, or the server's own for its demo. Whether it is. */
export function prepareRace(game: GameRecord): boolean {
  if (game.options.mode !== 'race' || !gameOpen(game)) return false
  game.phase = { kind: 'preparing' }
  game.lastFault = null
  return true
}

/** A course that could not be built puts the game back to waiting, its host to be told why. */
export function failCourse(game: GameRecord, reason: string): void {
  if (game.phase.kind !== 'preparing') return
  game.phase = { kind: 'open' }
  game.lastFault = reason
}

/** The course is built and the racers are to take their places on the grid of its first world: a racer for every slot, bots included. */
export function beginRace(game: GameRecord, course: Course, at: number): void {
  if (game.phase.kind !== 'preparing') return
  game.course = course
  game.racers.clear()
  game.slots.forEach((slot, index) => {
    const grid = game.racers.size
    if (slot.kind === 'bot') {
      const racer: Racer = { key: slot.pass, slot: index, grid, name: slot.name, vehicle: slot.vehicle, bot: true, leg: 0, checkpoint: 0, finishedAt: 0, place: 0 }
      game.racers.set(slot.pass, racer)
      return
    }
    const member = game.members.get(slot.member)
    if (member === undefined) return
    game.racers.set(member.drivePass, {
      key: member.drivePass,
      slot: index,
      grid,
      name: member.name,
      vehicle: member.vehicle,
      bot: false,
      leg: 0,
      checkpoint: 0,
      finishedAt: 0,
      place: 0,
    })
  })
  game.phase = { kind: 'starting', seatedBy: at + SEATING_TICKS, startsAt: null }
  placeRacers(game, [])
}

/** Why the host cannot start the race now, or `null` if they can: someone not ready, nobody here, or a race already on. */
export function gameFault(game: GameRecord): string | null {
  if (game.options.mode !== 'race') return 'a free drive has no start'
  if (!gameOpen(game)) return 'the race has already started'
  if (game.members.size === 0) return 'nobody is in the game'
  for (const member of game.members.values()) if (!member.ready) return `${member.name} is not ready`
  return null
}

/** A game as the start screen lists it, with where the race's leader is to be followed in this world of it. */
export function gameSummary(game: GameRecord): GameSummary {
  let humans = 0
  for (const slot of game.slots) if (slot.kind === 'player') humans += 1
  return {
    id: game.id,
    seed: game.options.seed,
    mode: game.options.mode,
    status: gameStatus(game),
    host: game.members.get(game.host)?.name ?? '',
    humans,
    slots: game.slots.length,
    leader: leaderWorld(game),
    demo: game.demo,
  }
}

/**
 * The world a race is to be followed in: the leg its leading racer is on,
 * and the first leg's before anyone has a place. 0 when there is no race to
 * follow: a free drive, or a race that is over or not yet under way.
 */
export function leaderWorld(game: GameRecord): number {
  if (game.options.mode !== 'race' || !raceUnderWay(game)) return 0
  const course = game.course
  if (course === null) return 0
  let leading: Racer | null = null
  for (const racer of game.racers.values()) {
    if (leading === null || (racer.place > 0 && (leading.place === 0 || racer.place < leading.place))) leading = racer
  }
  const leg = leading === null ? course.legs[0] : course.legs[leading.leg]
  return leg?.world ?? 0
}

/** Whether a member of a game has gone into its world: a race under way, or a free drive's member who is ready. */
function drivingOf(game: GameRecord, member: GameMember): boolean {
  if (game.options.mode === 'race') return raceUnderWay(game) && game.racers.has(member.drivePass)
  return member.ready
}

/** A slot of a game as its room sees it. */
function slotView(game: GameRecord, slot: Slot, at: number): GameSlotView {
  if (slot.kind === 'bot') {
    // A race's bots are out in it from the start; a free drive's roam it as soon as a world of it is made.
    const driving = game.options.mode === 'race' ? raceUnderWay(game) : true
    return { slot: at, bot: true, member: 0, name: slot.name, vehicle: slot.vehicle, ready: true, driving }
  }
  const member = game.members.get(slot.member)
  if (member === undefined) return { slot: at, bot: true, member: 0, name: '', vehicle: DEFAULT_VEHICLE_PROFILE, ready: true, driving: false }
  return { slot: at, bot: false, member: member.id, name: member.name, vehicle: member.vehicle, ready: member.ready, driving: drivingOf(game, member) }
}

/** A game as its room sees it, for one member: the same for all of them but which member it is reading it. */
export function gameView(game: GameRecord, member: number): GameView {
  const slots: GameSlotView[] = []
  game.slots.forEach((slot, at) => slots.push(slotView(game, slot, at)))
  return {
    id: game.id,
    status: gameStatus(game),
    host: game.host,
    options: game.options,
    slots,
    you: member,
    drivePass: game.members.get(member)?.drivePass ?? 0,
    fault: game.lastFault,
  }
}

/** The member of a game that drives with a pass, if one does. */
export function memberOfPass(game: GameRecord, pass: number): GameMember | undefined {
  for (const member of game.members.values()) if (member.drivePass === pass) return member
  return undefined
}

/** The slot of a game that holds a bot driving with a pass, if one does. */
export function botOfPass(game: GameRecord, pass: number): Slot | undefined {
  for (const slot of game.slots) if (slot.kind === 'bot' && slot.pass === pass) return slot
  return undefined
}

/**
 * One step of a game's life: the countdown begins when every racer is on the
 * grid or its waiting time is up, driving begins when the countdown is, and
 * the game is deleted once its standings have stood long enough.
 * `everyoneSeated` is the server's word that each racer has a seat in the
 * first world.
 */
export function stepGame(game: GameRecord, clock: number, everyoneSeated = false): GameEffect {
  const phase = game.phase
  if (phase.kind === 'starting') {
    const begins = phase.startsAt ?? (everyoneSeated || clock >= phase.seatedBy ? clock + COUNTDOWN_TICKS : null)
    if (begins === null) return NO_EFFECT
    if (clock < begins) {
      if (begins !== phase.startsAt) {
        game.phase = { kind: 'starting', seatedBy: phase.seatedBy, startsAt: begins }
        return { ...NO_EFFECT, countdown: true }
      }
      return NO_EFFECT
    }
    game.phase = { kind: 'racing', startsAt: begins, overAt: null }
    return { countdown: begins !== phase.startsAt, started: true, finished: false, closed: false }
  }
  if (phase.kind === 'racing' && phase.overAt !== null) {
    game.phase = { kind: 'finished', startsAt: phase.startsAt, overAt: phase.overAt, closesAt: phase.overAt + STANDINGS_TICKS }
    game.standings = standingsOf(game)
    return { countdown: false, started: false, finished: true, closed: false }
  }
  if (phase.kind === 'finished' && clock >= phase.closesAt) return { countdown: false, started: false, finished: false, closed: true }
  return NO_EFFECT
}

/** The race is called over at this tick: nobody finishes after it, and its standings are posted a grace from then. */
export function callRaceOver(game: GameRecord, clock: number): void {
  const phase = game.phase
  if (phase.kind !== 'racing' || phase.overAt !== null) return
  game.phase = { kind: 'racing', startsAt: phase.startsAt, overAt: clock }
}

/**
 * Where every racer stands: those that have finished in the order they did,
 * then the rest by how far through the course they are, ties by the order
 * they joined. Places are 1 upward and always consecutive. `order` is the
 * caller's to hold, so that placing a race every tick makes nothing.
 */
export function placeRacers(game: GameRecord, order: Racer[]): void {
  order.length = 0
  for (const racer of game.racers.values()) order.push(racer)
  order.sort((a, b) => {
    const finished = a.finishedAt !== 0
    const alsoFinished = b.finishedAt !== 0
    if (finished !== alsoFinished) return finished ? -1 : 1
    if (finished && alsoFinished && a.finishedAt !== b.finishedAt) return a.finishedAt - b.finishedAt
    if (a.leg !== b.leg) return b.leg - a.leg
    if (a.checkpoint !== b.checkpoint) return b.checkpoint - a.checkpoint
    return a.grid - b.grid
  })
  for (let at = 0; at < order.length; at++) order[at]!.place = at + 1
}

/** How the race finished: every racer's place, and its time or a DNF. */
function standingsOf(game: GameRecord): Standing[] {
  const begins = startsAtOf(game)
  const rows: Standing[] = []
  for (const racer of game.racers.values()) {
    const seconds = racer.finishedAt === 0 || begins === NO_TICK ? 0 : Math.round((racer.finishedAt - begins) / TICKS_PER_SECOND)
    rows.push({ place: racer.place, name: racer.name, vehicle: racer.vehicle, seconds, dnf: racer.finishedAt === 0, bot: racer.bot })
  }
  return rows.sort((a, b) => a.place - b.place)
}
