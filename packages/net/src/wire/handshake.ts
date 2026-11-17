import type { VehicleProfileId } from '@buggies/game'
import { bytesToHex } from '@noble/hashes/utils'

import { CHALLENGE_BYTES, PUBKEY_HEX, type NostrEvent } from '../nostr.ts'
import { CLIENT_AUTH, CLIENT_HELLO, NO_ARRIVAL, NO_PASS, NO_PROFILE, PROTOCOL_VERSION, SERVER_REJECT, SERVER_SIGNED_IN, SERVER_WELCOME } from '../protocol.ts'
import { Reader, Writer, hexBytes, messageTypeOf, profileAt, profileCode } from './fields.ts'
import { cleanName, fromUtf8, nameBytes, utf8 } from './text.ts'

/** A hello, up to its name's length; the name follows, in UTF-8. */
export const HELLO_BYTES = 18
/** A welcome, up to the challenge it carries, and the key the player is already known by: both follow, in hex, as bytes. */
export const WELCOME_BYTES = 25 + CHALLENGE_BYTES + PUBKEY_HEX / 2
/** The most an answer to a challenge may run to, in bytes. */
export const AUTH_MOST = 4096
export const SIGNED_IN_BYTES = 2 + PUBKEY_HEX / 2
export const REJECT_BYTES = 2

/** Into a world: the vehicle to drive, which game and world, and the member whose seat it is. */
export interface HelloMessage {
  protocolVersion: number
  /** The vehicle to drive, or `null` for a spectator, who takes no seat and drives nothing. */
  profile: VehicleProfileId | null
  /** Which game: the only game whose worlds and racers this connection may join. */
  game: number
  /** Which world: the room to be seated in. */
  seed: number
  /** Which of its portals to come out of, having come through a portal to it, or `NO_ARRIVAL`. */
  arrival: number
  /** The pass the game gave the member this seat belongs to; or `NO_PASS`. */
  pass: number
  /** What the player goes by, as cleaned by `cleanName`; empty if they gave none. */
  name: string
}

/** What the server tells a connection it has seated: the world it is in, the seat it has, and what to prove to keep it its own. */
export interface WelcomeMessage {
  protocolVersion: number
  /** The game this world is one of. */
  game: number
  seed: number
  seat: number
  epoch: number
  tick: number
  maxPlayers: number
  profile: VehicleProfileId
  /** The pass this member drives with: its world connection's pass, the same at every portal and after a dropped connection. */
  pass: number
  /** Whether a `SERVER_RACE_PLAN` follows this welcome: a race's world, rather than a free drive's. */
  race: boolean
  /** The game's options, as `flagsOf` writes them: weapons and bananas. */
  flags: number
  /** What to sign, to prove which nostr key is the player's: hex. */
  challenge: string
  /** The key the player has already proved theirs, come through a portal or back after a dropped connection: hex, or empty. */
  signedIn: string
}

/** The key a player has proved theirs, and how many achievements it has been paid all told. */
export interface SignedInMessage {
  pubkey: string
  earned: number
}

/** Why the server turned a connection away. */
export interface RejectMessage {
  reason: number
}

/** Ask to be let into a world: in this vehicle, as this member, by this name. A spectator asks in none. */
export function encodeHello(profile: VehicleProfileId | null, game: number, seed: number, arrival = NO_ARRIVAL, pass = NO_PASS, name = ''): Uint8Array {
  const named = nameBytes(name)
  const writer = new Writer(HELLO_BYTES + named.length)
  writer.u8(CLIENT_HELLO)
  writer.u16(PROTOCOL_VERSION)
  writer.u8(profile === null ? NO_PROFILE : profileCode(profile))
  writer.u32(game >>> 0)
  writer.u32(seed)
  writer.u8(arrival)
  writer.u32(pass)
  writer.u8(named.length)
  writer.raw(named)
  return writer.bytes
}

/** What a hello asked for, or `null` if the message is not one. */
export function decodeHello(payload: Uint8Array): HelloMessage | null {
  if (payload.length < HELLO_BYTES || messageTypeOf(payload) !== CLIENT_HELLO) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  // A spectator says so with its profile byte, and drives none.
  const profileByte = reader.u8()
  const profile = profileByte === NO_PROFILE ? null : profileAt(profileByte)
  const game = reader.u32()
  const seed = reader.u32()
  const arrival = reader.u8()
  const pass = reader.u32()
  const length = reader.u8()
  if (profileByte !== NO_PROFILE && profile === null) return null
  if (payload.length !== HELLO_BYTES + length) return null
  const name = reader.text(length)
  return name === null ? null : { protocolVersion, profile, game, seed, arrival, pass, name: cleanName(name) }
}

