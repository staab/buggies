import type { ArenaRules } from '@buggies/game'

import { GAMES_LISTED, SERVER_GAMES } from '../protocol.ts'
import { Reader, Writer, messageTypeOf } from './fields.ts'
import { nameBytes } from './text.ts'

/** The games listed: how many, each with the length of its host's name and the name after it. */
export const GAMES_HEADER_BYTES = 2
export const GAME_SUMMARY_BYTES = 18

/** What a game is played for: a race through the course's worlds, or driving about freely. */
export type GameMode = 'race' | 'free'

/** Where a game is in its life. Only an open game is joinable; a free drive is always open. */
export type GameStatus = 'open' | 'preparing' | 'starting' | 'racing' | 'finished'

/** What the host of a game has chosen: what it is played for, its seed, its rules, and how many worlds a race runs. */
export interface GameOptions {
  mode: GameMode
  seed: number
  weapons: boolean
  bananas: boolean
  /** How many worlds a race runs: `WORLDS_LEAST` to `WORLDS_MOST`. */
  raceLength: number
}

/**
 * What a game's host has switched on: the arena's rules, as the welcome's
 * flags say them and the mirror's arena is made with.
 */
export type GameRules = ArenaRules

/** A game as the start screen lists it. */
export interface GameSummary {
  id: number
  seed: number
  mode: GameMode
  status: GameStatus
  /** The host's name; empty for the server's own demo, which nobody hosts. */
  host: string
  /** How many people are in it, and how many slots it has for them. */
  humans: number
  slots: number
  /** The world the race's leader is in, so a watcher knows where to follow it, or 0 when there is none. */
  leader: number
  /** The server's own race, which the start screen watches in the background rather than listing. */
  demo: boolean
}

/** What a game is played for, by the byte that says so. */
const MODE_CODES: readonly GameMode[] = ['race', 'free']
/** Where a game is in its life, by the byte that says so. */
const STATUS_CODES: readonly GameStatus[] = ['open', 'preparing', 'starting', 'racing', 'finished']

/** What a game's mode is, as the byte that says so. */
export function modeCode(mode: GameMode): number {
  return Math.max(MODE_CODES.indexOf(mode), 0)
}

/** The mode a byte says, or `null` if it is none of them. */
export function modeOf(code: number): GameMode | null {
  return MODE_CODES[code] ?? null
}

/** Where a game is in its life, as the byte that says so. */
export function statusCode(status: GameStatus): number {
  return Math.max(STATUS_CODES.indexOf(status), 0)
}

/** The status a byte says, or `null` if it is none of them. */
export function statusOf(code: number): GameStatus | null {
  return STATUS_CODES[code] ?? null
}

/** The rules a welcome's flags say: weapons in the lowest bit, bananas over it. */
export function rulesOf(flags: number): GameRules {
  return { weapons: (flags & 1) === 1, bananas: (flags & 2) === 2 }
}

/** The flags that say a game's rules, for a welcome. */
export function flagsOf(options: GameOptions): number {
  return (options.weapons ? 1 : 0) | (options.bananas ? 2 : 0)
}

/** The games the server has, as the start screen lists them. */
export function encodeGames(games: readonly GameSummary[]): Uint8Array {
  const listed = games.slice(0, Math.min(GAMES_LISTED, 0xff)).map((game) => ({ game, host: nameBytes(game.host) }))
  let length = GAMES_HEADER_BYTES
  for (const { host } of listed) length += GAME_SUMMARY_BYTES + host.length
  const writer = new Writer(length)
  writer.u8(SERVER_GAMES)
  writer.u8(listed.length)
  for (const { game, host } of listed) {
    writer.u32(game.id >>> 0)
    writer.u32(game.seed >>> 0)
    writer.u8(modeCode(game.mode))
    writer.u8(statusCode(game.status))
    writer.u8(Math.min(Math.max(game.humans, 0), 0xff))
    writer.u8(Math.min(Math.max(game.slots, 0), 0xff))
    writer.u32(game.leader >>> 0)
    writer.u8(game.demo ? 1 : 0)
    writer.u8(host.length)
    writer.raw(host)
  }
  return writer.bytes
}

/** The games a lobby connection was told of, or `null` if the message is not one. */
export function decodeGames(payload: Uint8Array): GameSummary[] | null {
  if (payload.length < GAMES_HEADER_BYTES || messageTypeOf(payload) !== SERVER_GAMES) return null
  const reader = new Reader(payload)
  reader.u8()
  const count = reader.u8()
  if (count > GAMES_LISTED) return null
  const games: GameSummary[] = []
  for (let k = 0; k < count; k++) {
    if (reader.left() < GAME_SUMMARY_BYTES) return null
    const id = reader.u32()
    const seed = reader.u32()
    const mode = modeOf(reader.u8())
    const status = statusOf(reader.u8())
    const humans = reader.u8()
    const slots = reader.u8()
    const leader = reader.u32()
    const demo = reader.u8()
    const length = reader.u8()
    if (reader.left() < length) return null
    const host = reader.text(length)
    if (mode === null || status === null || demo > 1 || host === null) return null
    games.push({ id, seed, mode, status, host, humans, slots, leader, demo: demo === 1 })
  }
  return reader.left() === 0 ? games : null
}
