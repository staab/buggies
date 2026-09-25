import {
  LOOSE_KINDS,
  LOOSE_MOST,
  OIL_LIFE_TICKS,
  OIL_REACH,
  SPILL_FLIGHT_TICKS,
  SPILL_LIFE_TICKS,
  pickupOut,
  type LooseKind,
  type Pickup,
  type Loose,
} from '@buggies/game'
import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

/** Tip to tip, in meters: big enough to be seen from a chase camera. */
export const BANANA_LENGTH = 3.9
/** How fast a banana turns on the spot, in radians a second. */
export const SPIN_RATE = 0.9
/** How far a banana bobs up and down, and how fast. */
const BOB = 0.16
const BOB_RATE = 1.7
/** How a banana lies as it turns: tipped over, so the turn shows its curve. */
const TILT = 0.45
/** How high a spilled banana's arc goes over the ground it crosses, and how fast it spins in the air. */
const FLING_HEIGHT = 3
const FLING_LIFT = 0.25
const FLING_SPIN = 11

const SKIN = new THREE.Color('#f6d23c')
const TIP = new THREE.Color('#6b4a1e')
const SPARK = new THREE.Color('#fff2a8')

/** How long a banana's taking is on screen, in seconds. */
export const POP_LIFE = 0.9
const SPARKS = 14
const SPARK_SPEED = 5
const SPARK_GRAVITY = 7
const RING_RADIUS = 3
const POP_RISE = 2.4
const POP_SPIN = 14
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * A banana: a tube swept along a bend, thick in the middle and pinched at
 * the tips, which are browned. Built once and shared.
 */
export function bananaGeometry(length = BANANA_LENGTH): THREE.BufferGeometry {
  const bend = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-length / 2, length * 0.22, 0),
    new THREE.Vector3(0, -length * 0.3, 0),
    new THREE.Vector3(length / 2, length * 0.22, 0),
  )
  const along = 24
  const around = 10
  const fullRadius = length * 0.13
  const geometry = new THREE.TubeGeometry(bend, along, fullRadius, around, false)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)
  const center = new THREE.Vector3()
  const vertex = new THREE.Vector3()
  const color = new THREE.Color()
  // A tube's vertices come ring by ring: pinch each ring toward its point on
  // the bend by how near a tip it is.
  for (let i = 0; i < position.count; i++) {
    const ring = Math.floor(i / (around + 1))
    const t = ring / along
    const pinch = Math.max(Math.pow(Math.sin(Math.PI * t), 0.55), 0.12)
    bend.getPointAt(t, center)
    vertex.fromBufferAttribute(position, i).sub(center).multiplyScalar(pinch).add(center)
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
    const nearTip = Math.max(0, 1 - Math.min(t, 1 - t) / 0.1)
    color.copy(SKIN).lerp(TIP, nearTip * nearTip)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Where a field's bananas are and when: an arena, or a mirror of one. */
export interface PickupSource {
  readonly pickups: readonly Pickup[]
  readonly loose: readonly Loose[]
  readonly tick: number
}

/** How wide a bomb is, and how fast it turns as it floats. */
export const BOMB_RADIUS = 0.9
const BOMB_SPIN = 0.5

const IRON = new THREE.Color('#202226')
const FUSE = new THREE.Color('#8a7a5a')
const EMBER = new THREE.Color('#ff9a3c')

/** Parts, each painted one color, merged into one geometry colored by vertex. */
function mergePainted(parts: readonly [THREE.BufferGeometry, THREE.Color][]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  let vertices = 0
  for (const [part, color] of parts) {
    const position = part.getAttribute('position')
    const normal = part.getAttribute('normal')
    const index = part.getIndex()
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i))
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i))
      colors.push(color.r, color.g, color.b)
    }
    if (index !== null) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + vertices)
    vertices += position.count
    part.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  merged.setIndex(indices)
  return merged
}

/** A bomb: a black ball with a short fuse and a glowing end, colored by vertex. Built once and shared. */
export function bombGeometry(radius = BOMB_RADIUS): THREE.BufferGeometry {
  return mergePainted([
    [new THREE.SphereGeometry(radius, 14, 10), IRON],
    [new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, radius * 0.5, 6).translate(0, radius * 1.2, 0), FUSE],
    [new THREE.SphereGeometry(radius * 0.14, 6, 5).translate(0, radius * 1.45, 0), EMBER],
  ])
}

/** How wide a mine is. */
export const MINE_RADIUS = 0.55
const MINE_CASE = new THREE.Color('#3a4030')
const MINE_LIGHT = new THREE.Color('#ff3a2a')

