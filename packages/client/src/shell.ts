import { portalLink, withPortals, type VehicleProfileId } from '@buggies/game'
import {
  ConnectionFailure,
  LobbyClient,
  NO_ARRIVAL,
  REJECT_PROTOCOL_MISMATCH,
  cleanName,
  type GameOptions,
  type GameSummary,
  type GameView,
  type LobbyEvents,
  type Standing,
} from '@buggies/net'
import { WORLD_TRAITS, planetSeedOf, worldId, worldKindOf, type World, type WorldKind } from '@buggies/terrain'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import { disposeObject } from './dispose.ts'
import type { FinishScreen } from './finish-screen.ts'
import { ownMember, type GameRoom, type RoomHost } from './game-room.ts'
import { createIslandMode } from './island-mode.ts'
import { playerKey } from './identity.ts'
import type { Choice, FinishState, HudState, LocalDriver, ModeView, PlayRequest, PortalTrip, Screen, ShellModes } from './mode.ts'
import type { NameScreen } from './name-screen.ts'
import { createOnlineMode } from './online-mode.ts'
import { createShowroomMode, type ShowroomView } from './showroom-mode.ts'
import { THUMB_PIXELS, joinable, watchable, type StartHost, type StartScreen } from './start-screen.ts'
import type { Standings } from './standings.ts'
import type { Sun } from './sun.ts'
import { TerrainSource } from './terrain-source.ts'
import { createTerrainView, moveBoats, moveClouds, moveLife } from './terrain-view.ts'
import { createWatchMode } from './watch-mode.ts'
import { WORLD_LOOKS } from './world-looks.ts'
import { WebSocketClientTransport } from './ws-transport.ts'

/** How long to wait before trying to rejoin again, after each try that fails: longer each time, up to the last. */
const REJOIN_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

/** How many games' thumbnails are kept: one for each game listed, and a few more. */
const THUMBS_KEPT = 16

/**
 * How many lobby connections are tried in a row before the start screen
 * leaves it: a server that turns every one away is not to be hammered.
 */
const LOBBY_TRIES = 3

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** What went wrong, in words. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The HUD, as the shell fills it. */
export interface ShellHud {
  render(state: HudState | null): void
  notice(text: string): void
}

/** Where worlds come from: made off the page's thread, as main.ts's terrain source does it. */
export interface WorldSource {
  generate(world: number): Promise<World>
}

/** One player's side of a lobby connection, as the shell drives it: the start screen's list, and the room of the game it is in. */
export interface ShellLobby {
  connect(name: string, game?: number): Promise<void>
  games(): readonly GameSummary[]
  game(): GameView | null
  create(vehicle: VehicleProfileId): void
  join(game: number, vehicle: VehicleProfileId): void
  addSlot(): void
  removeSlot(slot: number): void
  setBotVehicle(slot: number, vehicle: VehicleProfileId): void
  leave(): void
  ready(vehicle: VehicleProfileId, ready: boolean): void
  edit(options: GameOptions): void
  start(): void
  close(why: string): void
}

/** How the shell opens a lobby connection: the server's, under the player's own key. */
export type LobbyMaker = (events: Partial<LobbyEvents>) => ShellLobby

/** The screens the shells shows, built around the page's own elements. */
export interface ShellScreens {
  name: NameScreen
  start: StartScreen
  room: GameRoom
  /** The celebration of the player's own finish, over the drive. */
  finish: FinishScreen
  standings: Standings
}

/** Everything a screen may ask of the shell. */
export interface ScreenHost extends StartHost, RoomHost {
  /** The name typed on the name screen: kept, and the start screen comes up under it. */
  nameChosen(name: string): void
  /** Out of the game, back to the start screen: what the celebration's button and the standings' do. */
  backToLobby(): void
}

export interface ShellDeps {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** What the canvas fills. */
  container: { readonly clientWidth: number; readonly clientHeight: number }
  hud: ShellHud
  sound: Sound
  /** The light over the world, and its shadows, which follow the play. */
  sun: Sun
  worlds: WorldSource
  /** The game server. */
  server: string
  /** The screens, made with the shell as their host. */
  screens: (host: ScreenHost) => ShellScreens
  modes?: ShellModes
  /** How the lobby connection is opened; the server's own unless something else is given. */
  lobby?: LobbyMaker
  /** Where the game being played is reflected: the address bar. */
  settle?: (choice: Choice) => void
}

/** One game being driven: its connection to the world, whose it is and where, outliving any one connection. */
interface Driving {
  mode: ModeView | null
  readonly driver: LocalDriver
  readonly game: number
  /** The world being driven, or gone to through a gate. */
  world: number
}

/**
 * A race looked on at behind the screens with no car of one's own in it: the
 * server's demo, or the race the player picked. Its connection to the world
 * the leader is in is remade as the leader goes on to another, and keeps
 * trying on the same world while the room is not there yet.
 */
