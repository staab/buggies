import { FIXED_TIMESTEP, MOUNT_HEIGHT, NO_TARGET, OWN_ACTIONS, WEAPON_LABELS, acting, hasBuiltInGun, type Seat, type Weapon } from '@buggies/game'
import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

import { engineRev, skidAmount, type EngineVoice, type SirenVoice, type SkidVoice, type Sound, type ThrustVoice } from './audio.ts'
import { CarView } from './car-view.ts'
import type { ChaseTarget } from './chase-camera.ts'
import { smokeAmount } from './damage.ts'
import { distanceFrom, type Ear } from './ear.ts'
import type { Explosions } from './explosion.ts'
import type { ControlHint, HudState } from './hud.ts'
import type { Smoke } from './smoke.ts'
import { SmoothedBody } from './smoothed-body.ts'
import { WeaponMount } from './weapon-mount.ts'
import { WeaponReveal } from './weapon-reveal.ts'

/** A knock that takes this much of a car's life is heard at full volume. */
const LOUD_KNOCK = 0.25
/**
 * The roof lights of an emergency vehicle: two lamps, this big, flashing in
 * turn this many times a second, in these colors, this far back from the
 * middle of the car: over the roof of a car, and over the cab of a truck,
 * whose body behind is taller. Each sits on the model's roof where it is.
 */
const ROOF_LIGHT = { width: 0.32, height: 0.14, depth: 0.24, apart: 0.36, flashes: 4 } as const
const ROOF_LIGHTS: Readonly<Partial<Record<Seat['profile'], { colors: [number, number]; back: number }>>> = {
  police: { colors: [0xff2a2a, 0x2a6cff], back: -0.1 },
  ambulance: { colors: [0xff2a2a, 0xffffff], back: -1.3 },
  firetruck: { colors: [0xff2a2a, 0xffffff], back: -1.9 },
}
const overhead = new THREE.Raycaster()
const above = new THREE.Vector3()
const down = new THREE.Vector3()

/** How high the top of a car's model is at a point over it, in the car's own frame; the chassis top where nothing is drawn there. */
function roofAt(car: THREE.Object3D, x: number, z: number, chassisTop: number): number {
  car.updateMatrixWorld(true)
  car.localToWorld(above.set(x, chassisTop + 10, z))
  down.set(0, -1, 0).transformDirection(car.matrixWorld)
  overhead.set(above, down)
  const hit = overhead.intersectObject(car, true)[0]
  return hit === undefined ? chassisTop : Math.max(car.worldToLocal(hit.point).y, chassisTop)
}
/** The boost's flame at the back of the car, this long. */
const BOOST_FLAME = { radius: 0.18, length: 0.8 } as const

