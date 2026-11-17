import type { VehicleProfileId } from '@buggies/game'

import {
  CLIENT_CREATE_GAME,
  CLIENT_GAME_EDIT,
  CLIENT_GAME_READY,
  CLIENT_GAME_START,
  CLIENT_JOIN_GAME,
  CLIENT_LEAVE_GAME,
  CLIENT_SLOT_ADD,
  CLIENT_SLOT_REMOVE,
  CLIENT_SLOT_VEHICLE,
  SERVER_GAME,
  SLOTS_MOST,
} from '../protocol.ts'
import { Reader, Writer, atMost, messageTypeOf, profileAt, profileCode } from './fields.ts'
import { flagsOf, modeCode, modeOf, rulesOf, statusCode, statusOf, type GameOptions, type GameStatus } from './games.ts'
import { nameBytes, utf8 } from './text.ts'

/** A game to make: a race, and the vehicle its host starts in. */
export const CREATE_GAME_BYTES = 2
export const LEAVE_GAME_BYTES = 1
/** Ready to drive: in which vehicle, and whether ready or not. */
export const GAME_READY_BYTES = 3
/** A game's world and rules: what it is played for, its seed, weapon and banana flags, and how many worlds a race runs. */
export const GAME_EDIT_BYTES = 8
export const GAME_START_BYTES = 1
/** One more bot slot, and one taken away: the slot's index. */
export const SLOT_ADD_BYTES = 1
export const SLOT_REMOVE_BYTES = 2
/** A bot slot's vehicle: which slot, and which vehicle. */
export const SLOT_VEHICLE_BYTES = 3
/** Into a game: its id and the vehicle to drive in. */
export const JOIN_GAME_BYTES = 6
/** A game's room, up to the length of its fault: the fault follows, then the slots. */
export const GAME_VIEW_BYTES = 26
/** A slot of a game's room, up to the length of its name: the name follows. */
export const GAME_SLOT_BYTES = 10

/** One slot of a game's room: a player's, or a bot's until a player takes it. */
export interface GameSlotView {
  /** Its index among the game's slots. */
  slot: number
  bot: boolean
  /** The member in it, or 0 for a bot. */
  member: number
  name: string
  vehicle: VehicleProfileId
  /** A bot is always ready. */
  ready: boolean
  /** Gone into the world: a race has started, or a free drive's member is driving. */
  driving: boolean
}

/** A game as its room sees it, for one member. */
export interface GameView {
  id: number
  status: GameStatus
  /** The member who alone may change the options, the slots or start the race. */
  host: number
  options: GameOptions
  /** Every slot, in order: the players among them and the bots. */
  slots: readonly GameSlotView[]
  /** The reading client's member id, 0 if it is only browsing. */
  you: number
  /** The pass this member drives with: its world connection's pass. */
  drivePass: number
  /** Why the host's last Start failed (a course that could not be built), or null. */
  fault: string | null
}

/** A game to make: a race, and the vehicle its host starts in. */
export function encodeCreateGame(vehicle: VehicleProfileId): Uint8Array {
  return Uint8Array.of(CLIENT_CREATE_GAME, profileCode(vehicle))
}

/** The vehicle a create asks for, or null if it is not one. */
export function decodeCreateGame(payload: Uint8Array): VehicleProfileId | null {
  if (payload.length !== CREATE_GAME_BYTES || messageTypeOf(payload) !== CLIENT_CREATE_GAME) return null
  return profileAt(payload[1]!)
}

/** Out of the game, back to browsing them. */
export function encodeLeaveGame(): Uint8Array {
  return Uint8Array.of(CLIENT_LEAVE_GAME)
}

/** Whether this is a game left. */
export function isLeaveGame(payload: Uint8Array): boolean {
  return payload.length === LEAVE_GAME_BYTES && messageTypeOf(payload) === CLIENT_LEAVE_GAME
}

/** Ready to drive in this vehicle, or no longer ready. */
export function encodeGameReady(vehicle: VehicleProfileId, ready: boolean): Uint8Array {
  return Uint8Array.of(CLIENT_GAME_READY, profileCode(vehicle), ready ? 1 : 0)
}

