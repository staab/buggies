// The camera behind a car: it hangs back on an arm, looks ahead of the car,
// widens its view with speed, drops under a bridge or in a tunnel, and pulls
// far away to watch a wreck.

import * as THREE from 'three'

import { clamp, type Quat, type Vec3 } from '@buggies/physics'
import { CHASSIS_FORWARD as CHASSIS_FORWARD_VEC3 } from '@buggies/game'
import { dampToward, dampVector3Toward } from './damping.ts'

export interface CameraTuning {
  distance: number
  height: number
  /** The height the camera drops to with something overhead, under a bridge or in a tunnel. */
  lowHeight: number
  distanceSpeedGain: number
  /**
   * How far back and up the camera pulls from the spot
   * where the car blew up, and how quickly. It stops following the car
   * there, and watches the wreck fly from where it stood.
   */
  wreckDistance: number
  wreckHeight: number
  wreckLambda: number

  positionLambda: number
  lookLambda: number
  fovLambda: number

  lookAheadTime: number
  lookAheadMax: number
  lookHeight: number

  velocityBlend: number

  fovBase: number
  fovMax: number
  fovSpeedRef: number

  near: number
  far: number

  groundClearance: number
}

export const DEFAULT_CAMERA_TUNING: Readonly<CameraTuning> = Object.freeze({
  distance: 8.5,
  // Raised on request, then a little more.
  height: 5.2,
  lowHeight: 1.9,
  distanceSpeedGain: 2.5,
  wreckDistance: 102,
  wreckHeight: 66,
  wreckLambda: 1.2,

  positionLambda: 6,
  lookLambda: 9,
  fovLambda: 3,

  lookAheadTime: 0.25,
  lookAheadMax: 9,
  lookHeight: 1.2,

  velocityBlend: 0.35,

  fovBase: 62,
  fovMax: 84,
  fovSpeedRef: 55,

  near: 0.2,
  far: 3200,

  groundClearance: 1.6,
} satisfies CameraTuning)

export function createCameraTuning(): CameraTuning {
  return { ...DEFAULT_CAMERA_TUNING }
}

export function resetCameraTuning(tuning: CameraTuning): void {
  Object.assign(tuning, DEFAULT_CAMERA_TUNING)
}

export interface ChaseTarget {
  position: Vec3
  rotation: Quat
  velocity: Vec3
  speed: number
  /** Blown up, and being watched from well back until it is put back. */
  wrecked: boolean
}

export function createChaseTarget(): ChaseTarget {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    wrecked: false,
  }
}

/**
 * What the camera may not pass through at a point: the
 * ground under it, and whatever roof there is over it.
 */
export interface CameraBounds {
  floor: number
  ceiling: number
}

/**
 * The bounds at a point, for a car at height `above`: a
 * deck counts as a roof only when it is over the car, not when the car is
 * driving on it.
 */
export type CameraBoundsAt = (x: number, z: number, out: CameraBounds, above: number) => CameraBounds

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const CHASSIS_FORWARD = new THREE.Vector3(CHASSIS_FORWARD_VEC3.x, CHASSIS_FORWARD_VEC3.y, CHASSIS_FORWARD_VEC3.z)
const MIN_SPEED_FOR_VELOCITY_BLEND = 1
const MIN_FOV_SPEED_REFERENCE = 1e-3
const MIN_ARM_LENGTH_SQUARED = 1e-6