/** A mine: a squat dark disc sitting on the ground, with a red light on top, colored by vertex. Built once and shared. */
export function mineGeometry(radius = MINE_RADIUS): THREE.BufferGeometry {
  return mergePainted([
    [new THREE.CylinderGeometry(radius * 0.85, radius, radius * 0.4, 16).translate(0, radius * 0.2, 0), MINE_CASE],
    [new THREE.SphereGeometry(radius * 0.18, 8, 6).translate(0, radius * 0.45, 0), MINE_LIGHT],
  ])
}

/** How big an oil slick starts, as a share of its full size, the moment it is dropped. */
const OIL_SEED = 0.05

/** An oil slick: a flat, ragged black pool, as wide as a car has to come to it. Built once and shared. */
export function oilGeometry(radius = OIL_REACH): THREE.BufferGeometry {
  const around = 24
  const shape = new THREE.Shape()
  for (let k = 0; k <= around; k++) {
    const angle = (k / around) * Math.PI * 2
    // Ragged, the same way every time: a few lobes and a little wobble.
    const reach = radius * (0.85 + 0.1 * Math.sin(angle * 3 + 1) + 0.05 * Math.sin(angle * 7))
    if (k === 0) shape.moveTo(Math.cos(angle) * reach, Math.sin(angle) * reach)
    else shape.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach)
  }
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2)
}

/** When a loose thing would fade on its own: a banana or a slick in time, a bomb or a mine never. */
function goneTick(thing: Loose): number {
  if (thing.kind === 'banana') return thing.bornTick + SPILL_LIFE_TICKS
  if (thing.kind === 'oil') return thing.bornTick + OIL_LIFE_TICKS
  return Number.POSITIVE_INFINITY
}

/** What a loose thing is known by from one frame to the next: what it is, where it was last drawn, and when it would fade. */
interface Seen {
  kind: LooseKind
  position: THREE.Vector3
  goneTick: number
}

interface Pop {
  group: THREE.Group
  banana: THREE.Mesh
  sparks: THREE.Mesh[]
  velocities: THREE.Vector3[]
  ring: THREE.Mesh
  bananaMaterial: THREE.MeshStandardMaterial
  sparkMaterial: THREE.MeshBasicMaterial
  ringMaterial: THREE.MeshBasicMaterial
  age: number
}

/**
 * The map's bananas, drawn where the simulation has them, turning slowly
 * and bobbing; the bananas spilled from wrecks, each flying out of the
 * blast in an arc, spinning, to lie where it lands; and what cars drop
 * behind them: bombs floating where they were left, mines sitting there,
 * and oil slicks spreading flat where they are dropped. A banana taken pops: it shoots up spinning
 * and shrinks away in a ring of sparks. A bomb or a mine gone went off,
 * and whoever draws the field is told where.
 */
export class PickupField {
  readonly object = new THREE.Group()

