import * as RAPIER from '@dimforge/rapier3d-compat'
import { FLAT, qmultiply, qrotate, v3, type Quat, type Vec3, type WorldShape } from '@buggies/physics'
import type { Prop, PropKind } from '@buggies/terrain'

import { placeOnShape } from './placement.ts'

/**
 * The props a car can knock about: what each is to the physics. Cones are
 * light and sail; barrels are heavier drums; crates tumble; bales are heavy
 * and soft, and lie on their side, so they roll.
 */
export interface PropShape {
  /** A box of these half extents, or a drum of this radius and half height, or a cone. */
  readonly shape: 'box' | 'drum' | 'cone'
  readonly halfWidth: number
  readonly halfHeight: number
  readonly halfDepth: number
  readonly mass: number
  readonly friction: number
  readonly restitution: number
  /** Lying on its side rather than standing. */
  readonly onSide: boolean
}

export const PROP_SHAPES: Readonly<Record<PropKind, PropShape>> = {
  crate: { shape: 'box', halfWidth: 0.5, halfHeight: 0.5, halfDepth: 0.5, mass: 30, friction: 0.7, restitution: 0.2, onSide: false },
  barrel: { shape: 'drum', halfWidth: 0.3, halfHeight: 0.45, halfDepth: 0.3, mass: 50, friction: 0.6, restitution: 0.15, onSide: false },
  cone: { shape: 'cone', halfWidth: 0.32, halfHeight: 0.45, halfDepth: 0.32, mass: 3, friction: 0.6, restitution: 0.3, onSide: false },
  bale: { shape: 'drum', halfWidth: 0.6, halfHeight: 0.6, halfDepth: 0.6, mass: 80, friction: 0.9, restitution: 0.05, onSide: true },
}

/**
 * How many flat sides a cone has. A perfectly round cone lying on its side
 * rolls in circles for good, never coming to rest; a faceted one lies on a face.
 */
export const CONE_SIDES = 12

/** A cone's points about its middle, apex up, its base ring placed as three.js places a cone's. */
function conePoints(halfHeight: number, radius: number): Float32Array {
  const points = [0, halfHeight, 0]
  for (let side = 0; side < CONE_SIDES; side++) {
    const angle = (side / CONE_SIDES) * Math.PI * 2
    points.push(Math.sin(angle) * radius, -halfHeight, Math.cos(angle) * radius)
  }
  return new Float32Array(points)
}

/** How high a prop's middle stands over the ground it starts on. */
export function propRise(kind: PropKind): number {
  const shape = PROP_SHAPES[kind]
  return shape.onSide ? shape.halfWidth : shape.halfHeight
}

/** The quaternion that stands a prop up, turned by its yaw, or lays it on its side if it lies that way. */
export function propRotation(kind: PropKind, yaw: number): RAPIER.Rotation {
  const sy = Math.sin(yaw / 2)
  const cy = Math.cos(yaw / 2)
  if (!PROP_SHAPES[kind].onSide) return { x: 0, y: sy, z: 0, w: cy }
  // The yaw, then a quarter turn about the body's own Z: the drum's axis comes to lie along the turned X.
  const s = Math.SQRT1_2
  return { x: sy * s, y: sy * s, z: cy * s, w: cy * s }
}

/**
 * Put a prop into a world as a dynamic body that sleeps when it comes to
 * rest, standing where the map has it.
 */
export function addProp(world: RAPIER.World, prop: Prop, shape: WorldShape = FLAT): RAPIER.RigidBody {
  const { position, rotation } = propPlacement(shape, prop)
  const form = PROP_SHAPES[prop.kind]
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation)
      .setLinearDamping(0.2)
      .setAngularDamping(0.4)
      .setCanSleep(true),
  )
  const desc =
    form.shape === 'box'
      ? RAPIER.ColliderDesc.cuboid(form.halfWidth, form.halfHeight, form.halfDepth)
      : form.shape === 'drum'
        ? RAPIER.ColliderDesc.cylinder(form.halfHeight, form.halfWidth)
        : // A hull of distinct points always makes a collider.
          RAPIER.ColliderDesc.convexHull(conePoints(form.halfHeight, form.halfWidth))!
  world.createCollider(desc.setDensity(0).setMass(form.mass).setFriction(form.friction).setRestitution(form.restitution), body)
  return body
}

/**
 * Where a prop stands at home, and how it is turned: as the map has it on
 * the flat, and on a planet carried round and stood upright on it, at its
 * own size whatever the chart's scale there.
 */
export function propPlacement(shape: WorldShape, prop: Prop): { position: Vec3; rotation: Quat } {
  if (shape.kind === 'flat') return { position: { x: prop.x, y: prop.bottom + propRise(prop.kind), z: prop.z }, rotation: propRotation(prop.kind, prop.yaw) }
  const { position, rotation } = placeOnShape(shape, prop.x, prop.bottom, prop.z, 0)
  // Lifted along the way up there by its own rise, and turned as it stands on the flat, only upright here.
  const up = qrotate(v3(), rotation, { x: 0, y: 1, z: 0 })
  const rise = propRise(prop.kind)
  return {
    position: { x: position.x + up.x * rise, y: position.y + up.y * rise, z: position.z + up.z * rise },
    rotation: qmultiply(rotation, propRotation(prop.kind, prop.yaw)),
  }
}

/**
 * A box the game moves itself, tick by tick, which the cars run into but
 * which nothing pushes: a robot on its rounds. It starts where it is put.
 */
export function addMover(
  world: RAPIER.World,
  halfWidth: number,
  halfHeight: number,
  halfDepth: number,
  at: { x: number; y: number; z: number },
): RAPIER.RigidBody {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y, at.z))
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth).setFriction(0.6), body)
  return body
}
