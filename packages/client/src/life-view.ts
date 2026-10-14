import { CLOUD_HEIGHT } from '@buggies/game'
import { createRng, randomInt, randomRange, type Rng, type Vec3 } from '@buggies/physics'
import { randomDirection, roofOver, sphereHeight, tangentFrame, type World } from '@buggies/terrain'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import { KELP_SWAY } from './furniture-view.ts'

/**
 * What lives in a world's water or air, drawn and moved by the page alone:
 * nothing in the game knows of it and nothing runs into it, but it is
 * placed by the world's seed and moved by the game's time, so everyone
 * sees it about alike. Neptune's fish, jellyfish and whales, and the
 * bubbles rising from its vents; the will-o'-the-wisps drifting about
 * Mercury's caverns; and the lightning that comes down out of Venus's
 * cloud onto whatever stands tallest.
 */
export function buildLife(world: World): THREE.Group | null {
  const rng = createRng((world.seed ^ LIFE_SALT) >>> 0)
  const living = world.kind === 'neptune' ? seaLife(world, rng) : world.kind === 'mercury' ? [wisps(world, rng)] : world.kind === 'venus' ? lightning(world) : []
  if (living.length === 0) return null
  const group = new THREE.Group()
  group.name = 'life'
  for (const one of living) group.add(one.object)
  group.userData.move = (seconds: number): void => {
    // The kelp sways in the same time, though it is drawn with the furniture.
    KELP_SWAY.value = seconds
    for (const one of living) one.move(seconds)
  }
  return group
}

const LIFE_SALT = 0x11fe

/** Something living: what is drawn of it, and how it is put where it is at a time. */
interface Living {
  readonly object: THREE.Object3D
  move(seconds: number): void
}

/** A place on the world: the way up there, the ways east and north across the ground, and how high the floor is. */
interface Spot {
  readonly up: THREE.Vector3
  readonly east: THREE.Vector3
  readonly north: THREE.Vector3
  readonly floor: number
}

function spotAt(world: World, at: Vec3): Spot {
  const up = new THREE.Vector3(at.x, at.y, at.z).normalize()
  const { east, north } = tangentFrame(up)
  return { up, east: new THREE.Vector3(east.x, east.y, east.z), north: new THREE.Vector3(north.x, north.y, north.z), floor: sphereHeight(world.ground, up) }
}

/** The point so far east, north and up of a spot's floor, into `out`. */
function besideSpot(world: World, spot: Spot, east: number, north: number, up: number, out: THREE.Vector3): THREE.Vector3 {
  return out
    .copy(spot.up)
    .multiplyScalar(world.radius + spot.floor + up)
    .addScaledVector(spot.east, east)
    .addScaledVector(spot.north, north)
}

/** Whether nothing closes the water in at a way out, nor anywhere round it this far off: no glass for anything swimming there to swim through. */
function openWater(world: World, spot: Spot, reach: number): boolean {
  const probe = new THREE.Vector3()
  for (let k = 0; k <= 8; k++) {
    const angle = (k / 8) * Math.PI * 2
    const out = k === 8 ? 0 : reach
    besideSpot(world, spot, Math.cos(angle) * out, Math.sin(angle) * out, 0, probe)
    if (Number.isFinite(roofOver(world, probe))) return false
  }
  return true
}

/** A place out in the open water, clear of the glass this far round, if one turns up in a few tries. */
function openSpot(world: World, rng: Rng, reach: number): Spot | null {
  for (let tries = 0; tries < 20; tries++) {
    const spot = spotAt(world, randomDirection(rng))
    if (openWater(world, spot, reach)) return spot
  }
  return null
}

/** A shape painted one color, to be merged with others into one model: its corners and their color, nothing else. */
function painted(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const plain = geometry.index === null ? geometry : geometry.toNonIndexed()
  plain.deleteAttribute('uv')
  const tint = new THREE.Color(color)
  const colors = new Float32Array(plain.getAttribute('position').count * 3)
  for (let k = 0; k < colors.length; k += 3) tint.toArray(colors, k)
  plain.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return plain
}

/** A mesh of many of one shape, each put where it is every frame: never left out for being off screen, as its bounds move with it. */
function swarm(geometry: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  return mesh
}

