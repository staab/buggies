import {
  FIXED_TIMESTEP,
  GRAPPLE_MISS_TICKS,
  GRAPPLE_RANGE,
  MAGNET_REACH,
  MOUNT_HEIGHT,
  NO_TARGET,
  OWN_ACTIONS,
  SHOCKWAVE_RANGE,
  WEAPON_LABELS,
  acting,
  hasBuiltInGun,
  type Seat,
  type Weapon,
} from '@buggies/game'
import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

import { engineRev, skidAmount, type EngineVoice, type SirenVoice, type SkidVoice, type Sound, type ThrustVoice } from './audio.ts'
import { CarView } from './car-view.ts'
import type { ChaseTarget } from './chase-camera.ts'
import { smokeAmount } from './damage.ts'
import { disposeObject } from './dispose.ts'
import { distanceFrom, type Ear } from './ear.ts'
import type { Explosions } from './explosion.ts'
import type { ControlHint, HudState } from './hud.ts'
import type { Smoke } from './smoke.ts'
import { SmoothedBody } from './smoothed-body.ts'
import { PLOW_BLADE_RADIUS, buildHook, buildPlow } from './weapon-models.ts'
import { WeaponMount } from './weapon-mount.ts'
import { WeaponReveal } from './weapon-reveal.ts'

/** A knock that takes this much of a car's life is heard at full volume. */
const LOUD_KNOCK = 0.25
/** How many times a second an emergency vehicle's roof lights flash from one side to the other. */
const SIREN_FLASHES = 4
const hooked = new THREE.Vector3()
const ropeFrom = new THREE.Vector3()
const ropeWay = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const AHEAD = new THREE.Vector3(0, 0, -1)
/** How thick the grappling rope is, and how big its hook is drawn, to be seen from the chase camera. */
const ROPE_RADIUS = 0.06
const HOOK_SCALE = 1.6
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
/** The siren's footprint, whose highest roof point its base stands on, and how far its base reaches below its middle. */
const SIREN_FOOTPRINT = { xs: [-0.26, 0, 0.26], zs: [-0.65, -0.35, 0, 0.2], base: 0.07 } as const
/** The boost's flame at the back of the car, this long. */
const BOOST_FLAME = { radius: 0.18, length: 0.8 } as const

/**
 * Where a seat's grappling line runs to: the middle of the car it has
 * caught, or, having caught nothing, a point straight ahead, going out to
 * the line's full reach and coming back; nowhere when the line is not out.
 */
export function hookPointOf(seat: Seat, seats: readonly Seat[]): Vec3 | null {
  if (seat.grappleTicks <= 0) return null
  if (seat.grappleTarget !== NO_TARGET) return seats[seat.grappleTarget]?.vehicle.frame.position ?? null
  const along = 1 - seat.grappleTicks / GRAPPLE_MISS_TICKS
  const out = GRAPPLE_RANGE * (1 - Math.abs(1 - 2 * along))
  const { position, forward } = seat.vehicle.frame
  return { x: position.x + forward.x * out, y: position.y + forward.y * out, z: position.z + forward.z * out }
}

