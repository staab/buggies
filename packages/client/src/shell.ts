import { portalLink, type VehicleProfileId } from '@buggies/game'
import { ConnectionFailure, NO_ARRIVAL, REJECT_PROTOCOL_MISMATCH, fetchPeek, fetchRooms, type IslandMark, type RoomSummary } from '@buggies/net'
import { isMoon, planetSeedOf, type World } from '@buggies/terrain'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import { disposeObject } from './dispose.ts'
import type { HudState } from './hud.ts'
import { createIslandMode, islandSummary } from './island-mode.ts'
import type { Choice, MenuHost, Step } from './menu.ts'
import type { ModeView } from './mode.ts'
import { createOnlineMode } from './online-mode.ts'
import { createShowroomMode, type ShowroomView } from './showroom-mode.ts'
import type { Sun } from './sun.ts'
import { createTerrainView, moveBoats, moveClouds } from './terrain-view.ts'
import { WebSocketClientTransport } from './ws-transport.ts'

/** How long to wait before trying to rejoin again, after each try that fails: longer each time, up to the last. */
const REJOIN_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The menu, as the shell drives it. */
export interface ShellMenu {
  readonly open: boolean
  show(choice: Choice, step?: Step): void
  hide(): void
  notice(text: string, busy?: boolean): void
}

/** The HUD, as the shell fills it. */
export interface ShellHud {
  render(state: HudState | null): void
  notice(text: string): void
}

/** Where islands come from. */
export interface IslandSource {
  generate(seed: number): Promise<World>
}

/**
 * How the shell makes what it shows. Replaceable, so that the shell's
 * comings and goings can be tested without a GPU, a keyboard or a server.
 */
export interface ShellModes {
  terrainView(map: World): THREE.Group
  island(map: World, scene: THREE.Scene, surface: HTMLElement): ModeView
  showroom(sound: Sound): ShowroomView
  /** Which islands on the server have people on them, busiest first. */
  rooms(url: string): Promise<RoomSummary[]>
  /** Where everyone and everything is on one island on the server. */
  peek(url: string, seed: number): Promise<IslandMark[]>
  play(
    scene: THREE.Scene,
    url: string,
    seed: number,
    profile: VehicleProfileId,
    mapFor: (seed: number) => Promise<World>,
    sound: Sound,
    sun: Sun,
    arrival?: number,
    pass?: number,
  ): Promise<ModeView>
}

/** The real thing. */
export const MODES: ShellModes = {
  terrainView: (map) => createTerrainView(map),
  island: createIslandMode,
  showroom: createShowroomMode,
  rooms: (url) => fetchRooms(new WebSocketClientTransport(url)),
  peek: (url, seed) => fetchPeek(new WebSocketClientTransport(url), seed),
  play: createOnlineMode,
}

export interface ShellDeps {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** What the canvas fills. */
  container: { readonly clientWidth: number; readonly clientHeight: number }
  hud: ShellHud
  sound: Sound
  /** The light over the island, and its shadows, which follow the play. */
  sun: Sun
  islands: IslandSource
  /** The game server the player joins. */
  server: string
  /** The menu, made with the shell as its host. */
  createMenu: (host: MenuHost, choice: Choice) => ShellMenu
  modes?: ShellModes
  /** Where the choice being played is reflected: the address bar. */
  settle?: (choice: Choice) => void
}

/** The game being played, and what it was set off with. */
interface Game {
  mode: ModeView
  choice: Choice
  /** Which world is being played: the chosen planet, or its moon, gone to through a portal. */
  world: number
}

/** What the menu puts up over the game while something is chosen. */
type Backdrop = { kind: 'island'; seed: number; mode: ModeView } | { kind: 'showroom'; mode: ShowroomView }

/** What is on the screen, for anyone asking. */
export type OnShow = 'game' | 'island' | 'showroom' | null

/** Whether a choice is the game already being played: the same island, in the same vehicle. */
export function continues(running: Choice, next: Choice): boolean {
  return sameSeats(running, next) && running.vehicle === next.vehicle
}

/**
 * Whether a choice keeps the player in the seat they have: the same
 * island. The vehicle is swapped where the car is; another island means
 * joining again.
 */
export function sameSeats(running: Choice, next: Choice): boolean {
  return running.seed === next.seed
}

