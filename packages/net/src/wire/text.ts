import { NAME_MOST } from '../protocol.ts'

/** A name as it may be gone by: printable, its spaces single, trimmed, and no longer than `NAME_MOST` characters. */
export function cleanName(raw: string): string {
  const printable = raw.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim()
  return [...printable].slice(0, NAME_MOST).join('').trim()
}

/** Text as UTF-8, by way of the escapes a URI makes of it: this package runs where there may be no `TextEncoder`. */
export function utf8(text: string): Uint8Array {
  const escaped = encodeURIComponent(text)
  const bytes: number[] = []
  for (let k = 0; k < escaped.length; k++) {
    if (escaped[k] === '%') {
      bytes.push(parseInt(escaped.slice(k + 1, k + 3), 16))
      k += 2
    } else bytes.push(escaped.charCodeAt(k))
  }
  return Uint8Array.from(bytes)
}

/** UTF-8 as text, or `null` if it is not UTF-8. */
export function fromUtf8(bytes: Uint8Array): string | null {
  try {
    return decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''))
  } catch {
    return null
  }
}

/** A name cleaned and in UTF-8, as it goes on the wire. */
export function nameBytes(name: string): Uint8Array {
  return utf8(cleanName(name))
}
