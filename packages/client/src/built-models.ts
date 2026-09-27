import { DEFAULT_WORLD_TUNING, restingRideHeight, type VehicleTuning } from '@buggies/game'
import * as THREE from 'three'

import { hullGeometry } from './hull-geometry.ts'

/**
 * Vehicles with no model file, built here instead, the way a model file is:
 * front toward +Z, left toward +X, the ground at y = 0, a meter to a unit,
 * and each wheel a node named `wheel-…`. They are sized off their tunings,
 * so the body is the chassis and the wheels are where the axles are.
 */

function material(color: string, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...options })
}

/** A box of this size with its middle here. */
function box(size: [number, number, number], at: [number, number, number], paint: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), paint)
  mesh.position.set(...at)
  return mesh
}

/** A tube from one point to another, this thick. */
function tube(from: THREE.Vector3, to: THREE.Vector3, radius: number, paint: THREE.Material): THREE.Mesh {
  const length = from.distanceTo(to)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), paint)
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
  return mesh
}

/**
 * A dune buggy: an open tube frame with a roll cage over two seats, a flat
 * floor pan, the engine out behind, and four big knobbly tires well out at
 * the corners.
 */
export function buildDuneBuggy(tuning: VehicleTuning): THREE.Group {
  const group = new THREE.Group()
  const w = tuning.chassisHalfWidth
  const l = tuning.chassisHalfLength
  const r = tuning.wheelRadius
  const frame = material('#2b2d31', { metalness: 0.5, roughness: 0.4 })
  const panel = material('#e8742a')
  const seat = material('#1a1a1a', { roughness: 0.9 })
  const engine = material('#9aa0a6', { metalness: 0.6, roughness: 0.35 })
  const rubber = material('#1d1d1d', { roughness: 0.95 })
  const hub = material('#c9ccd1', { metalness: 0.7, roughness: 0.3 })

  const floor = r * 0.75
  const cage = floor + 1.25
  // The floor pan, the nose panel and the bumpers, which make the length.
  group.add(box([w * 1.3, 0.12, l * 1.7], [0, floor, 0], panel))
  group.add(box([w * 1.1, 0.35, 0.6], [0, floor + 0.2, l * 0.72], panel))
  group.add(box([w * 1.4, 0.14, 0.14], [0, floor + 0.05, l - 0.07], frame))
  group.add(box([w * 1.4, 0.14, 0.14], [0, floor + 0.05, -l + 0.07], frame))
  // The roll cage: a hoop either side, joined across the top, out to the chassis's width.
  const post = 0.05
  for (const side of [-1, 1]) {
    const x = side * (w - post)
    const front = new THREE.Vector3(x, floor, l * 0.45)
    const back = new THREE.Vector3(x, floor, -l * 0.45)
    const topFront = new THREE.Vector3(x * 0.8, cage, l * 0.1)
    const topBack = new THREE.Vector3(x * 0.8, cage, -l * 0.3)
    for (const [a, b] of [
      [front, topFront],
      [topFront, topBack],
      [topBack, back],
      [back, front],
    ] as const) {
      group.add(tube(a, b, post, frame))
    }
  }
  group.add(tube(new THREE.Vector3(-w * 0.8, cage, l * 0.1), new THREE.Vector3(w * 0.8, cage, l * 0.1), post, frame))
  group.add(tube(new THREE.Vector3(-w * 0.8, cage, -l * 0.3), new THREE.Vector3(w * 0.8, cage, -l * 0.3), post, frame))
  // Two bucket seats, and the engine out behind them.
  for (const side of [-1, 1]) {
    group.add(box([0.45, 0.12, 0.5], [side * w * 0.35, floor + 0.14, -l * 0.05], seat))
    group.add(box([0.45, 0.6, 0.12], [side * w * 0.35, floor + 0.45, -l * 0.3], seat))
  }
  group.add(box([w * 0.8, 0.45, 0.6], [0, floor + 0.3, -l * 0.7], engine))

  // Four fat tires, well out at the corners, on the axles.
  const tire = new THREE.CylinderGeometry(r, r, 0.4, 20).rotateZ(Math.PI / 2)
  const rim = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.42, 12).rotateZ(Math.PI / 2)
  for (const [name, x, z] of [
    ['wheel-front-left', 1, -tuning.frontAxleZ],
    ['wheel-front-right', -1, -tuning.frontAxleZ],
    ['wheel-back-left', 1, -tuning.rearAxleZ],
    ['wheel-back-right', -1, -tuning.rearAxleZ],
  ] as const) {
    const wheel = new THREE.Group()
    wheel.name = name
    wheel.position.set(x * tuning.halfTrackWidth, r, z)
    wheel.add(new THREE.Mesh(tire, rubber), new THREE.Mesh(rim, hub))
    group.add(wheel)
  }
  return group
}

/**
 * A rocket ship: a white fuselage with a red nose cone, a glass canopy on
 * top, swept red fins at the tail and a stub wing either side out to the
 * chassis's width. It has no wheels, and nothing is drawn under it: it
 * rides at its height on thrusters that are not seen.
 */