interface Watching {
  /** The game watched. */
  readonly game: number
  /** The world it is in, or on its way to. */
  world: number
  mode: ModeView | null
  /** Whether a connection to it is being made right now. */
  trying: boolean
  /** How many tries in a row have come to nothing: the wait between them grows with it. */
  tries: number
  /** When it may be tried again, in milliseconds since the page opened, after a try that failed. */
  again: number
}

/**
 * What is on the screen and why: the pages of the game, from the name asked
 * for at the door to the celebration of the player's own finish, or the
 * standings a race ends on for one who did not come home, and the world
 * drawn behind them. It holds the one lobby connection a tab has, which is what the start
 * screen lists the server's games from and what its member joins a game
 * with; the drive itself is one connection to one world of that game at a
 * time, made and let go through every gate.
 */
export class Shell implements ScreenHost {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly container: ShellDeps['container']
  private readonly hud: ShellHud
  private readonly sound: Sound
  private readonly sun: Sun
  private readonly source: WorldSource
  private readonly server: string
  private readonly modes: ShellModes
  private readonly settle: (choice: Choice) => void
  private readonly makeLobby: LobbyMaker
  private readonly screens: ShellScreens

  private choiceNow: Choice
  private screenNow: Screen = 'name'
  private lobby: ShellLobby | null = null
  /** The game this tab's member is in, as the server last said; nothing while it is only browsing. */
  private current: GameView | null = null
  private drive: Driving | null = null
  /** The race playing behind the screens, the demo until one is picked. */
  private watched: Watching | null = null
  /** The game picked to watch instead of the demo, or `0` for the demo. */
  private picked = 0
  /** The world looked over in the room, turning in its stage. */
  private preview: { world: number; mode: ModeView } | null = null
  private showroom: ShowroomView | null = null
  /** Whether the last frame drew the room's stages, so the views are shaped to them and not to the screen. */
  private staged = false
  private readonly clearWas = new THREE.Color()
  /** The view of the world behind the screens: its terrain, its boats, its clouds and its life. */
  private view: THREE.Group | null = null
  /** The world last made, which a portal's way out is read from. */
  private map: World | null = null
  private readonly worlds = new Map<number, Promise<World>>()
  private readonly kept = new Map<string, World>()
  private readonly pictures = new Map<number, HTMLCanvasElement>()
  private readonly asking = new Set<number>()
  /** Seconds the screen has run, for what keeps time with no game on. */
  private idle = 0
  /** The planet's portal the moon was gone to by, to come back out of. */
  private cameFrom = 0
  /** The game the address bar named, asked for once when the lobby is first opened. */
  private asked: number
  /** How many lobby connections have been made in a row: bought down to nothing by one that works. */
  private lobbyTries = 0
  /**
   * Each thing asked for outranks the one before of its sort: a slow one
   * that lands late is let go. What is put up behind the screens is one
   * sort, and joining a world another, so that looking at another world
   * while a gate is gone through does not call the journey off.
   */
  private showing = 0
  private joining = 0
  /** A camera for the sky alone, where there is no world to look at. */
  private readonly sky = new THREE.PerspectiveCamera()

  constructor(deps: ShellDeps, choice: Choice) {
    this.renderer = deps.renderer
    this.scene = deps.scene
    this.container = deps.container
    this.hud = deps.hud
    this.sound = deps.sound
    this.sun = deps.sun
    this.source = deps.worlds
    this.server = deps.server
    this.modes = deps.modes ?? MODES
    this.settle = deps.settle ?? (() => {})
    this.choiceNow = { ...choice }
    this.asked = choice.game
    this.makeLobby = deps.lobby ?? ((events) => new LobbyClient(new WebSocketClientTransport(deps.server), playerKey(), events))
    this.screens = deps.screens(this)
    this.sky.position.set(0, 0, 0)
  }

  /** What the player last chose, or is choosing: who they are, what they drive and the game they are in. */
  choice(): Choice {
    return this.choiceNow
  }

  /** Which screen is up. */
  screen(): Screen {
    return this.screenNow
  }

  /** What the player is driving, if anything: for anyone asking. */
  driving(): { game: number; world: number } | null {
    return this.drive === null ? null : { game: this.drive.game, world: this.drive.world }
  }

  /** Open the page: the name first if none is kept from last time, the start screen otherwise. */
  welcome(): void {
    if (this.choiceNow.name === '') this.showName()
    else this.enterStart()
  }

  /** A line on the HUD and nothing else: what is being waited for. */
  notice(text: string): void {
    this.hud.notice(text)
  }

  /** The name typed: kept, and the start screen comes up under it. */
  nameChosen(name: string): void {
    const chosen = cleanName(name)
    if (chosen === '') return
    // The server knows a member by the name it joined under: another name is another connection.
    if (chosen !== this.choiceNow.name) this.closeLobby()
    this.choiceNow = { ...this.choiceNow, name: chosen }
    this.settle(this.choiceNow)
    this.enterStart()
  }

  /** Every game on the server, as it last looked. */
  games(): readonly GameSummary[] {
    return this.lobby?.games() ?? []
  }

