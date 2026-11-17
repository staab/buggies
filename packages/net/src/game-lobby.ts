/**
 * The server's side of the lobby: the games on it, who makes one, who joins
 * one, what its host may change of it, and when its race is started. A
 * connection here is a member of a game and no seat in a world; the world
 * connection it opens beside it drives the pass the member was given.
 */

import { DEFAULT_VEHICLE_PROFILE, PLAYABLE_PROFILE_IDS, buildCourse, setRules, type VehicleProfileId } from '@buggies/game'

import {
  addMember,
  addSlot,
  beginRace,
  createGame,
  editGame,
  failCourse,
  gameView,
  gameFault,
  joinable,
  prepareRace,
  removeMember,
  removeSlot,
  setBotVehicle,
  setReady,
  type GameRecord,
} from './game-registry.ts'
import { newChallenge } from './nostr.ts'
import { newPass, signInLobby } from './player-records.ts'
import {
  CLIENT_AUTH,
  CLIENT_CREATE_GAME,
  CLIENT_GAME_EDIT,
  CLIENT_GAME_READY,
  CLIENT_GAME_START,
  CLIENT_JOIN_GAME,
  CLIENT_LEAVE_GAME,
  CLIENT_SLOT_ADD,
  CLIENT_SLOT_REMOVE,
  CLIENT_SLOT_VEHICLE,
  PROTOCOL_VERSION,
  REJECT_MALFORMED_MESSAGE,
  REJECT_PROTOCOL_MISMATCH,
} from './protocol.ts'
import { closeRoom, leaveRoom } from './rooms.ts'
import { SEED_MOST, playerOfPass, type LobbyConnection, type ServerState } from './server-state.ts'
import { pushGame, pushGames, reject, sendGames } from './telling.ts'
import type { TransportConnection } from './transport.ts'
import {
  decodeAuth,
  decodeCreateGame,
  decodeGameEdit,
  decodeGameReady,
  decodeJoinGame,
  decodeLobbyHello,
  decodeSlotRemove,
  decodeSlotVehicle,
  encodeGame,
  encodeLobbyWelcome,
  isGameStart,
  isLeaveGame,
  isSlotAdd,
  messageTypeOf,
} from './wire.ts'

/** A connection on the start screen asks to be one: told the challenge it may prove its key by, and the games. */
export function openLobby(state: ServerState, connection: TransportConnection, payload: Uint8Array): void {
  const hello = decodeLobbyHello(payload)
  if (hello === null) {
    reject(state, connection, REJECT_MALFORMED_MESSAGE)
    return
  }
  if (hello.protocolVersion !== PROTOCOL_VERSION) {
    reject(state, connection, REJECT_PROTOCOL_MISMATCH)
    return
  }
  state.handshaking.delete(connection.id)
  const lobby: LobbyConnection = {
    connection,
    identity: { name: hello.name, challenge: newChallenge(), pubkey: null },
    game: 0,
    member: 0,
  }
  state.lobbies.set(connection.id, lobby)
  connection.send(encodeLobbyWelcome({ challenge: lobby.identity.challenge, signedIn: '' }))
  // Asking after a game of its own, as a link to one does: in it, if it is still there to be joined.
  if (hello.game !== 0) joinGame(state, lobby, hello.game, DEFAULT_VEHICLE_PROFILE)
  if (lobby.game === 0) sendGames(state, connection)
  else pushGame(state.games.get(lobby.game)!)
}

