import { DEFAULT_VEHICLE, VEHICLE_PROFILE_IDS, type VehicleProfileId } from '@buggies/game'
import { generateTerrain, type TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import { createDriveMode } from './drive-mode.ts'
import { Menu, type Choice } from './menu.ts'
import type { ModeView } from './mode.ts'
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
  materials.forEach((material) => material.dispose())
  scene.remove(group)
}

function loadMap(seed: number): void {
  if (view) disposeView(view)
  map = generateTerrain(seed)
  view = createTerrainView(map)
  scene.add(view)

  // View distances ride the world scale so the framing stays the same.
  const worldSize = map.size * map.cellSize
  scene.fog = new THREE.Fog('#a9cbe6', worldSize * 0.65, worldSize * 2.34)
}

function randomSeed(): number {
  return Math.floor(Math.random() * 100000)
}

function readChoice(): Choice {
  const params = new URLSearchParams(location.search)
  const seed = Number(params.get('seed'))
  const vehicle = params.get('vehicle')
  return {
    mode: params.get('mode') === 'drive' ? 'drive' : 'preview',
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : randomSeed(),
    vehicle: VEHICLE_PROFILE_IDS.includes(vehicle as VehicleProfileId)
      ? (vehicle as VehicleProfileId)
      : DEFAULT_VEHICLE,
  }
}

let choice = readChoice()

/**
 * Put the player on the map they asked for, in the mode they asked for. The
 * map is only regenerated when it actually changed: switching between modes
 * on one island should not cost seconds of terrain generation.
 */
function apply(next: Choice): void {
  const changed = map === null || next.seed !== map.seed
  choice = next
  if (changed) loadMap(next.seed)

  mode?.dispose()
  mode =
    choice.mode === 'drive'
      ? createDriveMode(map!, scene, choice.vehicle)
      : createPreviewMode(map!, scene, renderer.domElement)
  resize()

  const url = `?mode=${choice.mode}&seed=${choice.seed}&vehicle=${choice.vehicle}`
  history.replaceState(null, '', url)
  footerElement.textContent = 'R  a different map      Esc  menu'
}

const menu = new Menu(menuElement, choice)
menu.onCommit(apply)

apply(choice)
menu.show(choice)

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (menu.open) menu.hide()
    else menu.show(choice)
    return
  }
  if (menu.open || event.key.toLowerCase() !== 'r') return
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
    // A menu over the top pauses the world rather than letting it run on
    // unattended behind the panel.
    if (!menu.open) mode.update(dt)
    renderer.render(scene, mode.camera)
    hudElement.textContent = mode.hud()
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
