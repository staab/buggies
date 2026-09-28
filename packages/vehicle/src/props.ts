import * as RAPIER from '@dimforge/rapier3d-compat'
import type { Prop, PropKind } from '@buggies/terrain'

/**
 * The props a car can knock about: what each is to the physics. Barrels are
 * heavy drums; crates tumble.
 */
export interface PropShape {
  /** A box of these half extents, or a drum of this radius and half height. */
  readonly shape: 'box' | 'drum'
  readonly halfWidth: number
  readonly halfHeight: number
  readonly halfDepth: number
  readonly mass: number
  readonly friction: number
  readonly restitution: number
}

export const PROP_SHAPES: Readonly<Record<PropKind, PropShape>> = {
  crate: { shape: 'box', halfWidth: 0.5, halfHeight: 0.5, halfDepth: 0.5, mass: 30, friction: 0.7, restitution: 0.2 },
  barrel: { shape: 'drum', halfWidth: 0.3, halfHeight: 0.45, halfDepth: 0.3, mass: 50, friction: 0.6, restitution: 0.15 },
}

/** How high a prop's middle stands over the ground it starts on. */
export function propRise(kind: PropKind): number {
  return PROP_SHAPES[kind].halfHeight
}

/** The quaternion that stands a prop up, turned by its yaw. */
export function propRotation(yaw: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }
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
      .setRotation(propRotation(prop.yaw))
      .setLinearDamping(0.2)
      .setAngularDamping(0.4)
      .setCanSleep(true),
  )
  const desc =
    shape.shape === 'box'
      ? RAPIER.ColliderDesc.cuboid(shape.halfWidth, shape.halfHeight, shape.halfDepth)
      : RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.halfWidth)
  world.createCollider(desc.setDensity(0).setMass(shape.mass).setFriction(shape.friction).setRestitution(shape.restitution), body)
  return body
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
