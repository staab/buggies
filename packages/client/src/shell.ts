import type { VehicleProfileId } from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import { createDriveMode, type Player } from './drive-mode.ts'
import { LEFT_KEYS, RIGHT_KEYS, SOLO_KEYS } from './driver.ts'
import type { HudState } from './hud.ts'
import { createIslandMode, islandSummary } from './island-mode.ts'
import type { Choice, MenuHost, Step } from './menu.ts'
import type { ModeView } from './mode.ts'
import { createOnlineMode } from './online-mode.ts'
import { createShowroomMode, type ShowroomView } from './showroom-mode.ts'
import { createTerrainView } from './terrain-view.ts'

/** The menu, as the shell drives it. */
export interface ShellMenu {
  readonly open: boolean
  show(choice: Choice, step?: Step): void
  hide(): void
  notice(text: string, busy?: boolean): void
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
  island(map: TerrainMap, scene: THREE.Scene, surface: HTMLElement): ModeView
  showroom(sound: Sound): ShowroomView
  drive(map: TerrainMap, scene: THREE.Scene, players: readonly Player[], sound: Sound): ModeView
  online(
    scene: THREE.Scene,
    url: string,
    profile: VehicleProfileId,
    mapFor: (seed: number) => Promise<TerrainMap>,
    sound: Sound,
  ): Promise<ModeView>
}

/** The real thing. */
export const MODES: ShellModes = {
  terrainView: createTerrainView,
  island: createIslandMode,
  showroom: createShowroomMode,
  drive: createDriveMode,
  online: createOnlineMode,
}