export function buildRocketShip(tuning: VehicleTuning): THREE.Group {
  const group = new THREE.Group()
  const w = tuning.chassisHalfWidth
  const l = tuning.chassisHalfLength
  const hover = restingRideHeight(tuning, DEFAULT_WORLD_TUNING.gravity) - tuning.chassisHalfHeight
  const radius = tuning.chassisHalfHeight
  const hull = material('#f2f2ee', { metalness: 0.35, roughness: 0.35 })
  const trim = material('#d0342c', { metalness: 0.3, roughness: 0.45 })
  const glass = material('#7fd8ff', { metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.75 })
  const nozzle = material('#3a3d42', { metalness: 0.7, roughness: 0.3 })

  const middle = hover + radius
  const nose = l * 0.55
  // The fuselage, and the nose cone ahead of it: nose to tail, the chassis's length.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, 2 * l - nose, 20).rotateX(Math.PI / 2), hull)
  body.position.set(0, middle, -nose / 2)
  group.add(body)
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, nose, 20).rotateX(Math.PI / 2), trim)
  cone.position.set(0, middle, l - nose / 2)
  group.add(cone)
  // The canopy, and the engine bell at the tail.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.7, 16, 10), glass)
  canopy.scale.set(1, 0.7, 2)
  canopy.position.set(0, middle + radius * 0.6, l * 0.15)
  group.add(canopy)
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.75, 0.4, 16).rotateX(Math.PI / 2), nozzle)
  bell.position.set(0, middle, -l + 0.2)
  group.add(bell)
  // A stub wing either side, out to the chassis's width, and a fin standing up at the tail.
  group.add(box([2 * w, 0.08, l * 0.6], [0, middle - radius * 0.3, -l * 0.35], trim))
  const fin = box([0.08, radius * 1.4, l * 0.45], [0, middle + radius * 1.1, -l * 0.7], trim)
  group.add(fin)

  // Where the ground is under it, as it hovers: nothing to be seen, only
  // what the model is fitted to the road by, so it floats at its height.
  const ground = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.1), nozzle)
  ground.position.set(0, 0.005, 0)
  ground.visible = false
  ground.castShadow = false
  group.add(ground)
  return group
}

/**
 * An amphibian: a boat's hull, its bow forward, a dark band along its
 * waterline and a pale deck, a wheelhouse amidships with its glass and
 * roof, and four wheels half tucked into the hull's sides.
 */
export function buildAmphibian(tuning: VehicleTuning): THREE.Group {
  const group = new THREE.Group()
  const w = tuning.chassisHalfWidth
  const l = tuning.chassisHalfLength
  const h = tuning.chassisHalfHeight
  const r = tuning.wheelRadius
  const paint = material('#2f8f6a', { metalness: 0.2, roughness: 0.5 })
  const band = material('#1f2b28', { roughness: 0.8 })
  const planking = material('#d8c9a3', { roughness: 0.8 })
  const cabin = material('#f0ece0', { roughness: 0.6 })
  const glass = material('#9fd8f0', { metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.7 })
  const rubber = material('#1d1d1d', { roughness: 0.95 })
  const hub = material('#c9ccd1', { metalness: 0.7, roughness: 0.3 })

  // The hull, a meter long along X with its bow at +X, turned to run nose to tail along +Z and stretched to the chassis.
  const { skin, deck } = hullGeometry()
  const keel = r * 0.35
  const depth = h * 2 + r * 0.4
  const fit = (geometry: THREE.BufferGeometry, height: number, grow = 1): THREE.BufferGeometry =>
    geometry.clone().rotateY(-Math.PI / 2).scale(w * 2 * grow, height, l * 2).translate(0, keel, 0)
  group.add(new THREE.Mesh(fit(skin, depth), paint))
  group.add(new THREE.Mesh(fit(deck, depth), planking))
  // The band along the waterline, just proud of the hull's sides.
  group.add(new THREE.Mesh(fit(skin, depth * 0.45, 1.02), band))
  // The wheelhouse, a little aft of amidships: posts, glass all round the front, and a roof.
  const top = keel + depth
  group.add(box([w * 1.1, 0.5, l * 0.55], [0, top + 0.25, -l * 0.15], cabin))
  const screen = box([w * 1.05, 0.55, 0.06], [0, top + 0.72, l * 0.12], glass)
  screen.rotation.x = -0.3
  group.add(screen)
  for (const side of [-1, 1]) group.add(box([0.06, 0.55, l * 0.45], [side * w * 0.53, top + 0.72, -l * 0.2], glass))
  group.add(box([w * 1.2, 0.08, l * 0.62], [0, top + 1.03, -l * 0.17], cabin))

  // Four wheels, on the axles, half in the hull's sides.
  const tire = new THREE.CylinderGeometry(r, r, 0.36, 20).rotateZ(Math.PI / 2)
  const rim = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.38, 12).rotateZ(Math.PI / 2)
  for (const [name, x, z] of [
    ['wheel-front-left', 1, -tuning.frontAxleZ],
    ['wheel-front-right', -1, -tuning.frontAxleZ],
    ['wheel-back-left', 1, -tuning.rearAxleZ],
    ['wheel-back-right', -1, -tuning.rearAxleZ],
  ] as const) {
    const wheel = new THREE.Group()
    wheel.name = name
    wheel.position.set(x * tuning.halfTrackWidth, r, z)
    wheel.add(new THREE.Mesh(tire, rubber), new THREE.Mesh(rim, hub))
    group.add(wheel)
  }
  return group
}
