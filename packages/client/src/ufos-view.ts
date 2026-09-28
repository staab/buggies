import { FIXED_TIMESTEP, type Ufo } from '@buggies/game'
import { sampleHeight, type TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import type { PresenceEffects } from './car-presence.ts'
import { distanceFrom, type Ear } from './ear.ts'
import { MACHINE_SMOKING } from './robots-view.ts'

/** Where the saucers are: an arena, or a mirror of one. */
export interface UfoSource {
  readonly ufos: readonly Ufo[]
  /** The tick the saucers are at, to draw them smoothly between one and the next. */
  readonly tick: number
}

/** How wide a saucer is, and how its lights blink around its rim. */
const RADIUS = 7
const LIGHTS = 10
const BLINK_RATE = 6
const BEAM = new THREE.Color('#9dffb8')
/** How quickly a correction to where a saucer is gets eased away, per second, and past how far it is jumped instead. */
const CORRECTION_DECAY_RATE = 6
const LARGEST_SMOOTHED_CORRECTION = 25

/**
 * A flying saucer: a flat metal disc, a glass dome on top, and a ring of
 * lights around its rim chasing each other round. Under it hangs a cone of
 * pale green light, shown while it is lifting a car.
 */
export function buildUfo(): { model: THREE.Group; lights: THREE.MeshBasicMaterial[]; beam: THREE.Mesh } {
  const model = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: '#b9c2cc', metalness: 0.85, roughness: 0.25 })
  const disc = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 12), hull)
  disc.scale.set(1, 0.22, 1)
  disc.castShadow = true
  model.add(disc)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RADIUS * 0.96, 0.35, 8, 40).rotateX(Math.PI / 2), hull)
  model.add(rim)
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 0.38, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#8fe3ff', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.7 }),
  )
  dome.position.y = RADIUS * 0.12
  model.add(dome)
  const lights: THREE.MeshBasicMaterial[] = []
  for (let k = 0; k < LIGHTS; k++) {
    const angle = (k / LIGHTS) * Math.PI * 2
    const material = new THREE.MeshBasicMaterial({ color: '#ffe066' })
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), material)
    light.position.set(Math.cos(angle) * RADIUS * 0.98, 0, Math.sin(angle) * RADIUS * 0.98)
    model.add(light)
    lights.push(material)
  }
  // A cone a meter tall, its tip at the saucer and its mouth on the ground, stretched to the height it hangs at.
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(RADIUS * 0.6, 1, 24, 1, true).translate(0, -0.5, 0),
    new THREE.MeshBasicMaterial({ color: BEAM, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
  )
  beam.visible = false
  model.add(beam)
  return { model, lights, beam }
}

interface Shown {
  model: THREE.Group
  lights: THREE.MeshBasicMaterial[]
  beam: THREE.Mesh
  /** How many times it had been brought down when last drawn. */
  deaths: number
  /** Where it was at the tick before the last and at the last, which tick that was, and how long ago. */
  readonly before: THREE.Vector3
  readonly after: THREE.Vector3
  tick: number
  since: number
  /** A correction still being eased away: drawn this far off where it is. */
  readonly offset: THREE.Vector3
}

const STILL = { x: 0, y: 0, z: 0 }
const expected = new THREE.Vector3()

/** The saucers, each where the simulation has it, its lights chasing round, and its beam down while it lifts a car. */
export class UfosView {
  readonly object = new THREE.Group()

  private readonly source: UfoSource
  private readonly map: TerrainMap | null
  private readonly effects: PresenceEffects | null
  private readonly ear: Ear | null
  private readonly shown = new Map<number, Shown>()
  private time = 0

  constructor(source: UfoSource, map: TerrainMap | null = null, effects: PresenceEffects | null = null, ear: Ear | null = null) {
    this.source = source
    this.map = map
    this.effects = effects
    this.ear = ear
    this.update(0)
  }

  update(dt: number): void {
    this.time += dt
    for (const ufo of this.source.ufos) {
      let view = this.shown.get(ufo.id)
      if (view === undefined) {
        const at = new THREE.Vector3(ufo.position.x, ufo.position.y, ufo.position.z)
        view = { ...buildUfo(), deaths: ufo.deaths, before: at.clone(), after: at.clone(), tick: this.source.tick, since: 0, offset: new THREE.Vector3() }
        this.shown.set(ufo.id, view)
        this.object.add(view.model)
      }
      // Brought down since: it blows up where it was, and comes back elsewhere.
      if (ufo.deaths !== view.deaths) {
        view.deaths = ufo.deaths
        const where = { x: view.model.position.x, y: view.model.position.y, z: view.model.position.z }
        this.effects?.explosions.burst(where)
        if (this.ear !== null) this.effects?.sound?.boom(distanceFrom(this.ear, where))
      }
      if (ufo.damage > MACHINE_SMOKING) this.effects?.smoke.trail(ufo.position, STILL, (ufo.damage - MACHINE_SMOKING) * 2, dt)
      this.place(view, ufo, dt)
      view.model.rotation.y = this.time * 0.6
      const lit = Math.floor(this.time * BLINK_RATE) % view.lights.length
      view.lights.forEach((light, k) => light.color.set(k === lit || (k + view.lights.length / 2) % view.lights.length === lit ? '#ffffff' : '#ffb020'))
      view.beam.visible = ufo.state === 'lift' || ufo.state === 'carry' || ufo.state === 'lower'
      if (view.beam.visible) {
        const ground = this.map === null ? ufo.position.y - 20 : sampleHeight(this.map.heightfield, ufo.position.x, ufo.position.z)
        view.beam.scale.set(1, Math.max(ufo.position.y - ground, 1), 1)
      }
    }
  }

  /**
   * Drawn between where it was at the last two ticks, a tick behind, so it
   * glides rather than stepping; and a move the tick before does not
   * explain, the server's word putting it somewhere else, eased away.
   */
  private place(view: Shown, ufo: Ufo, dt: number): void {
    const { tick } = this.source
    if (tick !== view.tick) {
      const steps = Math.max(tick - view.tick, 1)
      // Where it would be had it gone on as it was going: whatever it is off that is a correction.
      expected.copy(view.after).sub(view.before).multiplyScalar(steps).add(view.after)
      view.before.copy(view.after)
      view.after.set(ufo.position.x, ufo.position.y, ufo.position.z)
      view.tick = tick
      view.since = 0
      const off = expected.distanceTo(view.after)
      if (off > LARGEST_SMOOTHED_CORRECTION || steps > 4) {
        view.before.copy(view.after)
        view.offset.set(0, 0, 0)
      } else if (off > 0.05) {
        // Drawn from where it would have been, the difference eased away.
        view.offset.add(expected).sub(view.after)
        view.before.add(view.after).sub(expected)
      }
    }
    view.since += dt
    const t = Math.min(view.since / FIXED_TIMESTEP, 1)
    view.offset.multiplyScalar(Math.exp(-CORRECTION_DECAY_RATE * dt))
    view.model.position.lerpVectors(view.before, view.after, t).add(view.offset)
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