export interface ShellDeps {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** What the canvas fills. */
  container: { readonly clientWidth: number; readonly clientHeight: number }
  huds: readonly ShellHud[]
  sound: Sound
  islands: IslandSource
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

/** What the menu puts up over the game while something is chosen. */
type Backdrop = { kind: 'island'; seed: number; mode: ModeView } | { kind: 'showroom'; mode: ShowroomView }

/** What is on the screen, for anyone asking. */
export type OnShow = 'game' | 'island' | 'showroom' | null

/**
 * Whether a choice is the game already being played, give or take the
 * vehicle: the same island, or the same server. Online, a different vehicle
 * means joining again, since the server seats a player in one for good.
 */
export function continues(running: Choice, next: Choice): boolean {
  if (running.mode !== next.mode) return false
  return next.mode === 'online'
    ? running.server === next.server && running.vehicle === next.vehicle
    : running.seed === next.seed
}

/** Who a choice puts on the island, on which keys. */
export function playersFor(choice: Choice): Player[] {
  return choice.mode === 'split'
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
 * What is on the screen and why: the island being looked over or the
 * vehicle turning while the menu is up, and the game behind them. It keeps
 * the island of the seed on show, starts and swaps games as the menu asks,
 * and draws whichever of them is in front each frame.
 */
export class Shell implements MenuHost {
  readonly menu: ShellMenu

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly container: ShellDeps['container']
  private readonly huds: readonly ShellHud[]
  private readonly sound: Sound
  private readonly islands: IslandSource
  private readonly modes: ShellModes
  private readonly settle: (choice: Choice) => void

  private choiceNow: Choice
  private map: TerrainMap | null = null
  private view: THREE.Group | null = null
  private game: Game | null = null
  private backdrop: Backdrop | null = null
  /** Each thing asked for outranks the one before: a slow one that lands late is let go. */
  private generation = 0

  constructor(deps: ShellDeps, choice: Choice) {
    this.renderer = deps.renderer
    this.scene = deps.scene
    this.container = deps.container
    this.huds = deps.huds
    this.sound = deps.sound
    this.islands = deps.islands
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
    this.huds[0]?.notice(text)
  }

  /** Open the menu on its first page with the island that would be driven behind it. */
  welcome(): void {
    this.menu.show(this.choiceNow)
    this.menu.notice(`generating island ${this.choiceNow.seed}...`, true)
    void this.showIsland(this.choiceNow.seed).then((about) => {
      if (about) this.menu.notice(about)
    })
  }

  /**
   * The Escape key. From a game, the menu opens on the vehicle page, to swap
   * and carry on; closed again, the game goes on. With no game behind it,
   * the menu stays up.
   */
  toggleMenu(): void {
    if (this.menu.open) {
      if (this.game !== null) {
        this.menu.hide()
        void this.resume()
      }
    } else {
      this.menu.show(this.game?.choice ?? this.choiceNow, this.game === null ? 'mode' : 'car')
    }
  }

  /** Put the island with this seed on show, to be looked over, and say what it is like. */
  async showIsland(seed: number): Promise<string> {
    const stamp = ++this.generation
    this.choiceNow = { ...this.choiceNow, seed }
    if (this.backdrop?.kind === 'island' && this.backdrop.seed === seed && this.map !== null) {
      return islandSummary(this.map)
    }
    const island = await this.mapFor(seed)
    // Something else may have been asked for while the island was being made.
    if (stamp !== this.generation) return ''
    this.setBackdrop({
      kind: 'island',
      seed,
      mode: this.modes.island(island, this.scene, this.renderer.domElement),
    })
    return islandSummary(island)
  }

  /** Put this vehicle on show, turning on the spot. */
  showVehicle(vehicle: VehicleProfileId): void {
    this.generation += 1
    this.choiceNow = { ...this.choiceNow, vehicle }
    if (this.backdrop?.kind !== 'showroom') {
      this.setBackdrop({ kind: 'showroom', mode: this.modes.showroom(this.sound) })
    }
    if (this.backdrop?.kind === 'showroom') this.backdrop.mode.show(vehicle)
  }

  /**
   * Put the player on the map they asked for, in the mode they asked for;
   * or, if that is the game they are already playing, just in the vehicle.
   */
  async start(next: Choice): Promise<void> {
    const stamp = ++this.generation
    this.choiceNow = next
    const { game } = this

    if (game !== null && continues(game.choice, next)) {
      if (next.mode !== 'online') {
        await this.mapFor(next.seed)
        if (stamp !== this.generation) return
      }
      if (game.choice.vehicle !== next.vehicle) game.mode.setVehicle?.(next.vehicle, 0)
      if (next.mode === 'split' && game.choice.vehicle2 !== next.vehicle2) game.mode.setVehicle?.(next.vehicle2, 1)
      game.choice = next
      this.setBackdrop(null)
      this.settle(next)
      return
    }

    this.setBackdrop(null)
    this.setGame(null)

    if (next.mode === 'online') {
      this.notice(`connecting to ${next.server}...`)
      try {
        const online = await this.modes.online(
          this.scene,
          next.server,
          next.vehicle,
          (seed) => {
            this.choiceNow = { ...this.choiceNow, seed }
            return this.mapFor(seed)
          },
          this.sound,
        )
        if (stamp !== this.generation) {
          online.dispose()
          return
        }
        const played = { ...next, seed: this.choiceNow.seed }
        this.setGame({ mode: online, choice: played })
        this.settle(played)
      } catch (error: unknown) {
        if (stamp !== this.generation) return
        const why = error instanceof Error ? error.message : String(error)
        this.menu.show(this.choiceNow)
        this.menu.notice(`could not join ${next.server}: ${why}`)
      }
      return
    }

    const island = await this.mapFor(next.seed)
    // A newer choice may have landed while the island was being made.
    if (stamp !== this.generation) return
    this.setGame({ mode: this.modes.drive(island, this.scene, playersFor(next), this.sound), choice: next })
    this.settle(next)
  }

  /**
   * Go back to the game behind the menu, with the island it is played on
   * back in view: choosing another one to look at will have taken it down.
   */
  async resume(): Promise<void> {
    const { game } = this
    if (game === null) return
    const stamp = ++this.generation
    this.choiceNow = game.choice
    if (game.choice.mode !== 'online') {
      await this.mapFor(game.choice.seed)
      if (stamp !== this.generation) return
    }
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
   * One frame. The game keeps its clock behind the menu, driven or not:
   * online, the server does not wait. What is drawn is whatever the menu
   * has put up over it, if anything, and the HUDs say what the game says
   * unless the menu is up, which speaks for itself.
   */
  frame(dt: number): void {
    const { menu, game, backdrop } = this
    game?.mode.update(dt, !menu.open)
    if (menu.open) backdrop?.mode.update(dt, false)
    const shown = menu.open && backdrop !== null ? backdrop.mode : (game?.mode ?? null)
    if (shown !== null) {
      if (shown.render) shown.render(this.renderer)
      else this.renderer.render(shown.scene ?? this.scene, shown.camera)
    }
    const states = menu.open || game === null ? [] : game.mode.hud()
    if (menu.open || game !== null) this.huds.forEach((hud, viewport) => hud.render(states[viewport] ?? null))
  }

  /**
   * The map with this seed, generated only if it is not already the one on
   * show: switching modes on one island should not cost seconds of terrain
   * generation. Generation runs off this thread, so the page keeps drawing
   * and says what it is waiting for.
   */
  private async mapFor(seed: number): Promise<TerrainMap> {
    if (this.map !== null && this.map.seed === seed) return this.map
    this.notice(`generating island ${seed}...`)
    const island = await this.islands.generate(seed)
    if (this.view) disposeView(this.scene, this.view)
    this.map = island
    this.view = this.modes.terrainView(island)
    this.scene.add(this.view)
    // View distances ride the world scale so the framing stays the same.
    const worldSize = island.size * island.cellSize
    this.scene.fog = new THREE.Fog('#a9cbe6', worldSize * 0.65, worldSize * 2.34)
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
