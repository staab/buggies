import type { IslandMark, PendingGame } from '@buggies/net'
import type { Game, GameRequest, Race, VehicleProfileId } from '@buggies/game'
import type { World } from '@buggies/terrain'
import type * as THREE from 'three'

import type { HudState } from './hud.ts'

/** Someone on the island, by name, and what they drive and play. */
export interface LobbyPlayer {
  seat: number
  name: string
  profile: VehicleProfileId
  score: number
  /** Gems won with games and races, all told. */
  gems: number
  /** The count they play for, if any. */
  game: Game | null
  /** Whether they are in the race on. */
  racing: boolean
}

/** Who is on the island, and the games they play or wait to. */
export interface Lobby {
  seed: number
  /** The player's own seat. */
  seat: number
  /** The island's tick now, for how long each game waiting has left. */
  tick: number
  players: LobbyPlayer[]
  /** The games asked for, waiting for players to join them, soonest to start first. */
  waiting: PendingGame[]
  race: Race | null
}

/**
 * One way of being on a map. Modes own their camera and whatever they add to
 * the scene; the shell owns the renderer, the lights and the terrain itself.
 */
export interface ModeView {
  readonly camera: THREE.PerspectiveCamera
  /** A scene of the mode's own to draw instead of the island's, if it has one. */
  readonly scene?: THREE.Scene
  resize(aspect: number): void
  /** `active` is false while a menu is over the top and the player is not driving. */
  update(dt: number, active: boolean): void
  /** The game's tick, the same on every mirror, for whatever on the island keeps time by it. */
  readonly tick?: number
  /** Draw itself, if it is not simply its scene through its camera. */
  render?(renderer: THREE.WebGLRenderer): void
  /** What the HUD should say of the mode; a mode with no one driving has nothing to say. */
  hud?(): HudState
  /** Put the player into this vehicle, where they are; a mode with no one driving has none. */
  changeVehicle?(profile: VehicleProfileId): void
  /** The island being driven, for a race to be picked on; a mode with no one driving has none. */
  readonly map?: World
  /** Where the player is. */
  position?(): { x: number; y: number; z: number }
  /** The count the player is playing for, if any. */
  game?(): Game | null
  /** The race on over the island, if any, and whether the player set it going. */
  race?(): { race: Race; mine: boolean } | null
  /** Ask everyone on the island to play this game, or stop the player's own. */
  setGame?(game: GameRequest | null): void
  /** Who is on the island, and the games they play or wait to. */
  lobby?(): Lobby
  /** Into the game waiting with this id, or out of whichever one the player is in. */
  joinGame?(id: number | null): void
  /** The portal the player has driven through since last asked, or -1. */
  portal?(): number
  /** Why the connection to the server was lost, if it has been, for the game to be joined again. */
  lost?(): string | null
  /** What the player shows on coming through a portal, for what they hold to be carried over. */
  pass?(): number
  /** Show where every car is on the island being looked over, as the server last said. */
  showMarks?(marks: readonly IslandMark[]): void
  dispose(): void
}
