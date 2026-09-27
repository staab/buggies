import type { IslandMark, IslandMarkKind } from '@buggies/net'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { seatColor } from './car-view.ts'
import type { ModeView } from './mode.ts'

/** How tall and wide a beacon over something on the island is, to be seen from high over the whole of it. */
const BEACON_HEIGHT = 90
const BEACON_RADIUS = 4
/** The colors things are marked in, as on the map: a player's car in its seat's own. */
const MARK_COLORS: Readonly<Record<Exclude<IslandMarkKind, 'player'>, number>> = {
  npc: 0x9aa0a6,
  robot: 0xff3030,
  ufo: 0x5cff8a,
  spider: 0xc15cff,
}

/** A line about an island, for the player choosing one. */
export function islandSummary(map: TerrainMap): string {
  const count = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`
  return (
    `seed ${map.seed} · ${count(map.districts.length, 'city').replace('citys', 'cities')}, ` +
    `${count(map.roads.length, 'road')}, ${count(map.rivers.length, 'river')}, ${count(map.lakes.length, 'lake')}`
  )
}

/**
 * Looking over a whole island from above while choosing it: orbit it, with
 * a beacon of light standing over every car on it, driven or not, and every
 * machine, as the server last said. The controls work whether or not the
 * menu is up, since the menu is what this is for.
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
        const { shaft: glow, cap: head } = paint(mark.kind === 'player' ? seatColor(mark.seat) : MARK_COLORS[mark.kind])
        const beacon = new THREE.Group()
        beacon.position.set(mark.position.x, mark.position.y, mark.position.z)
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
