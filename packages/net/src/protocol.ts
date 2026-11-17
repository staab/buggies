import { FIXED_TIMESTEP } from '@buggies/physics'

/** Bumped whenever a message changes shape. A mismatch is refused, not guessed at. */
export const PROTOCOL_VERSION = 46

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
/** On the wire, a seat that is not one: a spectator's, who watches the race from outside it. */
export const NO_SEAT = 0xff
/** In a hello's profile byte: nobody's car, since a spectator drives none. */
export const NO_PROFILE = 0xff

/** Into a world: a seat in it, by the pass of the member it belongs to. */
export const CLIENT_HELLO = 0x01
export const CLIENT_INPUT = 0x02
export const CLIENT_RESPAWN = 0x03
/** Into another vehicle, where the car is: the seat, its bananas and the island stay. */
export const CLIENT_CHANGE_VEHICLE = 0x05
/** Into the game with this id, in a vehicle. Sent on a lobby connection. */
export const CLIENT_JOIN_GAME = 0x08
/** The challenge the welcome gave, signed by the player's nostr key: who they are, for their achievements. */
export const CLIENT_AUTH = 0x09
/** Instead of a hello on a world connection: a lobby connection, browsing the games or asking after one. */
export const CLIENT_LOBBY = 0x0a
/** A game of the player's own: a race, and the vehicle they start in. */
export const CLIENT_CREATE_GAME = 0x0b
/** Out of the game the player is in. */
export const CLIENT_LEAVE_GAME = 0x0c
/** Ready to drive, in a vehicle, or no longer ready. */
export const CLIENT_GAME_READY = 0x0d
/** The world and the rules of the game, by its host alone. */
export const CLIENT_GAME_EDIT = 0x0e
/** Start the race the room waits for: by its host, once everyone is ready. */
export const CLIENT_GAME_START = 0x0f
/** One more slot in the game it hosts, filled by a bot until a player takes it. */
export const CLIENT_SLOT_ADD = 0x10
/** A bot slot taken away from the game it hosts. */
export const CLIENT_SLOT_REMOVE = 0x11
/** The vehicle of a bot slot of the game it hosts. */
export const CLIENT_SLOT_VEHICLE = 0x12

export const SERVER_WELCOME = 0x81
export const SERVER_REJECT = 0x82
export const SERVER_SNAPSHOT = 0x83
/** Who is on the island, by name: told again whenever that changes. */
export const SERVER_LOBBY = 0x86
/** The key a player has proved is theirs, and how many achievements it has already been paid. */
export const SERVER_SIGNED_IN = 0x87
/** The games on the server, to a lobby connection browsing them: told again whenever any changes. */
export const SERVER_GAMES = 0x88
/** One game as its room sees it, to each of its members: told again whenever anything in it changes. */
export const SERVER_GAME = 0x89
/** The leg of the course this world is, with its gates: sent right after the welcome in a race. */
export const SERVER_RACE_PLAN = 0x8a
/** How the race finished: sent to the room's lobby connections and to everyone in its rooms. */
export const SERVER_STANDINGS = 0x8b
/** The challenge a lobby connection answers, and the key the server already knows it by. */
export const SERVER_LOBBY_WELCOME = 0x8c

/** The most characters a player's name may have. */
export const NAME_MOST = 16

/** How many games the server lists at once. */
export const GAMES_LISTED = 100
/** How many slots one game may have: the host's, the players' and the bots'. */
export const SLOTS_MOST = 8
/** How many gates one leg of a course may have. */
export const CHECKPOINTS_LISTED = 8
/** How many of a world's portals one leg of a course may keep. */
export const KEEP_LISTED = 4

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