const placed = new THREE.Matrix4()
const at = new THREE.Vector3()
const ahead = new THREE.Vector3()
const across = new THREE.Vector3()
const back = new THREE.Vector3()
const upHere = new THREE.Vector3()
const size = new THREE.Vector3()
const turned = new THREE.Quaternion()

/** Put a swarm's `k`th at a point, its nose (its -z) along `forward`, its y up `up`, this big each way. */
function setPose(mesh: THREE.InstancedMesh, k: number, point: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3, scale: THREE.Vector3): void {
  back.copy(forward).negate()
  across.crossVectors(up, back).normalize()
  upHere.crossVectors(back, across)
  placed.makeBasis(across, upHere, back)
  turned.setFromRotationMatrix(placed)
  placed.compose(point, turned, scale)
  mesh.setMatrixAt(k, placed)
}

// Neptune.

/** Schools of fish: how many, how many fish in each, how far round each swims its loop, how high, and how fast. */
const SCHOOLS = { count: 30, fish: [14, 30], loop: [10, 26], over: [3, 14], speed: [3, 6], size: [0.5, 1.2] } as const
const FISH_COLORS = ['#c9d6e3', '#f2c94c', '#f28c38', '#4fc3c8', '#9b8cff', '#e86a6a']
/** Jellyfish: how many, how big, how high over the floor and how far they bob, and their glows. */
const JELLIES = { count: 90, size: [0.6, 1.8], over: [6, 30], bob: [2, 4] } as const
const JELLY_GLOWS = ['#ff8fd0', '#a98bff', '#7fe3ff']
/** Vents in the sea floor: how many, and how many bubbles rise from each at once, how fast and how big. */
const VENTS = { count: 48, bubbles: 12, speed: [1.5, 2.6], size: [0.12, 0.32] } as const
/** Whales: how many, how long, how far under the surface they swim, and how fast. */
const WHALES = { count: 2, length: [18, 24], under: 9, speed: [4, 6] } as const

function seaLife(world: World, rng: Rng): Living[] {
  return [fishSchools(world, rng), jellyfish(world, rng), vents(world, rng), ...whales(world, rng)]
}

/** A fish a unit long, nose along -z: a body of eight facets, and a tail. */
function fishGeometry(): THREE.BufferGeometry {
  const nose = [0, 0, -0.5]
  const top = [0, 0.13, -0.05]
  const bottom = [0, -0.11, -0.05]
  const left = [-0.07, 0, -0.05]
  const right = [0.07, 0, -0.05]
  const stock = [0, 0, 0.3]
  const fin = [
    [0, 0.15, 0.5],
    [0, -0.15, 0.5],
  ]
  const faces = [
    [nose, top, right],
    [nose, right, bottom],
    [nose, bottom, left],
    [nose, left, top],
    [stock, right, top],
    [stock, bottom, right],
    [stock, left, bottom],
    [stock, top, left],
    [stock, fin[0]!, fin[1]!],
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat(2), 3))
  geometry.computeVertexNormals()
  return geometry
}

/** A fish in a school: where it keeps in the school, along, across and up, when it wags, and how big it is for its kind. */
interface Fish {
  readonly along: number
  readonly across: number
  readonly up: number
  readonly wag: number
  readonly scale: number
}

/** A school: where it swims its loop round, how far round and how high over the floor, how fast and which way, and its fish. */
interface School {
  readonly spot: Spot
  readonly loop: number
  readonly over: number
  readonly speed: number
  readonly start: number
  readonly size: number
  readonly color: THREE.Color
  readonly fish: readonly Fish[]
}