/** How much bigger than the chassis the shield's bubble is, and how see-through. */
const SHIELD_BUBBLE = { scale: 1.6, opacity: 0.28 } as const
/** How far in front of the chassis the ram plow's blade is set. */
const PLOW_OUT = 0.35

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
  private readonly boostFlame: THREE.Mesh
  private aimPoint: Vec3 | null = null
  private hookPoint: Vec3 | null = null
  /** What lasts of what the car has used, drawn on it: the shield's bubble, the plow's blade, the magnet's reach and the grappling line with its hook. */
  private readonly bubble: THREE.Mesh
  private readonly blade: THREE.Group
  private readonly pull: THREE.Mesh
  /** The grappling line: a rope a meter long, stretched to fit, and the hook on its end. */
  private readonly rope: THREE.Mesh
  private readonly hook: THREE.Group
  private wasWrecked: boolean
  private lastDamage: number
  private lastScore: number
  private lastActionTicks: number
  private lastWeapon: Weapon
  private lastWins: number
  private lightTime = 0

  constructor(seat: Seat, color: number, effects: PresenceEffects, options: PresenceOptions = {}) {
    this.seat = seat
    this.effects = effects
    this.ear = options.ear ?? null
    this.view = new CarView(seat.profile, color)
    this.view.syncDimensions(seat.tuning)
    this.object = this.view.object
    // The siren power-up stands on the roof rather than hovering; measured before anything else is hung on the car.
    const top = seat.tuning.chassisHalfHeight
    const sirenRest =
      Math.max(...SIREN_FOOTPRINT.xs.flatMap((x) => SIREN_FOOTPRINT.zs.map((z) => roofAt(this.object, x, z, top)))) + SIREN_FOOTPRINT.base
    this.mount = new WeaponMount(top + MOUNT_HEIGHT, hasBuiltInGun(seat.profile), sirenRest)
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
    const { chassisHalfWidth, chassisHalfHeight, chassisHalfLength } = seat.tuning
    this.bubble = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0x7fd4ff, emissive: 0x3aa8ff, emissiveIntensity: 0.5, transparent: true, opacity: SHIELD_BUBBLE.opacity, depthWrite: false }),
    )
    this.bubble.scale.set(chassisHalfWidth, chassisHalfHeight * 1.5, chassisHalfLength).multiplyScalar(SHIELD_BUBBLE.scale)
    this.bubble.visible = false
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
    // Up +Y from its foot, so it is stood from one end of the line and turned and stretched to the other.
    this.rope = new THREE.Mesh(
      new THREE.CylinderGeometry(ROPE_RADIUS, ROPE_RADIUS, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0xc8b98a, roughness: 0.9 }),
    )
    this.rope.castShadow = true
    this.rope.frustumCulled = false
    this.rope.visible = false
    this.hook = buildHook()
    this.hook.scale.setScalar(HOOK_SCALE)
    this.hook.visible = false
    this.object.add(this.bubble, this.blade, this.pull, this.rope, this.hook)
    this.wasWrecked = seat.vehicle.wrecked
    this.lastDamage = seat.vehicle.damage
    this.lastScore = seat.score
    this.lastActionTicks = seat.actionTicks
    this.lastWeapon = seat.weapon
    this.lastWins = seat.wins
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

  /** Run the grappling line to a point in the world, or put it away, before the next render. */
  hookAt(point: Vec3 | null): void {
    this.hookPoint = point
  }

  /** Draw what lasts of what the car has used: the shield up, the plow set, the magnet pulling, the line out. */
  private showEffects(): void {
    const { seat } = this
    const out = !seat.vehicle.wrecked
    this.bubble.visible = out && seat.shieldTicks > 0
    this.blade.visible = out && seat.plowTicks > 0
    this.pull.visible = out && seat.magnetTicks > 0
    const lineOut = out && this.hookPoint !== null
    this.rope.visible = lineOut
    this.hook.visible = lineOut
    if (!lineOut || this.hookPoint === null) return
    // From the front of the car to where the hook is, in the car's own frame: the rope stretched between, the hook on the end, pointing on.
    this.object.updateMatrixWorld()
    const from = ropeFrom.set(0, 0, -seat.tuning.chassisHalfLength)
    hooked.set(this.hookPoint.x, this.hookPoint.y, this.hookPoint.z)
    this.object.worldToLocal(hooked)
    ropeWay.subVectors(hooked, from)
    const length = ropeWay.length()
    if (length > 0) ropeWay.divideScalar(length)
    else ropeWay.set(0, 0, -1)
    this.rope.position.copy(from)
    this.rope.quaternion.setFromUnitVectors(UP, ropeWay)
    this.rope.scale.set(1, Math.max(length, 0.01), 1)
    this.hook.position.copy(hooked)
    this.hook.quaternion.setFromUnitVectors(AHEAD, ropeWay)
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
    this.reveal.update(this.seat.weapon, this.seat.wins, dt)
    const own = OWN_ACTIONS[this.seat.profile]
    // Only what the car carries is mounted over its roof: nothing of its own is.
    this.mount.show(vehicle.wrecked ? 'none' : this.reveal.shown)
    this.mount.update(dt)
    this.mount.aim(this.aimPoint, dt)
    this.showEffects()
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
    this.view.lightSirens(lightsOn ? Math.floor(this.lightTime * SIREN_FLASHES) % 2 : null)
    // The siren power sounds while it is held; either way the siren is made the first time it is wanted.
    const sirenPower = this.seat.weapon === 'siren' && vehicle.command.fire && this.seat.ammoTicks > 0 && !vehicle.wrecked
    if ((lightsOn || sirenPower) && this.siren === null) this.siren = this.heard?.siren() ?? null
    this.siren?.set(lightsOn || sirenPower, off, sirenPower)
    // The horn and the hop are heard as they go, or go again, and the shockwave as it goes off: it is gone the moment it is fired.
    if (this.seat.actionTicks > this.lastActionTicks && !vehicle.wrecked) {
      if (own.kind === 'horn') sound?.horn(off)
      if (own.kind === 'hop') sound?.hop(off)
    }
    // Gone, or won again the moment it went: either way it went off, unless the car was wrecked.
    const shocked = this.lastWeapon === 'shockwave' && (this.seat.weapon !== 'shockwave' || this.seat.wins !== this.lastWins)
    if (shocked && !vehicle.wrecked) {
      explosions.shockwave(vehicle.frame.position, SHOCKWAVE_RANGE)
      sound?.shockwave(off)
    }
    this.lastWeapon = this.seat.weapon
    this.lastWins = this.seat.wins
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
    disposeObject(this.blade)
    disposeObject(this.hook)
    for (const mesh of [this.bubble, this.pull, this.rope]) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.view.dispose()
  }
}
