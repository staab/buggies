// Ported from the seattle project (src/render/chaseCamera.ts), kept in its
// original shape and formatting so the two can be compared and resynced.
// Buggies adds one thing seattle has no need of: a roof, for driving through
// tunnels. Every part of it is marked below.

import * as THREE from 'three'

import {clamp, type Quat, type Vec3} from '@buggies/physics'
import {CHASSIS_FORWARD as CHASSIS_FORWARD_VEC3} from '@buggies/game'
import {dampToward, dampVector3Toward} from './damping.ts'

export interface CameraTuning {
  distance: number
  height: number
  distanceSpeedGain: number

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
  // Raised from seattle's 3.2 on request. The rest of the rig is untouched.
  height: 4.4,
  distanceSpeedGain: 2.5,

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
  return {...DEFAULT_CAMERA_TUNING}
}

export function resetCameraTuning(tuning: CameraTuning): void {
  Object.assign(tuning, DEFAULT_CAMERA_TUNING)
}

export interface ChaseTarget {
  position: Vec3
  rotation: Quat
  velocity: Vec3
  speed: number
}

export function createChaseTarget(): ChaseTarget {
  return {
    position: {x: 0, y: 0, z: 0},
    rotation: {x: 0, y: 0, z: 0, w: 1},
    velocity: {x: 0, y: 0, z: 0},
    speed: 0,
  }
}

/**
 * Buggies addition. What the camera may not pass through at a point: the
 * ground under it, and whatever roof there is over it.
 */
export interface CameraBounds {
  floor: number
  ceiling: number
}

export type CameraBoundsAt = (x: number, z: number, out: CameraBounds) => CameraBounds

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const CHASSIS_FORWARD = new THREE.Vector3(
  CHASSIS_FORWARD_VEC3.x,
  CHASSIS_FORWARD_VEC3.y,
  CHASSIS_FORWARD_VEC3.z,
)
const MIN_SPEED_FOR_VELOCITY_BLEND = 1
const MIN_FOV_SPEED_REFERENCE = 1e-3
const MIN_ARM_LENGTH_SQUARED = 1e-6

/** Buggies addition. How far the camera keeps below a roof. */
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
  private boundsAt: CameraBoundsAt | null = null
  private readonly bounds: CameraBounds = {floor: Number.NEGATIVE_INFINITY, ceiling: Number.POSITIVE_INFINITY}

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

  /** Buggies addition. Where the camera is kept: above the floor, under the roof. */
  setBoundsAt(boundsAt: CameraBoundsAt): void {
    this.boundsAt = boundsAt
  }

  /**
   * Buggies addition. Keep a height between the floor and the roof at a point,
   * held clear of the ground and, where there is a roof, clear of that too. A
   * bore too low for both leaves the camera under the roof: better a view
   * skimming the road than one looking through the hill.
   */
  private confine(x: number, y: number, z: number): number {
    if (this.boundsAt === null) return y

    const {floor, ceiling} = this.boundsAt(x, z, this.bounds)
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
    this.updateDesiredPose(target.speed, speedFractionOfReference)
    this.settleOrDamp(dt, speedFractionOfReference)
    this.applyToCamera()
  }

  private readTarget(target: ChaseTarget): void {
    this.targetPosition.set(target.position.x, target.position.y, target.position.z)
    this.targetRotation.set(
      target.rotation.x,
      target.rotation.y,
      target.rotation.z,
      target.rotation.w,
    )
    this.targetVelocity.set(target.velocity.x, target.velocity.y, target.velocity.z)
  }

  private updateArmDirection(speed: number): void {
    const {velocityBlend} = this.tuning

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

  private updateDesiredPose(speed: number, speedFractionOfReference: number): void {
    const tuning = this.tuning
    const armLength = tuning.distance + tuning.distanceSpeedGain * speedFractionOfReference
    const lookAheadDistance = Math.min(speed * tuning.lookAheadTime, tuning.lookAheadMax)

    this.desiredPosition
      .copy(this.targetPosition)
      .addScaledVector(this.armDirection, -armLength)
      .addScaledVector(WORLD_UP, tuning.height)
    this.desiredPosition.y = this.confine(
      this.desiredPosition.x,
      this.desiredPosition.y,
      this.desiredPosition.z,
    )

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

    dampVector3Toward(this.position, this.desiredPosition, tuning.positionLambda, dt)
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
