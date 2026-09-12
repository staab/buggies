import { add, scale, vec3, type Vec3 } from '@buggies/physics'
import { onGround, type Heightfield } from '@buggies/terrain'

/** Player intent for a single simulation step. Values are expected in [-1, 1]. */
export interface VehicleInput {
  throttle: number
  steer: number
}

/** Full simulation state of one buggy. Plain data so it can be snapshotted and replayed. */
export interface VehicleState {
  position: Vec3
  velocity: Vec3
  heading: number
}

const ACCELERATION = 24
const TURN_RATE = 2.5

export const NEUTRAL_INPUT: VehicleInput = { throttle: 0, steer: 0 }

export function createVehicle(position: Vec3 = vec3()): VehicleState {
  return { position, velocity: vec3(), heading: 0 }
}

/**
 * Advance one vehicle by a fixed step. Pure and free of wall-clock time so the
 * same inputs always produce the same state on every peer.
 */
export function stepVehicle(
  state: VehicleState,
  input: VehicleInput,
  dt: number,
  terrain: Heightfield,
): VehicleState {
  const forward = vec3(Math.sin(state.heading), 0, Math.cos(state.heading))
  const velocity = add(state.velocity, scale(forward, input.throttle * ACCELERATION * dt))
  const position = onGround(terrain, add(state.position, scale(velocity, dt)))
  const heading = state.heading + input.steer * TURN_RATE * dt
  return { position, velocity, heading }
}