/** What a ready asks for, or null if it is not one. */
export function decodeGameReady(payload: Uint8Array): { vehicle: VehicleProfileId; ready: boolean } | null {
  if (payload.length !== GAME_READY_BYTES || messageTypeOf(payload) !== CLIENT_GAME_READY) return null
  const vehicle = profileAt(payload[1]!)
  const ready = payload[2]!
  if (vehicle === null || ready > 1) return null
  return { vehicle, ready: ready === 1 }
}

/** One more bot slot to fill, up to `SLOTS_MOST`: by the game's host alone. */
export function encodeSlotAdd(): Uint8Array {
  return Uint8Array.of(CLIENT_SLOT_ADD)
}

/** Whether this is a slot asked for, and a bot's until a player takes it. */
export function isSlotAdd(payload: Uint8Array): boolean {
  return payload.length === SLOT_ADD_BYTES && messageTypeOf(payload) === CLIENT_SLOT_ADD
}

/** A bot slot taken away, by its index: by the game's host alone. */
export function encodeSlotRemove(slot: number): Uint8Array {
  return Uint8Array.of(CLIENT_SLOT_REMOVE, atMost(slot, 0xff))
}

/** The slot a remove asks for, or null if it is not one. */
export function decodeSlotRemove(payload: Uint8Array): number | null {
  if (payload.length !== SLOT_REMOVE_BYTES || messageTypeOf(payload) !== CLIENT_SLOT_REMOVE) return null
  const slot = payload[1]!
  return slot < SLOTS_MOST ? slot : null
}

/** The vehicle a bot slot is to be driven in, by the slot's index: by the game's host alone. */
export function encodeSlotVehicle(slot: number, vehicle: VehicleProfileId): Uint8Array {
  return Uint8Array.of(CLIENT_SLOT_VEHICLE, atMost(slot, 0xff), profileCode(vehicle))
}

/** The slot a vehicle asks for and the vehicle itself, or null if it is not one. */
export function decodeSlotVehicle(payload: Uint8Array): { slot: number; vehicle: VehicleProfileId } | null {
  if (payload.length !== SLOT_VEHICLE_BYTES || messageTypeOf(payload) !== CLIENT_SLOT_VEHICLE) return null
  const slot = payload[1]!
  const vehicle = profileAt(payload[2]!)
  if (slot >= SLOTS_MOST || vehicle === null) return null
  return { slot, vehicle }
}

/** The world and the rules of a game, as its host changes them. */
export function encodeGameEdit(options: GameOptions): Uint8Array {
  const writer = new Writer(GAME_EDIT_BYTES)
  writer.u8(CLIENT_GAME_EDIT)
  writer.u8(modeCode(options.mode))
  writer.u32(options.seed >>> 0)
  writer.u8(flagsOf(options))
  writer.u8(atMost(options.raceLength, 0xff))
  return writer.bytes
}

/** The options an edit asks for, or null if it is not one. */
export function decodeGameEdit(payload: Uint8Array): GameOptions | null {
  if (payload.length !== GAME_EDIT_BYTES || messageTypeOf(payload) !== CLIENT_GAME_EDIT) return null
  const reader = new Reader(payload)
  reader.u8()
  const mode = modeOf(reader.u8())
  const seed = reader.u32()
  const flags = reader.u8()
  const raceLength = reader.u8()
  if (mode === null || (flags & ~3) !== 0) return null
  return { mode, seed, ...rulesOf(flags), raceLength }
}

/** Start the race the room waits for: by its host, once everyone is ready. */
export function encodeGameStart(): Uint8Array {
  return Uint8Array.of(CLIENT_GAME_START)
}

/** Whether this is a race asked to start. */
export function isGameStart(payload: Uint8Array): boolean {
  return payload.length === GAME_START_BYTES && messageTypeOf(payload) === CLIENT_GAME_START
}

/** Into the game with this id, in this vehicle. */
export function encodeJoinGame(game: number, vehicle: VehicleProfileId): Uint8Array {
  const writer = new Writer(JOIN_GAME_BYTES)
  writer.u8(CLIENT_JOIN_GAME)
  writer.u32(game >>> 0)
  writer.u8(profileCode(vehicle))
  return writer.bytes
}

