import type { VehicleProfileId } from '@buggies/game'

import { ConnectionFailure } from './client.ts'
import { authTemplate, publicKeyOf, signEvent } from './nostr.ts'
import {
  SERVER_GAME,
  SERVER_GAMES,
  SERVER_LOBBY_WELCOME,
  SERVER_REJECT,
  SERVER_SIGNED_IN,
  rejectLabel,
} from './protocol.ts'
import type { ClientTransport } from './transport.ts'
import {
  decodeGame,
  decodeGames,
  decodeLobbyWelcome,
  decodeReject,
  decodeSignedIn,
  encodeAuth,
  encodeCreateGame,
  encodeGameEdit,
  encodeGameReady,
  encodeGameStart,
  encodeJoinGame,
  encodeLeaveGame,
  encodeLobbyHello,
  encodeSlotAdd,
  encodeSlotRemove,
  encodeSlotVehicle,
  messageTypeOf,
  type GameOptions,
  type GameSummary,
  type GameView,
} from './wire.ts'

export interface LobbyEvents {
  /** Every game on the server, as a browsing connection last heard of them. */
  onGames(games: readonly GameSummary[]): void
  /** The game this connection is in, as its room last looked; `null` once the player has left it. */
  onGame(game: GameView | null): void
  onClosed(why: string): void
}

/**
 * One player's side of a lobby connection: the start screen's list of games,
 * and the room of the one they host or join. It is no seat in a world: the
 * game it is a member of has the pass that drives with.
 */
export class LobbyClient {
  private readonly transport: ClientTransport
  private readonly secret: Uint8Array | null
  private readonly pubkey: string | null
  private readonly events: Partial<LobbyEvents>

  private latestGames: readonly GameSummary[] = []
  private gamesBytes: Uint8Array | null = null
  private latestGame: GameView | null = null
  private gameBytes: Uint8Array | null = null
  private closedReason: string | null = null
  private rejectReason: number | null = null
  private settleConnect: { resolve(): void; reject(error: Error): void } | null = null
  private signedInAs: string | null = null

  constructor(transport: ClientTransport, secret: Uint8Array | null, events: Partial<LobbyEvents> = {}) {
    this.transport = transport
    this.secret = secret
    this.pubkey = secret === null ? null : publicKeyOf(secret)
    this.events = events
  }

  /** The nostr key the server has taken as the player's, its public half as hex; or `null` until it has. */
  signedIn(): string | null {
    return this.signedInAs
  }

  /** Why the connection closed, or `null` while it is open. */
  closed(): string | null {
    return this.closedReason
  }

  /** The games on the server, as they were last told. */
  games(): readonly GameSummary[] {
    return this.latestGames
  }

  /** The game this connection is in, as its room last looked; `null` when it is only browsing. */
  game(): GameView | null {
    return this.latestGame
  }

  /**
   * Open the connection under the player's name, browsing when `game` is 0 or
   * asking to be in that game: resolved once the server has answered with the
   * games or the game's room.
   */
  async connect(name: string, game = 0): Promise<void> {
    try {
      await this.transport.connect({
        onMessage: (payload) => this.receive(payload),
        onClose: (reason) => this.handleClose(reason),
      })
      const answered = new Promise<void>((resolve, reject) => {
        this.settleConnect = { resolve, reject }
      })
      this.transport.send(encodeLobbyHello(game, name))
      return await answered
    } catch (error) {
      throw new ConnectionFailure(error instanceof Error ? error.message : String(error), this.rejectReason)
    }
  }

  /** Make a game of one's own: a race, in this vehicle. */
  create(vehicle: VehicleProfileId): void {
    this.send(encodeCreateGame(vehicle))
  }

  /** Join the game with this id, in this vehicle. */
  join(game: number, vehicle: VehicleProfileId): void {
    this.send(encodeJoinGame(game, vehicle))
  }

  /** One more slot in the game this connection hosts, a bot's until a player takes it: by the host alone. */
  addSlot(): void {
    this.send(encodeSlotAdd())
  }

  /** Take a bot slot away from the game this connection hosts: by the host alone. */
  removeSlot(slot: number): void {
    this.send(encodeSlotRemove(slot))
  }

  /** Choose the vehicle a bot slot of the game this connection hosts is driven in: by the host alone. */
  setBotVehicle(slot: number, vehicle: VehicleProfileId): void {
    this.send(encodeSlotVehicle(slot, vehicle))
  }

  /** Leave the game this connection is in. */
  leave(): void {
    this.send(encodeLeaveGame())
  }

  /** Ready to drive in this vehicle, or no longer ready. */
  ready(vehicle: VehicleProfileId, ready: boolean): void {
    this.send(encodeGameReady(vehicle, ready))
  }

  /** The game's mode, world and rules: by its host alone. */
  edit(options: GameOptions): void {
    this.send(encodeGameEdit(options))
  }

  /** Start the race the room waits for: by its host, once everyone is ready. */
  start(): void {
    this.send(encodeGameStart())
  }

  close(why: string): void {
    this.transport.close(why)
  }

  private send(payload: Uint8Array): void {
    if (this.closedReason !== null) return
    this.transport.send(payload)
  }

  private receive(payload: Uint8Array): void {
    const type = messageTypeOf(payload)

    if (type === SERVER_LOBBY_WELCOME) {
      const welcome = decodeLobbyWelcome(payload)
      if (welcome !== null) this.prove(welcome.challenge, welcome.signedIn)
      return
    }

    if (type === SERVER_SIGNED_IN) {
      const signed = decodeSignedIn(payload)
      if (signed !== null && signed.pubkey === this.pubkey) this.signedInAs = signed.pubkey
      return
    }

    if (type === SERVER_GAMES) {
      const games = decodeGames(payload)
      if (games === null) return
      this.settleConnect?.resolve()
      this.settleConnect = null
      if (sameBytes(this.gamesBytes, payload)) return
      this.gamesBytes = payload.slice()
      this.latestGames = games
      this.events.onGames?.(games)
      return
    }

    if (type === SERVER_GAME) {
      const game = decodeGame(payload)
      if (game === null) return
      this.settleConnect?.resolve()
      this.settleConnect = null
      if (sameBytes(this.gameBytes, payload)) return
      this.gameBytes = payload.slice()
      this.latestGame = game
      this.events.onGame?.(game)
      return
    }

    if (type === SERVER_REJECT) {
      const message = decodeReject(payload)
      this.rejectReason = message?.reason ?? null
      this.handleClose(message === null ? 'malformed reject' : rejectLabel(message.reason))
    }
  }

  /**
   * Prove to the server which key is the player's, by signing the challenge
   * it welcomed the lobby connection with: unless it knows the key already.
   */
  private prove(challenge: string, signedIn: string): void {
    if (this.secret === null || this.pubkey === null) return
    if (signedIn === this.pubkey) {
      this.signedInAs = this.pubkey
      return
    }
    this.transport.send(encodeAuth(signEvent(authTemplate(challenge, this.pubkey, Date.now() / 1000), this.secret)))
  }

  private handleClose(reason: string): void {
    if (this.closedReason !== null) return
    this.closedReason = reason
    this.settleConnect?.reject(new Error(reason))
    this.settleConnect = null
    this.events.onClosed?.(reason)
  }
}

/** Whether these are the same bytes, either may be none. */
function sameBytes(before: Uint8Array | null, after: Uint8Array): boolean {
  if (before === null || before.length !== after.length) return false
  for (let k = 0; k < before.length; k++) if (before[k] !== after[k]) return false
  return true
}
