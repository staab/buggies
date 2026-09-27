import { shapeOf, type Shot } from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import type { PresenceEffects } from './car-presence.ts'
import { distanceFrom, type Ear } from './ear.ts'
import { Explosions } from './explosion.ts'
import { FLAT_GLOBE, Globe } from './globe.ts'
import { PickupField, type PickupSource } from './pickups-view.ts'
import { PropsView, type PropSource } from './props-view.ts'
import { RobotsView, type RobotSource } from './robots-view.ts'
import { RocketsView, type RocketSource } from './rockets-view.ts'
import { Smoke } from './smoke.ts'
import { SpidersView, type SpiderSource } from './spiders-view.ts'
import { Tracers } from './tracers.ts'
import { UfosView, type UfoSource } from './ufos-view.ts'

/** Where everything on the island besides the cars is read from: an arena, or a mirror of one. */
export interface ArenaSource extends PickupSource, RocketSource, PropSource, RobotSource, UfoSource, SpiderSource {
  readonly shots: readonly Shot[]
}

/**
 * Everything on the island besides the cars, as one thing on the screen:
 * the explosions and smoke every car feeds, the bananas and bombs, the
 * rockets in the air, the robots, the saucers and the tracers of the guns and lasers. It is what a view adds
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

  constructor(source: ArenaSource, sound: Sound | null, ear: Ear, map: TerrainMap | null = null) {
    this.source = source
    this.effects = { explosions: this.explosions, smoke: this.smoke, sound }
    // What lies on the map is drawn where that is in the world: round a planet, if the map is one's.
    const globe = map === null ? FLAT_GLOBE : new Globe(shapeOf(map))
    this.pickups = new PickupField(
      source,
      (at) => {
        this.explosions.burst(at)
        sound?.boom(distanceFrom(ear, at))
      },
      globe,
    )
    this.rockets = new RocketsView(source, this.effects, ear, globe)
    this.tracers = new Tracers(sound, ear, globe)
    this.props = new PropsView(source)
    this.robots = new RobotsView(source, this.effects, ear, globe)
    this.ufos = new UfosView(source, map, this.effects, ear, globe)
    this.spiders = new SpidersView(source, this.effects, ear, globe)
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
    )
  }

  /** A frame on: after the cars have fed the effects, so that what they gave off this frame is seen. */
  update(dt: number): void {
    this.pickups.update(dt)
    this.tracers.fire(this.source.shots, this.source.tick)
    this.tracers.update(dt)
    this.rockets.update(dt)
    this.props.update()
    this.robots.update(dt)
    this.ufos.update(dt)
    this.spiders.update(dt)
    this.smoke.update(dt)
    this.explosions.update(dt)
  }

  dispose(): void {
    this.tracers.dispose()
    this.props.dispose()
    this.robots.dispose()
    this.ufos.dispose()
    this.spiders.dispose()
    this.rockets.dispose()
    this.pickups.dispose()
    this.explosions.dispose()
    this.smoke.dispose()
    this.object.removeFromParent()
    this.object.clear()
  }
}
