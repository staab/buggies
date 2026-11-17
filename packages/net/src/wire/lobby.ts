import { bytesToHex } from '@noble/hashes/utils'

import { CHALLENGE_BYTES, PUBKEY_HEX } from '../nostr.ts'
import { CLIENT_LOBBY, PROTOCOL_VERSION, SERVER_LOBBY, SERVER_LOBBY_WELCOME } from '../protocol.ts'
import { Reader, Writer, hexBytes, messageTypeOf } from './fields.ts'
import { cleanName, nameBytes } from './text.ts'

/** A lobby connection's hello: the game it asks to be in, if any, and its name's length and the name after it. */
export const LOBBY_HELLO_BYTES = 8
/** The challenge a lobby connection answers, and the key it is already known by, as hex. */
export const LOBBY_WELCOME_BYTES = 1 + CHALLENGE_BYTES + PUBKEY_HEX / 2
/** A lobby: how many players, each with a seat and a name. */
export const LOBBY_HEADER_BYTES = 2
/** A player in a lobby: their seat and their name's length, then the name. */
export const LOBBY_PLAYER_BYTES = 2

/** A lobby connection's hello: the game it asks to be in, 0 for browsing them, and the name it goes by. */
export interface LobbyHelloMessage {
  protocolVersion: number
  /** The game to join, or 0 to be told of them all. */
  game: number
  name: string
}

/** The challenge a lobby connection answers, and the key the server already knows it by. */
export interface LobbyWelcomeMessage {
  challenge: string
  signedIn: string
}

/** Somebody in a world, by the name they go by: a player's, or a bot's. */
export interface LobbyPlayer {
  seat: number
  name: string
}

/** Who is in the world, by seat and name: the bots seated there among them. */
export interface LobbyMessage {
  players: LobbyPlayer[]
}

/** A lobby connection's hello: the game it asks to be in, 0 for browsing them, and the name it goes by. */
export function encodeLobbyHello(game = 0, name = ''): Uint8Array {
  const named = nameBytes(name)
  const writer = new Writer(LOBBY_HELLO_BYTES + named.length)
  writer.u8(CLIENT_LOBBY)
  writer.u16(PROTOCOL_VERSION)
  writer.u32(game >>> 0)
  writer.u8(named.length)
  writer.raw(named)
  return writer.bytes
}

/** What a lobby hello asked for, or `null` if the message is not one. */
export function decodeLobbyHello(payload: Uint8Array): LobbyHelloMessage | null {
  if (payload.length < LOBBY_HELLO_BYTES || messageTypeOf(payload) !== CLIENT_LOBBY) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const game = reader.u32()
  const length = reader.u8()
  if (payload.length !== LOBBY_HELLO_BYTES + length) return null
  const name = reader.text(length)
  return name === null ? null : { protocolVersion, game, name: cleanName(name) }
}

/** The challenge a lobby connection answers, and the key it is already known by. */
export function encodeLobbyWelcome(message: LobbyWelcomeMessage): Uint8Array {
  const bytes = new Uint8Array(LOBBY_WELCOME_BYTES)
  bytes[0] = SERVER_LOBBY_WELCOME
  bytes.set(hexBytes(message.challenge, CHALLENGE_BYTES), 1)
  bytes.set(hexBytes(message.signedIn, PUBKEY_HEX / 2), LOBBY_WELCOME_BYTES - PUBKEY_HEX / 2)
  return bytes
}

/** What a lobby welcome said, or `null` if the message is not one. */
export function decodeLobbyWelcome(payload: Uint8Array): LobbyWelcomeMessage | null {
  if (payload.length !== LOBBY_WELCOME_BYTES || messageTypeOf(payload) !== SERVER_LOBBY_WELCOME) return null
  const challenge = bytesToHex(payload.subarray(1, 1 + CHALLENGE_BYTES))
  const signedIn = bytesToHex(payload.subarray(LOBBY_WELCOME_BYTES - PUBKEY_HEX / 2))
  return { challenge, signedIn: /^0+$/.test(signedIn) ? '' : signedIn }
}

/** Who is on the island, by name. */
export function encodeLobby(message: LobbyMessage): Uint8Array {
  const players = message.players.slice(0, 0xff).map((player) => ({ seat: player.seat, name: nameBytes(player.name) }))
  let length = LOBBY_HEADER_BYTES
  for (const player of players) length += LOBBY_PLAYER_BYTES + player.name.length
  const writer = new Writer(length)
  writer.u8(SERVER_LOBBY)
  writer.u8(players.length)
  for (const player of players) {
    writer.u8(player.seat)
    writer.u8(player.name.length)
    writer.raw(player.name)
  }
  return writer.bytes
}

/** Who a lobby said is in the world, or `null` if the message is not one. */
export function decodeLobby(payload: Uint8Array): LobbyMessage | null {
  if (payload.length < LOBBY_HEADER_BYTES || messageTypeOf(payload) !== SERVER_LOBBY) return null
  const reader = new Reader(payload)
  reader.u8()
  const playerCount = reader.u8()
  const players: LobbyPlayer[] = []
  for (let k = 0; k < playerCount; k++) {
    if (reader.left() < LOBBY_PLAYER_BYTES) return null
    const seat = reader.u8()
    const length = reader.u8()
    if (reader.left() < length) return null
    const name = reader.text(length)
    if (name === null) return null
    players.push({ seat, name })
  }
  return reader.left() === 0 ? { players } : null
}
