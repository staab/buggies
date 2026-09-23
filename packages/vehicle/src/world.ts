// The physics world the vehicles live in, and the fixed things put into it.

import * as RAPIER from '@dimforge/rapier3d-compat'

import { FIXED_TIMESTEP, quatFromYaw, quatFromYawPitch, type Vec3 } from '@buggies/physics'
import { GROUND_GROUPS } from './groups.ts'

export { FIXED_TIMESTEP } from '@buggies/physics'

export const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }

const SOLVER_ITERATIONS = 8
const CCD_SUBSTEPS = 8

export interface WorldTuning {
  gravity: number
  waterDrag: number
  waterSpinDrag: number
  waterBuoyancy: number
}

export const DEFAULT_WORLD_TUNING: Readonly<WorldTuning> = Object.freeze({
  gravity: 18,
  waterDrag: 3.6,
  waterSpinDrag: 5,
  waterBuoyancy: 0.86,
} satisfies WorldTuning)

export function createWorldTuning(): WorldTuning {
  return { ...DEFAULT_WORLD_TUNING }
}

export function resetWorldTuning(tuning: WorldTuning): void {
  Object.assign(tuning, DEFAULT_WORLD_TUNING)
}

/**
 * How far ahead of a body a contact is made, in metres. Rapier's own 2cm
 * turns every seam of a wall a car scrapes along into a head-on collision:
 * a chassis corner a few millimetres short of the next facet is held back
 * from it as though it were about to hit it square. A couple of millimetres
 * keeps resting contacts settled and lets the corner slide on.
 */
const CONTACT_PREDICTION = 0.002

let wasmReady = false

export async function initPhysics(): Promise<void> {
  if (wasmReady) return

  await RAPIER.init()

  wasmReady = true
}

export function applyWorldTuning(world: RAPIER.World, tuning: WorldTuning): void {
  world.gravity.x = 0
  world.gravity.y = -tuning.gravity
  world.gravity.z = 0
}

export function worldGravity(world: RAPIER.World): number {
  return -world.gravity.y
}

export function createPhysicsWorld(tuning: WorldTuning = DEFAULT_WORLD_TUNING): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })

  applyWorldTuning(world, tuning)

  world.timestep = FIXED_TIMESTEP
  world.numSolverIterations = SOLVER_ITERATIONS
  world.maxCcdSubsteps = CCD_SUBSTEPS
  world.integrationParameters.normalizedPredictionDistance = CONTACT_PREDICTION

  return world
}

export interface BoxOptions {
  halfExtents: Vec3
  position: Vec3
  yaw?: number
  friction?: number
  restitution?: number
  mass?: number
}

export function addStaticBox(world: RAPIER.World, options: BoxOptions): RAPIER.RigidBody {
  const { halfExtents, position, yaw = 0, friction = 1.0, restitution = 0 } = options

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z).setRotation(quatFromYaw(yaw)),
  )

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setCollisionGroups(GROUND_GROUPS)
      .setFriction(friction)
      .setRestitution(restitution),
    body,
  )

  return body
}

/** A fixed box that is not ground: a wall, met by the chassis and counted as a crash. */
export function addStaticWall(world: RAPIER.World, options: BoxOptions): RAPIER.RigidBody {
  const { halfExtents, position, yaw = 0, friction = 1.0, restitution = 0 } = options

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z).setRotation(quatFromYaw(yaw)),
  )

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setFriction(friction)
      .setRestitution(restitution),
    body,
  )

  return body
}

export function addDynamicBox(world: RAPIER.World, options: BoxOptions): RAPIER.RigidBody {
  const { halfExtents, position, yaw = 0, friction = 0.8, restitution = 0.2, mass = 40 } = options

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(quatFromYaw(yaw))
      .setLinearDamping(0.1)
      .setAngularDamping(0.3),
  )

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setDensity(0)
      .setMass(mass)
      .setFriction(friction)
      .setRestitution(restitution),
    body,
  )

  return body
}

export interface RampOptions {
  halfExtents: Vec3
  position: Vec3
  pitch: number
  yaw?: number
}

export function addRamp(world: RAPIER.World, options: RampOptions): RAPIER.RigidBody {
  const { halfExtents, position, pitch, yaw = 0 } = options

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(quatFromYawPitch(yaw, pitch)),
  )

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setCollisionGroups(GROUND_GROUPS)
      .setFriction(1.0),
    body,
  )

  return body
}
