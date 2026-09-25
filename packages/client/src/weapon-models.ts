import * as THREE from 'three'

const SHELL = new THREE.Color('#ece7dd')
const WING = new THREE.Color('#dfe6ec')
const FLAME = new THREE.Color('#ffa63a')
const NOSE = new THREE.Color('#d8402c')
const STEEL = new THREE.Color('#2c3038')
const BARREL = new THREE.Color('#4b525c')
const BRASS = new THREE.Color('#c9a24b')

function metal(color: THREE.Color, roughness = 0.5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.2 })
}

/** A rocket engine: a stubby dark booster with a nozzle at the back, and a flame behind it when it burns. */
export function buildEngine(): { model: THREE.Group; flame: THREE.Mesh } {
  const model = new THREE.Group()
  const booster = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.0, 12), metal(STEEL))
  booster.rotation.x = Math.PI / 2
  model.add(booster)
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.35, 12, 1, true), metal(BARREL, 0.35))
  nozzle.rotation.x = Math.PI / 2
  nozzle.position.z = 0.6
  model.add(nozzle)
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 6, 16), metal(NOSE, 0.5))
  band.position.z = -0.3
  model.add(band)
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.9, 10),
    new THREE.MeshBasicMaterial({ color: FLAME, transparent: true, opacity: 0.85 }),
  )
  flame.rotation.x = Math.PI / 2
  flame.position.z = 1.2
  flame.visible = false
  model.add(flame)
  model.traverse((node) => {
    if (node instanceof THREE.Mesh && node !== flame) node.castShadow = true
  })
  return { model, flame }
}

/** A siren: a brass horn on a small base, its bell ahead. */
export function buildHorn(): THREE.Group {
  const group = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), metal(STEEL))
  group.add(base)
  const bell = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 14, 1, true), metal(BRASS, 0.3))
  bell.rotation.x = Math.PI / 2
  bell.position.set(0, 0.24, -0.35)
  group.add(bell)
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), metal(BRASS, 0.3))
  throat.rotation.x = Math.PI / 2
  throat.position.set(0, 0.24, 0.1)
  group.add(throat)
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

/** A shockwave: a dark speaker box with a grille on its face, over the roof. */
export function buildSpeaker(): THREE.Group {
  const group = new THREE.Group()
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.45), metal(STEEL, 0.7))
  cabinet.position.y = 0.25
  group.add(cabinet)
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.03), metal(BARREL, 0.9))
  grille.position.set(0, 0.25, -0.24)
  group.add(grille)
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

/** Wings: a pair of pale, swept, slightly raised wings, either side of the roof. */
export function buildWings(): THREE.Group {
  const group = new THREE.Group()
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.5), metal(WING, 0.6))
    wing.position.set(side * 1.0, 0.1, 0.1)
    wing.rotation.set(0, -side * 0.35, side * 0.12)
    wing.castShadow = true
    group.add(wing)
  }
  const spar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.3), metal(STEEL))
  group.add(spar)
  return group
}

/** A rocket: a pale tube with a red nose and three fins, pointing the way the car does. */
export function buildRocket(): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 12), metal(SHELL))
  body.rotation.x = Math.PI / 2
  group.add(body)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 12), metal(NOSE, 0.4))
  nose.rotation.x = -Math.PI / 2
  nose.position.z = -0.875
  group.add(nose)
  const finMaterial = metal(NOSE, 0.6)
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.32, 0.3), finMaterial)
    const pivot = new THREE.Group()
    pivot.rotation.z = (i * 2 * Math.PI) / 3
    fin.position.set(0, 0.28, 0.5)
    pivot.add(fin)
    group.add(pivot)
  }
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

/**
 * A machine gun: a dark receiver with a barrel out the front and a box of
 * rounds on the side. Its barrel runs along +Z, the way `lookAt` turns a
 * thing, so it is turned about to face the way the car does at rest.
 */
export function buildGun(): THREE.Group {
  const group = new THREE.Group()
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.8), metal(STEEL))
  group.add(receiver)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 10), metal(BARREL, 0.35))
  barrel.rotation.x = Math.PI / 2
  barrel.position.z = 0.85
  group.add(barrel)
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 10), metal(STEEL))
  brake.rotation.x = Math.PI / 2
  brake.position.z = 1.25
  group.add(brake)
  const rounds = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.32), metal(BRASS, 0.45))
  rounds.position.set(-0.28, -0.02, -0.05)
  group.add(rounds)
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

/** A repair kit: a red cross on a white disc, standing up over the roof and seen from either side. */
export function buildRepair(): THREE.Group {
  const group = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 24), metal(new THREE.Color('#f4f2ee'), 0.7))
  disc.rotation.x = Math.PI / 2
  group.add(disc)
  const red = metal(NOSE, 0.6)
  for (const face of [-1, 1]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.54, 0.02), red)
    upright.position.z = face * 0.05
    const across = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.02), red)
    across.position.z = face * 0.05
    group.add(upright, across)
  }
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

/** A bomb: a black ball with a short fuse, its end glowing. */
export function buildBomb(): THREE.Group {
  const group = new THREE.Group()
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), metal(new THREE.Color('#202226'), 0.45))
  group.add(ball)
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), metal(new THREE.Color('#8a7a5a'), 0.8))
  fuse.position.y = 0.5
  group.add(fuse)
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 5),
    new THREE.MeshStandardMaterial({ color: '#ff9a3c', emissive: '#ff6a1c', emissiveIntensity: 1.5 }),
  )
  ember.position.y = 0.62
  group.add(ember)
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}