  /** The world a game is played on, drawn flat for its card; nothing until it has been drawn. */
  picture(game: GameSummary): HTMLCanvasElement | null {
    const world = worldId(game.seed, 'planet')
    const made = this.pictures.get(world)
    if (made !== undefined) return made
    if (!this.asking.has(world)) {
      this.asking.add(world)
      void this.modes
        .picture(world, THUMB_PIXELS)
        .then((canvas) => this.keepPicture(world, canvas))
        .catch(() => this.asking.delete(world))
    }
    return null
  }

  joinable(game: GameSummary): boolean {
    return joinable(game)
  }

  watchable(game: GameSummary): boolean {
    return watchable(game)
  }

  /** Who this player goes by. */
  name(): string {
    return this.choiceNow.name
  }

  /** Ask for another name: the start screen comes back once it is given. */
  changeName(): void {
    this.closeLobby()
    this.showName()
  }

  /** Into the game with this id, as this player, in the vehicle they picked. */
  join(game: number): void {
    this.screens.start.warn('')
    this.lobby?.join(game, this.choiceNow.vehicle)
  }

  /**
   * Look on at this race behind the screens, as anyone may, or go back to the
   * demo if it is the one already watched. The list plays the part of "join"
   * for a race under way, which takes nobody: the page follows its leader.
   */
  watch(game: number): void {
    this.picked = this.picked === game ? 0 : game
    this.screens.start.update()
  }

  /** The game playing behind the screens: `0` for the demo, or the race the player picked. */
  watching(): number {
    return this.picked
  }

  /** Make a race of one's own, and go into its room: the room sets its worlds and rules. */
  host(): void {
    this.screens.start.warn('')
    this.lobby?.create(this.choiceNow.vehicle)
  }

  /** The game this tab's member is in, as the room shows it. */
  game(): GameView | null {
    return this.current
  }

  /** Whether this tab's member is the game's host. */
  isHost(): boolean {
    const game = this.current
    return game !== null && (ownMember(game)?.member ?? 0) === game.host
  }

  /** This tab's member drives this from now on, ready or not, and the turntable shows it. */
  setVehicle(profile: VehicleProfileId): void {
    this.choiceNow = { ...this.choiceNow, vehicle: profile }
    const game = this.current
    this.lobby?.ready(profile, game === null ? false : (ownMember(game)?.ready ?? false))
    this.showVehicle(profile)
  }

  /** This tab's member is ready to drive in this vehicle, or no longer is. In a free drive, ready is what drives. */
  ready(ready: boolean): void {
    this.lobby?.ready(this.choiceNow.vehicle, ready)
  }

  /** Put this vehicle on the showroom turntable in the modal's stage, its own to turn on. */
  showVehicle(profile: VehicleProfileId): void {
    if (this.showroom === null) this.showroom = this.modes.showroom(this.sound)
    this.showroom.show(profile)
  }

  /** The vehicle a bot's slot of this game is driven in: by the host alone. */
  setBotVehicle(slot: number, profile: VehicleProfileId): void {
    this.lobby?.setBotVehicle(slot, profile)
  }

  /** One more slot in this game, a bot's until a player takes it: by the host alone. */
  addSlot(): void {
    this.lobby?.addSlot()
  }

  /** Take a bot's slot out of this game: by the host alone. */
  removeSlot(slot: number): void {
    this.lobby?.removeSlot(slot)
  }

  /**
   * Look over another of the game's seed's worlds in the room, for this
   * player alone: a race starts on the island, wherever anyone looks.
   */
  previewWorld(kind: WorldKind): void {
    const seed = this.current?.options.seed ?? null
    if (seed !== null) void this.showPreview(worldId(seed, kind))
  }

  /** The game's world and rules, as its host set them. */
  edit(options: GameOptions): void {
    this.lobby?.edit(options)
  }

  /** Start the race the room waits for. */
  start(): void {
    this.lobby?.start()
  }

  /** Out of the game, back to the start screen. */
  leave(): void {
    this.leaveGame()
    this.enterStart()
  }

  /** Out of the game and back to the lobby: what the celebration's button and the standings' ask for. */
  backToLobby(): void {
    this.leave()
  }

  /**
   * The Escape key. From the room the game is left; from a free drive the
   * player is let out into the room again, no longer ready; from a race the
   * drive is left and the racer is out of it; from the celebration of a
   * finish, and from the standings, he is out of the game altogether; from
   * the start screen, nothing is left to leave.
   */
  escape(): void {
    switch (this.screenNow) {
      case 'name':
      case 'start':
        return
      case 'room':
      case 'finish':
      case 'standings':
        this.leave()
        return
      case 'drive':
        this.leaveDrive()
        return
    }
  }

  /** The tab is going: the lobby connection goes with it, and whatever was played behind the screens. */
  unload(): void {
    this.clearWatch()
    this.closeLobby()
  }

