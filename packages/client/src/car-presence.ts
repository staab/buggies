import {
  MAGNET_REACH,
  MOUNT_HEIGHT,
  NO_TARGET,
  SHOCKWAVE_RANGE,
  WEAPON_COSTS,
  WEAPON_LABELS,
  WEAPONS,
  affordable,
  aimPoint,
  going,
  hasBuiltInGun,
  keyOf,
  lasting,
  using,
  type Arena,
  type Seat,
} from '@buggies/game'
import { v3, type Vec3 } from '@buggies/physics'
import * as THREE from 'three'

import { EARSHOT, engineRev, skidAmount, type EngineVoice, type SirenVoice, type SkidVoice, type Sound, type ThrustVoice } from './audio.ts'
import { CarView } from './car-view.ts'
import type { ChaseTarget } from './chase-camera.ts'
import { smokeAmount } from './damage.ts'
import { disposeObject } from './dispose.ts'
import { distanceFrom, type Ear } from './ear.ts'
import { Headlights } from './headlights.ts'
import type { Explosions } from './explosion.ts'
import type { ControlHint, HudState, WeaponSlot } from './hud.ts'
import type { Smoke } from './smoke.ts'
import { SmoothedBody } from './smoothed-body.ts'
import { PLOW_BLADE_RADIUS, buildPlow } from './weapon-models.ts'
import { WeaponMount } from './weapon-mount.ts'

/** How far past earshot a car's voices are kept going before they are let go. */
const VOICES_KEPT = 1.25

/** A knock that takes this much of a car's life is heard at full volume. */
const LOUD_KNOCK = 0.25
/** How many times a second a siren's roof lights flash from one side to the other. */
const SIREN_FLASHES = 4
/** How far in front of the chassis the ram plow's blade is set. */
const PLOW_OUT = 0.35

