import {
  VEHICLE_PROFILE_LABELS,
  changeVehicle,
  respawnNearby,
  type Arena,
  type Seat,
  type VehicleInput,
  type VehicleProfileId,
} from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import type * as THREE from 'three'

import { BodyView } from './body-view.ts'
import { CarView, profileColor } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { smokeAmount } from './damage.ts'
import { cameraBounds, driverState, tunnelTest } from './driver-hud.ts'
import type { Explosions } from './explosion.ts'
import type { ControlHint, HudState } from './hud.ts'
import { Keyboard, LEFT_BINDINGS, RIGHT_BINDINGS, SOLO_BINDINGS, type KeyBindings } from './input.ts'
import type { Smoke } from './smoke.ts'

/** Which keys a driver has: to drive with, to get back on the road with, and what to tell them. */
export interface DriverKeys {
  bindings: KeyBindings
  /** Whether a key press is this driver asking to be put back on the road. */
  respawn: (event: KeyboardEvent) => boolean
  controls: readonly ControlHint[]
}

/** Alone: the whole keyboard. */
export const SOLO_KEYS: DriverKeys = {
  bindings: SOLO_BINDINGS,
  respawn: (event) => event.key === 'Enter',
  controls: [
    { keys: ['W', 'A', 'S', 'D'], does: 'or arrows to drive' },
    { keys: ['Space'], does: 'handbrake' },
    { keys: ['Enter'], does: 'back to the road' },
    { keys: ['Esc'], does: 'menu' },
  ],
}

/** The left half of a split screen: the letters. */
export const LEFT_KEYS: DriverKeys = {
  bindings: LEFT_BINDINGS,
  respawn: (event) => event.code === 'KeyQ',
  controls: [
    { keys: ['W', 'A', 'S', 'D'], does: 'to drive' },
    { keys: ['Space'], does: 'handbrake' },
    { keys: ['Q'], does: 'back to the road' },
    { keys: ['Esc'], does: 'menu' },
  ],
}

/** The right half of a split screen: the arrows. */
export const RIGHT_KEYS: DriverKeys = {
  bindings: RIGHT_BINDINGS,
  respawn: (event) => event.key === '?',
  controls: [
    { keys: ['↑', '←', '↓', '→'], does: 'to drive' },
    { keys: ['Left Shift'], does: 'handbrake' },
    { keys: ['?'], does: 'back to the road' },
    { keys: ['Esc'], does: 'menu' },
  ],
}

/** The effects every driver's car feeds: one set for the whole screen. */
export interface DriverEffects {
  explosions: Explosions
  smoke: Smoke
}

/**
 * One person driving one seat: their keys, their car as drawn, and the
 * camera that follows it. A screen has one of these, or one each side.
 */
export class Driver {
  readonly seat: Seat
  readonly keys: DriverKeys
  readonly chase: ChaseCamera
  profile: VehicleProfileId

  private readonly scene: THREE.Scene
  private readonly map: TerrainMap
  private readonly effects: DriverEffects
  private readonly keyboard: Keyboard
  private readonly target = createChaseTarget()
  private readonly inTunnel: ReturnType<typeof tunnelTest>
  private car: CarView
  private body: BodyView
  private wasWrecked = false

  constructor(
    scene: THREE.Scene,
    map: TerrainMap,
    seat: Seat,
    profile: VehicleProfileId,
    keys: DriverKeys,
    effects: DriverEffects,
  ) {
    this.scene = scene
    this.map = map
    this.seat = seat
    this.profile = profile
    this.keys = keys
    this.effects = effects
    this.keyboard = new Keyboard(keys.bindings)
    this.car = new CarView(profile, profileColor(profile))
    this.car.syncDimensions(seat.tuning)
    scene.add(this.car.object)
    this.body = new BodyView(seat.vehicle.body, this.car.object)
    const cameraTuning = createCameraTuning()
    cameraTuning.far = map.size * map.cellSize * 2
    this.chase = new ChaseCamera(cameraTuning)
    this.chase.setBoundsAt(cameraBounds(map))
    this.inTunnel = tunnelTest(map)
    this.snap()
  }

  get camera(): THREE.PerspectiveCamera {
    return this.chase.camera
  }

  /** What they are asking of the car right now. */
  input(): VehicleInput {
    return this.keyboard.read()
  }

  /** After each simulation step. */
  captureStep(): void {
    this.body.capture()
  }

  /** Draw the car between the last two steps, feed its effects, and follow it. */
  render(fraction: number, dt: number): void {
    const { vehicle, tuning } = this.seat
    const { explosions, smoke } = this.effects
    this.body.apply(fraction)
    this.car.applySimulatedWheels(vehicle.wheels, tuning)
    if (vehicle.wrecked && !this.wasWrecked) explosions.burst(vehicle.frame.position)
    this.wasWrecked = vehicle.wrecked
    this.car.setWrecked(this.wasWrecked)
    if (!this.wasWrecked) {
      smoke.trail(vehicle.frame.position, vehicle.frame.linearVelocity, smokeAmount(vehicle.damage), dt)
    }
    this.aim()
    this.chase.update(dt, this.target)
  }

  /** The car has been moved: pick the camera up and put it behind it. */
  snap(): void {
    this.body.reset()
    this.aim()
    this.chase.snapTo(this.target)
  }

  /** Back on the nearest road, on this driver's say-so. */
  respawn(arena: Arena): void {
    respawnNearby(arena, this.seat)
    this.keyboard.release()
    this.snap()
  }

  /** A different vehicle, where this one is. */
  setVehicle(arena: Arena, next: VehicleProfileId): void {
    if (next === this.profile) return
    changeVehicle(arena, this.seat, next)
    this.profile = next
    this.car.dispose()
    this.car = new CarView(next, profileColor(next))
    this.car.syncDimensions(this.seat.tuning)
    this.scene.add(this.car.object)
    this.body = new BodyView(this.seat.vehicle.body, this.car.object)
    this.wasWrecked = false
    this.keyboard.release()
    this.snap()
  }

  hud(): HudState {
    const { vehicle, tuning, submersion } = this.seat
    return {
      title: `${VEHICLE_PROFILE_LABELS[this.profile]} | seed ${this.map.seed}`,
      state: driverState(vehicle, submersion, this.inTunnel(vehicle.frame.position)),
      speed: vehicle.speed,
      maxSpeed: tuning.maxSpeed,
      damage: vehicle.wrecked ? 1 : vehicle.damage,
      controls: this.keys.controls,
    }
  }

  dispose(): void {
    this.keyboard.dispose()
    this.car.dispose()
  }

  private aim(): void {
    const { vehicle } = this.seat
    vehicle.body.translation(this.target.position)
    vehicle.body.rotation(this.target.rotation)
    vehicle.body.linvel(this.target.velocity)
    this.target.speed = vehicle.speed
    this.target.wrecked = vehicle.wrecked
  }
}