/** What a connection on the start screen or in a game room says, and what the server does about it. */
export function lobbyMessage(state: ServerState, lobby: LobbyConnection, payload: Uint8Array): void {
  switch (messageTypeOf(payload)) {
    case CLIENT_AUTH:
      signInLobby(state, lobby, decodeAuth(payload))
      return

    case CLIENT_JOIN_GAME: {
      const joining = decodeJoinGame(payload)
      if (joining === null || !PLAYABLE_PROFILE_IDS.includes(joining.vehicle)) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      joinGame(state, lobby, joining.game, joining.vehicle)
      return
    }

    case CLIENT_CREATE_GAME: {
      const vehicle = decodeCreateGame(payload)
      if (vehicle === null || !PLAYABLE_PROFILE_IDS.includes(vehicle)) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      hostGame(state, lobby, vehicle)
      return
    }

    case CLIENT_LEAVE_GAME:
      if (!isLeaveGame(payload)) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      leaveGame(state, lobby)
      return

    case CLIENT_GAME_READY: {
      const ready = decodeGameReady(payload)
      if (ready === null || !PLAYABLE_PROFILE_IDS.includes(ready.vehicle)) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      const game = state.games.get(lobby.game)
      if (game === undefined) return
      setReady(game, lobby.member, ready.vehicle, ready.ready)
      pushGame(game)
      pushGames(state)
      return
    }

    case CLIENT_GAME_EDIT: {
      const options = decodeGameEdit(payload)
      if (options === null) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      const game = state.games.get(lobby.game)
      if (game === undefined) return
      const was = game.options.mode
      if (editGame(game, lobby.member, options)) {
        // A game played for something else has no world to its name: its rooms were of the old one.
        if (game.options.mode !== was) closeRoomsOf(state, game)
        for (const room of state.rooms.values()) if (room.game === game.id) setRules(room.arena, { weapons: game.options.weapons, bananas: game.options.bananas })
        pushGame(game)
        pushGames(state)
      }
      return
    }

    case CLIENT_GAME_START:
      if (!isGameStart(payload)) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      startGame(state, lobby)
      return

    case CLIENT_SLOT_ADD:
      if (!isSlotAdd(payload)) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      changeSlots(state, lobby, (game, member) => addSlot(game, member))
      return

    case CLIENT_SLOT_REMOVE: {
      const slot = decodeSlotRemove(payload)
      if (slot === null) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      changeSlots(state, lobby, (game, member) => removeSlot(game, member, slot))
      return
    }

    case CLIENT_SLOT_VEHICLE: {
      const changed = decodeSlotVehicle(payload)
      if (changed === null || !PLAYABLE_PROFILE_IDS.includes(changed.vehicle)) {
        reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
        return
      }
      changeSlots(state, lobby, (game, member) => setBotVehicle(game, member, changed.slot, changed.vehicle))
      return
    }

    default:
      reject(state, lobby.connection, REJECT_MALFORMED_MESSAGE)
  }
}

/** Have a game's host change its slots, and tell everyone if it happened: the room and the start screen. */
function changeSlots(state: ServerState, lobby: LobbyConnection, change: (game: GameRecord, member: number) => boolean): void {
  const game = state.games.get(lobby.game)
  if (game === undefined || !change(game, lobby.member)) return
  pushGame(game)
  pushGames(state)
}

/** Make a game of the player's own, a race until its host says otherwise, and be in it: out of whichever game it was in. */
function hostGame(state: ServerState, lobby: LobbyConnection, vehicle: VehicleProfileId): void {
  if (lobby.game !== 0) leaveGame(state, lobby)
  const seed = newSeed()
  const game = createGame(state.nextGameId, lobby.connection, lobby.identity.name, vehicle, lobby.identity.challenge, seed, newPass(state))
  state.nextGameId += 1
  state.games.set(game.id, game)
  const member = game.members.get(game.host)
  if (member !== undefined && lobby.identity.pubkey !== null) member.pubkey = lobby.identity.pubkey
  lobby.game = game.id
  lobby.member = game.host
  state.events.onGameOpened?.(game)
  pushGame(game)
  pushGames(state)
}

/** A seed for a game nobody chose one for: a planet's, over the whole range one has. */
function newSeed(): number {
  return 1 + Math.floor(Math.random() * SEED_MOST)
}

/** Join the game with this id, in this vehicle, if it is joinable: out of whichever game it was in, taking a bot's slot. */
function joinGame(state: ServerState, lobby: LobbyConnection, id: number, vehicle: VehicleProfileId): void {
  if (lobby.game === id) return
  const game = state.games.get(id)
  if (game === undefined || !joinable(game)) return
  if (lobby.game !== 0) leaveGame(state, lobby)
  const member = addMember(game, lobby.connection, lobby.identity.name, vehicle, lobby.identity.challenge, newPass(state))
  if (member === null) return
  if (lobby.identity.pubkey !== null) member.pubkey = lobby.identity.pubkey
  lobby.game = id
  lobby.member = member.id
  pushGame(game)
  pushGames(state)
}

