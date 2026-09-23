import type { Shot } from '@buggies/game'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import type { PresenceEffects } from './car-presence.ts'
import { distanceFrom, type Ear } from './ear.ts'
import { Explosions } from './explosion.ts'
import { PickupField, type PickupSource } from './pickups-view.ts'
import { RocketsView, type RocketSource } from './rockets-view.ts'
import { Smoke } from './smoke.ts'
import { Tracers } from './tracers.ts'

/** Where everything on the island besides the cars is read from: an arena, or a mirror of one. */
export interface ArenaSource extends PickupSource, RocketSource {
  readonly shots: readonly Shot[]
}

/**
 * Everything on the island besides the cars, as one thing on the screen:
 * the explosions and smoke every car feeds, the bananas and bombs, the
 * rockets in the air and the tracers of the guns. It is what a view adds
 * to the scene around its cars, updated and let go of as one.
 */
export class ArenaView {
  readonly object = new THREE.Group()
  /** What every car on this screen feeds. */
  readonly effects: PresenceEffects

  private readonly source: ArenaSource
  private readonly explosions = new Explosions()
  private readonly smoke = new Smoke()
  private readonly pickups: PickupField
  private readonly rockets: RocketsView
  private readonly tracers: Tracers

  constructor(source: ArenaSource, sound: Sound | null, ear: Ear) {
    this.source = source
    this.effects = { explosions: this.explosions, smoke: this.smoke, sound }
    this.pickups = new PickupField(source, (at) => {
      this.explosions.burst(at)
      sound?.boom(distanceFrom(ear, at))
    })
    this.rockets = new RocketsView(source, this.effects, ear)
    this.tracers = new Tracers(sound, ear)
    this.object.add(this.explosions.object, this.smoke.object, this.pickups.object, this.rockets.object, this.tracers.object)
  }

  /** A frame on: after the cars have fed the effects, so that what they gave off this frame is seen. */
  update(dt: number): void {
    this.pickups.update(dt)
    this.tracers.fire(this.source.shots, this.source.tick)
    this.tracers.update(dt)
    this.rockets.update(dt)
    this.smoke.update(dt)
    this.explosions.update(dt)
  }

  dispose(): void {
    this.tracers.dispose()
    this.rockets.dispose()
    this.pickups.dispose()
    this.explosions.dispose()
    this.smoke.dispose()
    this.object.removeFromParent()
    this.object.clear()
  }
}
