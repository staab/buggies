import { METEOR_FALL_TICKS, METEOR_RANGE, meteorAt, type Meteor } from '@buggies/game'
import * as THREE from 'three'

import type { PresenceEffects } from './car-presence.ts'
import { distanceFrom, type Ear } from './ear.ts'
import { lifted, standOn } from './stand.ts'

/** How big a meteor is across, and how much smoke it trails, as a share of a burning car's. */
const METEOR_SIZE = 2.4
const TRAIL = 2.5
const ROCK = 0x3a2a22
const GLOW = 0xff7a2a
const MARK = 0xff5030

/** Where the meteors are: an arena, or a mirror of one. */
export interface MeteorSource {
  readonly meteors: readonly Meteor[]
  readonly tick: number
}

interface Fall {
  rock: THREE.Mesh
  /** A ring on the ground where it will land, redder the nearer it is. */
  mark: THREE.Mesh
  markMaterial: THREE.MeshBasicMaterial
  meteor: Meteor
}

const at = { x: 0, y: 0, z: 0 }
const down = new THREE.Vector3()

/**
 * The meteors coming down on a moon, each a glowing rock on its slanting
 * line, trailing smoke, over a ring on the ground where it will land; one
 * gone once its time is up has landed, and blows up there.
 */
export class MeteorsView {
  readonly object = new THREE.Group()

  private readonly source: MeteorSource
  private readonly effects: PresenceEffects
  private readonly ear: Ear
  private readonly falls = new Map<number, Fall>()
  private readonly rockGeometry = new THREE.IcosahedronGeometry(METEOR_SIZE / 2, 0)
  private readonly rockMaterial = new THREE.MeshStandardMaterial({ color: ROCK, emissive: GLOW, emissiveIntensity: 1.4, flatShading: true })
  private readonly markGeometry = new THREE.RingGeometry(METEOR_RANGE * 0.85, METEOR_RANGE, 48).rotateX(-Math.PI / 2)

  constructor(source: MeteorSource, effects: PresenceEffects, ear: Ear) {
    this.source = source
    this.effects = effects
    this.ear = ear
  }

  /** `fraction` is how far the frame is from the last step to the next, for the rocks to fall smoothly between steps. */
  update(dt: number, fraction = 0): void {
    const { meteors, tick } = this.source
    for (const meteor of meteors) {
      let fall = this.falls.get(meteor.id)
      if (fall === undefined) {
        const rock = new THREE.Mesh(this.rockGeometry, this.rockMaterial)
        const markMaterial = new THREE.MeshBasicMaterial({ color: MARK, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
        const mark = new THREE.Mesh(this.markGeometry, markMaterial)
        // A little over the ground, so it is not lost in it.
        standOn(mark, lifted(meteor.to, 0.15, down))
        this.object.add(rock, mark)
        fall = { rock, mark, markMaterial, meteor }
        this.falls.set(meteor.id, fall)
      }
      fall.meteor = meteor
      meteorAt(meteor, tick + fraction, at)
      fall.rock.position.set(at.x, at.y, at.z)
      fall.rock.rotation.x += dt * 2.1
      fall.rock.rotation.y += dt * 1.3
      down.set(meteor.to.x - meteor.from.x, meteor.to.y - meteor.from.y, meteor.to.z - meteor.from.z).divideScalar(METEOR_FALL_TICKS / 60)
      this.effects.smoke.trail(fall.rock.position, down, TRAIL, dt)
      fall.markMaterial.opacity = 0.2 + 0.6 * Math.min(Math.max((tick - meteor.bornTick) / METEOR_FALL_TICKS, 0), 1)
    }
    for (const [id, fall] of this.falls) {
      if (meteors.some((meteor) => meteor.id === id)) continue
      this.falls.delete(id)
      this.object.remove(fall.rock, fall.mark)
      fall.markMaterial.dispose()
      // Gone once it is down is landed; gone before is the server changing its mind, and nothing to see.
      if (tick - fall.meteor.bornTick >= METEOR_FALL_TICKS - 2) {
        const { explosions, sound } = this.effects
        explosions.burst(fall.meteor.to)
        explosions.shockwave(fall.meteor.to, METEOR_RANGE)
        sound?.boom(distanceFrom(this.ear, down.set(fall.meteor.to.x, fall.meteor.to.y, fall.meteor.to.z)))
      }
    }
  }

  dispose(): void {
    for (const fall of this.falls.values()) fall.markMaterial.dispose()
    this.falls.clear()
    this.rockGeometry.dispose()
    this.rockMaterial.dispose()
    this.markGeometry.dispose()
    this.object.removeFromParent()
    this.object.clear()
  }
}
