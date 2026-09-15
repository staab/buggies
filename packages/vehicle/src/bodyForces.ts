// Ported from the seattle project (src/physics/bodyForces.ts). Kept in its original
// shape and formatting so the two can be compared and resynced.

import type * as RAPIER from '@dimforge/rapier3d-compat'

import {v3, vscale, type Vec3} from '@buggies/physics'

const appliedForce = v3()
const appliedTorque = v3()

export function addForceAlong(body: RAPIER.RigidBody, direction: Vec3, magnitude: number): void {
  vscale(appliedForce, direction, magnitude)
  body.addForce(appliedForce, true)
}

export function addTorqueAbout(body: RAPIER.RigidBody, axis: Vec3, magnitude: number): void {
  vscale(appliedTorque, axis, magnitude)
  body.addTorque(appliedTorque, true)
}