/** How far the camera keeps below a roof. */
const ROOF_CLEARANCE = 0.6

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera

  private readonly tuning: CameraTuning
  private readonly position = new THREE.Vector3()
  private readonly lookAt = new THREE.Vector3()

  private readonly targetPosition = new THREE.Vector3()
  private readonly targetRotation = new THREE.Quaternion()
  private readonly targetVelocity = new THREE.Vector3()
  private readonly travelDirection = new THREE.Vector3()
  private readonly armDirection = new THREE.Vector3()
  private readonly desiredPosition = new THREE.Vector3()
  private readonly desiredLookAt = new THREE.Vector3()

  private settled = false
  private wrecked = false
  /** Where the car blew up, and which way it was going, for the camera to pull away from. */
  private readonly wreckAnchor = new THREE.Vector3()
  private readonly wreckArm = new THREE.Vector3()
  private boundsAt: CameraBoundsAt | null = null
  private readonly bounds: CameraBounds = { floor: Number.NEGATIVE_INFINITY, ceiling: Number.POSITIVE_INFINITY }

  constructor(tuning: CameraTuning) {
    this.tuning = tuning
    this.camera = new THREE.PerspectiveCamera(tuning.fovBase, 1, tuning.near, tuning.far)
  }

  setGroundAt(groundAt: (x: number, z: number) => number): void {
    this.setBoundsAt((x, z, out) => {
      out.floor = groundAt(x, z)
      out.ceiling = Number.POSITIVE_INFINITY
      return out
    })
  }

  /** Where the camera is kept: above the floor, under the roof. */
  setBoundsAt(boundsAt: CameraBoundsAt): void {
    this.boundsAt = boundsAt
  }

  /**
   * Keep a height between the floor and the roof at a point,
   * held clear of the ground and, where there is a roof, clear of that too. A
   * bore too low for both leaves the camera under the roof: better a view
   * skimming the road than one looking through the hill.
   */
  private confine(x: number, y: number, z: number): number {
    if (this.boundsAt === null) return y

    const { floor, ceiling } = this.boundsAt(x, z, this.bounds, this.targetPosition.y)
    const lowest = floor + this.tuning.groundClearance
    const highest = ceiling - ROOF_CLEARANCE

    return Math.min(Math.max(y, lowest), Math.max(highest, floor + ROOF_CLEARANCE))
  }

  snapTo(target: ChaseTarget): void {
    this.settled = false
    this.update(0, target)
  }

  update(dt: number, target: ChaseTarget): void {
    const speedFractionOfReference = clamp(
      target.speed / Math.max(this.tuning.fovSpeedRef, MIN_FOV_SPEED_REFERENCE),
      0,
      1,
    )

    this.readTarget(target)
    this.updateArmDirection(target.speed)
    if (target.wrecked && !this.wrecked) {
      this.wreckAnchor.copy(this.targetPosition)
      this.wreckArm.copy(this.armDirection)
    }
    this.wrecked = target.wrecked
    this.updateDesiredPose(target.speed, speedFractionOfReference)
    this.settleOrDamp(dt, speedFractionOfReference)
    this.applyToCamera()
  }

  private readTarget(target: ChaseTarget): void {
    this.targetPosition.set(target.position.x, target.position.y, target.position.z)
    this.targetRotation.set(target.rotation.x, target.rotation.y, target.rotation.z, target.rotation.w)
    this.targetVelocity.set(target.velocity.x, target.velocity.y, target.velocity.z)
  }

  private updateArmDirection(speed: number): void {
    const { velocityBlend } = this.tuning

    this.armDirection.copy(CHASSIS_FORWARD).applyQuaternion(this.targetRotation)

    if (velocityBlend > 0 && speed > MIN_SPEED_FOR_VELOCITY_BLEND) {
      this.travelDirection.copy(this.targetVelocity).divideScalar(speed)

      if (this.travelDirection.dot(this.armDirection) > 0) {
        this.armDirection.lerp(this.travelDirection, clamp(velocityBlend, 0, 1))
      }
    }

    this.armDirection.y = 0

    if (this.armDirection.lengthSq() < MIN_ARM_LENGTH_SQUARED) {
      this.armDirection.copy(CHASSIS_FORWARD)
    }

    this.armDirection.normalize()
  }

  /** Whether there is a roof over the car itself: a bridge deck, or a tunnel. */
  private covered(): boolean {
    if (this.boundsAt === null) return false
    const { x, y, z } = this.targetPosition
    return Number.isFinite(this.boundsAt(x, z, this.bounds, y).ceiling)
  }

  private updateDesiredPose(speed: number, speedFractionOfReference: number): void {
    const tuning = this.tuning
    // A wreck is watched from well back and well up. The
    // camera stops following the car the moment it blows up, pulls away from
    // that spot, and turns to keep the wreck in view as it flies.
    if (this.wrecked) {
      this.desiredPosition
        .copy(this.wreckAnchor)
        .addScaledVector(this.wreckArm, -tuning.wreckDistance)
        .addScaledVector(WORLD_UP, tuning.wreckHeight)
      this.desiredPosition.y = this.confine(this.desiredPosition.x, this.desiredPosition.y, this.desiredPosition.z)
      this.desiredLookAt.copy(this.targetPosition)
      return
    }
    const armLength = tuning.distance + tuning.distanceSpeedGain * speedFractionOfReference
    const lookAheadDistance = Math.min(speed * tuning.lookAheadTime, tuning.lookAheadMax)
    // Under a bridge the camera drops to a low chase, and
    // eases back up once the car is out from under it.
    const height = this.covered() ? tuning.lowHeight : tuning.height

    this.desiredPosition
      .copy(this.targetPosition)
      .addScaledVector(this.armDirection, -armLength)
      .addScaledVector(WORLD_UP, height)
    this.desiredPosition.y = this.confine(this.desiredPosition.x, this.desiredPosition.y, this.desiredPosition.z)

    this.desiredLookAt
      .copy(this.targetPosition)
      .addScaledVector(WORLD_UP, tuning.lookHeight)
      .addScaledVector(this.armDirection, lookAheadDistance)
  }

  private settleOrDamp(dt: number, speedFractionOfReference: number): void {
    const tuning = this.tuning

    if (!this.settled) {
      this.position.copy(this.desiredPosition)
      this.lookAt.copy(this.desiredLookAt)
      this.camera.fov = tuning.fovBase
      this.settled = true

      return
    }

    // The pull-out from a wreck is slower than the chase.
    const positionLambda = this.wrecked ? tuning.wreckLambda : tuning.positionLambda
    dampVector3Toward(this.position, this.desiredPosition, positionLambda, dt)
    dampVector3Toward(this.lookAt, this.desiredLookAt, tuning.lookLambda, dt)

    this.camera.fov = dampToward(
      this.camera.fov,
      tuning.fovBase + (tuning.fovMax - tuning.fovBase) * speedFractionOfReference,
      tuning.fovLambda,
      dt,
    )
  }

  private applyToCamera(): void {
    const tuning = this.tuning

    this.camera.near = tuning.near
    this.camera.far = tuning.far
    this.position.y = this.confine(this.position.x, this.position.y, this.position.z)
    this.camera.position.copy(this.position)
    this.camera.up.copy(WORLD_UP)
    this.camera.lookAt(this.lookAt)
    this.camera.updateProjectionMatrix()
  }
}
