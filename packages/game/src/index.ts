import { FIXED_TIMESTEP, vec3, type Vec3 } from '@buggies/physics'

export { FIXED_TIMESTEP } from '@buggies/physics'
export type { Vec3 } from '@buggies/physics'
import { flatHeightfield, type Heightfield } from '@buggies/terrain'
import {
  NEUTRAL_INPUT,
  createVehicle,
  stepVehicle,
  type VehicleInput,
  type VehicleState,
} from '@buggies/vehicle'

export interface GameConfig {
  terrain?: Heightfield
  spawn?: Vec3
}

/** One player's intent for the upcoming tick. */
export interface PlayerInput {
  vehicleId: string
  input: VehicleInput
}

/**
 * The complete headless state of a match. Both the server and every client hold
 * one of these and advance it with the same inputs and the same fixed step.
 */
export interface GameState {
  tick: number
  time: number
  terrain: Heightfield
  vehicles: Record<string, VehicleState>
}

export function createGame(config: GameConfig = {}): GameState {
  const terrain = config.terrain ?? flatHeightfield(64, 64)
  const spawn = config.spawn ?? vec3()
  return {
    tick: 0,
    time: 0,
    terrain,
    vehicles: { player: createVehicle(spawn) },
  }
}

/**
 * Advance the match by exactly one fixed step. Pure: given the same state and
 * inputs it returns the same next state, which is what keeps playback in sync.
 */
export function advance(state: GameState, inputs: PlayerInput[] = [], dt = FIXED_TIMESTEP): GameState {
  const vehicles: Record<string, VehicleState> = {}
  for (const [id, vehicle] of Object.entries(state.vehicles)) {
    const playerInput = inputs.find((entry) => entry.vehicleId === id)?.input ?? NEUTRAL_INPUT
    vehicles[id] = stepVehicle(vehicle, playerInput, dt, state.terrain)
  }
  return {
    tick: state.tick + 1,
    time: state.time + dt,
    terrain: state.terrain,
    vehicles,
  }
}