/** Out of the game the player is in, and back to the start screen. */
function leaveGame(state: ServerState, lobby: LobbyConnection): void {
  const game = state.games.get(lobby.game)
  const member = lobby.member
  lobby.game = 0
  lobby.member = 0
  if (game === undefined) {
    sendGames(state, lobby.connection)
    return
  }
  dropMember(state, game, member)
  // The room as it is now, for a member no longer in it, so the screen it was on knows to go back.
  if (state.games.get(game.id) === game) lobby.connection.send(encodeGame(gameView(game, 0), 0, 0))
  sendGames(state, lobby.connection)
}

/** A lobby connection's player is gone: out of its game, and out of the world it was driving in. */
export function dropLobby(state: ServerState, lobby: LobbyConnection): void {
  const game = state.games.get(lobby.game)
  const member = lobby.member
  lobby.game = 0
  lobby.member = 0
  if (game !== undefined) dropMember(state, game, member)
}

/** Take a member out of a game, its seat in the world with it; the game goes if it was the last. */
export function dropMember(state: ServerState, game: GameRecord, member: number): void {
  const gone = game.members.get(member)
  removeMember(game, member)
  if (gone !== undefined) {
    const player = playerOfPass(state, game.id, gone.drivePass)
    if (player !== undefined) leaveRoom(state, player)
  }
  if (game.members.size === 0) {
    closeGame(state, game)
    return
  }
  pushGame(game)
  pushGames(state)
}

/** Close every room of a game while it has no player in one: what they are is the game's, and that has changed. */
function closeRoomsOf(state: ServerState, game: GameRecord): void {
  for (const room of [...state.rooms.values()]) if (room.game === game.id) closeRoom(state, room)
}

/** Delete a game behind its last member or its standings: its rooms and everyone in them go with it. */
export function closeGame(state: ServerState, game: GameRecord): void {
  if (state.games.get(game.id) !== game) return
  for (const lobby of state.lobbies.values()) {
    if (lobby.game !== game.id) continue
    lobby.game = 0
    lobby.member = 0
  }
  state.games.delete(game.id)
  state.leaders.delete(game.id)
  if (state.demo === game.id) state.demo = 0
  for (const room of [...state.rooms.values()]) {
    if (room.game !== game.id) continue
    for (const player of [...room.players.values()]) leaveRoom(state, player)
    room.bots.clear()
    closeRoom(state, room)
  }
  state.events.onGameClosed?.(game)
  pushGames(state)
}

/** The host's Start: the course is made off the tick, and the room says so while it is. */
function startGame(state: ServerState, lobby: LobbyConnection): void {
  const game = state.games.get(lobby.game)
  if (game === undefined || game.host !== lobby.member || gameFault(game) !== null) return
  beginRaceOf(state, game)
}

/** A game's race is on its way: the course is made off the tick, and everyone is told while it is. */
export function beginRaceOf(state: ServerState, game: GameRecord): void {
  if (!prepareRace(game)) return
  pushGame(game)
  pushGames(state)
  void makeCourse(state, game)
}

/**
 * Build the race's course, a few worlds of seconds each, and put the
 * racers on its first grid. A game that has gone, or is no longer
 * preparing, is left alone; a course that cannot be made puts the game
 * back to waiting with the reason in front of its host.
 */
async function makeCourse(state: ServerState, game: GameRecord): Promise<void> {
  let course
  try {
    course = await buildCourse(game.options.seed, game.options.raceLength, (world) => state.sources.worldFor(world))
  } catch (error) {
    if (state.games.get(game.id) !== game || game.phase.kind !== 'preparing') return
    failCourse(game, error instanceof Error ? error.message : String(error))
    state.events.onCourseFailed?.(game, game.lastFault!)
    // A demo whose course cannot be made is dropped rather than waited on, for the next to be drawn.
    if (game.demo) {
      closeGame(state, game)
      return
    }
    pushGame(game)
    pushGames(state)
    return
  }
  if (state.games.get(game.id) !== game || game.phase.kind !== 'preparing') return
  beginRace(game, course, state.clock)
  pushGame(game)
  pushGames(state)
}