/** The game a join asks for and the vehicle to drive in it, or null if it is not a join. */
export function decodeJoinGame(payload: Uint8Array): { game: number; vehicle: VehicleProfileId } | null {
  if (payload.length !== JOIN_GAME_BYTES || messageTypeOf(payload) !== CLIENT_JOIN_GAME) return null
  const vehicle = profileAt(payload[5]!)
  if (vehicle === null) return null
  const reader = new Reader(payload)
  reader.u8()
  return { game: reader.u32(), vehicle }
}

/** One game's room, as one of its members sees it. */
export function encodeGame(view: GameView, you: number, drivePass: number): Uint8Array {
  // A fault is a line a host reads, not a document: what fits its length byte.
  const fault = utf8(view.fault ?? '').subarray(0, 0xff)
  const slots = view.slots.slice(0, SLOTS_MOST).map((slot) => ({ slot, name: nameBytes(slot.name) }))
  let length = GAME_VIEW_BYTES + fault.length + 1
  for (const { name } of slots) length += GAME_SLOT_BYTES + name.length
  const writer = new Writer(length)
  writer.u8(SERVER_GAME)
  writer.u32(view.id >>> 0)
  writer.u8(statusCode(view.status))
  writer.u32(view.host >>> 0)
  writer.u8(modeCode(view.options.mode))
  writer.u32(view.options.seed >>> 0)
  writer.u8(flagsOf(view.options))
  writer.u8(atMost(view.options.raceLength, 0xff))
  writer.u32(you >>> 0)
  writer.u32(drivePass >>> 0)
  writer.u8(fault.length)
  writer.raw(fault)
  writer.u8(slots.length)
  for (const { slot, name } of slots) {
    writer.u8(slot.slot)
    writer.u8(slot.bot ? 1 : 0)
    writer.u32(slot.member >>> 0)
    writer.u8(name.length)
    writer.raw(name)
    writer.u8(profileCode(slot.vehicle))
    writer.u8(slot.ready ? 1 : 0)
    writer.u8(slot.driving ? 1 : 0)
  }
  return writer.bytes
}

/** What a game's room says, or `null` if the message is not one. */
export function decodeGame(payload: Uint8Array): GameView | null {
  if (payload.length < GAME_VIEW_BYTES + 1 || messageTypeOf(payload) !== SERVER_GAME) return null
  const reader = new Reader(payload)
  reader.u8()
  const id = reader.u32()
  const status = statusOf(reader.u8())
  const host = reader.u32()
  const mode = modeOf(reader.u8())
  const seed = reader.u32()
  const flags = reader.u8()
  const raceLength = reader.u8()
  const you = reader.u32()
  const drivePass = reader.u32()
  const faultLength = reader.u8()
  if (status === null || mode === null || (flags & ~3) !== 0 || reader.left() < faultLength) return null
  const fault = reader.text(faultLength)
  if (fault === null || reader.left() < 1) return null
  const count = reader.u8()
  if (count > SLOTS_MOST) return null
  const slots: GameSlotView[] = []
  for (let k = 0; k < count; k++) {
    if (reader.left() < GAME_SLOT_BYTES) return null
    const slot = reader.u8()
    const bot = reader.u8()
    const member = reader.u32()
    const length = reader.u8()
    // The name, then its vehicle, its readiness and whether it is driving.
    if (reader.left() < length + 1 + 1 + 1) return null
    const name = reader.text(length)
    const vehicle = profileAt(reader.u8())
    const ready = reader.u8()
    const driving = reader.u8()
    if (slot >= SLOTS_MOST || bot > 1 || name === null || vehicle === null || ready > 1 || driving > 1) return null
    slots.push({ slot, bot: bot === 1, member, name, vehicle, ready: ready === 1, driving: driving === 1 })
  }
  if (reader.left() !== 0) return null
  const options: GameOptions = { mode, seed, ...rulesOf(flags), raceLength }
  return { id, status, host, options, slots, you, drivePass, fault: fault === '' ? null : fault }
}
