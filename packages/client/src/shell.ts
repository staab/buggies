import type { VehicleProfileId } from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import type { HudState } from './hud.ts'
import { LEFT_KEYS, RIGHT_KEYS, SOLO_KEYS } from './keys.ts'
import type { Choice, MenuHost, Step } from './menu.ts'
import type { ModeView } from './mode.ts'
import type { OnlinePlayer } from './online-mode.ts'
import { createShowroomMode, type ShowroomView } from './showroom-mode.ts'
import type { Sun } from './sun.ts'
import { createTeamMode } from './team-mode.ts'
import { createTerrainView } from './terrain-view.ts'

/** The menu, as the shell drives it. */
export interface ShellMenu {
  readonly open: boolean
  show(choice: Choice, step?: Step): void
  hide(): void
  notice(text: string): void
}

/** A HUD, as the shell fills it: one a viewport. */
export interface ShellHud {
  render(state: HudState | null): void
  notice(text: string): void
}

/** Where islands come from. */
export interface IslandSource {
  generate(seed: number): Promise<TerrainMap>
}

/**
 * How the shell makes what it shows. Replaceable, so that the shell's
 * comings and goings can be tested without a GPU, a keyboard or a server.
 */
export interface ShellModes {
  terrainView(map: TerrainMap): THREE.Group
  showroom(sound: Sound): ShowroomView
  play(
    scene: THREE.Scene,
    url: string,
    players: readonly OnlinePlayer[],
    mapFor: (seed: number) => Promise<TerrainMap>,
    sound: Sound,
    sun: Sun,
  ): Promise<ModeView>
}

/** The real thing. */
export const MODES: ShellModes = {
  terrainView: createTerrainView,
  showroom: createShowroomMode,
  play: createTeamMode,
}

export interface ShellDeps {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** What the canvas fills. */
  container: { readonly clientWidth: number; readonly clientHeight: number }
  huds: readonly ShellHud[]
  sound: Sound
  /** The light over the island, and its shadows, which follow the play. */
  sun: Sun
  islands: IslandSource
  /** The game server everyone on this screen joins. */
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
}

/** What is on the screen, for anyone asking. */
export type OnShow = 'game' | 'showroom' | null

/**
 * Whether a choice is the game already being played: the same players in
 * the same vehicles. Any other vehicle means joining again, since the
 * server seats a player in one for good.
 */
export function continues(running: Choice, next: Choice): boolean {
  if (running.mode !== next.mode || running.vehicle !== next.vehicle) return false
  return next.mode === 'solo' || running.vehicle2 === next.vehicle2
}

/** Who a choice puts on the server, on which keys. */
export function playersFor(choice: Choice): OnlinePlayer[] {
  return choice.mode === 'duo'
    ? [
        { profile: choice.vehicle, keys: LEFT_KEYS },
        { profile: choice.vehicle2, keys: RIGHT_KEYS },
      ]
    : [{ profile: choice.vehicle, keys: SOLO_KEYS }]
}

function disposeView(scene: THREE.Scene, group: THREE.Group): void {
  const materials = new Set<THREE.Material>()
  const geometries = new Set<THREE.BufferGeometry>()
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    geometries.add(object.geometry)
    if (Array.isArray(object.material)) object.material.forEach((entry) => materials.add(entry))
    else materials.add(object.material)
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => {
    if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose()
    material.dispose()
  })
  scene.remove(group)
}

/**
 * What is on the screen and why: the vehicle turning while the menu is up,
 * and the game behind it. It keeps the server's island on show, joins and
 * rejoins as the menu asks, and draws whichever of them is in front each
 * frame.
 */
export class Shell implements MenuHost {
  readonly menu: ShellMenu

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly container: ShellDeps['container']
  private readonly huds: readonly ShellHud[]
  private readonly sound: Sound
  private readonly sun: Sun
  private readonly islands: IslandSource
  private readonly server: string
  private readonly modes: ShellModes
  private readonly settle: (choice: Choice) => void

  private choiceNow: Choice
  private map: TerrainMap | null = null
  private view: THREE.Group | null = null
  /** An island on its way, so that two players joining at once do not each make one. */
  private making: { seed: number; island: Promise<TerrainMap> } | null = null
  private game: Game | null = null
  private showroom: ShowroomView | null = null
  /** Each thing asked for outranks the one before: a slow one that lands late is let go. */
  private generation = 0

  constructor(deps: ShellDeps, choice: Choice) {
    this.renderer = deps.renderer
    this.scene = deps.scene
    this.container = deps.container
    this.huds = deps.huds
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
    if (this.menu.open && this.showroom !== null) return 'showroom'
    return this.game !== null ? 'game' : this.showroom !== null ? 'showroom' : null
  }