function disposeView(scene: THREE.Scene, group: THREE.Group): void {
  disposeObject(group)
  scene.remove(group)
}

/**
 * What is on the screen and why: the island being looked over or the
 * vehicle turning while the menu is up, and the game behind them. It keeps
 * the island of the seed on show, joins and rejoins as the menu asks, and
 * draws whichever of them is in front each frame.
 */
export class Shell implements MenuHost {
  readonly menu: ShellMenu

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly container: ShellDeps['container']
  private readonly hud: ShellHud
  private readonly sound: Sound
  private readonly sun: Sun
  private readonly islands: IslandSource
  private readonly server: string
  private readonly modes: ShellModes
  private readonly settle: (choice: Choice) => void

  private choiceNow: Choice
  private map: World | null = null
  private view: THREE.Group | null = null
  /** Seconds the screen has run, for what keeps time with no game on. */
  private idle = 0
  /** The planet's portal the moon was gone to by, to come back out of. */
  private cameFrom = 0
  /** An island on its way, so that two asking for it at once do not each make one. */
  private making: { seed: number; island: Promise<World> } | null = null
  private game: Game | null = null
  private backdrop: Backdrop | null = null
  /** Each thing asked for outranks the one before: a slow one that lands late is let go. */
  private generation = 0

  constructor(deps: ShellDeps, choice: Choice) {
    this.renderer = deps.renderer
    this.scene = deps.scene
    this.container = deps.container
    this.hud = deps.hud
    this.sound = deps.sound
    this.sun = deps.sun
    this.islands = deps.islands
    this.server = deps.server
    this.modes = deps.modes ?? MODES
    this.settle = deps.settle ?? (() => {})
    this.choiceNow = choice
    this.menu = deps.createMenu(this, choice)
  }

  /** What the player last chose, or is choosing. */
  get choice(): Choice {
    return this.choiceNow
  }

  get playing(): boolean {
    return this.game !== null
  }

  get onShow(): OnShow {
    if (this.menu.open && this.backdrop !== null) return this.backdrop.kind
    return this.game !== null ? 'game' : (this.backdrop?.kind ?? null)
  }

  /** A line on the HUD and nothing else: what is being waited for. */
  notice(text: string): void {
    this.hud.notice(text)
  }

  /** A panel over the game, such as the games panel: while it is open, no one is driving. */
  overlay: { readonly open: boolean } = { open: false }

  /** The game being played, if any. */
  get played(): ModeView | null {
    return this.game?.mode ?? null
  }

  /** Open the menu on its first page, with the island that would be driven coming up behind it. */
  welcome(): void {
    this.menu.show(this.choiceNow)
    void this.showIsland(this.choiceNow.seed)
  }

  /**
   * The Escape key. From a game, the menu opens on the vehicle page, to swap
   * and rejoin; closed again, the game goes on. With no game behind it, the
   * menu stays up.
   */
  toggleMenu(): void {
    if (this.menu.open) {
      if (this.game !== null) {
        this.menu.hide()
        void this.resume()
      }
    } else {
      this.menu.show(this.game?.choice ?? this.choiceNow, this.game === null ? 'map' : 'car')
    }
  }

  /** Put the island with this seed on show, to be looked over, and say what it is like. The address bar names it as soon as it is picked. */
  async showIsland(seed: number): Promise<string> {
    const stamp = ++this.generation
    this.choiceNow = { ...this.choiceNow, seed }
    this.settle(this.choiceNow)
    if (this.backdrop?.kind === 'island' && this.backdrop.seed === seed && this.map !== null) {
      return islandSummary(this.map)
    }
    const island = await this.mapFor(seed)
    // Something else may have been asked for while the island was being made.
    if (stamp !== this.generation) return ''
    this.setBackdrop({ kind: 'island', seed, mode: this.modes.island(island, this.scene, this.renderer.domElement) })
    return islandSummary(island)
  }

  /** Which islands have people on them, busiest first; none if the server cannot say. */
  listRooms(): Promise<RoomSummary[]> {
    return this.modes.rooms(this.server).catch(() => [])
  }

  /** Show who and what is on the island being looked over, if it is still the one asked after. */
  async peekIsland(seed: number): Promise<void> {
    const marks = await this.modes.peek(this.server, seed).catch(() => [])
    const { backdrop } = this
    if (backdrop?.kind === 'island' && backdrop.seed === seed) backdrop.mode.showMarks?.(marks)
  }

