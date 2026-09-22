import {
  DEFAULT_VEHICLE_PROFILE,
  VEHICLE_PROFILE_IDS,
  initPhysics,
  type VehicleProfileId,
} from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import { loadCarModels } from './car-model.ts'
import { createDriveMode } from './drive-mode.ts'
import { LEFT_KEYS, RIGHT_KEYS, SOLO_KEYS } from './driver.ts'
import { Hud } from './hud.ts'
import { createIslandMode, islandSummary } from './island-mode.ts'
import { Menu, type Choice, type Mode } from './menu.ts'
import type { ModeView } from './mode.ts'
import { createOnlineMode } from './online-mode.ts'
import { createShowroomMode, type ShowroomView } from './showroom-mode.ts'
import { TerrainSource } from './terrain-source.ts'
import { createTerrainView } from './terrain-view.ts'

const container = document.getElementById('app')!
/** One HUD a viewport: the left, or only, and the right of a split screen. */
const huds = [new Hud(document.getElementById('hud')!), new Hud(document.getElementById('hud-right')!)]
const hud = huds[0]!
const menuElement = document.getElementById('menu')!

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
container.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#a9cbe6')
scene.add(new THREE.HemisphereLight('#cfe6ff', '#4a5a3a', 0.9))
const sun = new THREE.DirectionalLight('#fff4e0', 1.6)
sun.position.set(-300, 500, 200)
scene.add(sun)

let map: TerrainMap | null = null
let view: THREE.Group | null = null
const terrain = new TerrainSource()

/** The game being played, and what it was set off with. */
interface Game {
  mode: ModeView
  choice: Choice
}

/** What the menu puts up over the game while something is chosen. */
type Backdrop = { kind: 'island'; seed: number; mode: ModeView } | { kind: 'showroom'; mode: ShowroomView }

let game: Game | null = null
let backdrop: Backdrop | null = null

function setBackdrop(next: Backdrop | null): void {
  backdrop?.mode.dispose()
  backdrop = next
  resize()
}

function setGame(next: Game | null): void {
  game?.mode.dispose()
  game = next
  resize()
}

