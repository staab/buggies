import { ROCKET_LIFE_TICKS, type Rocket } from '@buggies/game'
import * as THREE from 'three'

import type { PresenceEffects } from './car-presence.ts'
import { disposeObject } from './dispose.ts'
import { distanceFrom, type Ear } from './ear.ts'
import { buildRocket } from './weapon-models.ts'

/** How much smoke a rocket leaves behind it, as a share of a burning car's. */
const TRAIL = 0.6

/** Where the rockets are: an arena, or a mirror of one. */
export interface RocketSource {
  readonly rockets: readonly Rocket[]
  readonly tick: number
}

interface Flight {
  model: THREE.Group
  last: THREE.Vector3
  bornTick: number
}

const ahead = new THREE.Vector3()

/**
 * The rockets in the air, each drawn where the simulation has it, nose
 * first, trailing smoke; one gone before its time went off on something,
 * and blows up where it was last seen.
 */
export class RocketsView {
  readonly object = new THREE.Group()

  private readonly source: RocketSource
  private readonly effects: PresenceEffects
  private readonly ear: Ear
  private readonly flights = new Map<number, Flight>()

  constructor(source: RocketSource, effects: PresenceEffects, ear: Ear) {
    this.source = source
    this.effects = effects
    this.ear = ear
  }

  get flying(): number {
    return this.flights.size
  }

  update(dt: number): void {
    const { rockets, tick } = this.source
    const { explosions, smoke, sound } = this.effects
    for (const rocket of rockets) {
      let flight = this.flights.get(rocket.id)
      if (flight === undefined) {
        flight = { model: buildRocket(), last: new THREE.Vector3(), bornTick: rocket.bornTick }
        this.object.add(flight.model)
        this.flights.set(rocket.id, flight)
        sound?.whoosh(distanceFrom(this.ear, rocket.position))
      }
      const { position, velocity } = rocket
      flight.model.position.set(position.x, position.y, position.z)
      // The model's nose is along -Z, and lookAt turns +Z to what it is given.
      ahead.set(position.x - velocity.x, position.y - velocity.y, position.z - velocity.z)
      flight.model.lookAt(ahead)
      flight.last.copy(flight.model.position)
      smoke.trail(position, velocity, TRAIL, dt)
    }
    for (const [id, flight] of this.flights) {
      if (rockets.some((rocket) => rocket.id === id)) continue
      this.flights.delete(id)
      this.object.remove(flight.model)
      if (tick - flight.bornTick < ROCKET_LIFE_TICKS) {
        explosions.burst(flight.last)
        sound?.boom(distanceFrom(this.ear, flight.last))
      }
      disposeObject(flight.model)
    }
  }

  dispose(): void {
    for (const flight of this.flights.values()) disposeObject(flight.model)
    this.flights.clear()
    this.object.removeFromParent()
    this.object.clear()
  }
}
