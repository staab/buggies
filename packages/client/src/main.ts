import {
  DEFAULT_VEHICLE_PROFILE,
  VEHICLE_PROFILE_IDS,
  initPhysics,
  type VehicleProfileId,
} from '@buggies/game'
import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import { createDriveMode } from './drive-mode.ts'
import { Menu, type Choice, type Mode } from './menu.ts'
import type { ModeView } from './mode.ts'
import { createOnlineMode } from './online-mode.ts'
import { createPreviewMode } from './preview-mode.ts'
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
let mode: ModeView | null = null

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
 * generation.
 */
function mapFor(seed: number): TerrainMap {
  if (map !== null && map.seed === seed) return map
  if (view) disposeView(view)
  map = generateTerrain(seed)
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
  const requested = params.get('mode')
  const mode: Mode = requested === 'drive' || requested === 'online' ? requested : 'preview'
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

/** Each apply outranks the one before: a slow connection that lands late is let go. */
let generation = 0

/** Reflect what is on show in the address bar and the footer. */
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

/** Put the player on the map they asked for, in the mode they asked for. */
function apply(next: Choice): void {
  const stamp = ++generation
  choice = next
  mode?.dispose()
  mode = null

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
        mode = online
        resize()
        settle()
      },
      (error: unknown) => {
        if (stamp !== generation) return
        const why = error instanceof Error ? error.message : String(error)
        hudElement.textContent = `could not join ${next.server}: ${why}`
        menu.show(choice)
      },
    )
    return
  }

  const island = mapFor(next.seed)
  mode =
    next.mode === 'drive'
      ? createDriveMode(island, scene, next.vehicle)
      : createPreviewMode(island, scene, renderer.domElement)
  resize()
  settle()
}

const menu = new Menu(menuElement, choice)
menu.onCommit(apply)

// The physics engine is a wasm module, so it has to be ready before anything
// can be driven. It loads in well under a frame, and getting it out of the way
// up front beats a loading state in the middle of a session.
await initPhysics()
apply(choice)
menu.show(choice)

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (menu.open) menu.hide()
    else menu.show(choice)
    return
  }
  // Online, the server decides the map.
  if (menu.open || choice.mode === 'online' || event.key.toLowerCase() !== 'r') return
  apply({ ...choice, seed: randomSeed() })
})

function resize(): void {
  const { clientWidth, clientHeight } = container
  renderer.setSize(clientWidth, clientHeight, false)
  mode?.resize(clientWidth / Math.max(clientHeight, 1))
}
window.addEventListener('resize', resize)
resize()

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  if (mode) {
    mode.update(dt, !menu.open)
    renderer.render(scene, mode.camera)
    hudElement.textContent = mode.hud()
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
