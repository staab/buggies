import { SPIDER_BELLY, SPIDER_BODY, SPIDER_REACH, type Spider } from '@buggies/game'
import * as THREE from 'three'

import type { PresenceEffects } from './car-presence.ts'
import { distanceFrom, type Ear } from './ear.ts'
import { MACHINE_SMOKING } from './robots-view.ts'

/** Where the spiders are: an arena, or a mirror of one. */
export interface SpiderSource {
  readonly spiders: readonly Spider[]
}

/** How far a foot swings through a step, fore and aft, and how high it lifts, in meters. */
const STEP = 5.5
const LIFT = 2.8
/** How high over the hip each knee stands. */
const KNEE_RISE = 6
const STILL = { x: 0, y: 0, z: 0 }

interface Leg {
  hip: THREE.Vector3
  rest: THREE.Vector3
  upper: THREE.Mesh
  lower: THREE.Mesh
  /** Which half of the legs it steps with: the other half is planted meanwhile. */
  half: number
}

interface Shown {
  model: THREE.Group
  legs: Leg[]
  deaths: number
}

const UP = new THREE.Vector3(0, 1, 0)
const foot = new THREE.Vector3()
const knee = new THREE.Vector3()
const out = new THREE.Vector3()
const along = new THREE.Vector3()

/** Stretch a unit cylinder from one point to another. */
function span(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  along.subVectors(to, from)
  const length = along.length()
  mesh.position.copy(from).addScaledVector(along, 0.5)
  mesh.quaternion.setFromUnitVectors(UP, along.divideScalar(length || 1))
  mesh.scale.set(1, length, 1)
}

/**
 * A giant spider: a dark round body hung high between eight long legs,
 * four a side, each bent up at a knee over its hip and down to a foot
 * planted well out on the ground, with a cluster of red eyes at its front.
 * Its feet are at y = 0, and it faces -Z, the way the cars face.
 */
export function buildSpider(): { model: THREE.Group; legs: Leg[] } {
  const model = new THREE.Group()
  const shell = new THREE.MeshStandardMaterial({ color: '#2a2320', roughness: 0.6, metalness: 0.2 })
  const band = new THREE.MeshStandardMaterial({ color: '#b8322a', roughness: 0.5, metalness: 0.1 })
  const eyes = new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff2a2a', emissiveIntensity: 1.5 })
  const middle = SPIDER_BELLY + SPIDER_BODY.halfHeight
  const { halfWidth, halfHeight, halfDepth } = SPIDER_BODY
  // The head end, forward, and the great abdomen behind it with a red band across its back.
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), shell)
  head.scale.set(halfWidth * 0.8, halfHeight * 0.9, halfDepth * 0.45)
  head.position.set(0, middle, -halfDepth * 0.45)
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), shell)
  abdomen.scale.set(halfWidth * 1.05, halfHeight * 1.3, halfDepth * 0.7)
  abdomen.position.set(0, middle + 0.4, halfDepth * 0.5)
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 24), band)
  stripe.scale.set(halfWidth * 1.02, halfHeight * 1.28, 1)
  stripe.position.set(0, middle + 0.4, halfDepth * 0.5)
  for (const mesh of [head, abdomen]) mesh.castShadow = true
  model.add(head, abdomen, stripe)
  for (const [x, y, size] of [
    [-0.85, 0.6, 0.48],
    [0.85, 0.6, 0.48],
    [-1.5, 0.2, 0.3],
    [1.5, 0.2, 0.3],
    [-0.45, 1.1, 0.27],
    [0.45, 1.1, 0.27],
  ] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), eyes)
    eye.position.set(x, middle + y, -halfDepth * 0.9)
    model.add(eye)
  }
  // Eight legs, four a side, fanned from the front to the back.
  const limb = new THREE.CylinderGeometry(0.38, 0.5, 1, 8)
  const shin = new THREE.CylinderGeometry(0.5, 0.2, 1, 8)
  const legs: Leg[] = []
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const fan = ((k - 1.5) / 1.5) * 0.9
      const hip = new THREE.Vector3(side * halfWidth * 0.7, middle - 0.5, -halfDepth * 0.45 + (k - 1.5) * 1.5)
      const rest = new THREE.Vector3(side * Math.cos(fan) * SPIDER_REACH, 0, Math.sin(fan) * SPIDER_REACH * 0.9)
      const upper = new THREE.Mesh(limb, shell)
      const lower = new THREE.Mesh(shin, shell)
      upper.castShadow = true
      lower.castShadow = true
      model.add(upper, lower)
      legs.push({ hip, rest, upper, lower, half: (k + (side > 0 ? 1 : 0)) % 2 })
    }
  }
  return { model, legs }
}

/** Set each leg where it is in its step, this far through its stride. */
function pose(legs: Leg[], stride: number): void {
  for (const leg of legs) {
    const phase = (stride / (STEP * 2)) * Math.PI * 2 + leg.half * Math.PI
    // Lifted, a foot swings forward, toward -Z, for the next step; planted, it slides back as the body goes on, a step's length each half stride.
    foot.copy(leg.rest)
    foot.z -= Math.sin(phase) * (STEP / 2)
    foot.y = Math.max(Math.cos(phase), 0) * LIFT
    knee.addVectors(leg.hip, foot).multiplyScalar(0.5)
    out.subVectors(foot, leg.hip).setY(0)
    knee.addScaledVector(out, -0.15)
    knee.y = leg.hip.y + KNEE_RISE
    span(leg.upper, leg.hip, knee)
    span(leg.lower, knee, foot)
  }
}

/** The spiders, each drawn where the simulation has it, its legs stepping as it strides. */
export class SpidersView {
  readonly object = new THREE.Group()

  private readonly source: SpiderSource
  private readonly effects: PresenceEffects | null
  private readonly ear: Ear | null
  private readonly shown = new Map<number, Shown>()

  constructor(source: SpiderSource, effects: PresenceEffects | null = null, ear: Ear | null = null) {
    this.source = source
    this.effects = effects
    this.ear = ear
    this.update(0)
  }

  /** A frame on: a spider brought down since blows up where it was, and one badly hurt smokes. */
  update(dt: number): void {
    for (const spider of this.source.spiders) {
      let view = this.shown.get(spider.id)
      if (view === undefined) {
        view = { ...buildSpider(), deaths: spider.deaths }
        this.shown.set(spider.id, view)
        this.object.add(view.model)
      }
      if (spider.deaths !== view.deaths) {
        view.deaths = spider.deaths
        const where = { x: view.model.position.x, y: view.model.position.y + SPIDER_BELLY, z: view.model.position.z }
        this.effects?.explosions.burst(where)
        if (this.ear !== null) this.effects?.sound?.boom(distanceFrom(this.ear, where))
      }
      if (spider.damage > MACHINE_SMOKING) {
        const back = { x: spider.position.x, y: spider.position.y + SPIDER_BELLY + SPIDER_BODY.halfHeight * 2, z: spider.position.z }
        this.effects?.smoke.trail(back, STILL, (spider.damage - MACHINE_SMOKING) * 2, dt)
      }
      view.model.position.set(spider.position.x, spider.position.y, spider.position.z)
      view.model.rotation.set(0, spider.heading, 0)
      pose(view.legs, spider.stride)
    }
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        ;(node.material as THREE.Material).dispose()
      }
    })
    this.object.removeFromParent()
    this.object.clear()
    this.shown.clear()
  }
}
