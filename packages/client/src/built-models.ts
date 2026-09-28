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

/** A mesh that shines rather than stands: drawn over what is behind it, casting no shadow, and no part of the body it is fitted by. */
function glowing(geometry: THREE.BufferGeometry, color: string, opacity: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  )
  mesh.userData.glow = true
  mesh.castShadow = false
  return mesh
}

/** Make a glow flicker as a flame does, every copy of it alike, about the opacity it was made with. */
function flicker(mesh: THREE.Mesh, rate: number, depth: number): void {
  const material = mesh.material as THREE.MeshBasicMaterial
  const base = material.opacity
  const phase = Math.random() * 10
  material.onBeforeRender = () => {
    const t = performance.now() / 1000 * rate + phase
    material.opacity = base * (1 - depth * (0.5 + 0.3 * Math.sin(t * 7.3) + 0.2 * Math.sin(t * 13.1)))
  }
}

/**
 * A thin swept blade, a fin or a wing, standing out from the fuselage's
 * axis this far at this angle round it: its root along the hull from
 * `rootFrom` to `rootTo`, its tip this far out, swept back by `sweep`.
 */
function blade(
  paint: THREE.Material,
  at: { angle: number; out: number; middle: number },
  root: { from: number; to: number },
  span: number,
  tipChord: number,
  sweep: number,
): THREE.Mesh {
  const shape = new THREE.Shape()
  shape.moveTo(root.from, 0)
  shape.lineTo(root.to, 0)
  shape.lineTo(root.to - sweep, span)
  shape.lineTo(root.to - sweep - tipChord, span)
  shape.closePath()
  const thickness = 0.05
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 })
  geometry.translate(0, 0, -thickness / 2)
  // Along the shape's x to the hull's length, its y out from the axis, its depth round it.
  const c = Math.cos(at.angle)
  const s = Math.sin(at.angle)
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(c, s, 0), new THREE.Vector3(-s, c, 0)))
  const mesh = new THREE.Mesh(geometry, paint)
  mesh.position.set(c * at.out, at.middle + s * at.out, 0)
  return mesh
}

/**
 * A rocket ship out of an old picture of the future: a gleaming hull that
 * swells from its engine and sweeps to a needle nose, red at the tip and
 * banded in chrome, a bubble canopy, portholes lit along its sides, three
 * swept fins at the tail and a stub wing either side out to the chassis's
 * width with a thruster pod on its tip. The engine's bell glows, and its
 * flame and the pods' flicker behind it; under it, the glow of the
 * thrusters it hovers on. It has no wheels.
 */
