import type { VehicleState } from '@buggies/game'
import * as THREE from 'three'

/** How far back and how high the camera sits, before speed stretches it. */
const DISTANCE = 9.5
const HEIGHT = 4.8
const DISTANCE_AT_SPEED = 3

/** Damping rates, per second. The look point chases harder than the seat. */
const POSITION_RATE = 6
const LOOK_RATE = 9
const FOV_RATE = 3

const LOOK_HEIGHT = 1.4
const LOOK_AHEAD_TIME = 0.3
const LOOK_AHEAD_MAX = 10

/** How much of the arm comes from where the vehicle is going rather than where
 * it points. Enough to see through a drift without swinging wildly. */
const VELOCITY_BLEND = 0.35
const MIN_BLEND_SPEED = 2

const FOV_BASE = 62
const FOV_WIDE = 80
const FOV_SPEED = 50

/** The camera never drops below the ground, whatever the vehicle is over. */
const GROUND_CLEARANCE = 1.8

const WORLD_UP = new THREE.Vector3(0, 1, 0)

function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt)
}

function dampVector(current: THREE.Vector3, target: THREE.Vector3, rate: number, dt: number): void {
  const remaining = Math.exp(-rate * dt)
  current.x = target.x + (current.x - target.x) * remaining
  current.y = target.y + (current.y - target.y) * remaining
  current.z = target.z + (current.z - target.z) * remaining
}

/**
 * A third-person chase camera. It trails on a damped arm rather than being
 * bolted to the vehicle, so hard cornering, landings and drifts read as motion
 * instead of shaking the whole world.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera

  private readonly seat = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly wantSeat = new THREE.Vector3()
  private readonly wantLook = new THREE.Vector3()
  private readonly arm = new THREE.Vector3()
  private settled = false

  constructor(far: number) {
    this.camera = new THREE.PerspectiveCamera(FOV_BASE, 1, 0.3, far)
  }

  snap(): void {
    this.settled = false
  }

  update(dt: number, state: VehicleState, groundAt: (x: number, z: number) => number): void {
    const planar = Math.hypot(state.velocity.x, state.velocity.z)
    const pace = Math.min(planar / FOV_SPEED, 1)

    this.arm.set(Math.sin(state.heading), 0, Math.cos(state.heading))
    if (planar > MIN_BLEND_SPEED) {
      const travel = new THREE.Vector3(state.velocity.x, 0, state.velocity.z).divideScalar(planar)
      // Only when it is broadly going where it is pointing: in a spin the
      // travel direction is behind the nose and following it is nauseating.
      if (travel.dot(this.arm) > 0) this.arm.lerp(travel, VELOCITY_BLEND).normalize()
    }

    this.wantSeat
      .set(state.position.x, state.position.y, state.position.z)
      .addScaledVector(this.arm, -(DISTANCE + DISTANCE_AT_SPEED * pace))
      .addScaledVector(WORLD_UP, HEIGHT)
    this.wantSeat.y = Math.max(
      this.wantSeat.y,
      groundAt(this.wantSeat.x, this.wantSeat.z) + GROUND_CLEARANCE,
    )

    this.wantLook
      .set(state.position.x, state.position.y, state.position.z)
      .addScaledVector(WORLD_UP, LOOK_HEIGHT)
      .addScaledVector(this.arm, Math.min(planar * LOOK_AHEAD_TIME, LOOK_AHEAD_MAX))

    if (this.settled) {
      dampVector(this.seat, this.wantSeat, POSITION_RATE, dt)
      dampVector(this.look, this.wantLook, LOOK_RATE, dt)
      this.camera.fov = damp(this.camera.fov, FOV_BASE + (FOV_WIDE - FOV_BASE) * pace, FOV_RATE, dt)
    } else {
      this.seat.copy(this.wantSeat)
      this.look.copy(this.wantLook)
      this.camera.fov = FOV_BASE
      this.settled = true
    }

    this.seat.y = Math.max(this.seat.y, groundAt(this.seat.x, this.seat.z) + GROUND_CLEARANCE)
    this.camera.position.copy(this.seat)
    this.camera.up.copy(WORLD_UP)
    this.camera.lookAt(this.look)
    this.camera.updateProjectionMatrix()
  }
}