/** Schools of fish swimming loops out over the sea floor, each fish keeping its place in the school, and wagging. */
function fishSchools(world: World, rng: Rng): Living {
  const schools: School[] = []
  for (let k = 0; k < SCHOOLS.count; k++) {
    const loop = randomRange(rng, ...SCHOOLS.loop)
    const spot = openSpot(world, rng, loop + 8)
    if (spot === null) continue
    const fish = Array.from({ length: randomInt(rng, ...SCHOOLS.fish) }, () => ({
      along: randomRange(rng, -5, 5),
      across: randomRange(rng, -3, 3),
      up: randomRange(rng, -1.5, 1.5),
      wag: randomRange(rng, 0, Math.PI * 2),
      scale: randomRange(rng, 0.85, 1.15),
    }))
    schools.push({
      spot,
      loop,
      over: randomRange(rng, ...SCHOOLS.over),
      speed: randomRange(rng, ...SCHOOLS.speed) * (rng() < 0.5 ? -1 : 1),
      start: randomRange(rng, 0, Math.PI * 2),
      size: randomRange(rng, ...SCHOOLS.size),
      color: new THREE.Color(FISH_COLORS[k % FISH_COLORS.length]!),
      fish,
    })
  }
  const count = schools.reduce((sum, school) => sum + school.fish.length, 0)
  const mesh = swarm(fishGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3, flatShading: true, side: THREE.DoubleSide }), Math.max(count, 1))
  mesh.count = count
  let k = 0
  for (const school of schools) school.fish.forEach(() => mesh.setColorAt(k++, school.color))
  const middle = new THREE.Vector3()
  const way = new THREE.Vector3()
  const side = new THREE.Vector3()
  return {
    object: mesh,
    move(seconds) {
      let k = 0
      for (const school of schools) {
        const { spot, loop } = school
        const angle = school.start + (school.speed * seconds) / loop
        const bob = Math.sin(seconds * 0.3 + school.start) * 1.5
        besideSpot(world, spot, Math.cos(angle) * loop, Math.sin(angle) * loop, school.over + bob, middle)
        // Along the loop, the way it goes round.
        way
          .copy(spot.east)
          .multiplyScalar(-Math.sin(angle))
          .addScaledVector(spot.north, Math.cos(angle))
          .multiplyScalar(Math.sign(school.speed))
        side.crossVectors(spot.up, way)
        for (const fish of school.fish) {
          const wag = Math.sin(seconds * 3 + fish.wag)
          at.copy(middle)
            .addScaledVector(way, fish.along)
            .addScaledVector(side, fish.across + wag * 0.2)
            .addScaledVector(spot.up, fish.up)
          ahead.copy(way).addScaledVector(side, wag * 0.15).normalize()
          size.setScalar(school.size * fish.scale)
          setPose(mesh, k++, at, ahead, spot.up, size)
        }
      }
      mesh.instanceMatrix.needsUpdate = true
    },
  }
}

/** A jellyfish a unit across: a bell over its rim, and tentacles and arms hanging from it. */
function jellyGeometry(): THREE.BufferGeometry {
  const bell = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.45)
  bell.translate(0, -Math.cos(Math.PI * 0.45), 0)
  const parts = [painted(bell, '#ffffff')]
  for (let k = 0; k < 10; k++) {
    const angle = (k / 10) * Math.PI * 2
    const long = k % 2 === 0 ? 2.6 : 1.7
    const tentacle = new THREE.ConeGeometry(0.035, long, 3)
    tentacle.rotateX(Math.PI)
    tentacle.translate(Math.cos(angle) * 0.75, -long / 2, Math.sin(angle) * 0.75)
    parts.push(painted(tentacle, '#ffffff'))
  }
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.ConeGeometry(0.12, 1.2, 4)
    arm.rotateX(Math.PI)
    arm.translate(Math.cos(k * 1.6) * 0.15, -0.6, Math.sin(k * 1.6) * 0.15)
    parts.push(painted(arm, '#ffffff'))
  }
  return mergeGeometries(parts)
}

