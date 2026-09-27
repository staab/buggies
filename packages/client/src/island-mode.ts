import type { IslandMark } from '@buggies/net'
import { shapeOf } from './globe.ts'
import { mapExtent, type TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TrackballControls } from 'three/addons/controls/TrackballControls.js'

import { seatColor } from './car-view.ts'
import type { ModeView } from './mode.ts'

const UP = new THREE.Vector3(0, 1, 0)

/** How tall and wide a beacon over something on the island is, to be seen from high over the whole of it. */
const BEACON_HEIGHT = 90
const BEACON_RADIUS = 4
/** The color a car nobody drives is marked in; a player's is in its seat's own. */
const NPC_COLOR = 0x9aa0a6

/** A line about an island, for the player choosing one. */
export function islandSummary(map: TerrainMap): string {
  const count = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`
  return (
    `seed ${map.seed} · ${count(map.districts.length, 'city').replace('citys', 'cities')}, ` +
    `${count(map.roads.length, 'road')}, ${count(map.rivers.length, 'river')}, ${count(map.lakes.length, 'lake')}`
  )
}

/** An island orbited from above, round its middle, never from under it. */
function islandControls(camera: THREE.PerspectiveCamera, surface: HTMLElement, extent: { x: number; z: number }): OrbitControls {
  const controls = new OrbitControls(camera, surface)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2.05
  controls.target.set(extent.x / 2, 0, extent.z / 2)
  controls.update()
  return controls
}

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
  controls.minDistance = radius * 1.15
  controls.maxDistance = radius * 6
  controls.update()
  return controls
}

/**
 * Looking over a whole island from above while choosing it: orbit it, with
 * a beacon of light standing over every car on it, driven or not, as the
 * server last said. The controls work whether or not the
 * menu is up, since the menu is what this is for.
 */
export function createIslandMode(map: TerrainMap, scene: THREE.Scene, surface: HTMLElement): ModeView {
  const extent = mapExtent(map)
  const worldSize = Math.max(extent.x, extent.z)
  const shape = shapeOf(map)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, worldSize * 6.5)
  // Over the island, or round the whole planet, looking at its middle from out over its equator.
  if (shape.kind === 'planet') camera.position.set(0, shape.planet.radius * 0.9, shape.planet.radius * 2.6)
  else camera.position.set(extent.x / 2 + worldSize * 0.35, worldSize * 0.8, extent.z / 2 + worldSize * 0.65)

  // A planet is turned about freely, over its poles and all, by quaternions: an orbit keeps its
  // up the y axis and stops short at each pole. A flat island is orbited, never from under it.
  const controls = shape.kind === 'planet' ? planetControls(camera, surface, shape.planet.radius) : islandControls(camera, surface, extent)

  const beacons = new THREE.Group()
  const shaft = new THREE.CylinderGeometry(BEACON_RADIUS * 0.5, BEACON_RADIUS, BEACON_HEIGHT, 12, 1, true).translate(0, BEACON_HEIGHT / 2, 0)
  const cap = new THREE.SphereGeometry(BEACON_RADIUS * 2, 16, 10)
  const paints = new Map<number, { shaft: THREE.MeshBasicMaterial; cap: THREE.MeshBasicMaterial }>()
  const paint = (color: number): { shaft: THREE.MeshBasicMaterial; cap: THREE.MeshBasicMaterial } => {
    let made = paints.get(color)
    if (made === undefined) {
      made = {
        shaft: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
        cap: new THREE.MeshBasicMaterial({ color }),
      }
      paints.set(color, made)
    }
    return made
  }
  scene.add(beacons)

  return {
    camera,
    resize(aspect) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      if (controls instanceof TrackballControls) controls.handleResize()
    },
    update() {
      controls.update()
    },
    hud() {
      return []
    },
    showMarks(marks) {
      beacons.clear()
      for (const mark of marks) {
        const { shaft: glow, cap: head } = paint(mark.kind === 'player' ? seatColor(mark.seat) : NPC_COLOR)
        const beacon = new THREE.Group()
        beacon.position.set(mark.position.x, mark.position.y, mark.position.z)
        // Standing up where it is: away from a planet's middle, or up the y axis on the flat.
        if (shape.kind === 'planet') beacon.quaternion.setFromUnitVectors(UP, beacon.position.clone().normalize())
        const top = new THREE.Mesh(cap, head)
        top.position.y = BEACON_HEIGHT
        beacon.add(new THREE.Mesh(shaft, glow), top)
        beacons.add(beacon)
      }
    },
    dispose() {
      controls.dispose()
      scene.remove(beacons)
      shaft.dispose()
      cap.dispose()
      for (const { shaft: glow, cap: head } of paints.values()) {
        glow.dispose()
        head.dispose()
      }
    },
  }
}
