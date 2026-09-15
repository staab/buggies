// Ported from the seattle project (src/physics/chassisFrame.ts). Kept in its original
// shape and formatting so the two can be compared and resynced.

import type * as RAPIER from '@dimforge/rapier3d-compat'

import {
  qrotate,
  quat,
  v3,
  vadd,
  vcross,
  vscale,
  vsub,
  type Quat,
  type Vec3,
} from '@buggies/physics'

export const CHASSIS_RIGHT: Vec3 = {x: 1, y: 0, z: 0}
export const CHASSIS_UP: Vec3 = {x: 0, y: 1, z: 0}
export const CHASSIS_FORWARD: Vec3 = {x: 0, y: 0, z: -1}

export interface ChassisFrame {
  position: Vec3
  rotation: Quat
  linearVelocity: Vec3
  right: Vec3
  up: Vec3
  forward: Vec3
  down: Vec3
}

export function createChassisFrame(): ChassisFrame {
  return {
    position: v3(),
    rotation: quat(),
    linearVelocity: v3(),
    right: v3(CHASSIS_RIGHT.x, CHASSIS_RIGHT.y, CHASSIS_RIGHT.z),
    up: v3(CHASSIS_UP.x, CHASSIS_UP.y, CHASSIS_UP.z),
    forward: v3(CHASSIS_FORWARD.x, CHASSIS_FORWARD.y, CHASSIS_FORWARD.z),
    down: v3(-CHASSIS_UP.x, -CHASSIS_UP.y, -CHASSIS_UP.z),
  }
}

export function orientChassisFrame(out: ChassisFrame): ChassisFrame {
  qrotate(out.right, out.rotation, CHASSIS_RIGHT)
  qrotate(out.up, out.rotation, CHASSIS_UP)
  qrotate(out.forward, out.rotation, CHASSIS_FORWARD)
  vscale(out.down, out.up, -1)

  return out
}

export function readChassisFrame(out: ChassisFrame, body: RAPIER.RigidBody): ChassisFrame {
  body.translation(out.position)
  body.rotation(out.rotation)
  body.linvel(out.linearVelocity)

  return orientChassisFrame(out)
}

const angularVelocity = v3()
const centerOfMass = v3()
const leverArm = v3()

export function velocityAtPoint(
  out: Vec3,
  body: RAPIER.RigidBody,
  frame: ChassisFrame,
  point: Vec3,
): Vec3 {
  body.angvel(angularVelocity)
  body.worldCom(centerOfMass)
  vsub(leverArm, point, centerOfMass)
  vcross(out, angularVelocity, leverArm)

  return vadd(out, out, frame.linearVelocity)
}