export function buildRocketShip(tuning: VehicleTuning): THREE.Group {
  const group = new THREE.Group()
  const w = tuning.chassisHalfWidth
  const l = tuning.chassisHalfLength
  const hover = restingRideHeight(tuning, DEFAULT_WORLD_TUNING.gravity) - tuning.chassisHalfHeight
  const radius = tuning.chassisHalfHeight * 1.1
  const hull = material('#eef0f2', { metalness: 0.45, roughness: 0.22 })
  const trim = material('#d3362a', { metalness: 0.35, roughness: 0.35 })
  const chrome = material('#d5dae2', { metalness: 1, roughness: 0.18 })
  const dark = material('#26292e', { metalness: 0.8, roughness: 0.35 })
  const glass = material('#6fd0ff', { metalness: 0.3, roughness: 0.04, transparent: true, opacity: 0.7 })
  const lit = new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffb347', emissiveIntensity: 1.4, roughness: 0.3 })

  const middle = hover + radius
  // The hull, turned about its axis from the engine to the nose: how wide it is along the way, 0 at the tail to 1 at the tip.
  const tail = -l + 0.35
  const along = (t: number): number => tail + (l - tail) * t
  const girth = (t: number): number => {
    if (t < 0.3) return radius * (0.72 + 0.28 * Math.sin((t / 0.3) * (Math.PI / 2)))
    if (t < 0.5) return radius
    const u = (t - 0.5) / 0.5
    return radius * Math.sqrt(Math.max(1 - u * u, 0)) * (1 - 0.3 * u)
  }
  const lathe = (from: number, to: number, paint: THREE.Material, grow = 1): THREE.Mesh => {
    const steps = Math.max(2, Math.round((to - from) * 60))
    const points: THREE.Vector2[] = []
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps
      points.push(new THREE.Vector2(girth(t) * grow, along(t)))
    }
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, 32).rotateX(Math.PI / 2), paint)
    mesh.position.y = middle
    return mesh
  }
  group.add(lathe(0, 0.08, trim), lathe(0.08, 0.5, hull), lathe(0.5, 0.53, chrome, 1.015), lathe(0.53, 0.84, hull), lathe(0.84, 1, trim))

  // The canopy, a bubble set into the top of the hull ahead of the middle, on a chrome sill.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass)
  canopy.scale.set(radius * 0.62, radius * 0.62, l * 0.34)
  canopy.position.set(0, middle + radius * 0.62, along(0.56))
  group.add(canopy)
  const sill = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 32).rotateX(Math.PI / 2), chrome)
  sill.scale.set(radius * 0.62, 1, l * 0.34)
  sill.position.copy(canopy.position)
  group.add(sill)

  // Portholes along either side, rimmed in chrome and lit from within.
  for (const side of [-1, 1]) {
    for (const t of [0.22, 0.32, 0.42]) {
      const at = new THREE.Vector3(side * girth(t) * 0.97, middle + radius * 0.15, along(t))
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.17, radius * 0.04, 6, 20).rotateY(Math.PI / 2), chrome)
      rim.position.copy(at)
      const pane = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.17, 20).rotateY((side * Math.PI) / 2), lit)
      pane.position.copy(at).x += side * 0.005
      group.add(rim, pane)
    }
  }

  // Three swept fins at the tail, one standing up and two splayed down and out, as far out as the chassis is wide.
  const root = { from: tail - 0.1, to: along(0.3) }
  const splay = Math.PI / 6
  const low = Math.min((w - radius * 0.8) / Math.cos(splay), (middle - 0.1 - radius * 0.8 * Math.sin(splay)) / Math.sin(splay))
  group.add(blade(trim, { angle: Math.PI / 2, out: radius * 0.8, middle }, root, radius * 1.3, l * 0.22, l * 0.3))
  for (const angle of [-splay, Math.PI + splay]) group.add(blade(trim, { angle, out: radius * 0.8, middle }, root, low, l * 0.22, l * 0.3))

  // A stub wing either side, level and swept, with a thruster pod on its tip.
  const pod = 0.11
  const reach = w - pod - radius * 0.8
  for (const [side, angle] of [[1, 0], [-1, Math.PI]] as const) {
    group.add(blade(hull, { angle, out: radius * 0.8, middle: middle - radius * 0.25 }, { from: along(0.3), to: along(0.55) }, reach, l * 0.18, l * 0.22))
    const x = side * (w - pod)
    const z = along(0.36)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(pod, pod * 0.8, l * 0.42, 14).rotateX(Math.PI / 2), chrome)
    body.position.set(x, middle - radius * 0.25, z)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(pod, 14, 8), trim)
    tip.position.set(x, middle - radius * 0.25, z + l * 0.21)
    const jet = glowing(new THREE.ConeGeometry(pod * 0.75, 0.55, 12, 1, true).rotateX(-Math.PI / 2), '#7fd8ff', 0.8)
    jet.position.set(x, middle - radius * 0.25, z - l * 0.21 - 0.27)
    flicker(jet, 1.3, 0.5)
    group.add(body, tip, jet)
  }

  // The engine: a flared bell at the tail, glowing in its throat, and the flame out of it, a hot core inside a wider plume.
  const mouth = -l
  const bell = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(radius * 0.42, tail + 0.02), new THREE.Vector2(radius * 0.5, tail - 0.12), new THREE.Vector2(radius * 0.78, mouth)], 28).rotateX(Math.PI / 2),
    dark,
  )
  bell.position.y = middle
  group.add(bell)
  const throat = glowing(new THREE.CircleGeometry(radius * 0.7, 28).rotateY(Math.PI), '#ffb347', 0.95)
  throat.position.set(0, middle, mouth + 0.08)
  const plume = glowing(new THREE.ConeGeometry(radius * 0.7, 1.6, 20, 1, true).rotateX(-Math.PI / 2), '#ff7a1c', 0.55)
  plume.position.set(0, middle, mouth - 0.8)
  const core = glowing(new THREE.ConeGeometry(radius * 0.38, 0.9, 16, 1, true).rotateX(-Math.PI / 2), '#bfe8ff', 0.9)
  core.position.set(0, middle, mouth - 0.45)
  flicker(plume, 1, 0.6)
  flicker(core, 1.7, 0.35)
  group.add(throat, plume, core)

  // The thrusters it hovers on, seen only as a glow on the ground under it.
  const wash = glowing(new THREE.CircleGeometry(1, 32).rotateX(Math.PI / 2), '#58b8ff', 0.35)
  wash.scale.set(w * 0.8, 1, l * 0.7)
  wash.position.set(0, Math.max(hover * 0.5, 0.05), 0)
  flicker(wash, 0.6, 0.4)
  group.add(wash)

  // Where the ground is under it, as it hovers: nothing to be seen, only
  // what the model is fitted to the road by, so it floats at its height.
  const ground = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.1), dark)
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
