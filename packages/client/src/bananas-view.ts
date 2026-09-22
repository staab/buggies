import { bananaOut, type Banana } from '@buggies/game'
import * as THREE from 'three'

/** Tip to tip, in metres: big enough to be seen from a chase camera. */
export const BANANA_LENGTH = 1.3
/** How fast a banana turns on the spot, in radians a second. */
export const SPIN_RATE = 0.9
/** How far a banana bobs up and down, and how fast. */
const BOB = 0.16
const BOB_RATE = 1.7
/** How a banana lies as it turns: tipped over, so the turn shows its curve. */
const TILT = 0.45

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
  const colours = new Float32Array(position.count * 3)
  const centre = new THREE.Vector3()
  const vertex = new THREE.Vector3()
  const colour = new THREE.Color()
  // A tube's vertices come ring by ring: pinch each ring toward its point on
  // the bend by how near a tip it is.
  for (let i = 0; i < position.count; i++) {
    const ring = Math.floor(i / (around + 1))
    const t = ring / along
    const pinch = Math.max(Math.pow(Math.sin(Math.PI * t), 0.55), 0.12)
    bend.getPointAt(t, centre)
    vertex.fromBufferAttribute(position, i).sub(centre).multiplyScalar(pinch).add(centre)
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
    const nearTip = Math.max(0, 1 - Math.min(t, 1 - t) / 0.1)
    colour.copy(SKIN).lerp(TIP, nearTip * nearTip)
    colours[i * 3] = colour.r
    colours[i * 3 + 1] = colour.g
    colours[i * 3 + 2] = colour.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Where a field's bananas are and when: an arena, or a mirror of one. */
export interface BananaSource {
  readonly bananas: readonly Banana[]
  readonly tick: number
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
 * and bobbing; and, when one is taken, a pop: it shoots up spinning and
 * shrinks away in a ring of sparks.
 */
export class BananaField {
  readonly object = new THREE.Group()

  private readonly source: BananaSource
  private readonly geometry = bananaGeometry()
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    emissive: SKIN,
    emissiveIntensity: 0.12,
  })
  private readonly field: THREE.InstancedMesh
  private readonly spark = new THREE.OctahedronGeometry(0.12)
  private readonly ringGeometry = new THREE.TorusGeometry(1, 0.05, 6, 40).rotateX(Math.PI / 2)
  private readonly placer = new THREE.Object3D()
  private readonly seen: number[]
  private readonly wasOut: boolean[]
  private readonly lastPositions: THREE.Vector3[]
  private readonly pops: Pop[] = []
  private time = 0

  constructor(source: BananaSource) {
    this.source = source
    const count = source.bananas.length
    this.field = new THREE.InstancedMesh(this.geometry, this.material, count)
    this.field.castShadow = true
    this.field.frustumCulled = false
    this.object.add(this.field)
    this.seen = source.bananas.map((banana) => banana.generation)
    this.wasOut = source.bananas.map(() => false)
    this.lastPositions = source.bananas.map((banana) => new THREE.Vector3().copy(banana.position))
    this.update(0)
  }

  /** How many takings are on screen. */
  get popping(): number {
    return this.pops.length
  }

  update(dt: number): void {
    this.time += dt
    const { bananas, tick } = this.source
    for (const [slot, banana] of bananas.entries()) {
      const out = bananaOut(banana, tick)
      // A slot moving on to its next banana means this one was taken.
      if (banana.generation !== this.seen[slot]) {
        if (this.wasOut[slot]) this.pop(this.lastPositions[slot]!)
        this.seen[slot] = banana.generation
      }
      const phase = this.time * BOB_RATE + slot * 1.7
      this.placer.position.set(banana.position.x, banana.position.y + Math.sin(phase) * BOB, banana.position.z)
      this.placer.rotation.set(0, this.time * SPIN_RATE + slot * 0.9, TILT, 'YXZ')
      this.placer.scale.setScalar(out ? 1 : 0)
      this.placer.updateMatrix()
      this.field.setMatrixAt(slot, this.placer.matrix)
      this.lastPositions[slot]!.copy(this.placer.position)
      this.wasOut[slot] = out
    }
    this.field.instanceMatrix.needsUpdate = true
    this.updatePops(dt)
  }

  dispose(): void {
    for (const pop of this.pops) this.remove(pop)
    this.pops.length = 0
    this.object.removeFromParent()
    this.object.clear()
    this.field.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.spark.dispose()
    this.ringGeometry.dispose()
  }

  private pop(at: THREE.Vector3): void {
    const group = new THREE.Group()
    group.position.copy(at)
    const bananaMaterial = this.material.clone()
    bananaMaterial.transparent = true
    const banana = new THREE.Mesh(this.geometry, bananaMaterial)
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
    for (let p = this.pops.length - 1; p >= 0; p--) {
      const pop = this.pops[p]!
      pop.age += dt
      const life = pop.age / POP_LIFE
      if (life >= 1) {
        this.remove(pop)
        this.pops.splice(p, 1)
        continue
      }
      // The banana leaps, spins, and is gone.
      pop.banana.position.y = POP_RISE * (1 - (1 - life) * (1 - life))
      pop.banana.rotation.y += POP_SPIN * dt
      pop.banana.scale.setScalar(Math.max(1 - life * 1.3, 0))
      pop.bananaMaterial.opacity = Math.max(1 - life * 1.3, 0)
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
  }

  private remove(pop: Pop): void {
    this.object.remove(pop.group)
    pop.bananaMaterial.dispose()
    pop.sparkMaterial.dispose()
    pop.ringMaterial.dispose()
  }
}