/** Welcome a connection into a world: its seat, what is on it, and what to prove to keep it. */
export function encodeWelcome(message: WelcomeMessage): Uint8Array {
  const writer = new Writer(WELCOME_BYTES)
  writer.u8(SERVER_WELCOME)
  writer.u16(message.protocolVersion)
  writer.u32(message.game)
  writer.u32(message.seed)
  writer.u8(message.seat)
  writer.u8(message.epoch)
  writer.u32(message.tick)
  writer.u8(message.maxPlayers)
  writer.u8(profileCode(message.profile))
  writer.u32(message.pass)
  writer.u8(message.race ? 1 : 0)
  writer.u8(message.flags)
  writer.bytes.set(hexBytes(message.challenge, CHALLENGE_BYTES), WELCOME_BYTES - CHALLENGE_BYTES - PUBKEY_HEX / 2)
  writer.bytes.set(hexBytes(message.signedIn, PUBKEY_HEX / 2), WELCOME_BYTES - PUBKEY_HEX / 2)
  return writer.bytes
}

/** What a welcome said, or `null` if the message is not one. */
export function decodeWelcome(payload: Uint8Array): WelcomeMessage | null {
  if (payload.length !== WELCOME_BYTES || messageTypeOf(payload) !== SERVER_WELCOME) return null
  const reader = new Reader(payload)
  reader.u8()
  const protocolVersion = reader.u16()
  const game = reader.u32()
  const seed = reader.u32()
  const seat = reader.u8()
  const epoch = reader.u8()
  const tick = reader.u32()
  const maxPlayers = reader.u8()
  const profile = profileAt(reader.u8())
  const pass = reader.u32()
  const race = reader.u8()
  const flags = reader.u8()
  if (profile === null || race > 1 || (flags & ~3) !== 0) return null
  const challenge = bytesToHex(payload.subarray(WELCOME_BYTES - CHALLENGE_BYTES - PUBKEY_HEX / 2, WELCOME_BYTES - PUBKEY_HEX / 2))
  const signedIn = bytesToHex(payload.subarray(WELCOME_BYTES - PUBKEY_HEX / 2))
  return {
    protocolVersion,
    game,
    seed,
    seat,
    epoch,
    tick,
    maxPlayers,
    profile,
    pass,
    race: race === 1,
    flags,
    challenge,
    signedIn: /^0+$/.test(signedIn) ? '' : signedIn,
  }
}

/** A signed answer to the welcome's challenge. */
export function encodeAuth(event: NostrEvent): Uint8Array {
  const text = utf8(JSON.stringify(event))
  const bytes = new Uint8Array(1 + text.length)
  bytes[0] = CLIENT_AUTH
  bytes.set(text, 1)
  return bytes
}

/** The event an answer carries, unchecked; or `null` if it is not one. */
export function decodeAuth(payload: Uint8Array): unknown {
  if (messageTypeOf(payload) !== CLIENT_AUTH || payload.length > AUTH_MOST) return null
  const text = fromUtf8(payload.subarray(1))
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** The key a player has proved is theirs, and how many achievements it has been paid. */
export function encodeSignedIn(message: SignedInMessage): Uint8Array {
  const bytes = new Uint8Array(SIGNED_IN_BYTES)
  bytes[0] = SERVER_SIGNED_IN
  bytes.set(hexBytes(message.pubkey, PUBKEY_HEX / 2), 1)
  bytes[SIGNED_IN_BYTES - 1] = Math.min(message.earned, 0xff)
  return bytes
}

/** What a signed-in said, or `null` if the message is not one. */
export function decodeSignedIn(payload: Uint8Array): SignedInMessage | null {
  if (payload.length !== SIGNED_IN_BYTES || messageTypeOf(payload) !== SERVER_SIGNED_IN) return null
  return { pubkey: bytesToHex(payload.subarray(1, SIGNED_IN_BYTES - 1)), earned: payload[SIGNED_IN_BYTES - 1]! }
}

/** Turn a connection away, for one of the `REJECT_` reasons. */
export function encodeReject(message: RejectMessage): Uint8Array {
  const writer = new Writer(REJECT_BYTES)
  writer.u8(SERVER_REJECT)
  writer.u8(message.reason)
  return writer.bytes
}

/** Why a connection was turned away, or `null` if the message is not one. */
export function decodeReject(payload: Uint8Array): RejectMessage | null {
  if (payload.length !== REJECT_BYTES || messageTypeOf(payload) !== SERVER_REJECT) return null
  return { reason: payload[1]! }
}
