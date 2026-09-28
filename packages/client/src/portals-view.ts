import type { Building, TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

const PORTAL_RING = new THREE.Color('#58e0ff')
const PORTAL_FILL = new THREE.Color('#9ff0ff')
const LANDER_FOIL = new THREE.Color('#c9a13a')
const LANDER_METAL = new THREE.Color('#bfc3c8')
const FLAG_COLOR = new THREE.Color('#d0392b')
const POLE_COLOR = new THREE.Color('#e8e8e4')

/** How thick a portal's ring is. */
const RING_THICKNESS = 0.6
/** How fast the sheet across a portal shimmers, in pulses a second. */
const SHIMMER_RATE = 0.8

/**
 * The portals: each a glowing ring standing on the ground, round its
 * middle a radius up, facing the way through it, with a shimmering sheet
 * across it.
 */
export function buildPortals(map: TerrainMap): THREE.Object3D {
  const portals = new THREE.Group()
  portals.name = 'portals'
  if (map.portals.length === 0) return portals
  const ringMaterial = new THREE.MeshStandardMaterial({ color: PORTAL_RING, emissive: PORTAL_RING, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.4 })
  const fillMaterial = new THREE.MeshBasicMaterial({ color: PORTAL_FILL, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  for (const portal of map.portals) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(portal.radius, RING_THICKNESS, 12, 64), ringMaterial)
    const sheet = new THREE.Mesh(new THREE.CircleGeometry(portal.radius - RING_THICKNESS / 2, 48), fillMaterial)
    const standing = new THREE.Group()
    // The ring and its sheet lie across the way through it, their middle a radius up off the ground.
    for (const part of [ring, sheet]) {
      part.position.y = portal.radius
      standing.add(part)
    }
    standing.position.set(portal.x, portal.y - RING_THICKNESS / 2, portal.z)
    standing.rotation.y = Math.atan2(portal.dx, portal.dz)
    portals.add(standing)
  }
  portals.userData.shimmer = (seconds: number): void => {
    fillMaterial.opacity = 0.3 + 0.12 * Math.sin(seconds * SHIMMER_RATE * Math.PI * 2)
    ringMaterial.emissiveIntensity = 0.7 + 0.3 * Math.sin(seconds * SHIMMER_RATE * Math.PI * 2 + 1)
  }
  return portals
}

/** A lander on its four legs: a foil-wrapped descent stage, a metal cabin on top, and a pad under each leg. */
function lander(building: Building): THREE.Object3D {
  const foil = new THREE.MeshStandardMaterial({ color: LANDER_FOIL, roughness: 0.35, metalness: 0.7, flatShading: true })
  const metal = new THREE.MeshStandardMaterial({ color: LANDER_METAL, roughness: 0.5, metalness: 0.6, flatShading: true })
  const craft = new THREE.Group()
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 1.8, 8), foil)
  stage.position.y = 2.2
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.2), metal)
  cabin.position.y = 4
  craft.add(stage, cabin)
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * Math.PI * 2 + Math.PI / 4
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.8, 6), metal)
    leg.position.copy(out).multiplyScalar(2.6).setY(1.15)
    // Leaning out from the stage down to its pad.
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-out.x * 0.5, 1, -out.z * 0.5).normalize())
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 10), metal)
    pad.position.copy(out).multiplyScalar(3.2).setY(0.35)
    craft.add(leg, pad)
  }
  for (const part of craft.children) part.castShadow = true
  craft.scale.setScalar(building.width / 6)
  return craft
}

/** A flag on its pole, standing out from the top of it. */
function flag(building: Building): THREE.Object3D {
  const height = building.top - building.bottom
  const planted = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, height, 8), new THREE.MeshStandardMaterial({ color: POLE_COLOR, roughness: 0.4, metalness: 0.6 }))
  pole.position.y = height / 2
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.03), new THREE.MeshStandardMaterial({ color: FLAG_COLOR, roughness: 0.8 }))
  cloth.position.set(0.82, height - 0.55, 0)
  pole.castShadow = cloth.castShadow = true
  planted.add(pole, cloth)
  return planted
}

/** The flag and the lander on a moon, each standing where the map has it. */
export function buildMoonCraft(map: TerrainMap): THREE.Object3D {
  const craft = new THREE.Group()
  craft.name = 'moon craft'
  for (const building of map.buildings) {
    const made = building.kind === 'lander' ? lander(building) : building.kind === 'flag' ? flag(building) : null
    if (made === null) continue
    made.position.set(building.x, building.bottom, building.z)
    made.rotation.y = building.yaw
    craft.add(made)
  }
  return craft
}

/** Shimmer the portals of a terrain view, this many seconds into the game. */
export function shimmerPortals(view: THREE.Object3D, seconds: number): void {
  const portals = view.getObjectByName('portals')
  ;(portals?.userData.shimmer as ((seconds: number) => void) | undefined)?.(seconds)
}
