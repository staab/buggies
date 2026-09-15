import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import type { ModeView } from './mode.ts'
import { createScaleCar } from './terrain-view.ts'

/** Looking at the whole island: orbit it, and park one car on it for scale. */
export function createPreviewMode(
  map: TerrainMap,
  scene: THREE.Scene,
  surface: HTMLElement,
): ModeView {
  const worldSize = map.size * map.cellSize
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, worldSize * 6.5)
  camera.position.set(worldSize * 0.85, worldSize * 0.8, worldSize * 1.15)

  const controls = new OrbitControls(camera, surface)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2.05
  controls.target.set(worldSize / 2, 0, worldSize / 2)
  controls.update()

  const car = createScaleCar(map)
  scene.add(car)

  const summary =
    `seed ${map.seed} | cities ${map.districts.length}, roads ${map.roads.length}, ` +
    `rivers ${map.rivers.length}, lakes ${map.lakes.length}`

  return {
    camera,
    resize(aspect) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    },
    update() {
      controls.update()
    },
    hud() {
      return summary
    },
    dispose() {
      controls.dispose()
      scene.remove(car)
      car.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return
        node.geometry.dispose()
        const material = node.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material.dispose()
      })
    },
  }
}
