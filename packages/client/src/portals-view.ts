import type { World, WorldBuilding } from '@buggies/terrain'
import * as THREE from 'three'

const PORTAL_RING = new THREE.Color('#58e0ff')
const PORTAL_FILL = new THREE.Color('#9ff0ff')
const LANDER_FOIL = new THREE.Color('#c9a13a')
const LANDER_METAL = new THREE.Color('#bfc3c8')
const FLAG_COLOR = new THREE.Color('#d0392b')
const POLE_COLOR = new THREE.Color('#e8e8e4')

/** How thick a portal's ring is. */
const RING_THICKNESS = 0.6

/** Stand an object on the planet as a thing standing there is: its foot where the thing's is, turned as it is. */
function stood(object: THREE.Object3D, at: { x: number; y: number; z: number }, turn: { x: number; y: number; z: number; w: number }): THREE.Object3D {
  object.position.set(at.x, at.y, at.z)
  object.quaternion.set(turn.x, turn.y, turn.z, turn.w)
  return object
}

/**
 * The portals: each a glowing ring sunk halfway into the ground, round
 * its middle where it stands, facing the way through it, with a
 * shimmering sheet across the arch.
 */
export function buildPortals(world: World): THREE.Object3D {
  const portals = new THREE.Group()
  portals.name = 'portals'
  if (world.portals.length === 0) return portals
  const ringMaterial = new THREE.MeshStandardMaterial({ color: PORTAL_RING, emissive: PORTAL_RING, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.4 })
  const fillMaterial = new THREE.MeshBasicMaterial({ color: PORTAL_FILL, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  for (const portal of world.portals) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(portal.radius, RING_THICKNESS, 12, 64), ringMaterial)
    const sheet = new THREE.Mesh(new THREE.CircleGeometry(portal.radius - RING_THICKNESS / 2, 48), fillMaterial)
    // The ring lies across the way through it, its lower half in the ground.
    const standing = new THREE.Group()
    standing.add(ring, sheet)
    portals.add(stood(standing, portal.at, portal.turn))
  }
  return portals
}

/** A lander on its four legs: a foil-wrapped descent stage, a metal cabin on top, and a pad under each leg. */
function lander(building: WorldBuilding): THREE.Object3D {
  const foil = new THREE.MeshStandardMaterial({ color: LANDER_FOIL, roughness: 0.35, metalness: 0.7, flatShading: true })
  const metal = new THREE.MeshStandardMaterial({ color: LANDER_METAL, roughness: 0.5, metalness: 0.6, flatShading: true })
  const craft = new THREE.Group()
  const scale = building.width / 6
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
  craft.scale.setScalar(scale)
  // Its foot a little into the ground, as it stands.
  const standing = new THREE.Group()
  craft.position.y = 0.3
  standing.add(craft)
  return standing
}

/** A flag on its pole, standing out from the top of it. */
function flag(building: WorldBuilding): THREE.Object3D {
  const planted = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, building.height, 8), new THREE.MeshStandardMaterial({ color: POLE_COLOR, roughness: 0.4, metalness: 0.6 }))
  pole.position.y = building.height / 2
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.03), new THREE.MeshStandardMaterial({ color: FLAG_COLOR, roughness: 0.8 }))
  cloth.position.set(0.82, building.height - 0.55, 0)
  planted.add(pole, cloth)
  return planted
}

/** The flag and the lander on a moon, each standing where the world has it. */
export function buildMoonCraft(world: World): THREE.Object3D {
  const craft = new THREE.Group()
  craft.name = 'moon craft'
  for (const building of world.buildings) {
    if (building.kind === 'lander') craft.add(stood(lander(building), building.at, building.turn))
    else if (building.kind === 'flag') craft.add(stood(flag(building), building.at, building.turn))
  }
  return craft
}
