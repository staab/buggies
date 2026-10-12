/**
 * Who a player is, by their nostr key: the server asks each player to sign
 * a challenge of its own making, as a relay asks a client to (NIP-42), and
 * believes a key only once a fresh event naming that challenge is signed
 * by it. Events are made, hashed and signed as NIP-01 has them, so a
 * browser's nostr extension (NIP-07) signs them as readily as a key kept
 * here does.
 */

import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils'

/** The kind of event a client authenticates with. */
export const AUTH_KIND = 22242

/** How far, in seconds, a signed challenge may be from the server's own time and still be believed. */
export const AUTH_WINDOW_SECONDS = 600

/** How long a challenge is, in bytes, and a key, as hex. */
export const CHALLENGE_BYTES = 16
export const PUBKEY_HEX = 64

/** An event as it is signed. */
export interface UnsignedEvent {
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: string[][]
  readonly content: string
}

/** An event as it is sent: with its id, the hash of what it says, and the signature over that. */
export interface NostrEvent extends UnsignedEvent {
  readonly id: string
  readonly sig: string
}

/** A fresh challenge, as hex. */
export function newChallenge(): string {
  return bytesToHex(randomBytes(CHALLENGE_BYTES))
}

/** An event's id: the hash of everything it says, laid out as NIP-01 has it. */
export function eventId(event: UnsignedEvent): string {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  return bytesToHex(sha256(utf8ToBytes(serialized)))
}

/** The event that answers a challenge, for the key named to sign. */
export function authTemplate(challenge: string, pubkey: string, nowSeconds: number): UnsignedEvent {
  return { pubkey, created_at: Math.floor(nowSeconds), kind: AUTH_KIND, tags: [['challenge', challenge]], content: '' }
}

/** A new secret key, for a player with no nostr extension to sign with. */
export function newSecretKey(): Uint8Array {
  return schnorr.utils.randomPrivateKey()
}

/** The public key, as hex, of a secret key. */
export function publicKeyOf(secret: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(secret))
}

/** An event signed with a secret key. */
export function signEvent(template: UnsignedEvent, secret: Uint8Array): NostrEvent {
  const id = eventId(template)
  return { ...template, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), secret)) }
}

const HEX = /^[0-9a-f]+$/

/**
 * The key that answered a challenge, if this event is its true answer:
 * the right kind, naming the challenge, signed lately, its id the hash of
 * what it says and its signature that key's over it. Otherwise nothing.
 */
export function verifyAuth(event: unknown, challenge: string, nowSeconds: number): string | null {
  if (typeof event !== 'object' || event === null) return null
  const { id, pubkey, created_at, kind, tags, content, sig } = event as Record<string, unknown>
  if (typeof id !== 'string' || typeof pubkey !== 'string' || typeof sig !== 'string' || typeof content !== 'string') return null
  if (typeof created_at !== 'number' || !Number.isInteger(created_at) || kind !== AUTH_KIND) return null
  if (!Array.isArray(tags) || !tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))) return null
  if (pubkey.length !== PUBKEY_HEX || id.length !== 64 || sig.length !== 128 || ![pubkey, id, sig].every((hex) => HEX.test(hex))) return null
  if (Math.abs(created_at - nowSeconds) > AUTH_WINDOW_SECONDS) return null
  if (!(tags as string[][]).some((tag) => tag[0] === 'challenge' && tag[1] === challenge)) return null
  if (eventId({ pubkey, created_at, kind, tags: tags as string[][], content }) !== id) return null
  try {
    return schnorr.verify(hexToBytes(sig), hexToBytes(id), hexToBytes(pubkey)) ? pubkey : null
  } catch {
    return null
  }
}