  resize(): void {
    const { clientWidth, clientHeight } = this.container
    this.renderer.setSize(clientWidth, clientHeight, false)
    const aspect = clientWidth / Math.max(clientHeight, 1)
    this.drive?.mode?.resize(aspect)
    this.watched?.mode?.resize(aspect)
    this.preview?.mode.resize(aspect)
  }

  /**
   * One frame. A drive keeps its clock whether the player is driving or a
   * screen is up over it: the server does not wait. Gates, lost connections
   * and the end of a race are all read from the mode here, and whatever is
   * on show is drawn: the drive, or the world behind the screens.
   */
  frame(dt: number): void {
    const drive = this.drive
    if (drive !== null) {
      drive.mode?.update(dt, this.screenNow === 'drive')
      // The moment the player's own racer is home the celebration goes up
      // over the drive, which is not let go: it goes on behind, and is not
      // joined again once its room closes.
      if (this.drive === drive) {
        const came = drive.mode?.finished?.() ?? null
        if (came !== null) {
          if (this.screenNow === 'finish') this.screens.finish.update(came)
          else if (this.screenNow === 'drive') this.celebrate(came)
        }
      }
      if (this.drive === drive) {
        const trip = drive.mode?.trip?.() ?? null
        if (trip !== null) this.follow(drive, trip)
      }
      if (this.drive === drive) {
        const through = drive.mode?.portal?.() ?? -1
        if (through >= 0) this.travel(drive, through)
      }
      if (this.drive === drive) {
        const lost = drive.mode?.lost?.() ?? null
        if (lost !== null) {
          // A finished race is never joined again: a room closing is the
          // server's way of ending it, and the celebration stays up.
          if (this.screenNow === 'finish') this.clearDrive()
          else this.rejoin(drive, lost)
        }
      }
      if (this.drive === drive) {
        const rows = drive.mode?.standings?.() ?? null
        if (rows !== null) this.finish(rows)
      }
    }
    if (this.screenNow === 'start') {
      this.rejoinWatch()
      this.tendWatch()
      // The race behind the screen goes on whether or not anyone is looking at it closely.
      this.watched?.mode?.update(dt, false)
      this.screens.start.update()
    } else if (this.screenNow === 'finish') {
      // The server's demo plays behind the celebration too, as it does behind the start screen.
      this.rejoinWatch()
      this.tendWatch()
      this.watched?.mode?.update(dt, false)
    } else if (this.screenNow !== 'drive') {
      this.preview?.mode.update(dt, this.screenNow === 'room')
    }
    if (this.screenNow === 'room') this.showroom?.update(dt, false)

    // The world's clocks keep the game's time where there is one.
    this.idle += dt
    if (this.view !== null) {
      const tick = this.drive?.mode?.tick?.() ?? this.watched?.mode?.tick?.() ?? this.preview?.mode.tick?.()
      const seconds = tick === undefined ? this.idle : tick / 60
      moveBoats(this.view, seconds)
      moveClouds(this.view, seconds)
      moveLife(this.view, seconds)
      this.sun.turn(seconds)
      this.sun.shade(this.scene, WORLD_LOOKS[this.map?.kind ?? 'planet'].skies)
    }

    this.draw()
    // Between worlds there is nothing to fill the HUD with, so what is being waited for stays up.
    if (this.screenNow !== 'drive') this.hud.render(null)
    else if (this.drive?.mode !== undefined && this.drive.mode !== null) this.hud.render(this.drive.mode.hud?.() ?? null)
  }

  // -- the screens ---------------------------------------------------------

  private showName(): void {
    this.screenNow = 'name'
    this.current = null
    this.clearDrive()
    this.clearWatch()
    this.screens.start.hide()
    this.screens.room.hide()
    this.screens.finish.hide()
    this.screens.standings.hide()
    this.screens.name.show(this.choiceNow.name)
    this.clearPreview()
    this.hud.render(null)
  }

  /** The start screen, with its lobby connection made or asked for again. */
  private enterStart(warning: string | null = null): void {
    const asked = this.asked
    this.asked = 0
    this.current = null
    this.clearDrive()
    this.showStart(warning)
    if (this.lobby === null) void this.openLobby(asked)
  }

  private showStart(warning: string | null): void {
    this.screenNow = 'start'
    this.screens.name.hide()
    this.screens.room.hide()
    this.screens.finish.hide()
    this.screens.standings.hide()
    this.screens.start.show()
    if (warning !== null) this.screens.start.warn(warning)
    this.hud.render(null)
    this.choiceNow = { ...this.choiceNow, game: 0 }
    this.settle(this.choiceNow)
    this.screens.start.update()
  }