  /** A line on the HUD and nothing else: what is being waited for. */
  notice(text: string): void {
    this.huds[0]?.notice(text)
  }

  /** Open the menu on its first page, the vehicle that would be driven turning behind it. */
  welcome(): void {
    this.menu.show(this.choiceNow)
    this.showVehicle(this.choiceNow.vehicle)
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
        this.resume()
      }
    } else {
      this.menu.show(this.game?.choice ?? this.choiceNow, this.game === null ? 'mode' : 'car')
    }
  }

  /** Put this vehicle on show, turning on the spot. */
  showVehicle(vehicle: VehicleProfileId): void {
    if (this.showroom === null) {
      this.showroom = this.modes.showroom(this.sound)
      this.resize()
    }
    this.showroom.show(vehicle)
  }

  /**
   * Join the server with everyone on this screen in the vehicles they
   * asked for; or, if that is the game already being played, go back to it.
   */
  async start(next: Choice): Promise<void> {
    const stamp = ++this.generation
    this.choiceNow = next
    this.menu.hide()

    if (this.game !== null && continues(this.game.choice, next)) {
      this.resume()
      return
    }

    this.dropShowroom()
    this.setGame(null)
    this.notice(`connecting to ${this.server}...`)
    try {
      const mode = await this.modes.play(
        this.scene,
        this.server,
        playersFor(next),
        (seed) => this.mapFor(seed),
        this.sound,
        this.sun,
      )
      if (stamp !== this.generation) {
        mode.dispose()
        return
      }
      this.setGame({ mode, choice: next })
      this.settle(next)
    } catch (error: unknown) {
      if (stamp !== this.generation) return
      const why = error instanceof Error ? error.message : String(error)
      this.menu.show(this.choiceNow)
      this.menu.notice(`could not join ${this.server}: ${why}`)
    }
  }

  /** Go back to the game behind the menu. */
  resume(): void {
    const { game } = this
    if (game === null) return
    this.generation += 1
    this.choiceNow = game.choice
    this.dropShowroom()
    this.settle(game.choice)
  }

  resize(): void {
    const { clientWidth, clientHeight } = this.container
    this.renderer.setSize(clientWidth, clientHeight, false)
    const aspect = clientWidth / Math.max(clientHeight, 1)
    this.game?.mode.resize(aspect)
    this.showroom?.resize(aspect)
  }

  /**
   * One frame. The game keeps its clock behind the menu, driven or not: the
   * server does not wait. What is drawn is the showroom if the menu has put
   * it up, else the game, and the HUDs say what the game says unless the
   * menu is up, which speaks for itself.
   */
  frame(dt: number): void {
    const { menu, game, showroom } = this
    game?.mode.update(dt, !menu.open)
    if (menu.open) showroom?.update(dt, false)
    const shown: ModeView | null = menu.open && showroom !== null ? showroom : (game?.mode ?? showroom)
    if (shown !== null) {
      if (shown.render) shown.render(this.renderer)
      else this.renderer.render(shown.scene ?? this.scene, shown.camera)
    }
    const states = menu.open || game === null ? [] : game.mode.hud()
    if (menu.open || game !== null) this.huds.forEach((hud, viewport) => hud.render(states[viewport] ?? null))
  }

  /**
   * The map with this seed, generated only if it is not already the one on
   * show, and only once however many ask for it at the same time: switching
   * vehicles on one island should not cost seconds of terrain generation.
   * Generation runs off this thread, so the page keeps drawing and says
   * what it is waiting for.
   */
  private mapFor(seed: number): Promise<TerrainMap> {
    if (this.map !== null && this.map.seed === seed) return Promise.resolve(this.map)
    if (this.making !== null && this.making.seed === seed) return this.making.island
    this.notice(`generating island ${seed}...`)
    const island = this.islands.generate(seed).then((made) => {
      if (this.making?.island === island) this.making = null
      if (this.view) disposeView(this.scene, this.view)
      this.map = made
      this.view = this.modes.terrainView(made)
      this.scene.add(this.view)
      // View distances ride the world scale so the framing stays the same.
      const worldSize = made.size * made.cellSize
      this.scene.fog = new THREE.Fog('#a9cbe6', worldSize * 0.65, worldSize * 2.34)
      this.sun.centreOn({ x: worldSize / 2, y: 0, z: worldSize / 2 })
      return made
    })
    this.making = { seed, island }
    return island
  }

  private dropShowroom(): void {
    this.showroom?.dispose()
    this.showroom = null
  }

  private setGame(next: Game | null): void {
    this.game?.mode.dispose()
    this.game = next
    this.resize()
  }
}
