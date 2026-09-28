import * as RAPIER from '@dimforge/rapier3d-compat'
import { qmultiply, qrotate, v3, type Quat, type Vec3 } from '@buggies/physics'
import type { PropKind, WorldProp } from '@buggies/terrain'

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

/** How many sides the prism round a drum has. */
const DRUM_SIDES = 12

/** The corners of a many-sided prism round a drum: its ends, top and bottom, each a ring of them. */
function drumPoints(halfHeight: number, radius: number): Float32Array {
  const points: number[] = []
  for (let side = 0; side < DRUM_SIDES; side++) {
    const angle = (side / DRUM_SIDES) * Math.PI * 2
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius
    points.push(x, halfHeight, z, x, -halfHeight, z)
  }
  return new Float32Array(points)
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
export function addProp(world: RAPIER.World, prop: WorldProp): RAPIER.RigidBody {
  const { position, rotation } = propPlacement(prop)
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
      : // The ground is a mesh, and a true cylinder rolling on a mesh costs ten times what a prism round it does.
        RAPIER.ColliderDesc.convexHull(drumPoints(form.halfHeight, form.halfWidth))!
  world.createCollider(desc.setDensity(0).setMass(form.mass).setFriction(form.friction).setRestitution(form.restitution), body)
  return body
}

/** How far over the ground a prop is set down, to drop onto it. */
const PROP_CLEARANCE = 0.05

/**
 * Where a prop stands at home, and how it is turned: lifted along its way
 * up by its own rise, and a little more to settle from, since the ground is
 * a mesh, which a prop set down a hair into is pushed out the wrong side of.
 */
export function propPlacement(prop: WorldProp): { position: Vec3; rotation: Quat } {
  const up = qrotate(v3(), prop.turn, { x: 0, y: 1, z: 0 })
  const rise = propRise(prop.kind) + PROP_CLEARANCE
  return {
    position: { x: prop.at.x + up.x * rise, y: prop.at.y + up.y * rise, z: prop.at.z + up.z * rise },
    rotation: qmultiply(prop.turn, propRotation(0)),
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