  /** Put this vehicle on show, turning on the spot. */
  showVehicle(vehicle: VehicleProfileId): void {
    this.generation += 1
    this.choiceNow = { ...this.choiceNow, vehicle }
    if (this.backdrop?.kind !== 'showroom') this.setBackdrop({ kind: 'showroom', mode: this.modes.showroom(this.sound) })
    if (this.backdrop?.kind === 'showroom') this.backdrop.mode.show(vehicle)
  }

  /**
   * Join the server's room for the island in
   * the vehicles they asked for; or, if that is the game already being
   * played, go back to it.
   */
  async start(next: Choice): Promise<void> {
    const stamp = ++this.generation
    this.choiceNow = next
    this.menu.hide()

    if (this.game !== null && continues(this.game.choice, next)) {
      await this.resume()
      return
    }
    const { game } = this
    if (game?.mode.changeVehicle !== undefined && sameSeats(game.choice, next)) {
      game.mode.changeVehicle(next.vehicle)
      game.choice = next
      await this.resume()
      return
    }

    this.setBackdrop(null)
    this.setGame(null)
    this.notice('connecting...')
    try {
      const mode = await this.modes.play(
        this.scene,
        this.server,
        next.seed,
        next.vehicle,
        (seed) => this.mapFor(seed),
        this.sound,
        this.sun,
      )
      if (stamp !== this.generation) {
        mode.dispose()
        return
      }
      this.setGame({ mode, choice: next, world: next.seed })
    } catch (error: unknown) {
      if (stamp !== this.generation) return
      const why = error instanceof Error ? error.message : String(error)
      this.menu.show(this.choiceNow)
      this.menu.notice(`Could not join ${this.server}: ${why}`)
    }
  }

  /**
   * Take the player through a portal: from a planet to its
   * moon, or from the moon back to the planet, out of the portal they left
   * it by. They join the room for the world on the other side, in the
   * vehicles they are in.
   */
  private async travel(through: number): Promise<void> {
    const { game, map } = this
    if (game === null || map === null || map.seed !== game.world) return
    const link = portalLink(map, this.cameFrom)
    if (!isMoon(map.seed)) this.cameFrom = through
    const stamp = ++this.generation
    // Taken before the game is let go, so that what the car holds goes through with it.
    const pass = game.mode.pass?.()
    this.setGame(null)
    this.notice(isMoon(link.to) ? 'through the portal to the moon...' : 'back through the portal...')
    try {
      const mode = await this.modes.play(this.scene, this.server, link.to, game.choice.vehicle, (seed) => this.mapFor(seed), this.sound, this.sun, link.arrival, pass)
      if (stamp !== this.generation) {
        mode.dispose()
        return
      }
      this.setGame({ mode, choice: game.choice, world: link.to })
    } catch (error: unknown) {
      if (stamp !== this.generation) return
      const why = error instanceof Error ? error.message : String(error)
      this.menu.show(this.choiceNow)
      this.menu.notice(`Could not go through the portal: ${why}`)
    }
  }

  /**
   * Join the world being played again, in the
   * vehicles they were in, after the connection to the server was lost:
   * back where they were, with what they held, if the server still has it.
   * Tried until it works, or something else is asked for, or the server
   * has moved on to a version this page does not speak.
   */
  private async rejoin(why: string): Promise<void> {
    const { game } = this
    if (game === null) return
    const stamp = ++this.generation
    const pass = game.mode.pass?.()
    this.setGame(null)
    for (let attempt = 0; ; attempt++) {
      this.notice(`lost the server (${why}), reconnecting...`)
      try {
        const mode = await this.modes.play(this.scene, this.server, game.world, game.choice.vehicle, (seed) => this.mapFor(seed), this.sound, this.sun, NO_ARRIVAL, pass)
        if (stamp !== this.generation) {
          mode.dispose()
          return
        }
        this.setGame({ mode, choice: game.choice, world: game.world })
        return
      } catch (error: unknown) {
        if (stamp !== this.generation) return
        if (error instanceof ConnectionFailure && error.reject === REJECT_PROTOCOL_MISMATCH) {
          this.menu.show(this.choiceNow)
          this.menu.notice('The server has been updated: reload the page to play on.')
          return
        }
        why = error instanceof Error ? error.message : String(error)
      }
      await wait(REJOIN_DELAYS_MS[Math.min(attempt, REJOIN_DELAYS_MS.length - 1)]!)
      if (stamp !== this.generation) return
    }
  }