function disposeView(group: THREE.Group): void {
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
 * The map with this seed, generated only if it is not already the one on
 * show: switching modes on one island should not cost seconds of terrain
 * generation. Generation runs off this thread, so the page keeps drawing
 * and says what it is waiting for.
 */
async function mapFor(seed: number): Promise<TerrainMap> {
  if (map !== null && map.seed === seed) return map
  hud.notice(`generating island ${seed}...`)
  const island = await terrain.generate(seed)
  if (view) disposeView(view)
  map = island
  view = createTerrainView(map)
  scene.add(view)

  // View distances ride the world scale so the framing stays the same.
  const worldSize = map.size * map.cellSize
  scene.fog = new THREE.Fog('#a9cbe6', worldSize * 0.65, worldSize * 2.34)
  return map
}

function randomSeed(): number {
  return Math.floor(Math.random() * 100000)
}

/** The game server this page was served next to, unless told otherwise. */
function defaultServer(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.hostname || 'localhost'}:8787`
}

function readChoice(): Choice {
  const params = new URLSearchParams(location.search)
  const seed = Number(params.get('seed'))
  const requested = params.get('mode')
  const mode: Mode = requested === 'online' || requested === 'split' ? requested : 'drive'
  const profile = (name: string, fallback: VehicleProfileId): VehicleProfileId => {
    const given = params.get(name)
    return VEHICLE_PROFILE_IDS.includes(given as VehicleProfileId) ? (given as VehicleProfileId) : fallback
  }
  return {
    mode,
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : randomSeed(),
    vehicle: profile('vehicle', DEFAULT_VEHICLE_PROFILE),
    vehicle2: profile('vehicle2', VEHICLE_PROFILE_IDS[1] ?? DEFAULT_VEHICLE_PROFILE),
    server: params.get('server') ?? defaultServer(),
  }
}

let choice = readChoice()

/** Each thing asked for outranks the one before: a slow one that lands late is let go. */
let generation = 0

/** Reflect what is being played in the address bar. */
function settle(): void {
  const online = choice.mode === 'online'
  const url = online
    ? `?mode=online&server=${encodeURIComponent(choice.server)}&vehicle=${choice.vehicle}`
    : `?mode=${choice.mode}&seed=${choice.seed}&vehicle=${choice.vehicle}` +
      (choice.mode === 'split' ? `&vehicle2=${choice.vehicle2}` : '')
  history.replaceState(null, '', url)
}

/** Put the island with this seed on show, to be looked over, and say what it is like. */
async function showIsland(seed: number): Promise<string> {
  const stamp = ++generation
  choice = { ...choice, seed }
  if (backdrop?.kind === 'island' && backdrop.seed === seed && map !== null) return islandSummary(map)
  const island = await mapFor(seed)
  // Something else may have been asked for while the island was being made.
  if (stamp !== generation) return ''
  setBackdrop({ kind: 'island', seed, mode: createIslandMode(island, scene, renderer.domElement) })
  return islandSummary(island)
}

/** Put this vehicle on show, turning on the spot. */
function showVehicle(vehicle: VehicleProfileId): void {
  generation += 1
  choice = { ...choice, vehicle }
  if (backdrop?.kind !== 'showroom') setBackdrop({ kind: 'showroom', mode: createShowroomMode() })
  if (backdrop?.kind === 'showroom') backdrop.mode.show(vehicle)
}

/**
 * Whether a choice is the game already being played, give or take the
 * vehicle: the same island, or the same server. Online, a different vehicle
 * means joining again, since the server seats a player in one for good.
 */
function continues(running: Choice, next: Choice): boolean {
  if (running.mode !== next.mode) return false
  return next.mode === 'online'
    ? running.server === next.server && running.vehicle === next.vehicle
    : running.seed === next.seed
}

/**
 * Go back to the game behind the menu, with the island it is played on
 * back in view: choosing another one to look at will have taken it down.
 */
async function resume(): Promise<void> {
  if (game === null) return
  const stamp = ++generation
  choice = game.choice
  if (game.choice.mode !== 'online') {
    await mapFor(game.choice.seed)
    if (stamp !== generation) return
  }
  setBackdrop(null)
  settle()
}

/**
 * Put the player on the map they asked for, in the mode they asked for; or,
 * if that is the game they are already playing, just in the vehicle.
 */
async function start(next: Choice): Promise<void> {
  const stamp = ++generation
  choice = next

  if (game !== null && continues(game.choice, next)) {
    if (next.mode !== 'online') {
      await mapFor(next.seed)
      if (stamp !== generation) return
    }
    if (game.choice.vehicle !== next.vehicle) game.mode.setVehicle?.(next.vehicle, 0)
    if (next.mode === 'split' && game.choice.vehicle2 !== next.vehicle2) game.mode.setVehicle?.(next.vehicle2, 1)
    game.choice = next
    setBackdrop(null)
    settle()
    return
  }

  setBackdrop(null)
  setGame(null)

  if (next.mode === 'online') {
    hud.notice(`connecting to ${next.server}...`)
    createOnlineMode(scene, next.server, next.vehicle, (seed) => {
      choice = { ...choice, seed }
      return mapFor(seed)
    }).then(
      (online) => {
        if (stamp !== generation) {
          online.dispose()
          return
        }
        setGame({ mode: online, choice: { ...next, seed: choice.seed } })
        settle()
      },
      (error: unknown) => {
        if (stamp !== generation) return
        const why = error instanceof Error ? error.message : String(error)
        menu.show(choice)
        menu.notice(`could not join ${next.server}: ${why}`)
      },
    )
    return
  }

  const island = await mapFor(next.seed)
  // A newer choice may have landed while the island was being made.
  if (stamp !== generation) return
  const players =
    next.mode === 'split'
      ? [
          { profile: next.vehicle, keys: LEFT_KEYS },
          { profile: next.vehicle2, keys: RIGHT_KEYS },
        ]
      : [{ profile: next.vehicle, keys: SOLO_KEYS }]
  setGame({ mode: createDriveMode(island, scene, players), choice: next })
  settle()
}

const menu = new Menu(menuElement, choice, { showIsland, showVehicle, start })

// The physics engine is a wasm module, so it has to be ready before anything
// can be driven. It loads in well under a frame, and getting it out of the way
// up front beats a loading state in the middle of a session. The vehicles'
// models come in alongside it: every one of them, since online anyone may
// turn up in any of them.
hud.notice('loading...')
await Promise.all([initPhysics(), loadCarModels()])
menu.show(choice)
// Something to look at behind the first page: the island that would be driven.
menu.notice(`generating island ${choice.seed}...`)
void showIsland(choice.seed).then((about) => {
  if (about) menu.notice(about)
})

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  // From a game, the menu opens on the vehicle page, to swap and carry on;
  // closed again, the game goes on. With no game behind it, it stays up.
  if (menu.open) {
    if (game !== null) {
      menu.hide()
      void resume()
    }
  } else {
    menu.show(game?.choice ?? choice, game === null ? 'mode' : 'car')
  }
})

function resize(): void {
  const { clientWidth, clientHeight } = container
  renderer.setSize(clientWidth, clientHeight, false)
  const aspect = clientWidth / Math.max(clientHeight, 1)
  game?.mode.resize(aspect)
  backdrop?.mode.resize(aspect)
}
window.addEventListener('resize', resize)
resize()

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  // The game keeps its clock behind the menu, driven or not: online, the
  // server does not wait. What is drawn is whatever the menu has put up
  // over it, if anything.
  game?.mode.update(dt, !menu.open)
  if (menu.open) backdrop?.mode.update(dt, false)
  const shown = menu.open && backdrop !== null ? backdrop.mode : game?.mode ?? null
  if (shown !== null) {
    if (shown.render) shown.render(renderer)
    else renderer.render(shown.scene ?? scene, shown.camera)
  }
  // The menu says what it is showing itself.
  const states = menu.open || game === null ? [] : game.mode.hud()
  if (menu.open || game !== null) huds.forEach((each, viewport) => each.render(states[viewport] ?? null))
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
