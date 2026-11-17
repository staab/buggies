import type { World } from '@buggies/terrain'
import * as THREE from 'three'
import { TrackballControls } from 'three/addons/controls/TrackballControls.js'

import { bendAround, bendMaterials } from './bend.ts'
import type { ModeView } from './mode.ts'

/** A line about an island, for the player choosing one. */
export function islandSummary(map: World): string {
  const count = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`
  return (
    `seed ${map.seed} · ${count(map.districts.length, 'city').replace('citys', 'cities')}, ` +
    `${count(map.roads.length, 'road')}, ${count(map.rivers.length, 'river')}, ${count(map.lakes.length, 'lake')}`
  )
}

/**
 * How many times bigger than it is the planet is drawn while an island is
 * chosen, round the point facing the camera: this much come in as close as
 * can be, easing to not at all from this many radii out, where the whole
 * planet is in view and any bend shows as the globe squashed flat.
 */
const SEED_BEND_SCALE = 1.5
const SEED_BEND_UNTIL = 2.5

/** How close to the planet's middle the camera may come, in radii. */
const CLOSEST = 1.15

/** A planet turned about its middle any way at all, and come in to no closer than a little over its surface. */
function planetControls(camera: THREE.PerspectiveCamera, surface: HTMLElement, radius: number): TrackballControls {
  const controls = new TrackballControls(camera, surface)
  controls.target.set(0, 0, 0)
  controls.rotateSpeed = 2.5
  controls.zoomSpeed = 1.2
  controls.noPan = true
  // No keys: A, S and D are the driving keys, and the seed is typed on this page.
  controls.keys = ['', '', '']
  controls.staticMoving = false
  controls.dynamicDampingFactor = 0.12
  controls.minDistance = radius * CLOSEST
  controls.maxDistance = radius * 10
  controls.update()
  return controls
}

/**
 * Looking over a whole island from above while choosing it, or while the
 * room of a game shows the world it is played on: orbit it, the controls
 * working whether or not a screen is up, since a screen is what this is
 * for.
 */
export function createIslandMode(map: World, scene: THREE.Scene, surface: HTMLElement): ModeView {
  const { radius } = map
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, radius * 40)
  // Round the whole planet, looking at its middle from out over its equator.
  camera.position.set(0, radius * 0.9, radius * 2.6)
  // Turned about freely, over its poles and all, by quaternions: an orbit keeps its up the y axis and stops short at each pole.
  const controls = planetControls(camera, surface, radius)
  const facing = new THREE.Vector3()

  return {
    camera,
    resize(aspect) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      controls.handleResize()
    },
    update() {
      controls.update()
    },
    render(renderer) {
      // Drawn as though the planet were bigger round the point facing the camera, so it does not look so sharply curved.
      bendMaterials(scene)
      const near = THREE.MathUtils.clamp((SEED_BEND_UNTIL * radius - camera.position.length()) / ((SEED_BEND_UNTIL - CLOSEST) * radius), 0, 1)
      bendAround(facing.copy(camera.position).setLength(radius), radius, 1 + (SEED_BEND_SCALE - 1) * near)
      renderer.render(scene, camera)
      bendAround(null)
    },
    dispose() {
      controls.dispose()
    },
  }
}