/** Jellyfish drifting up and down over the sea floor, glowing, their bells pulsing. */
function jellyfish(world: World, rng: Rng): Living {
  const shape = jellyGeometry()
  const jellies = JELLY_GLOWS.map(() => [] as { spot: Spot; over: number; bob: number; period: number; pulse: number; phase: number; size: number }[])
  for (let k = 0; k < JELLIES.count; k++) {
    const spot = openSpot(world, rng, 4)
    if (spot === null) continue
    // Under the surface, however shallow the sea is there.
    const deep = -spot.floor - 4
    jellies[k % JELLY_GLOWS.length]!.push({
      spot,
      over: Math.min(randomRange(rng, ...JELLIES.over), deep),
      bob: randomRange(rng, ...JELLIES.bob),
      period: randomRange(rng, 25, 45),
      pulse: randomRange(rng, 3.5, 6),
      phase: randomRange(rng, 0, Math.PI * 2),
      size: randomRange(rng, ...JELLIES.size),
    })
  }
  const meshes = JELLY_GLOWS.map((glow, k) => {
    const color = new THREE.Color(glow)
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.3, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
    const mesh = swarm(shape, material, Math.max(jellies[k]!.length, 1))
    mesh.count = jellies[k]!.length
    return mesh
  })
  const group = new THREE.Group()
  for (const mesh of meshes) group.add(mesh)
  return {
    object: group,
    move(seconds) {
      meshes.forEach((mesh, glow) => {
        jellies[glow]!.forEach((jelly, k) => {
          const rise = Math.sin((seconds / jelly.period) * Math.PI * 2 + jelly.phase) * jelly.bob
          const drift = (seconds / 60) * Math.PI * 2 + jelly.phase
          besideSpot(world, jelly.spot, Math.cos(drift) * 2, Math.sin(drift) * 2, jelly.over + rise, at)
          // A pulse: the bell squeezed narrow and tall, then let out wide and low.
          const pulse = Math.max(0, Math.sin(seconds * jelly.pulse + jelly.phase)) ** 2
          size.set(jelly.size * (1 - 0.15 * pulse), jelly.size * (1 + 0.2 * pulse), jelly.size * (1 - 0.15 * pulse))
          setPose(mesh, k, at, jelly.spot.east, jelly.spot.up, size)
        })
        mesh.instanceMatrix.needsUpdate = true
      })
    },
  }
}

/** Vents in the sea floor, dark chimneys with a stream of bubbles rising from each to the surface, swelling as they go. */
function vents(world: World, rng: Rng): Living {
  const found: { spot: Spot; speed: number; size: number; phase: number }[] = []
  for (let k = 0; k < VENTS.count; k++) {
    const spot = openSpot(world, rng, 3)
    if (spot !== null) found.push({ spot, speed: randomRange(rng, ...VENTS.speed), size: randomRange(rng, ...VENTS.size), phase: randomRange(rng, 0, 100) })
  }
  const chimney = new THREE.CylinderGeometry(0.5, 1.4, 2.6, 7)
  chimney.translate(0, 1, 0)
  const chimneys = swarm(chimney, new THREE.MeshStandardMaterial({ color: '#2e2b29', roughness: 0.95, flatShading: true }), Math.max(found.length, 1))
  chimneys.count = found.length
  found.forEach((vent, k) => {
    besideSpot(world, vent.spot, 0, 0, 0, at)
    setPose(chimneys, k, at, vent.spot.east, vent.spot.up, size.setScalar(1))
  })
  const bubbles = swarm(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#d8f1ff', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45, depthWrite: false }),
    Math.max(found.length * VENTS.bubbles, 1),
  )
  bubbles.count = found.length * VENTS.bubbles
  const group = new THREE.Group()
  group.add(chimneys, bubbles)
  return {
    object: group,
    move(seconds) {
      found.forEach((vent, v) => {
        // From the chimney's mouth up to the surface, and round again.
        const height = -vent.spot.floor - 3
        for (let b = 0; b < VENTS.bubbles; b++) {
          const share = (((seconds * vent.speed) / height + b / VENTS.bubbles + vent.phase) % 1 + 1) % 1
          const wobble = seconds * 2.2 + b * 1.7
          besideSpot(world, vent.spot, Math.sin(wobble) * 0.3, Math.cos(wobble * 0.8) * 0.3, 2.6 + share * height, at)
          size.setScalar(vent.size * (1 + share * 0.8))
          setPose(bubbles, v * VENTS.bubbles + b, at, vent.spot.east, vent.spot.up, size)
        }
      })
      bubbles.instanceMatrix.needsUpdate = true
    },
  }
}

