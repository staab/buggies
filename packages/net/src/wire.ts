/**
 * The wire: every message the server and a client send each other, each
 * with its type, its encoder and its decoder kept together in the module of
 * its family — the handshake, the lobby, the games list, a game's room, a
 * race's plan, a snapshot, the standings, and a driver's input — over the
 * flat runs of fields that `fields.ts` reads and writes.
 */

/** The bounds a message may not pass: kept equal by `course.ts` on the simulation's side. */
export { CHECKPOINTS_LISTED, GAMES_LISTED, KEEP_LISTED, SLOTS_MOST } from './protocol.ts'
/** The values that are not values, beside the message codes they are known by. */
export { NO_ARRIVAL, NO_PASS } from './protocol.ts'

export * from './wire/fields.ts'
export * from './wire/game-room.ts'
export * from './wire/games.ts'
export * from './wire/handshake.ts'
export * from './wire/inputs.ts'
export * from './wire/lobby.ts'
export * from './wire/race-plan.ts'
export * from './wire/snapshot.ts'
export * from './wire/standings.ts'
export * from './wire/text.ts'
