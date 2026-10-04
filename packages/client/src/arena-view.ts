import type { Shot } from '@buggies/game'
import type { World } from '@buggies/terrain'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import type { PresenceEffects } from './car-presence.ts'
import { distanceFrom, type Ear } from './ear.ts'
import { Explosions } from './explosion.ts'
import { MeteorsView, type MeteorSource } from './meteors-view.ts'
import { PickupField, type PickupSource } from './pickups-view.ts'
import { PropsView, type PropSource } from './props-view.ts'
import { RobotsView, type RobotSource } from './robots-view.ts'
import { RocketsView, type RocketSource } from './rockets-view.ts'
import { Smoke } from './smoke.ts'
import { SpidersView, type SpiderSource } from './spiders-view.ts'
import { Tracers } from './tracers.ts'
import { UfosView, type UfoSource } from './ufos-view.ts'

/** Where everything on the island besides the cars is read from: an arena, or a mirror of one. */
export interface ArenaSource extends PickupSource, RocketSource, PropSource, RobotSource, UfoSource, SpiderSource, MeteorSource {
  readonly shots: readonly Shot[]
}

/**
 * Everything on the island besides the cars, as one thing on the screen:
 * the explosions and smoke every car feeds, the bananas and bombs, the
 * rockets in the air, the robots, the saucers, the spiders, the meteors and the tracers of the guns and lasers. It is what a view adds
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
  private readonly props: PropsView
  private readonly robots: RobotsView
  private readonly ufos: UfosView
  private readonly spiders: SpidersView
  private readonly meteors: MeteorsView

  constructor(source: ArenaSource, sound: Sound | null, ear: Ear, planet: World | null = null) {
    this.source = source
    this.effects = { explosions: this.explosions, smoke: this.smoke, sound }
    this.pickups = new PickupField(source, (at) => {
      this.explosions.burst(at)
      sound?.boom(distanceFrom(ear, at))
    })
    this.rockets = new RocketsView(source, this.effects, ear)
    this.tracers = new Tracers(sound, ear)
    this.props = new PropsView(source)
    this.robots = new RobotsView(source, this.effects, ear)
    this.ufos = new UfosView(source, planet, this.effects, ear)
    this.spiders = new SpidersView(source, this.effects, ear)
    this.meteors = new MeteorsView(source, this.effects, ear)
    this.object.add(
      this.explosions.object,
      this.smoke.object,
      this.pickups.object,
      this.rockets.object,
      this.tracers.object,
      this.props.object,
      this.robots.object,
      this.ufos.object,
      this.spiders.object,
      this.meteors.object,
    )
  }

  /** After a step of the simulation: what is drawn between steps takes note of where it got to. */
  captureStep(): void {
    this.ufos.captureStep()
  }

  /**
   * A frame on: after the cars have fed the effects, so that what they gave
   * off this frame is seen. `fraction` is how far the frame is from the last
   * step to the next, for what is drawn between steps.
   */
  update(dt: number, fraction?: number): void {
    this.pickups.update(dt)
    this.tracers.fire(this.source.shots, this.source.tick)
    this.tracers.update(dt)
    this.rockets.update(dt)
    this.props.update()
    this.robots.update(dt)
    this.ufos.update(dt, fraction)
    this.spiders.update(dt)
    this.meteors.update(dt, fraction)
    this.smoke.update(dt)
    this.explosions.update(dt)
  }

  dispose(): void {
    this.tracers.dispose()
    this.props.dispose()
    this.robots.dispose()
    this.ufos.dispose()
    this.spiders.dispose()
    this.meteors.dispose()
    this.rockets.dispose()
    this.pickups.dispose()
    this.explosions.dispose()
    this.smoke.dispose()
    this.object.removeFromParent()
    this.object.clear()
  }
}
