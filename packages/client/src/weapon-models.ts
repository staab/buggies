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

/** A shockwave: a glowing yellow lightning bolt, standing up over the roof and seen from either side. */
export function buildBolt(): THREE.Group {
  const group = new THREE.Group()
  // A zigzag, top to bottom, in its own plane.
  const outline = new THREE.Shape()
  outline.moveTo(0.1, 0.55)
  outline.lineTo(-0.22, 0.02)
  outline.lineTo(-0.02, 0.02)
  outline.lineTo(-0.12, -0.55)
  outline.lineTo(0.24, 0.1)
  outline.lineTo(0.04, 0.1)
  outline.lineTo(0.18, 0.55)
  outline.closePath()
  const bolt = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline, { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05),
    new THREE.MeshStandardMaterial({ color: '#ffd43a', emissive: '#ffb81c', emissiveIntensity: 0.9, roughness: 0.4 }),
  )
  bolt.position.y = 0.3
  group.add(bolt)
  return shadowed(group)
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

/**
 * A laser: a squat white housing with cooling fins, and a red lens at the
 * front of a short barrel. Like the gun, it points along +Z, to be aimed.
 */
export function buildLaser(): THREE.Group {
  const group = new THREE.Group()
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.7), metal(new THREE.Color('#e9ecef'), 0.4))
  group.add(housing)
  for (const offset of [-0.2, 0, 0.2]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.08), metal(STEEL))
    fin.position.set(0, 0.17, offset)
    group.add(fin)
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 12), metal(STEEL))
  barrel.rotation.x = Math.PI / 2
  barrel.position.z = 0.55
  group.add(barrel)
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 16),
    new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff2a2a', emissiveIntensity: 1.5 }),
  )
  lens.position.z = 0.81
  group.add(lens)
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

function shadowed(group: THREE.Group): THREE.Group {
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true
  })
  return group
}

const MAGNET = new THREE.Color('#d8402c')

/** A magnet: a red horseshoe, its silver ends pointing ahead. */
export function buildMagnet(): THREE.Group {
  const group = new THREE.Group()
  const bend = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 8, 20, Math.PI), metal(MAGNET, 0.4))
  bend.rotation.x = Math.PI / 2
  bend.position.z = 0.1
  group.add(bend)
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 10), metal(MAGNET, 0.4))
    arm.rotation.x = Math.PI / 2
    arm.position.set(side * 0.3, 0, -0.05)
    group.add(arm)
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 10), metal(SHELL, 0.25))
    tip.rotation.x = Math.PI / 2
    tip.position.set(side * 0.3, 0, -0.27)
    group.add(tip)
  }
  return shadowed(group)
}

/** How far a plow's blade curves out from its middle. */
export const PLOW_BLADE_RADIUS = 0.5

/**
 * A ram plow: a dark blade, a quarter of a drum across, hollow toward the
 * front, with a yellow edge along the bottom. Its middle is the drum's,
 * this far ahead of the blade.
 */
export function buildPlow(): THREE.Group {
  const group = new THREE.Group()
  const r = PLOW_BLADE_RADIUS
  const bladeMaterial = metal(STEEL, 0.4)
  bladeMaterial.side = THREE.DoubleSide
  // A drum's side, laid across the car: the quarter of it behind the drum's middle, toward +Z.
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.4, 16, 1, true, -Math.PI / 4, Math.PI / 2), bladeMaterial)
  blade.rotation.z = Math.PI / 2
  group.add(blade)
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.08), metal(new THREE.Color('#e8c23a'), 0.5))
  edge.position.set(0, -r * Math.SQRT1_2, r * Math.SQRT1_2)
  group.add(edge)
  return shadowed(group)
}

/** A mine: a squat dark disc with a red light on top. */
export function buildMine(): THREE.Group {
  const group = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.16, 16), metal(new THREE.Color('#3a4030'), 0.6))
  group.add(disc)
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#ff3a2a', emissive: '#ff2a1a', emissiveIntensity: 1.6 }),
  )
  light.position.y = 0.1
  group.add(light)
  return shadowed(group)
}

/** A mine field: a stack of mines, carried over the roof. */
export function buildMines(): THREE.Group {
  const group = new THREE.Group()
  for (let level = 0; level < 3; level++) {
    const mine = buildMine()
    mine.position.y = level * 0.18 - 0.18
    mine.rotation.y = level * 0.6
    group.add(mine)
  }
  return group
}