/** Where a seat's gun is trained: the middle of the car, or the machine, it has picked out, if any. */
export function aimPointOf(seat: Seat, field: Pick<Arena, 'seats' | 'robots' | 'ufos' | 'spiders'>): Vec3 | null {
  if ((seat.weapon !== 'machineGun' && seat.weapon !== 'laser') || seat.aimTarget === NO_TARGET) return null
  return aimPoint(field, seat.aimTarget, v3())
}

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
  ear?: Ear
  /** Whether it is heard from here at all: a car driven from another view of this screen is not. */
  heard?: boolean
  /** Whether its headlights light what is ahead of it, as the driver's own do, or only glow. */
  beam?: boolean
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
  private readonly ear: Ear | null
  private readonly view: CarView
  /** Its engine, tires and thrusters, heard only while it is in earshot: out of it, they are let go, not left running silent. */
  private voice: EngineVoice | null = null
  private skid: SkidVoice | null = null
  private thrust: ThrustVoice | null = null
  private readonly mount: WeaponMount
  private readonly heard: Sound | null
  /** The siren, made the first time it is turned on. */
  private siren: SirenVoice | null = null
  private readonly headlights: Headlights
  private aimPoint: Vec3 | null = null
  /** What lasts of what the car has used, drawn on it: the plow's blade and the magnet's reach. */
  private readonly blade: THREE.Group
  private readonly pull: THREE.Mesh
  private wasWrecked: boolean
  private lastDamage: number
  private lastScore: number
  private lastShockTicks: number
  private lastHornTicks: number
  private lightTime = 0

  constructor(seat: Seat, color: number, effects: PresenceEffects, options: PresenceOptions = {}) {
    this.seat = seat
    this.effects = effects
    this.ear = options.ear ?? null
    this.view = new CarView(seat.profile, color)
    this.view.syncDimensions(seat.tuning)
    this.object = this.view.object
    this.mount = new WeaponMount(seat.tuning.chassisHalfHeight + MOUNT_HEIGHT, hasBuiltInGun(seat.profile))
    this.object.add(this.mount.object)
    this.body = new SmoothedBody(seat.vehicle.body, this.object)
    this.heard = options.heard !== false ? effects.sound : null
    this.headlights = new Headlights(seat.tuning, options.beam === true)
    this.object.add(this.headlights.object)
    const { chassisHalfWidth, chassisHalfHeight, chassisHalfLength } = seat.tuning
    // The blade stood up across the front of the car, its edge down at the road.
    this.blade = buildPlow()
    this.blade.scale.set((chassisHalfWidth * 2.2) / 1.4, 1, 1)
    this.blade.position.set(0, -chassisHalfHeight * 0.3, -chassisHalfLength - PLOW_OUT - PLOW_BLADE_RADIUS)
    this.blade.visible = false
    this.pull = new THREE.Mesh(
      new THREE.RingGeometry(MAGNET_REACH - 0.4, MAGNET_REACH, 64),
      new THREE.MeshBasicMaterial({ color: 0xd8402c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    )
    this.pull.rotation.x = -Math.PI / 2
    this.pull.position.y = -chassisHalfHeight
    this.pull.visible = false
    this.object.add(this.blade, this.pull)
    this.wasWrecked = seat.vehicle.wrecked
    this.lastDamage = seat.vehicle.damage
    this.lastScore = seat.score
    this.lastShockTicks = seat.shockTicks
    this.lastHornTicks = seat.hornTicks
  }

  get wrecked(): boolean {
    return this.seat.vehicle.wrecked
  }

  /** The weapons on their keys, as they stand with the car: picked, affordable, going. */
  get weaponSlots(): WeaponSlot[] {
    const { seat } = this
    return WEAPONS.map((weapon) => ({
      key: keyOf(weapon),
      label: WEAPON_LABELS[weapon],
      cost: WEAPON_COSTS[weapon],
      lasting: lasting(weapon),
      picked: seat.weapon === weapon,
      ready: affordable(seat, weapon),
      firing: going(seat, weapon),
    }))
  }

  /** Train the gun on a point in the world, or on nothing, before the next render. */
  aimAt(point: Vec3 | null): void {
    this.aimPoint = point
  }

  /** Draw what lasts of what the car has used: the plow set and the magnet pulling. */
  private showEffects(): void {
    const { seat } = this
    const out = !seat.vehicle.wrecked
    this.blade.visible = out && seat.plowTicks > 0
    this.pull.visible = out && seat.magnetTicks > 0
  }

  /** Start its voices as it comes into earshot, and let them go a way past it, so one on the edge does not come and go. */
  private listen(off: number): void {
    if (this.heard === null) return
    if (this.voice === null && off < EARSHOT) {
      this.voice = this.heard.engine(this.seat.profile)
      this.skid = this.heard.skid()
      this.thrust = this.heard.thrust()
    } else if (this.voice !== null && off > EARSHOT * VOICES_KEPT) {
      this.voice.stop()
      this.skid?.stop()
      this.thrust?.stop()
      this.voice = this.skid = this.thrust = null
    }
  }

  /** How far off it is from whoever is listening. */
  private distance(): number {
    return this.ear === null ? 0 : distanceFrom(this.ear, this.seat.vehicle.frame.position)
  }

  /** Draw it between the last two steps, feed its effects, and hear it. */
  render(fraction: number, dt: number): void {
    const { vehicle, tuning, score } = this.seat
    const { explosions, smoke } = this.effects
    const sound = this.heard
    this.body.render(fraction, dt)
    this.view.applySimulatedWheels(vehicle.wheels, tuning)
    // The weapon picked last rides over the roof.
    this.mount.show(vehicle.wrecked ? 'none' : this.seat.weapon)
    this.mount.update(dt)
    this.mount.aim(this.aimPoint, dt)
    this.showEffects()
    const engine = using(this.seat, 'engine')
    this.mount.burn(engine)
    const off = this.distance()
    this.listen(off)
    this.thrust?.set(engine ? 1 : 0, off)
    this.headlights.update(this.seat.vehicle.wrecked, this.seat.vehicle.frame.position)
    // The shockwave is seen and heard as it goes off.
    if (this.seat.shockTicks > this.lastShockTicks && !vehicle.wrecked) {
      explosions.shockwave(vehicle.frame.position, SHOCKWAVE_RANGE)
      sound?.shockwave(off)
    }
    this.lastShockTicks = this.seat.shockTicks
    // The roof lights flash in turn while the siren is on, and it wails; the horn is heard as it is blown.
    this.lightTime += dt
    const lightsOn = this.seat.lightsOn && !vehicle.wrecked
    this.view.lightSirens(lightsOn ? Math.floor(this.lightTime * SIREN_FLASHES) % 2 : null)
    if (lightsOn && this.siren === null) this.siren = this.heard?.siren() ?? null
    this.siren?.set(lightsOn, off)
    if (this.seat.hornTicks > this.lastHornTicks && !vehicle.wrecked) sound?.horn(off)
    this.lastHornTicks = this.seat.hornTicks
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
    target.up = vehicle.up
  }

  /** What the HUD says of it, with a line on how it is keeping up with the server if there is one. */
  hudState(title: string, controls: readonly ControlHint[], sync?: string): HudState {
    const { vehicle, tuning, score } = this.seat
    return {
      title,
      speed: vehicle.speed,
      maxSpeed: tuning.maxSpeed,
      damage: vehicle.wrecked ? 1 : vehicle.damage,
      controls,
      score,
      weapons: this.weaponSlots,
      ...(sync === undefined ? {} : { sync }),
    }
  }

  dispose(): void {
    this.headlights.dispose()
    this.voice?.stop()
    this.skid?.stop()
    this.thrust?.stop()
    this.siren?.stop()
    this.mount.dispose()
    disposeObject(this.blade)
    this.pull.geometry.dispose()
    ;(this.pull.material as THREE.Material).dispose()
    this.view.dispose()
  }
}