/** Where a seat's gun is trained: the middle of the car it has picked out, if any. */
export function aimPointOf(seat: Seat, seats: readonly Seat[]): Vec3 | null {
  if (seat.weapon !== 'machineGun' || seat.aimTarget === NO_TARGET) return null
  return seats[seat.aimTarget]?.vehicle.frame.position ?? null
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
  private readonly voice: EngineVoice | null
  private readonly skid: SkidVoice | null
  private readonly thrust: ThrustVoice | null
  private readonly reveal = new WeaponReveal()
  private readonly mount: WeaponMount
  private readonly heard: Sound | null
  /** The siren, made the first time it is needed: an emergency vehicle's own, or the power any car may win. */
  private siren: SirenVoice | null = null
  private readonly roofLights: THREE.Mesh[] = []
  private readonly boostFlame: THREE.Mesh
  private aimPoint: Vec3 | null = null
  private wasWrecked: boolean
  private lastDamage: number
  private lastScore: number
  private lastActionTicks: number
  private lastWeapon: Weapon
  private lightTime = 0

  constructor(seat: Seat, color: number, effects: PresenceEffects, options: PresenceOptions = {}) {
    this.seat = seat
    this.effects = effects
    this.ear = options.ear ?? null
    this.view = new CarView(seat.profile, color)
    this.view.syncDimensions(seat.tuning)
    this.object = this.view.object
    // An emergency vehicle's roof lights, each on the model's roof where it
    // sits, measured before anything else is hung on the car; off until its
    // lights are on.
    const lamps = ROOF_LIGHTS[seat.profile]
    if (lamps !== undefined) {
      const roofs = [-1, 1].map((side) => roofAt(this.object, side * ROOF_LIGHT.apart, lamps.back, seat.tuning.chassisHalfHeight))
      for (const [k, color] of lamps.colors.entries()) {
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(ROOF_LIGHT.width, ROOF_LIGHT.height, ROOF_LIGHT.depth),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, roughness: 0.4 }),
        )
        lamp.position.set((k === 0 ? -1 : 1) * ROOF_LIGHT.apart, roofs[k]! + ROOF_LIGHT.height / 2, lamps.back)
        lamp.visible = false
        this.object.add(lamp)
        this.roofLights.push(lamp)
      }
    }
    this.mount = new WeaponMount(seat.tuning.chassisHalfHeight + MOUNT_HEIGHT, hasBuiltInGun(seat.profile))
    this.object.add(this.mount.object)
    this.body = new SmoothedBody(seat.vehicle.body, this.object)
    const heard = options.heard !== false ? effects.sound : null
    this.voice = heard?.engine(seat.profile) ?? null
    this.skid = heard?.skid() ?? null
    this.thrust = heard?.thrust() ?? null
    this.heard = heard
    // The boost's flame, behind the car, out until it boosts.
    this.boostFlame = new THREE.Mesh(
      new THREE.ConeGeometry(BOOST_FLAME.radius, BOOST_FLAME.length, 10),
      new THREE.MeshBasicMaterial({ color: 0xffa63a, transparent: true, opacity: 0.85 }),
    )
    this.boostFlame.rotation.x = Math.PI / 2
    this.boostFlame.position.set(0, seat.tuning.chassisHalfHeight * 0.4, seat.tuning.chassisHalfLength + BOOST_FLAME.length / 2)
    this.boostFlame.visible = false
    this.object.add(this.boostFlame)
    this.wasWrecked = seat.vehicle.wrecked
    this.lastDamage = seat.vehicle.damage
    this.lastScore = seat.score
    this.lastActionTicks = seat.actionTicks
    this.lastWeapon = seat.weapon
  }

  get wrecked(): boolean {
    return this.seat.vehicle.wrecked
  }

  /** Whether what it carries may be fired: not while the roll that reveals it is on. */
  get armed(): boolean {
    return this.reveal.ready
  }

  /** Whether the fire key is held back: while the roll that reveals a weapon is on. */
  get rolling(): boolean {
    return this.reveal.rolling
  }

  /**
   * What the HUD says it is carrying: the name, with the seconds left of
   * one that lasts, or nothing when it carries nothing. What the car does
   * of its own is ambient, and not said here.
   */
  get weaponLabel(): string {
    const { shown } = this.reveal
    if (shown === 'none') return ''
    if (this.reveal.rolling || this.seat.ammoTicks === 0) return WEAPON_LABELS[shown]
    return `${WEAPON_LABELS[shown]} ${Math.ceil(this.seat.ammoTicks * FIXED_TIMESTEP)}s`
  }

  /** Train the gun on a point in the world, or on nothing, before the next render. */
  aimAt(point: Vec3 | null): void {
    this.aimPoint = point
  }

  /** How far off it is from whoever is listening. */
  private distance(): number {
    return this.ear === null ? 0 : distanceFrom(this.ear, this.seat.vehicle.frame.position)
  }

  /** Draw it between the last two steps, feed its effects, and hear it. */
  render(fraction: number, dt: number): void {
    const { vehicle, tuning, score } = this.seat
    const { explosions, smoke } = this.effects
    const sound = this.voice !== null ? this.effects.sound : null
    this.body.render(fraction, dt)
    this.view.applySimulatedWheels(vehicle.wheels, tuning)
    this.reveal.update(this.seat.weapon, dt)
    const own = OWN_ACTIONS[this.seat.profile]
    // Only what the car carries is mounted over its roof: nothing of its own is.
    this.mount.show(vehicle.wrecked ? 'none' : this.reveal.shown)
    this.mount.update(dt)
    this.mount.aim(this.aimPoint, dt)
    const engine = this.seat.weapon === 'engine' && vehicle.command.fire && this.seat.ammoTicks > 0 && !vehicle.wrecked
    this.mount.burn(engine)
    const off = this.distance()
    const boosting = acting(this.seat) && own.kind === 'boost'
    this.thrust?.set(engine || boosting ? 1 : 0, off)
    this.boostFlame.visible = boosting
    if (boosting) {
      const flicker = 0.75 + 0.25 * Math.sin(this.lightTime * 47) * Math.sin(this.lightTime * 31)
      this.boostFlame.scale.set(flicker, 0.8 + 0.5 * flicker, flicker)
    }
    // The roof lights flash in turn while they are on, and the siren wails.
    this.lightTime += dt
    const lightsOn = this.seat.lightsOn && !vehicle.wrecked
    for (const [k, lamp] of this.roofLights.entries()) {
      lamp.visible = lightsOn && Math.floor(this.lightTime * ROOF_LIGHT.flashes + k) % 2 === 0
    }
    // The siren power sounds while it is held; either way the siren is made the first time it is wanted.
    const sirenPower = this.seat.weapon === 'siren' && vehicle.command.fire && this.seat.ammoTicks > 0 && !vehicle.wrecked
    if ((lightsOn || sirenPower) && this.siren === null) this.siren = this.heard?.siren() ?? null
    this.siren?.set(lightsOn || sirenPower, off, sirenPower)
    // The horn and the hop are heard as they go, or go again, and the shockwave as it goes off: it is gone the moment it is fired.
    if (this.seat.actionTicks > this.lastActionTicks && !vehicle.wrecked) {
      if (own.kind === 'horn') sound?.horn(off)
      if (own.kind === 'hop') sound?.hop(off)
    }
    if (this.lastWeapon === 'shockwave' && this.seat.weapon === 'none' && !vehicle.wrecked) sound?.shockwave(off)
    this.lastWeapon = this.seat.weapon
    this.lastActionTicks = this.seat.actionTicks
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
      weapon: this.weaponLabel,
      rolling: this.reveal.rolling,
      ...(sync === undefined ? {} : { sync }),
    }
  }

  dispose(): void {
    this.voice?.stop()
    this.skid?.stop()
    this.siren?.stop()
    this.thrust?.stop()
    this.mount.dispose()
    this.view.dispose()
  }
}