  /** Open the lobby connection, asking for a game by its id if the address bar named one. */
  private async openLobby(asked: number): Promise<void> {
    if (this.lobbyTries >= LOBBY_TRIES) return
    this.lobbyTries += 1
    let made: ShellLobby | null = null
    const lobby = this.makeLobby({
      onGames: () => {
        if (made !== null && this.lobby === made) this.screens.start.update()
      },
      onGame: (view) => {
        if (made !== null && this.lobby === made) this.seeGame(view)
      },
      onClosed: (why) => {
        if (made !== null && this.lobby === made) this.loseLobby(why)
      },
    })
    made = lobby
    this.lobby = lobby
    try {
      await lobby.connect(this.choiceNow.name, asked)
    } catch (error: unknown) {
      // One that something newer has taken over is not this one's to report.
      if (this.lobby !== lobby) return
      this.lobby = null
      if (this.screenNow !== 'start') return
      this.screens.start.warn(
        error instanceof ConnectionFailure && error.reject === REJECT_PROTOCOL_MISMATCH
          ? 'The server has been updated: reload the page to play on.'
          : `Could not reach ${this.server}: ${reasonOf(error)}`,
      )
      return
    }
    if (this.lobby !== lobby) return
    this.lobbyTries = 0
    if (this.current !== null) this.enterRoom()
    else {
      this.screens.start.update()
      if (asked !== 0) this.screens.start.warn('that game is gone')
    }
  }

  /** The game this tab's member is in, as the server last pushed it. */
  private seeGame(view: GameView | null): void {
    if (view === null || view.you === 0) {
      // Out of the game: the room goes, and so does any drive in it.
      this.current = null
      if (this.screenNow === 'room') this.enterStart('that game has closed')
      return
    }
    this.current = view
    if (this.screenNow === 'start' || this.screenNow === 'name') {
      this.enterRoom()
    } else if (this.screenNow === 'room') {
      // The room says which of the seed's worlds it wants in its stage: the island of another seed, or the one picked.
      this.screens.room.show(view)
    }
    if (this.drive === null && this.screenNow !== 'standings' && this.screenNow !== 'finish' && this.needsDrive(view)) this.go(view)
  }

  /** Whether the game is at the point where this tab's member belongs in the world. */
  private needsDrive(view: GameView): boolean {
    const own = ownMember(view)
    if (own === null) return false
    if (view.options.mode === 'free') return own.ready
    return view.status === 'starting' || view.status === 'racing'
  }

  private enterRoom(): void {
    const view = this.current
    if (view === null) {
      this.enterStart()
      return
    }
    this.clearWatch()
    this.screenNow = 'room'
    this.screens.name.hide()
    this.screens.start.hide()
    this.screens.finish.hide()
    this.screens.standings.hide()
    this.screens.room.show(view)
    const own = ownMember(view)
    this.choiceNow = { ...this.choiceNow, game: view.id, ...(own === null ? {} : { vehicle: own.vehicle }) }
    this.settle(this.choiceNow)
    this.hud.render(null)
    // Every room opens on the island of its seed: a race starts there, wherever anyone looked.
    void this.showPreview(worldId(view.options.seed, 'planet'))
  }

  /**
   * How a race ended. A player whose own racer came home keeps the
   * celebration it went up with, and the standings are put up in it; one who
   * did not finish is shown the standings on their own, and stays there
   * until they leave.
   */
  private finish(rows: readonly Standing[]): void {
    if (this.screenNow === 'finish') {
      this.screens.finish.standings(rows)
      return
    }
    this.clearDrive()
    this.screenNow = 'standings'
    this.screens.name.hide()
    this.screens.start.hide()
    this.screens.room.hide()
    this.screens.finish.hide()
    this.screens.standings.show(rows)
    this.hud.render(null)
  }

  /** Throw the celebration of the player's own finish up over the drive, which goes on behind it. */
  private celebrate(came: FinishState): void {
    this.screenNow = 'finish'
    this.screens.name.hide()
    this.screens.start.hide()
    this.screens.room.hide()
    this.screens.standings.hide()
    this.screens.finish.show(came)
    this.hud.render(null)
  }

  /** Out of the game: leave it on the server, and let go of the drive. */
  private leaveGame(): void {
    this.lobby?.leave()
    this.current = null
    this.clearDrive()
  }

  /** Escape from a drive: out of a free drive into the room, out of a race altogether. */
  private leaveDrive(): void {
    const view = this.current
    if (view !== null && view.options.mode === 'race') {
      this.leaveGame()
      this.enterStart()
      return
    }
    this.clearDrive()
    if (view !== null) {
      this.lobby?.ready(this.choiceNow.vehicle, false)
      this.enterRoom()
    } else this.enterStart()
  }

  // -- the game ------------------------------------------------------------

  /** Into the world the game starts on, in the vehicle this player picked there. */
  private go(view: GameView): void {
    if (this.drive !== null) return
    const own = ownMember(view)
    if (own === null) return
    // A race starts on its seed's island, and so does a free drive.
    const world = worldId(view.options.seed, 'planet')
    const drive: Driving = {
      mode: null,
      driver: { name: this.choiceNow.name, profile: own.vehicle, pass: view.drivePass },
      game: view.id,
      world,
    }
    this.drive = drive
    this.enterDrive()
    this.choiceNow = { ...this.choiceNow, game: view.id, vehicle: own.vehicle }
    this.settle(this.choiceNow)
    const racing = view.options.mode === 'race'
    void this.joinWorld(drive, world, NO_ARRIVAL, (why) =>
      why === null ? (racing ? 'joining the race...' : 'joining the world...') : `could not join the ${racing ? 'race' : 'world'} (${why}), trying again...`,
    )
  }