  private readonly source: PickupSource
  private readonly bananaShape = bananaGeometry()
  private readonly bananaMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    emissive: SKIN,
    emissiveIntensity: 0.12,
  })
  private readonly bananas: THREE.InstancedMesh
  private readonly bombMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 })
  private readonly oilMaterial = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.08, metalness: 0.4 })
  /** Everything loose, a mesh a kind. */
  private readonly loose: Readonly<Record<LooseKind, THREE.InstancedMesh>>
  private readonly onBomb: (at: Vec3) => void
  private looseSeen = new Map<number, Seen>()
  private readonly spark = new THREE.OctahedronGeometry(0.12)
  private readonly ringGeometry = new THREE.TorusGeometry(1, 0.05, 6, 40).rotateX(Math.PI / 2)
  private readonly placer = new THREE.Object3D()
  private readonly seen: number[]
  private readonly wasOut: boolean[]
  private readonly lastPositions: THREE.Vector3[]
  private pops: Pop[] = []
  private time = 0

  constructor(source: PickupSource, onBomb: (at: Vec3) => void = () => {}) {
    this.source = source
    this.onBomb = onBomb
    this.bananas = new THREE.InstancedMesh(this.bananaShape, this.bananaMaterial, Math.max(source.pickups.length, 1))
    this.loose = {
      banana: new THREE.InstancedMesh(this.bananaShape, this.bananaMaterial, LOOSE_MOST),
      bomb: new THREE.InstancedMesh(bombGeometry(), this.bombMaterial, LOOSE_MOST),
      mine: new THREE.InstancedMesh(mineGeometry(), this.bombMaterial, LOOSE_MOST),
      oil: new THREE.InstancedMesh(oilGeometry(), this.oilMaterial, LOOSE_MOST),
    }
    for (const mesh of [this.bananas, ...Object.values(this.loose)]) {
      mesh.castShadow = true
      mesh.frustumCulled = false
      this.object.add(mesh)
    }
    // An oil slick is a film on the road: it takes shadows, and casts none.
    this.loose.oil.castShadow = false
    this.loose.oil.receiveShadow = true
    this.bananas.count = source.pickups.length
    for (const mesh of Object.values(this.loose)) mesh.count = 0
    this.seen = source.pickups.map((pickup) => pickup.generation)
    this.wasOut = source.pickups.map(() => false)
    this.lastPositions = source.pickups.map((pickup) => new THREE.Vector3().copy(pickup.position))
    this.update(0)
  }

  /** How many takings are on screen. */
  get popping(): number {
    return this.pops.length
  }

  update(dt: number): void {
    this.time += dt
    const { pickups, tick } = this.source
    // What is remembered a slot was made with the field, one a slot.
    for (const [slot, pickup] of pickups.entries()) {
      const out = pickupOut(pickup, tick)
      // A slot moving on to its next banana means this one was taken.
      if (pickup.generation !== this.seen[slot]) {
        if (this.wasOut[slot]) this.pop(this.lastPositions[slot]!)
        this.seen[slot] = pickup.generation
      }
      const phase = this.time * BOB_RATE + slot * 1.7
      this.placer.position.set(pickup.position.x, pickup.position.y + Math.sin(phase) * BOB, pickup.position.z)
      this.placer.rotation.set(0, this.time * SPIN_RATE + slot * 0.9, TILT, 'YXZ')
      this.placer.scale.setScalar(out ? 1 : 0)
      this.placer.updateMatrix()
      this.bananas.setMatrixAt(slot, this.placer.matrix)
      this.lastPositions[slot]!.copy(this.placer.position)
      this.wasOut[slot] = out
    }
    this.bananas.instanceMatrix.needsUpdate = true
    this.updateLoose()
    this.updatePops(dt)
  }

  /**
   * The loose things: bananas in the air for a while after the blast, then
   * lying where they land; bombs floating where they were dropped, mines
   * sitting there and oil slicks lying flat. A banana that goes before its
   * time was taken, and pops; a bomb or a mine that goes went off.
   */
  private updateLoose(): void {
    const { tick } = this.source
    const seen = new Map<number, Seen>()
    const drawn: Record<LooseKind, number> = { banana: 0, bomb: 0, mine: 0, oil: 0 }
    for (const thing of this.source.loose) {
      const { kind } = thing
      const slot = drawn[kind]
      if (slot >= LOOSE_MOST) continue
      const flight = Math.min(Math.max((tick - thing.bornTick) / SPILL_FLIGHT_TICKS, 0), 1)
      const { from, position } = thing
      if (kind === 'oil') {
        // A slick is not thrown: it spreads where it lies, out to its full size as it would have landed.
        this.place(thing, slot)
        this.placer.scale.setScalar(Math.max(1 - (1 - flight) * (1 - flight), OIL_SEED))
      } else if (flight < 1) {
        // Out of the blast, or off the back of the car, in an arc, tumbling.
        const across = Math.hypot(position.x - from.x, position.z - from.z)
        const lift = Math.sin(Math.PI * flight) * (FLING_HEIGHT + FLING_LIFT * across)
        this.placer.position.set(
          from.x + (position.x - from.x) * flight,
          from.y + (position.y - from.y) * flight + lift,
          from.z + (position.z - from.z) * flight,
        )
        this.placer.rotation.set(flight * FLING_SPIN * 0.6, flight * FLING_SPIN + thing.bornTick, kind === 'banana' ? TILT : 0, 'YXZ')
        this.placer.scale.setScalar(0.4 + 0.6 * Math.min(flight * 4, 1))
      } else {
        this.place(thing, slot)
      }
      this.placer.updateMatrix()
      this.loose[kind].setMatrixAt(slot, this.placer.matrix)
      drawn[kind] += 1
      const known = this.looseSeen.get(thing.id)
      const at = known?.position ?? new THREE.Vector3()
      at.copy(this.placer.position)
      seen.set(thing.id, { kind, position: at, goneTick: goneTick(thing) })
    }
    for (const [id, known] of this.looseSeen) {
      if (seen.has(id)) continue
      if (known.kind === 'bomb' || known.kind === 'mine') this.onBomb(known.position)
      else if (known.kind === 'banana' && tick < known.goneTick) this.pop(known.position)
    }
    this.looseSeen = seen
    for (const kind of LOOSE_KINDS) {
      this.loose[kind].count = drawn[kind]
      this.loose[kind].instanceMatrix.needsUpdate = true
    }
  }

  /** Put a loose thing that has landed where it lies: a banana or a bomb bobbing and turning, a mine or a slick still. */
  private place(thing: Loose, slot: number): void {
    const { position } = thing
    const phase = this.time * BOB_RATE + slot * 1.7
    this.placer.scale.setScalar(1)
    switch (thing.kind) {
      case 'banana':
        this.placer.position.set(position.x, position.y + Math.sin(phase) * BOB, position.z)
        this.placer.rotation.set(0, this.time * SPIN_RATE + slot * 0.9, TILT, 'YXZ')
        return
      case 'bomb':
        this.placer.position.set(position.x, position.y + Math.sin(phase) * BOB, position.z)
        this.placer.rotation.set(0, this.time * BOMB_SPIN + slot * 0.9, 0, 'YXZ')
        return
      default:
        // Turned by its number, so no two lie alike.
        this.placer.position.set(position.x, position.y, position.z)
        this.placer.rotation.set(0, thing.id * 2.4, 0, 'YXZ')
    }
  }

  dispose(): void {
    for (const pop of this.pops) this.remove(pop)
    this.pops.length = 0
    this.object.removeFromParent()
    this.object.clear()
    this.bananas.dispose()
    for (const mesh of Object.values(this.loose)) {
      if (mesh.geometry !== this.bananaShape) mesh.geometry.dispose()
      mesh.dispose()
    }
    this.bananaShape.dispose()
    this.bananaMaterial.dispose()
    this.bombMaterial.dispose()
    this.oilMaterial.dispose()
    this.spark.dispose()
    this.ringGeometry.dispose()
  }

  private pop(at: THREE.Vector3): void {
    const group = new THREE.Group()
    group.position.copy(at)
    const bananaMaterial = this.bananaMaterial.clone()
    bananaMaterial.transparent = true
    const banana = new THREE.Mesh(this.bananaShape, bananaMaterial)
    banana.rotation.z = TILT
    group.add(banana)
    const sparkMaterial = new THREE.MeshBasicMaterial({ color: SPARK, transparent: true })
    const sparks: THREE.Mesh[] = []
    const velocities: THREE.Vector3[] = []
    for (let i = 0; i < SPARKS; i++) {
      const angle = i * GOLDEN_ANGLE
      const mesh = new THREE.Mesh(this.spark, sparkMaterial)
      group.add(mesh)
      sparks.push(mesh)
      velocities.push(
        new THREE.Vector3(Math.cos(angle) * SPARK_SPEED, 2.5 + (i % 3) * 1.2, Math.sin(angle) * SPARK_SPEED),
      )
    }
    const ringMaterial = new THREE.MeshBasicMaterial({ color: SKIN, transparent: true, opacity: 0.8 })
    const ring = new THREE.Mesh(this.ringGeometry, ringMaterial)
    ring.scale.setScalar(0.3)
    group.add(ring)
    this.object.add(group)
    this.pops.push({ group, banana, sparks, velocities, ring, bananaMaterial, sparkMaterial, ringMaterial, age: 0 })
  }

  private updatePops(dt: number): void {
    const alive: Pop[] = []
    for (const pop of this.pops) {
      pop.age += dt
      const life = pop.age / POP_LIFE
      if (life >= 1) {
        this.remove(pop)
        continue
      }
      alive.push(pop)
      // The banana leaps, spins, and is gone.
      pop.banana.position.y = POP_RISE * (1 - (1 - life) * (1 - life))
      pop.banana.rotation.y += POP_SPIN * dt
      pop.banana.scale.setScalar(Math.max(1 - life * 1.3, 0))
      pop.bananaMaterial.opacity = Math.max(1 - life * 1.3, 0)
      // The velocities were made alongside the sparks, one each.
      for (const [i, spark] of pop.sparks.entries()) {
        const velocity = pop.velocities[i]!
        velocity.y -= SPARK_GRAVITY * dt
        spark.position.addScaledVector(velocity, dt)
        spark.rotation.x += 9 * dt
        spark.rotation.y += 7 * dt
      }
      pop.sparkMaterial.opacity = 1 - life * life
      // The ring spreads out along the ground and thins away.
      const spread = Math.sqrt(Math.min(life / 0.7, 1))
      pop.ring.scale.setScalar(0.3 + RING_RADIUS * spread)
      pop.ringMaterial.opacity = 0.8 * (1 - spread) * (1 - spread)
    }
    this.pops = alive
  }

  private remove(pop: Pop): void {
    this.object.remove(pop.group)
    pop.bananaMaterial.dispose()
    pop.sparkMaterial.dispose()
    pop.ringMaterial.dispose()
  }
}
