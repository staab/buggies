/**
 * The server's own race, which nobody hosts: a short one of bots that plays
 * while anyone is on the start screen with no game of their own, and is let
 * go once nobody is. It is listed like any race, marked as the demo, so
 * that a page may watch it in the background without being told to.
 */

import { callRaceOver, createDemoGame } from './game-registry.ts'
import { beginRaceOf, closeGame } from './game-lobby.ts'
import { TICKS_PER_SECOND } from './protocol.ts'
import type { ServerState } from './server-state.ts'

/** How long the server's own demo race is given to get home before it is called over all the same, in ticks. */
const DEMO_TICKS = TICKS_PER_SECOND * 60 * 4

/**
 * The demo race: one is kept going while anyone is on the start screen
 * with no game of their own, and let go once nobody is. It is a race of
 * four bots, two worlds long, on a seed of its own, which nobody hosts.
 */
export function tendDemo(state: ServerState): void {
  if (!state.demoOn) return
  let browsing = false
  for (const lobby of state.lobbies.values()) browsing ||= lobby.game === 0
  const demo = state.games.get(state.demo)
  if (!browsing) {
    if (demo !== undefined) closeGame(state, demo)
    return
  }
  // A demo is given so long to get home, and called over all the same: it never waits on a person.
  if (demo !== undefined && demo.phase.kind === 'racing' && demo.phase.overAt === null && state.clock - demo.phase.startsAt > DEMO_TICKS) {
    callRaceOver(demo, state.clock)
  }
  // The standings of a demo are seen out before the next one takes its place.
  for (const game of state.games.values()) if (game.demo && game.phase.kind === 'finished') return
  if (demo === undefined) openDemo(state)
}

/** Start the demo race: a new seed's course, made off the tick as a host's is, and no room of it made until its bots take their places. */
function openDemo(state: ServerState): void {
  const game = createDemoGame(state.nextGameId, state.demoSeed())
  state.nextGameId += 1
  state.games.set(game.id, game)
  state.demo = game.id
  state.events.onGameOpened?.(game)
  beginRaceOf(state, game)
}
