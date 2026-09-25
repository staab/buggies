import * as RAPIER from '@dimforge/rapier3d-compat'
import type { Prop, PropKind } from '@buggies/terrain'

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
  cone: { shape: 'cone', halfWidth: 0.25, halfHeight: 0.35, halfDepth: 0.25, mass: 3, friction: 0.6, restitution: 0.3, onSide: false },
  bale: { shape: 'drum', halfWidth: 0.6, halfHeight: 0.6, halfDepth: 0.6, mass: 80, friction: 0.9, restitution: 0.05, onSide: true },
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
export function addProp(world: RAPIER.World, prop: Prop): RAPIER.RigidBody {
  const shape = PROP_SHAPES[prop.kind]
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(prop.x, prop.bottom + propRise(prop.kind), prop.z)
      .setRotation(propRotation(prop.kind, prop.yaw))
      .setLinearDamping(0.2)
      .setAngularDamping(0.4)
      .setCanSleep(true),
  )
  const desc =
    shape.shape === 'box'
      ? RAPIER.ColliderDesc.cuboid(shape.halfWidth, shape.halfHeight, shape.halfDepth)
      : shape.shape === 'drum'
        ? RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.halfWidth)
        : RAPIER.ColliderDesc.cone(shape.halfHeight, shape.halfWidth)
  world.createCollider(desc.setDensity(0).setMass(shape.mass).setFriction(shape.friction).setRestitution(shape.restitution), body)
  return body
}
