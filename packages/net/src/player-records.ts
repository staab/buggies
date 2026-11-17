/**
 * What the server keeps of a player, and how it comes to: the nostr key they
 * prove theirs, the feats it is paid once ever, and the bananas a free drive
 * leaves in their wallet for the next. None of it is a room's: a key is the
 * same player at every portal, in every tab and on every world.
 */

import type { Achievement, Seat } from '@buggies/game'

import { memberOfPass } from './game-registry.ts'
import { verifyAuth } from './nostr.ts'
import type { Room } from './rooms.ts'
import { memberOf, playerIn, playerOfPass, seatsWith, type LobbyConnection, type Player, type ServerState } from './server-state.ts'
import { pushGame } from './telling.ts'
import { NO_PASS, encodeSignedIn } from './wire.ts'

/**
 * A player proving which nostr key is theirs, on their world connection:
 * an event signed by it naming the challenge they were welcomed with.
 * Believed, the key is theirs for their achievements, each of which it is
 * paid once, ever; and in a free drive it starts them off with the
 * bananas it held when they last left one.
 */
export function signInPlayer(state: ServerState, player: Player, event: unknown): void {
  const pubkey = verifyAuth(event, player.identity.challenge, Date.now() / 1000)
  // Not believed, or signed by some other key than the one the seat already plays under: nothing changes.
  if (pubkey === null || (player.identity.pubkey !== null && player.identity.pubkey !== pubkey)) return
  player.connection.send(encodeSignedIn({ pubkey, earned: state.store.earned(pubkey).size }))
  if (player.identity.pubkey !== null) return
  welcomeKey(state, player, pubkey)
  const game = state.games.get(player.room.game)
  const member = game === undefined || player.pass === NO_PASS ? undefined : memberOfPass(game, player.pass)
  if (member !== undefined) member.pubkey = pubkey
}

/** A player proving which nostr key is theirs on their lobby connection: who the seat it drives, if it has one, is. */
export function signInLobby(state: ServerState, lobby: LobbyConnection, event: unknown): void {
  const pubkey = verifyAuth(event, lobby.identity.challenge, Date.now() / 1000)
  if (pubkey === null || lobby.identity.pubkey === pubkey) return
  lobby.identity.pubkey = pubkey
  const game = state.games.get(lobby.game)
  const member = game === undefined ? undefined : memberOf(state, lobby)
  if (member !== undefined) member.pubkey = pubkey
  if (game !== undefined && member !== undefined) pushGame(game)
  const player = game === undefined ? undefined : playerOfPass(state, game.id, member?.drivePass ?? NO_PASS)
  if (player !== undefined) welcomeKey(state, player, pubkey)
  lobby.connection.send(encodeSignedIn({ pubkey, earned: state.store.earned(pubkey).size }))
  state.events.onSignedIn?.(player?.seat ?? null, pubkey)
}

/**
 * The key is proved: mark off every feat it has been paid and, unless the
 * car came into this room holding what it took from the last, start it
 * with whatever bananas its free-drive balance holds.
 */
export function welcomeKey(state: ServerState, player: Player, pubkey: string, withBalance = true): void {
  player.identity.pubkey = pubkey
  giveKept(state, player.seat, pubkey)
  if (withBalance && keepsBananas(state, player)) player.seat.score += state.store.bananas(pubkey)
}

/** Give a seat every feat its key has been paid, marked off, for none to be paid again. */
function giveKept(state: ServerState, seat: Seat, pubkey: string): void {
  for (const id of state.store.earned(pubkey)) if (id < seat.progress.earned.length) seat.progress.earned[id] = 1
}

/**
 * Whether this seat's bananas are the player's own, kept between sessions:
 * only a free drive has a wallet, and only with bananas on. A race's
 * bananas are the race's, and are thrown away with it.
 */
export function keepsBananas(state: ServerState, player: Player): boolean {
  if (player.room.mode !== 'free') return false
  return state.games.get(player.room.game)?.options.bananas ?? true
}

/** The bananas a player holds, kept against their key, if they have proved one, for their next free drive. */
export function keepBananas(state: ServerState, player: Player): void {
  const pubkey = player.identity.pubkey
  if (pubkey !== null && keepsBananas(state, player)) state.store.keepBananas(pubkey, player.seat.score)
}

/** Whether a seat may be paid for a feat: only one whose player has proved their key, and only if that key never has been. */
export function unpaid(state: ServerState, room: Room, seat: Seat, id: number): boolean {
  const pubkey = playerIn(room, seat)?.identity.pubkey ?? null
  return pubkey !== null && !state.store.earned(pubkey).has(id)
}

/** A feat paid: never again to the key, here or on any world it is playing on at once. */
export function paid(state: ServerState, room: Room, seat: Seat, achievement: Achievement): void {
  const pubkey = playerIn(room, seat)?.identity.pubkey ?? null
  if (pubkey !== null) {
    state.store.record(pubkey, achievement.id)
    for (const each of seatsWith(state, pubkey)) each.progress.earned[achievement.id] = 1
  }
  state.events.onAchieved?.(seat, achievement)
}

/** A pass nobody holds or has left behind: random, so nobody takes another's by guessing. */
export function newPass(state: ServerState): number {
  for (;;) {
    const pass = Math.floor(Math.random() * 0x1_0000_0000)
    if (pass === NO_PASS || state.left.has(pass)) continue
    let taken = false
    for (const player of state.players.values()) taken ||= player.pass === pass
    for (const game of state.games.values()) taken ||= memberOfPass(game, pass) !== undefined
    if (!taken) return pass
  }
}