  private enterDrive(): void {
    // The world looked over in the room lets go of its camera; the world itself stays on view until the drive's own is made.
    this.clearPreview()
    this.clearWatch()
    this.screenNow = 'drive'
    this.screens.name.hide()
    this.screens.start.hide()
    this.screens.room.hide()
    this.screens.finish.hide()
    this.screens.standings.hide()
    this.hud.render(null)
  }

  /**
   * Join the world a game has gone to, out of a gate or back after losing
   * it, saying what is being waited for. The world is made first, so the
   * seat is not held empty while it is. Tried until it works, or something
   * else is asked for, or the server has moved on to a version this page
   * does not speak.
   */
  private async joinWorld(drive: Driving, world: number, arrival: number, waiting: (why: string | null) => string): Promise<void> {
    const stamp = ++this.joining
    drive.world = world
    this.notice(waiting(null))
    for (let attempt = 0; ; attempt++) {
      const driver = drive.driver
      try {
        await this.mapFor(world, null)
        if (stamp !== this.joining || this.drive !== drive) return
        const request: PlayRequest = {
          scene: this.scene,
          url: this.server,
          game: drive.game,
          world,
          arrival,
          driver,
          mapFor: (asked, keep) => this.driveMap(asked, keep),
          sound: this.sound,
          sun: this.sun,
        }
        const mode = await this.modes.play(request)
        if (stamp !== this.joining || this.drive !== drive) {
          mode.dispose()
          return
        }
        drive.mode = mode
        this.resize()
        return
      } catch (error: unknown) {
        if (stamp !== this.joining || this.drive !== drive) return
        if (error instanceof ConnectionFailure && error.reject === REJECT_PROTOCOL_MISMATCH) {
          this.closeLobby()
          this.current = null
          this.clearDrive()
          this.showStart('The server has been updated: reload the page to play on.')
          return
        }
        this.notice(waiting(reasonOf(error)))
      }
      await wait(REJOIN_DELAYS_MS[Math.min(attempt, REJOIN_DELAYS_MS.length - 1)]!)
      if (stamp !== this.joining) return
    }
  }

  /** Through the gate out of a race's world and on to the next world of the course. */
  private follow(drive: Driving, trip: PortalTrip): void {
    this.leaveWorld(drive)
    void this.joinWorld(drive, trip.to, trip.arrival, (why) =>
      why === null ? 'on to the next world...' : `could not go on to the next world (${why}), trying again...`,
    )
  }

  /**
   * Take the player through a portal to another of the planet's worlds,
   * picked at random; back to the planet itself, out of the portal they
   * left it by.
   */
  private travel(drive: Driving, through: number): void {
    const map = this.map
    if (map === null || map.seed !== drive.world) return
    const link = portalLink(map, this.cameFrom)
    if (map.kind === 'planet') this.cameFrom = through
    this.leaveWorld(drive)
    const kind = worldKindOf(link.to)
    const going = kind === 'planet' ? 'back through the portal' : `through the portal to ${WORLD_TRAITS[kind].name}`
    void this.joinWorld(drive, link.to, link.arrival, (why) =>
      why === null ? `${going}...` : `could not go ${going} (${why}), trying again...`,
    )
  }

  /** Join the world being driven again, where the server still has it, after losing the connection. */
  private rejoin(drive: Driving, lost: string): void {
    const world = drive.world
    this.leaveWorld(drive)
    void this.joinWorld(drive, world, NO_ARRIVAL, (why) => `lost the server (${why ?? lost}), reconnecting...`)
  }

  /** Let go of the connection a game is played over, keeping the game: another is on its way. */
  private leaveWorld(drive: Driving): void {
    this.joining += 1
    drive.mode?.dispose()
    drive.mode = null
  }

  private clearDrive(): void {
    if (this.drive !== null) this.leaveWorld(this.drive)
    this.drive = null
  }

  // -- watching ------------------------------------------------------------

  /**
   * Play a race behind the start screen: the server's demo, which is there
   * while anyone browses, or the race picked with Watch, followed wherever
   * its leader is. Nothing plays behind any other screen.
   */
  private tendWatch(): void {
    // Behind the celebration the drive is drawn until it is let go: only then does the demo come in its place.
    if (!this.playsBehind() || this.lobby === null || (this.screenNow === 'finish' && this.drive !== null)) {
      this.clearWatch()
      return
    }
    const game = this.watchedGame()
    if (game === null || game.leader === 0) {
      // A demo still lining up has nowhere to be looked at yet, and no game at all is nothing to watch.
      this.clearWatch()
      return
    }
    const watch = this.watched
    if (watch === null || watch.game !== game.id || watch.world !== game.leader) {
      this.startWatch(game.id, game.leader)
      return
    }
    if (watch.mode === null && !watch.trying && performance.now() >= watch.again) void this.openWatch(watch)
  }

