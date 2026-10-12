import { newSecretKey, secretKeyFromHex, secretKeyHex } from '@buggies/net'

/** Where the player's nostr key is kept between visits. */
const KEY_STORE = 'buggies.key'

let known: Uint8Array | null = null

/**
 * The player's nostr key, secret: made on their first visit and kept in
 * the browser for every visit after. It is used for one thing only, to
 * prove to the server which seat is theirs, so that what they have won,
 * their achievements and gems, is kept for them. Where the browser keeps
 * nothing, it is made afresh for this visit alone.
 */
export function playerKey(): Uint8Array {
  if (known !== null) return known
  let stored: Uint8Array | null = null
  try {
    stored = secretKeyFromHex(localStorage.getItem(KEY_STORE) ?? '')
  } catch {
    // Kept nowhere: this visit's own.
  }
  known = stored ?? newSecretKey()
  if (stored === null) {
    try {
      localStorage.setItem(KEY_STORE, secretKeyHex(known))
    } catch {
      // Kept nowhere: this visit's own.
    }
  }
  return known
}
