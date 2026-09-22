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
import { createIslandMode, islandSummary } from './island-mode.ts'
import { Menu, type Choice, type Mode } from './menu.ts'
import type { ModeView } from './mode.ts'
import { createOnlineMode } from './online-mode.ts'
import { createShowroomMode, type ShowroomView } from './showroom-mode.ts'
import { TerrainSource } from './terrain-source.ts'
import { createTerrainView } from './terrain-view.ts'

const container = document.getElementById('app')!
const hudElement = document.getElementById('hud')!
const footerElement = document.getElementById('footer')!
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

/**
 * What is on show: a game being played, an island being looked over while
 * it is chosen, or a vehicle turning in the showroom while it is.
 */
type OnShow =
  | { kind: 'game'; mode: ModeView }
  | { kind: 'island'; seed: number; mode: ModeView }
  | { kind: 'showroom'; mode: ShowroomView }

let onShow: OnShow | null = null

function put(next: OnShow | null): void {
  onShow?.mode.dispose()
  onShow = next
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
  hudElement.textContent = `generating island ${seed}...`
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
  const vehicle = params.get('vehicle')
  const mode: Mode = params.get('mode') === 'online' ? 'online' : 'drive'
  return {
    mode,
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : randomSeed(),
    vehicle: VEHICLE_PROFILE_IDS.includes(vehicle as VehicleProfileId)
      ? (vehicle as VehicleProfileId)
      : DEFAULT_VEHICLE_PROFILE,
    server: params.get('server') ?? defaultServer(),
  }
}

let choice = readChoice()

/** Each thing asked for outranks the one before: a slow one that lands late is let go. */
let generation = 0

/** Reflect what is being played in the address bar and the footer. */
function settle(): void {
  const online = choice.mode === 'online'
  const url = online
    ? `?mode=online&server=${encodeURIComponent(choice.server)}&vehicle=${choice.vehicle}`
    : `?mode=${choice.mode}&seed=${choice.seed}&vehicle=${choice.vehicle}`
  history.replaceState(null, '', url)
  footerElement.textContent = online
    ? 'Enter  back to the road      Esc  menu'
    : 'R  a different map      Esc  menu'
}

/** Put the island with this seed on show, to be looked over, and say what it is like. */
async function showIsland(seed: number): Promise<string> {
  const stamp = ++generation
  choice = { ...choice, seed }
  if (onShow?.kind === 'island' && onShow.seed === seed && map !== null) return islandSummary(map)
  const island = await mapFor(seed)
  // Something else may have been asked for while the island was being made.
  if (stamp !== generation) return ''
  put({ kind: 'island', seed, mode: createIslandMode(island, scene, renderer.domElement) })
  return islandSummary(island)
}

/** Put this vehicle on show, turning on the spot. */
function showVehicle(vehicle: VehicleProfileId): void {
  generation += 1
  choice = { ...choice, vehicle }
  if (onShow?.kind !== 'showroom') put({ kind: 'showroom', mode: createShowroomMode() })
  if (onShow?.kind === 'showroom') onShow.mode.show(vehicle)
}

/** Put the player on the map they asked for, in the mode they asked for. */
async function start(next: Choice): Promise<void> {
  const stamp = ++generation
  choice = next
  put(null)

  if (next.mode === 'online') {
    hudElement.textContent = `connecting to ${next.server}...`
    footerElement.textContent = 'Esc  menu'
    createOnlineMode(scene, next.server, next.vehicle, (seed) => {
      choice = { ...choice, seed }
      return mapFor(seed)
    }).then(
      (online) => {
        if (stamp !== generation) {
          online.dispose()
          return
        }
        put({ kind: 'game', mode: online })
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
  put({ kind: 'game', mode: createDriveMode(island, scene, next.vehicle) })
  settle()
}

const menu = new Menu(menuElement, choice, { showIsland, showVehicle, start })

// The physics engine is a wasm module, so it has to be ready before anything
// can be driven. It loads in well under a frame, and getting it out of the way
// up front beats a loading state in the middle of a session. The vehicles'
// models come in alongside it: every one of them, since online anyone may
// turn up in any of them.
hudElement.textContent = 'loading...'
await Promise.all([initPhysics(), loadCarModels()])
menu.show(choice)
// Something to look at behind the first page: the island that would be driven.
menu.notice(`generating island ${choice.seed}...`)
void showIsland(choice.seed).then((about) => {
  if (about) menu.notice(about)
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    // A game paused behind the menu can be gone back to; an island or a
    // showroom is only there for the menu, so the menu stays up with it.
    if (menu.open) {
      if (onShow?.kind === 'game') menu.hide()
    } else {
      menu.show(choice)
    }
    return
  }
  // Online, the server decides the map.
  if (menu.open || onShow?.kind !== 'game' || choice.mode === 'online') return
  if (event.key.toLowerCase() === 'r') void start({ ...choice, seed: randomSeed() })
})

function resize(): void {
  const { clientWidth, clientHeight } = container
  renderer.setSize(clientWidth, clientHeight, false)
  onShow?.mode.resize(clientWidth / Math.max(clientHeight, 1))
}
window.addEventListener('resize', resize)
resize()

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  if (onShow) {
    const { mode } = onShow
    mode.update(dt, !menu.open)
    renderer.render(mode.scene ?? scene, mode.camera)
    hudElement.textContent = mode.hud()
  }
  // The menu says what it is showing itself.
  hudElement.hidden = menu.open
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