/** A whale's body, a unit long, nose along -z: a long rounded spindle, a little flat, dark over a pale belly, with a fin either side. */
function whaleBody(): THREE.BufferGeometry {
  const profile = [
    [0, 0],
    [0.04, 0.03],
    [0.08, 0.12],
    [0.12, 0.3],
    [0.14, 0.5],
    [0.135, 0.7],
    [0.11, 0.86],
    [0.07, 0.96],
    [0, 1],
  ].map(([r, along]) => new THREE.Vector2(r, along))
  const body = new THREE.LatheGeometry(profile, 16)
  body.translate(0, -0.5, 0)
  body.rotateX(-Math.PI / 2)
  body.scale(1, 0.85, 1)
  const plain = body.toNonIndexed()
  plain.deleteAttribute('uv')
  const corners = plain.getAttribute('position')
  const colors = new Float32Array(corners.count * 3)
  const back = new THREE.Color('#2f3b4a')
  const belly = new THREE.Color('#c9c4b8')
  const color = new THREE.Color()
  for (let k = 0; k < corners.count; k++) color.copy(belly).lerp(back, THREE.MathUtils.smoothstep(corners.getY(k), -0.06, 0.02)).toArray(colors, k * 3)
  plain.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const fins = [-1, 1].map((side) => {
    const fin = new THREE.BufferGeometry()
    fin.setAttribute('position', new THREE.Float32BufferAttribute([side * 0.1, -0.04, -0.2, side * 0.32, -0.12, -0.08, side * 0.1, -0.05, -0.08], 3))
    fin.computeVertexNormals()
    return painted(fin, '#2f3b4a')
  })
  return mergeGeometries([plain, ...fins])
}

/** A whale's flukes, a unit across the whale's length: flat, spreading back from where they join its tail. */
function whaleFlukes(): THREE.BufferGeometry {
  const flukes = new THREE.BufferGeometry()
  flukes.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.16, 0, 0.12, -0.05, 0, 0.06, 0, 0, 0, 0.05, 0, 0.06, 0.16, 0, 0.12], 3))
  flukes.computeVertexNormals()
  return painted(flukes, '#2f3b4a')
}

/** Whales swimming slowly right round the world, high over the stations, beating their flukes. */
function whales(world: World, rng: Rng): Living[] {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true, side: THREE.DoubleSide })
  const bodyShape = whaleBody()
  const flukeShape = whaleFlukes()
  return Array.from({ length: WHALES.count }, () => {
    const length = randomRange(rng, ...WHALES.length)
    // The great circle it swims round: two ways out square to each other, across its plane.
    const from = new THREE.Vector3().copy(randomDirection(rng) as THREE.Vector3Like)
    const toward = new THREE.Vector3().copy(randomDirection(rng) as THREE.Vector3Like)
    toward.addScaledVector(from, -toward.dot(from)).normalize()
    const speed = randomRange(rng, ...WHALES.speed)
    const height = world.seaLevel - WHALES.under
    const whale = new THREE.Group()
    const body = new THREE.Mesh(bodyShape, material)
    body.scale.setScalar(length)
    const tail = new THREE.Group()
    tail.position.set(0, 0, length / 2)
    const flukes = new THREE.Mesh(flukeShape, material)
    flukes.scale.setScalar(length)
    tail.add(flukes)
    whale.add(body, tail)
    const forward = new THREE.Vector3()
    const out = new THREE.Vector3()
    const pose = new THREE.Matrix4()
    return {
      object: whale,
      move(seconds: number) {
        const angle = (seconds * speed) / (world.radius + height)
        out.copy(from).multiplyScalar(Math.cos(angle)).addScaledVector(toward, Math.sin(angle))
        forward.copy(from).multiplyScalar(-Math.sin(angle)).addScaledVector(toward, Math.cos(angle))
        const beat = seconds * 1.1
        whale.position.copy(out).multiplyScalar(world.radius + height + Math.sin(beat * 0.5) * 0.6)
        back.copy(forward).negate()
        across.crossVectors(out, back).normalize()
        upHere.crossVectors(back, across)
        pose.makeBasis(across, upHere, back)
        whale.quaternion.setFromRotationMatrix(pose)
        // Nose a little up as the flukes come down, and down as they go up.
        body.rotation.x = Math.cos(beat) * 0.03
        tail.rotation.x = Math.sin(beat) * 0.35
      },
    }
  })
}

// Mercury.