  /** The race to play behind the screens: the one picked while it is under way, or else the server's demo. */
  private watchedGame(): GameSummary | null {
    const games = this.games()
    // A celebration of a finish has the demo behind it, whatever was picked to watch before the race.
    if (this.picked !== 0 && this.screenNow !== 'finish') {
      const picked = games.find((game) => game.id === this.picked)
      if (picked !== undefined && watchable(picked)) return picked
      // A race that is over, or gone from the server, is nobody's to watch any more: the demo comes back.
      this.picked = 0
    }
    return games.find((game) => game.demo) ?? null
  }

  /** Look on at this race's world, letting whatever was watched before go. */
  private startWatch(game: number, world: number): void {
    this.clearWatch()
    const watching: Watching = { game, world, mode: null, trying: false, tries: 0, again: 0 }
    this.watched = watching
    void this.openWatch(watching)
  }

  /** Let go of the race playing behind the screens, if one is. */
  private clearWatch(): void {
    const watch = this.watched
    this.watched = null
    watch?.mode?.dispose()
  }

  /**
   * Open a watcher's connection to the world a race is being followed in. A
   * race's room comes and goes with the racers in it, so one that is not
   * there yet is tried again, waiting longer each time; the list says when
   * the leader has gone on to another world.
   */
  private async openWatch(watching: Watching): Promise<void> {
    watching.trying = true
    try {
      const mode = await this.modes.watch({
        scene: this.scene,
        url: this.server,
        game: watching.game,
        world: watching.world,
        mapFor: (asked, keep) => this.driveMap(asked, keep),
        sound: this.sound,
        sun: this.sun,
      })
      if (this.watched !== watching) {
        mode.dispose()
        return
      }
      watching.mode = mode
      watching.tries = 0
      this.resize()
    } catch (error: unknown) {
      if (this.watched !== watching) return
      if (error instanceof ConnectionFailure && error.reject === REJECT_PROTOCOL_MISMATCH) {
        this.clearWatch()
        this.screens.start.warn('The server has been updated: reload the page to play on.')
        return
      }
      watching.tries += 1
      watching.again = performance.now() + REJOIN_DELAYS_MS[Math.min(watching.tries - 1, REJOIN_DELAYS_MS.length - 1)]!
    } finally {
      watching.trying = false
    }
  }

  /** A watched room has closed under us: the race has gone on to another world, or is over. Follow it. */
  private rejoinWatch(): void {
    const watch = this.watched
    if (watch === null || watch.mode === null) return
    if (watch.mode.lost?.() == null) return
    watch.mode.dispose()
    watch.mode = null
    watch.tries = 0
    watch.again = 0
  }

  // -- worlds --------------------------------------------------------------

  /**
   * The world with this id, made once however many ask for it, and — for a
   * race's world — a copy keeping only the portals the course uses.
   */
  private mapFor(world: number, keep: readonly number[] | null): Promise<World> {
    const made = this.worldFor(world)
    if (keep === null) return made
    const key = `${world}:${keep.join(',')}`
    const kept = this.kept.get(key)
    if (kept !== undefined) return Promise.resolve(kept)
    return made.then((map) => {
      const copy = withPortals(map, keep)
      this.kept.set(key, copy)
      return copy
    })
  }

  /** The world with this id, generated off this thread if it is not already made, so the page keeps drawing. */
  private worldFor(world: number): Promise<World> {
    const made = this.worlds.get(world)
    if (made !== undefined) return made
    const kind = worldKindOf(world)
    this.notice(kind === 'planet' ? `generating island ${planetSeedOf(world)}...` : `generating ${WORLD_TRAITS[kind].name} of island ${planetSeedOf(world)}...`)
    const making = this.source.generate(world)
    this.worlds.set(world, making)
    // One that could not be made is asked for afresh next time.
    making.catch(() => this.worlds.delete(world))
    return making
  }

  /**
   * The world a drive is played on, as the server has it — a race's copy
   * keeping only its course's portals — put on view in place of whatever
   * was there, so what is drawn is the world driven, portals and all.
   */
  private async driveMap(world: number, keep: readonly number[] | null): Promise<World> {
    const map = await this.mapFor(world, keep)
    this.setView(map)
    return map
  }

  /** Put the world with this id behind the screens, to be looked over: the room's preview of it, or a race's first world. */
  private async showPreview(world: number): Promise<void> {
    const stamp = ++this.showing
    if (this.preview !== null && this.preview.world === world) return
    this.screens.room.making(true)
    let map: World
    try {
      map = await this.mapFor(world, null)
    } catch {
      this.screens.room.making(false)
      return
    }
    if (stamp !== this.showing) return
    this.setView(map)
    this.setPreview({ world, mode: this.modes.island(map, this.scene, this.renderer.domElement) })
    this.screens.room.making(false)
  }

