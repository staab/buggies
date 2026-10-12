import { newSecretKey } from '@buggies/net'

/** Where the player's nostr key is kept between visits. */
const KEY_STORE = 'buggies.key'

let known: Uint8Array | null = null

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesOf(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null
  return Uint8Array.from({ length: 32 }, (_, k) => parseInt(hex.slice(k * 2, k * 2 + 2), 16))
}

/**
 * The player's nostr key, secret: made on their first visit and kept in
 * the browser for every visit after. It is used for one thing only, to
 * prove to the server which seat is theirs, so that what they have won,
 * their achievements and gems, is kept for them. Where the browser keeps
 * nothing, it is made afresh for this visit alone.
 */
export function playerKey(): Uint8Array {
  if (known !== null) return known
  let stored: string | null = null
  try {
    stored = localStorage.getItem(KEY_STORE)
  } catch {
    // Kept nowhere: this visit's own.
  }
  known = (stored === null ? null : bytesOf(stored)) ?? newSecretKey()
  if (stored === null || bytesOf(stored) === null) {
    try {
      localStorage.setItem(KEY_STORE, hexOf(known))
    } catch {
      // Kept nowhere: this visit's own.
    }
  }
  return known
}