/** Will-o'-the-wisps: how many in each cavern, how big each glow is, how far out from the cavern's middle they wander and how high, and their colors. */
const WISPS = { each: [20, 30], glow: 3.2, out: [0.1, 0.55], over: [3, 0.4] } as const
const WISP_COLORS = ['#9fffe0', '#a8d8ff', '#ffe6a0'].map((hex) => new THREE.Color(hex))

/** A soft round glow, white at its heart and fading to nothing at its edge. */
function glowTexture(): THREE.DataTexture {
  const side = 64
  const pixels = new Uint8Array(side * side * 4)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const r = Math.hypot(x - side / 2 + 0.5, y - side / 2 + 0.5) / (side / 2)
      const glow = Math.max(0, Math.exp(-r * r * 5) - Math.exp(-5)) + Math.max(0, 1 - r * 6)
      const k = (y * side + x) * 4
      pixels.fill(255, k, k + 3)
      pixels[k + 3] = Math.round(Math.min(1, glow) * 255)
    }
  }
  const texture = new THREE.DataTexture(pixels, side, side)
  // Smooth however big it is drawn, as a glow is close up.
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

/** Will-o'-the-wisps: pale glows drifting about each cavern's air, wandering slowly, bobbing and flickering. */
function wisps(world: World, rng: Rng): Living {
  const found: { spot: Spot; out: number; turn: number; start: number; over: number; color: THREE.Color; phase: number }[] = []
  for (const cavern of world.districts) {
    const spot = spotAt(world, cavern.center)
    const room = roofOver(world, cavern.center) - spot.floor
    if (!Number.isFinite(room) || room < WISPS.over[0] * 2) continue
    const count = randomInt(rng, ...WISPS.each)
    for (let k = 0; k < count; k++) {
      found.push({
        spot,
        out: randomRange(rng, ...WISPS.out) * cavern.radius,
        turn: randomRange(rng, 0.02, 0.06) * (rng() < 0.5 ? -1 : 1),
        start: randomRange(rng, 0, Math.PI * 2),
        over: randomRange(rng, WISPS.over[0], room * WISPS.over[1]),
        color: WISP_COLORS[k % WISP_COLORS.length]!,
        phase: randomRange(rng, 0, 100),
      })
    }
  }
  const positions = new Float32Array(found.length * 3)
  const colors = new Float32Array(found.length * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage))
  const material = new THREE.PointsMaterial({ size: WISPS.glow, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  const shine = new THREE.Color()
  return {
    object: points,
    move(seconds) {
      found.forEach((wisp, k) => {
        const angle = wisp.start + seconds * wisp.turn
        const out = wisp.out * (1 + 0.25 * Math.sin(seconds * 0.07 + wisp.phase))
        const jitter = seconds * 2.3 + wisp.phase
        besideSpot(
          world,
          wisp.spot,
          Math.cos(angle) * out + Math.sin(jitter) * 0.3,
          Math.sin(angle) * out + Math.cos(jitter * 1.3) * 0.3,
          wisp.over + Math.sin(seconds * 0.2 + wisp.phase) * 2,
          at,
        ).toArray(positions, k * 3)
        // A flicker, now brighter, now dimmer, never quite out.
        const flicker = (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(seconds * 5 + wisp.phase))) * (0.75 + 0.25 * Math.sin(seconds * 13 + wisp.phase * 2))
        shine.copy(wisp.color).multiplyScalar(flicker).toArray(colors, k * 3)
      })
      geometry.attributes.position!.needsUpdate = true
      geometry.attributes.color!.needsUpdate = true
    },
  }
}

// Venus.

/**
 * Lightning: how many seconds apart its strokes come, give or take, how
 * long each shows, how many kinks a stroke has and how far it wanders from
 * the straight line down, how thick it and its glow are, and how bright its
 * flash lights everything.
 */
const LIGHTNING = { every: 7, shows: 0.4, kinks: 14, wander: 0.08, thick: 0.35, glow: 1.8, flash: 2.4 } as const
/** What lightning strikes: the tallest things standing. */
const STRUCK: readonly string[] = ['monolith', 'spire', 'screw']