  private setView(map: World): void {
    if (this.view !== null && this.map === map) return
    this.map = map
    if (this.view !== null) {
      disposeObject(this.view)
      this.scene.remove(this.view)
    }
    this.view = this.modes.terrainView(map)
    this.scene.add(this.view)
    // View distances ride the planet's size so the framing stays the same.
    const across = 2 * Math.PI * map.radius
    const { fog, skies } = WORLD_LOOKS[map.kind]
    this.scene.fog = new THREE.Fog(skies.day, across * fog.near, across * fog.far)
    // Over the middle of the planet.
    this.sun.centerOn({ x: 0, y: 0, z: 0 })
  }

  private setPreview(next: { world: number; mode: ModeView } | null): void {
    this.preview?.mode.dispose()
    this.preview = next
    if (next === null && this.view !== null) {
      disposeObject(this.view)
      this.scene.remove(this.view)
      this.view = null
    }
    this.resize()
  }

  private clearPreview(): void {
    this.showing += 1
    this.setPreview(null)
  }

  /** Keep a game's thumbnail, letting the oldest go once there are too many. */
  private keepPicture(world: number, canvas: HTMLCanvasElement): void {
    this.pictures.set(world, canvas)
    while (this.pictures.size > THUMBS_KEPT) {
      const oldest = this.pictures.keys().next().value
      if (oldest === undefined) break
      this.pictures.delete(oldest)
    }
  }

  private closeLobby(): void {
    const lobby = this.lobby
    this.lobby = null
    lobby?.close('left')
  }

  /** The lobby connection closed under us: the start screen comes back, and one more connection is tried. */
  private loseLobby(why: string): void {
    this.lobby = null
    this.enterStart(`lost the server (${why})`)
  }

  // -- drawing -------------------------------------------------------------

  /** Whether a race plays behind the screen that is up: behind the start screen, and behind the celebration of a finish. */
  private playsBehind(): boolean {
    return this.screenNow === 'start' || this.screenNow === 'finish'
  }

  private draw(): void {
    if (this.screenNow === 'room' && this.screens.room.open()) {
      this.drawRoom()
      return
    }
    // Back from the room's stages to the whole screen: the views take its shape again.
    if (this.staged) {
      this.staged = false
      this.resize()
    }
    const shown = this.drive?.mode ?? (this.playsBehind() ? (this.watched?.mode ?? null) : (this.preview?.mode ?? null))
    if (shown === null) {
      // With neither drive nor demo behind the celebration, the last frame stays up rather than a blank sky.
      if (this.screenNow === 'finish') return
      this.renderer.render(this.scene, this.sky)
    } else if (shown.render !== undefined) {
      shown.render(this.renderer)
    } else {
      this.renderer.render(shown.scene ?? this.scene, shown.camera)
    }
  }

  /**
   * The room's two stages: the world the player is looking over, turning in
   * the preview's, and the vehicle picked, on its turntable in the modal's,
   * while the modal is open. Each is a viewport of the same renderer,
   * scissored to the box the room leaves for it.
   */
  private drawRoom(): void {
    this.staged = true
    const { clientWidth, clientHeight } = this.container
    // Round the stages, the night of the page, not the sky of whatever was drawn last.
    this.renderer.getClearColor(this.clearWas)
    const alpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(ROOM_DARK, 1)
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, clientWidth, clientHeight)
    this.renderer.clear()
    this.renderer.setClearColor(this.clearWas, alpha)
    const world = this.preview?.mode
    if (world !== undefined) this.drawInto(this.screens.room.worldBox(), world)
    // The turntable is only drawn into the car modal, which is shut until a car is picked there.
    const car = this.screens.room.carBox()
    if (car !== null && this.showroom !== null) this.drawInto(car, this.showroom)
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, clientWidth, clientHeight)
  }

  /** Draw a view into a box of the page, shaped to it, over whatever is drawn round it. */
  private drawInto(box: HTMLElement, view: ModeView): void {
    const rect = box.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    const canvas = this.renderer.domElement.getBoundingClientRect()
    const left = rect.left - canvas.left
    const bottom = canvas.bottom - rect.bottom
    this.renderer.setScissorTest(true)
    this.renderer.setViewport(left, bottom, rect.width, rect.height)
    this.renderer.setScissor(left, bottom, rect.width, rect.height)
    view.resize(rect.width / rect.height)
    if (view.render !== undefined) view.render(this.renderer)
    else this.renderer.render(view.scene ?? this.scene, view.camera)
  }
}

/** What the room is drawn on round its stages: the page's own dark. */
const ROOM_DARK = 0x0b1620

/**
 * Where the start screen's thumbnails come from: a source of its own, so
 * that a picture does not wait behind a world someone is driving.
 */
const PICTURES = new TerrainSource()

/** The real thing. */
export const MODES: ShellModes = {
  terrainView: (map) => createTerrainView(map),
  island: createIslandMode,
  showroom: createShowroomMode,
  picture: (world, pixels) => PICTURES.picture(world, pixels),
  play: createOnlineMode,
  watch: createWatchMode,
}
