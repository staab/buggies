import { generateTerrain } from '@buggies/terrain'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { createTerrainView } from './terrain-view.ts'

const container = document.getElementById('app')!
const hud = document.getElementById('hud')!

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
container.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#a9cbe6')
scene.fog = new THREE.Fog('#a9cbe6', 500, 1800)

const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 5000)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI / 2.05

scene.add(new THREE.HemisphereLight('#cfe6ff', '#4a5a3a', 0.9))
const sun = new THREE.DirectionalLight('#fff4e0', 1.6)
sun.position.set(-300, 500, 200)
scene.add(sun)

let view: THREE.Group | null = null

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

function load(seed: number): void {
  if (view) disposeView(view)

  const map = generateTerrain(seed)
  view = createTerrainView(map)
  scene.add(view)

  const worldSize = map.size * map.cellSize
  camera.position.set(worldSize * 0.85, worldSize * 0.8, worldSize * 1.15)
  controls.target.set(worldSize / 2, 0, worldSize / 2)
  controls.update()

  hud.textContent = `seed ${seed} | cities ${map.districts.length}, rivers ${map.rivers.length}, lakes ${map.lakes.length} | press R for a new map`
}

function readSeed(): number {
  const param = new URLSearchParams(location.search).get('seed')
  const seed = param !== null ? Number(param) : Math.floor(Math.random() * 100000)
  return Number.isFinite(seed) ? seed : 1
}

load(readSeed())

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'r') return
  const seed = Math.floor(Math.random() * 100000)
  history.replaceState(null, '', `?seed=${seed}`)
  load(seed)
})

function resize(): void {
  const { clientWidth, clientHeight } = container
  renderer.setSize(clientWidth, clientHeight, false)
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

function frame(): void {
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
