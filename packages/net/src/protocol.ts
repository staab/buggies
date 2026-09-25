import { FIXED_TIMESTEP } from '@buggies/physics'

/** Bumped whenever a message changes shape. A mismatch is refused, not guessed at. */
export const PROTOCOL_VERSION = 19

export const TICKS_PER_SECOND = Math.round(1 / FIXED_TIMESTEP)
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

/** How often the server tells everyone where everything is. */
export const SNAPSHOTS_PER_SECOND = 20
export const TICKS_PER_SNAPSHOT = Math.round(TICKS_PER_SECOND / SNAPSHOTS_PER_SECOND)

/**
 * How far ahead of the server a client may send inputs for, and how far
 * behind its own prediction it can be asked to replay. Just over a second.
 */
export const INPUT_TIMELINE_TICKS = 64

/** On the wire, a tick that is not one. */
export const NO_TICK = 0xffffffff
export const UNACKNOWLEDGED_INPUT_TICK = -1

export const CLIENT_HELLO = 0x01
export const CLIENT_INPUT = 0x02
export const CLIENT_RESPAWN = 0x03
/** Instead of a hello: which islands have people on them. The answer ends the connection. */
export const CLIENT_ROOMS = 0x04

export const SERVER_WELCOME = 0x81
export const SERVER_REJECT = 0x82
export const SERVER_SNAPSHOT = 0x83
export const SERVER_ROOMS = 0x84

/** How many islands the server tells of: every one with anyone on it, up to what the wire counts in a byte. */
export const ROOMS_LISTED = 255

export const REJECT_PROTOCOL_MISMATCH = 1
export const REJECT_SERVER_FULL = 2
export const REJECT_MALFORMED_MESSAGE = 3
export const REJECT_HANDSHAKE_ORDER = 4
export const REJECT_IDLE = 5

const REJECT_LABELS: Readonly<Record<number, string>> = {
  [REJECT_PROTOCOL_MISMATCH]: 'protocol version mismatch',
  [REJECT_SERVER_FULL]: 'server is full',
  [REJECT_MALFORMED_MESSAGE]: 'malformed message',
  [REJECT_HANDSHAKE_ORDER]: 'expected hello before any other message',
  [REJECT_IDLE]: 'nothing heard for a while',
}

export function rejectLabel(reason: number): string {
  return REJECT_LABELS[reason] ?? `unknown reject reason ${reason}`
}