  /**
   * Go back to the game behind the menu, with the island it is played on
   * back in view: looking over another one will have taken it down.
   */
  async resume(): Promise<void> {
    const { game } = this
    if (game === null) return
    const stamp = ++this.generation
    this.choiceNow = game.choice
    await this.mapFor(game.world)
    if (stamp !== this.generation) return
    this.setBackdrop(null)
    this.settle(game.choice)
  }

  resize(): void {
    const { clientWidth, clientHeight } = this.container
    this.renderer.setSize(clientWidth, clientHeight, false)
    const aspect = clientWidth / Math.max(clientHeight, 1)
    this.game?.mode.resize(aspect)
    this.backdrop?.mode.resize(aspect)
  }

  /**
   * One frame. The game keeps its clock behind the menu, driven or not: the
   * server does not wait. What is drawn is whatever the menu has put up
   * over it, if anything, and the HUDs say what the game says unless the
   * menu is up, which speaks for itself.
   */
  frame(dt: number): void {
    const { menu, game, backdrop } = this
    game?.mode.update(dt, !menu.open && !this.overlay.open)
    // Through a portal, the player goes over to the world it leads to.
    const through = game?.mode.portal?.() ?? -1
    if (through >= 0) void this.travel(through)
    // Cut off from the server, the player joins again.
    const lost = game?.mode.lost?.() ?? null
    if (lost !== null && this.game === game) void this.rejoin(lost)
    if (menu.open) backdrop?.mode.update(dt, false)
    // The island's clocks keep the game's time.
    if (this.view !== null) {
      this.view.userData.tick = game?.mode.tick ?? null
      // The boats by the game's time where there is one, to be where the game has them; by the screen's otherwise.
      this.idle += dt
      const seconds = game?.mode.tick === undefined ? this.idle : game.mode.tick / 60
      moveBoats(this.view, seconds)
      moveClouds(this.view, seconds)
      // The planet turns under the sun by the game's time, and the sky is as the day is over the whole of it, until a view says where the play is.
      this.sun.turn(seconds)
      this.sun.shade(this.scene, this.map?.kind === 'moon')
    }
    const shown = menu.open && backdrop !== null ? backdrop.mode : (game?.mode ?? backdrop?.mode ?? null)
    if (shown !== null) {
      if (shown.render) shown.render(this.renderer)
      else this.renderer.render(shown.scene ?? this.scene, shown.camera)
    }
    if (menu.open || game !== null) this.hud.render(menu.open ? null : (game?.mode.hud?.() ?? null))
  }

  /**
   * The map with this seed, generated only if it is not already the one on
   * show, and only once however many ask for it at the same time: switching
   * vehicles on one island should not cost seconds of terrain generation.
   * Generation runs off this thread, so the page keeps drawing and says
   * what it is waiting for.
   */
  private mapFor(seed: number): Promise<World> {
    if (this.map !== null && this.map.seed === seed) return Promise.resolve(this.map)
    if (this.making !== null && this.making.seed === seed) return this.making.island
    this.notice(isMoon(seed) ? `generating the moon of island ${planetSeedOf(seed)}...` : `generating island ${seed}...`)
    const island = this.islands.generate(seed).then((made) => {
      if (this.making?.island === island) this.making = null
      if (this.view) disposeView(this.scene, this.view)
      this.map = made
      this.view = this.modes.terrainView(made)
      this.scene.add(this.view)
      // View distances ride the planet's size so the framing stays the same.
      const across = 2 * Math.PI * made.radius
      this.scene.fog = new THREE.Fog('#a9cbe6', across * 0.65, across * 2.34)
      // Over the middle of the planet.
      this.sun.centerOn({ x: 0, y: 0, z: 0 })
      return made
    })
    this.making = { seed, island }
    return island
  }

  private setBackdrop(next: Backdrop | null): void {
    this.backdrop?.mode.dispose()
    this.backdrop = next
    this.resize()
  }

  private setGame(next: Game | null): void {
    this.game?.mode.dispose()
    this.game = next
    this.resize()
  }
}
