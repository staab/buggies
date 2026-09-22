import { DEFAULT_WORLD_TUNING, createVehicleTuning, restingRideHeight } from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { CarView, profileColor } from './car-view.ts'
import type { ModeView } from './mode.ts'
import { createScaleCar } from './terrain-view.ts'

/** A line about an island, for the player choosing one. */
export function islandSummary(map: TerrainMap): string {
  const count = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`
  return (
    `seed ${map.seed} · ${count(map.districts.length, 'city').replace('citys', 'cities')}, ` +
    `${count(map.roads.length, 'road')}, ${count(map.rivers.length, 'river')}, ${count(map.lakes.length, 'lake')}`
  )
}

/**
 * Looking over a whole island from above while choosing it: orbit it, and
 * park one car on it for scale. The controls work whether or not the menu
 * is up, since the menu is what this is for.
 */
export function createIslandMode(map: TerrainMap, scene: THREE.Scene, surface: HTMLElement): ModeView {
  const worldSize = map.size * map.cellSize
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, worldSize * 6.5)
  camera.position.set(worldSize * 0.85, worldSize * 0.8, worldSize * 1.15)

  const controls = new OrbitControls(camera, surface)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2.05
  controls.target.set(worldSize / 2, 0, worldSize / 2)
  controls.update()

  // A sports car parked on the highway, to judge the roads by.
  const tuning = createVehicleTuning('sportsCar')
  const view = new CarView('sportsCar', profileColor('sportsCar'))
  view.syncDimensions(tuning)
  view.applyRollingWheels(tuning, 0)
  view.object.position.y = restingRideHeight(tuning, DEFAULT_WORLD_TUNING.gravity)
  const car = createScaleCar(map, view.object)
  scene.add(car)

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
      return null
    },
    dispose() {
      controls.dispose()
      scene.remove(car)
      view.dispose()
    },
  }
}