/** A number from 0 to 1 that only these two numbers decide, the same on every page. */
function hashed(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** How bright a stroke is this long after it struck: a flash, a dip, a second flash, and gone. */
function flicker(since: number): number {
  if (since < 0.08) return 1
  if (since < 0.14) return 0.25
  if (since < 0.22) return 0.85
  return Math.max(0, 1 - (since - 0.22) / (LIGHTNING.shows - 0.22)) * 0.5
}

/**
 * Lightning coming down out of the cloud now and again onto the top of a
 * monolith, a spire or a screw tower, jagged, and lighting everything as
 * it flashes. When it strikes, and where, and how it zigzags, are all the
 * game's time and the world's seed, the same for everyone.
 */
function lightning(world: World): Living[] {
  const tops = world.buildings
    .filter((building) => STRUCK.includes(building.kind))
    .map((building) => new THREE.Vector3(building.at.x, building.at.y, building.at.z).setLength(Math.hypot(building.at.x, building.at.y, building.at.z) + building.height))
  if (tops.length === 0) return []
  const stroke = new THREE.MeshBasicMaterial({ color: '#f4f0ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const halo = new THREE.MeshBasicMaterial({ color: '#9db4ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const bolt = new THREE.Mesh(new THREE.BufferGeometry(), stroke)
  const glow = new THREE.Mesh(new THREE.BufferGeometry(), halo)
  for (const mesh of [bolt, glow]) {
    mesh.frustumCulled = false
    mesh.visible = false
  }
  // Lit up all over by a flash: there at nothing the rest of the time, so the shaders never change for it.
  const flash = new THREE.AmbientLight('#e8e4ff', 0)
  const group = new THREE.Group()
  group.add(bolt, glow, flash)
  let shown = -1
  const salt = world.seed % 9973
  /** The `k`th stroke's path, from the cloud down to its target, zigzagging, into the bolt and its glow. */
  const draw = (k: number): void => {
    const target = tops[Math.floor(hashed(k, salt) * tops.length)]!
    const up = target.clone().normalize()
    const { east, north } = tangentFrame(up)
    const across = new THREE.Vector3(east.x, east.y, east.z)
    const along = new THREE.Vector3(north.x, north.y, north.z)
    const from = up.clone().multiplyScalar(world.radius + CLOUD_HEIGHT)
    from.addScaledVector(across, (hashed(k, salt + 1) - 0.5) * 60).addScaledVector(along, (hashed(k, salt + 2) - 0.5) * 60)
    const length = from.distanceTo(target)
    const points = Array.from({ length: LIGHTNING.kinks + 1 }, (_, i) => {
      const share = i / LIGHTNING.kinks
      const point = from.clone().lerp(target, share)
      // Kinked aside, most in the middle, none where it leaves the cloud or strikes.
      const wander = Math.sin(share * Math.PI) * LIGHTNING.wander * length
      return point.addScaledVector(across, (hashed(k, salt + 3 + i) - 0.5) * 2 * wander).addScaledVector(along, (hashed(k, salt + 40 + i) - 0.5) * 2 * wander)
    })
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 0; i < LIGHTNING.kinks; i++) path.add(new THREE.LineCurve3(points[i]!, points[i + 1]!))
    bolt.geometry.dispose()
    glow.geometry.dispose()
    bolt.geometry = new THREE.TubeGeometry(path, LIGHTNING.kinks * 2, LIGHTNING.thick, 4, false)
    glow.geometry = new THREE.TubeGeometry(path, LIGHTNING.kinks * 2, LIGHTNING.glow, 5, false)
  }
  return [
    {
      object: group,
      move(seconds) {
        // The stroke now showing, if one is: the last to have struck, if it struck lately enough.
        const latest = Math.floor(seconds / LIGHTNING.every)
        let since = Infinity
        let striking = -1
        for (const k of [latest, latest - 1]) {
          const at = (k + hashed(k, salt + 99) * 0.7) * LIGHTNING.every
          if (seconds >= at && seconds - at < LIGHTNING.shows) {
            since = seconds - at
            striking = k
          }
        }
        if (striking < 0) {
          bolt.visible = glow.visible = false
          flash.intensity = 0
          return
        }
        if (striking !== shown) {
          draw(striking)
          shown = striking
        }
        const bright = flicker(since)
        bolt.visible = glow.visible = true
        stroke.opacity = bright
        halo.opacity = bright * 0.35
        flash.intensity = bright * LIGHTNING.flash
      },
    },
  ]
}
