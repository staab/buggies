import type { Seat } from '@buggies/game'
import type { Vec3 } from '@buggies/physics'
import type * as THREE from 'three'

import { engineRev, skidAmount, type EngineVoice, type SkidVoice, type Sound } from './audio.ts'
import { CarView } from './car-view.ts'
import type { ChaseTarget } from './chase-camera.ts'
import { smokeAmount } from './damage.ts'
import { driverState } from './driver-hud.ts'
import type { Explosions } from './explosion.ts'
import type { ControlHint, HudState } from './hud.ts'
import type { Smoke } from './smoke.ts'
import { SmoothedBody } from './smoothed-body.ts'

/** A knock that takes this much of a car's life is heard at full volume. */
const LOUD_KNOCK = 0.25

/** What every car on a screen feeds: one set for the whole view. */
export interface PresenceEffects {
  explosions: Explosions
  smoke: Smoke
  /** Where it is heard, if it is heard from here at all. */
  sound: Sound | null
}

export interface PresenceOptions {
  /**
   * Whose ear its sounds fall on, for how far off they are. Left out, the
   * car is its own ear and is heard at full volume.
   */
  ear?: () => Vec3
  /** Whether it is heard from here at all: a car driven from another view of this screen is not. */
  heard?: boolean
}

/**
 * A car as it is on the screen: its model following its body, the effects
 * it feeds as it is knocked about and blown up, the sounds it makes, and
 * what the HUD says of it. The local car and everyone else's are the same
 * in all of this; only who drives the body differs.
 */
export class CarPresence {
  readonly object: THREE.Group
  /** The body as drawn, with the server's corrections eased away. */
  readonly body: SmoothedBody

  private readonly seat: Seat
  private readonly effects: PresenceEffects
  private readonly ear: (() => Vec3) | null
  private readonly view: CarView
  private readonly voice: EngineVoice | null
  private readonly skid: SkidVoice | null
  private wasWrecked: boolean
  private lastDamage: number
  private lastScore: number

  constructor(seat: Seat, color: number, effects: PresenceEffects, options: PresenceOptions = {}) {
    this.seat = seat
    this.effects = effects
    this.ear = options.ear ?? null
    this.view = new CarView(seat.profile, color)
    this.view.syncDimensions(seat.tuning)
    this.object = this.view.object
    this.body = new SmoothedBody(seat.vehicle.body, this.object)
    const heard = options.heard !== false ? effects.sound : null
    this.voice = heard?.engine(seat.profile) ?? null
    this.skid = heard?.skid() ?? null
    this.wasWrecked = seat.vehicle.wrecked
    this.lastDamage = seat.vehicle.damage
    this.lastScore = seat.score
  }

  get wrecked(): boolean {
    return this.seat.vehicle.wrecked
  }

  /** How far off it is from whoever is listening. */
  private distance(): number {
    if (this.ear === null) return 0
    const at = this.seat.vehicle.frame.position
    const ear = this.ear()
    return Math.hypot(at.x - ear.x, at.y - ear.y, at.z - ear.z)
  }

  /** Draw it between the last two steps, feed its effects, and hear it. */
  render(fraction: number, dt: number): void {
    const { vehicle, tuning, score } = this.seat
    const { explosions, smoke } = this.effects
    const sound = this.voice !== null ? this.effects.sound : null
    this.body.render(fraction, dt)
    this.view.applySimulatedWheels(vehicle.wheels, tuning)
    const off = this.distance()
    if (vehicle.wrecked && !this.wasWrecked) {
      explosions.burst(vehicle.frame.position)
      sound?.boom(off)
    }
    this.wasWrecked = vehicle.wrecked
    this.view.setWrecked(vehicle.wrecked)
    if (!vehicle.wrecked) {
      smoke.trail(vehicle.frame.position, vehicle.frame.linearVelocity, smokeAmount(vehicle.damage), dt)
    }
    this.voice?.set(vehicle.wrecked ? 0 : engineRev(vehicle.speed, tuning.maxSpeed, vehicle.command.throttle), off)
    this.skid?.set(vehicle.wrecked ? 0 : skidAmount(vehicle.wheels, tuning), off)
    const knock = vehicle.damage - this.lastDamage
    if (knock > 0 && !vehicle.wrecked) sound?.thud(knock / LOUD_KNOCK, off)
    this.lastDamage = vehicle.damage
    if (score > this.lastScore) sound?.chime(off)
    this.lastScore = score
  }

  /** Where the chase camera should look. */
  aim(target: ChaseTarget): void {
    const { vehicle } = this.seat
    vehicle.body.translation(target.position)
    vehicle.body.rotation(target.rotation)
    vehicle.body.linvel(target.velocity)
    target.speed = vehicle.speed
    target.wrecked = vehicle.wrecked
  }

  /** What the HUD says of it. */
  hudState(title: string, controls: readonly ControlHint[], inTunnel: boolean): HudState {
    const { vehicle, tuning, submersion, score } = this.seat
    return {
      title,
      state: driverState(vehicle, submersion, inTunnel),
      speed: vehicle.speed,
      maxSpeed: tuning.maxSpeed,
      damage: vehicle.wrecked ? 1 : vehicle.damage,
      controls,
      score,
    }
  }

  dispose(): void {
    this.voice?.stop()
    this.skid?.stop()
    this.view.dispose()
  }
}
