// Ported from the seattle project (src/render/chaseCamera.ts), kept in its
// original shape and formatting so the two can be compared and resynced.
// Buggies adds one thing seattle has no need of: a view that moves inside the
// car, for driving through tunnels. Every part of it is marked below.

import * as THREE from 'three'

import {clamp, lerp, type Quat, type Vec3} from '@buggies/physics'
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

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const CHASSIS_FORWARD = new THREE.Vector3(
  CHASSIS_FORWARD_VEC3.x,
  CHASSIS_FORWARD_VEC3.y,
  CHASSIS_FORWARD_VEC3.z,
)
const MIN_SPEED_FOR_VELOCITY_BLEND = 1
const MIN_FOV_SPEED_REFERENCE = 1e-3
const MIN_ARM_LENGTH_SQUARED = 1e-6

/** Buggies addition. How quickly the view moves in and back out again. */
const FIRST_PERSON_RATE = 3

/**
 * Buggies addition. Seated, the camera is part of the car rather than trailing
 * it, so it is damped hard enough to stay put in the cabin at speed.
 */
const SEATED_LAMBDA = 28

/** Buggies addition. Where the driver's head is, in the chassis' own frame. */
const EYE_UP = 0.5
const EYE_FORWARD = 0.2
const EYE_LOOK_AHEAD = 12

const CHASSIS_UP = new THREE.Vector3(0, 1, 0)

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
  private groundAt: ((x: number, z: number) => number) | null = null

  /** Buggies addition: how far into the cabin the view has moved, 0 to 1. */
  private seated = 0
  private wantSeated = 0
  private readonly eye = new THREE.Vector3()
  private readonly eyeLookAt = new THREE.Vector3()
  private readonly eyeForward = new THREE.Vector3()

  constructor(tuning: CameraTuning) {
    this.tuning = tuning
    this.camera = new THREE.PerspectiveCamera(tuning.fovBase, 1, tuning.near, tuning.far)
  }

  setGroundAt(groundAt: (x: number, z: number) => number): void {
    this.groundAt = groundAt
  }

  /**
   * Buggies addition. Move the view into the cabin, or back out behind the
   * car. It eases across rather than cutting, and takes the ground with it:
   * inside a tunnel the ground overhead is the hill, and a camera held above
   * it is a camera outside the mountain looking at nothing.
   */
  setSeated(seated: boolean): void {
    this.wantSeated = seated ? 1 : 0
  }

  private groundFloor(x: number, z: number): number {
    return this.groundAt === null
      ? Number.NEGATIVE_INFINITY
      : this.groundAt(x, z) + this.tuning.groundClearance
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

    this.seated = dampToward(this.seated, this.wantSeated, FIRST_PERSON_RATE, dt)
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
    this.desiredPosition.y = lerp(
      Math.max(
        this.desiredPosition.y,
        this.groundFloor(this.desiredPosition.x, this.desiredPosition.z),
      ),
      this.desiredPosition.y,
      this.seated,
    )

    this.desiredLookAt
      .copy(this.targetPosition)
      .addScaledVector(WORLD_UP, tuning.lookHeight)
      .addScaledVector(this.armDirection, lookAheadDistance)

    if (this.seated <= 0) return

    // Buggies addition. The seat rides with the chassis, so it is placed off
    // the car's own axes rather than the world's, and looks along the same arm
    // the chase view uses: the nose, eased toward where the car is going.
    this.eyeForward.copy(CHASSIS_FORWARD).applyQuaternion(this.targetRotation)
    this.eye
      .copy(CHASSIS_UP)
      .applyQuaternion(this.targetRotation)
      .multiplyScalar(EYE_UP)
      .addScaledVector(this.eyeForward, EYE_FORWARD)
      .add(this.targetPosition)
    this.eyeLookAt.copy(this.eye).addScaledVector(this.armDirection, EYE_LOOK_AHEAD)

    this.desiredPosition.lerp(this.eye, this.seated)
    this.desiredLookAt.lerp(this.eyeLookAt, this.seated)
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

    // Buggies addition: a trailing arm may lag, a seat may not.
    const positionLambda = lerp(tuning.positionLambda, SEATED_LAMBDA, this.seated)
    const lookLambda = lerp(tuning.lookLambda, SEATED_LAMBDA, this.seated)

    dampVector3Toward(this.position, this.desiredPosition, positionLambda, dt)
    dampVector3Toward(this.lookAt, this.desiredLookAt, lookLambda, dt)

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
    // Buggies addition: the floor is let go of as the view moves inside.
    this.position.y = lerp(
      Math.max(this.position.y, this.groundFloor(this.position.x, this.position.z)),
      this.position.y,
      this.seated,
    )
    this.camera.position.copy(this.position)
    this.camera.up.copy(WORLD_UP)
    this.camera.lookAt(this.lookAt)
    this.camera.updateProjectionMatrix()
  }
}
