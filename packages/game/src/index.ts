import { FIXED_TIMESTEP, vec3, type Vec3 } from '@buggies/physics'
import { ROAD_GRADE, flatHeightfield, type TerrainMap } from '@buggies/terrain'
import {
  DEFAULT_VEHICLE,
  NEUTRAL_INPUT,
  createDriveSurface,
  createVehicle,
  flatDriveSurface,
  groundAt,
  stepVehicle,
  vehicleTuning,
  type DriveSurface,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleState,
  type VehicleTuning,
} from '@buggies/vehicle'

export { FIXED_TIMESTEP } from '@buggies/physics'
export type { Vec3 } from '@buggies/physics'
export {
  DEFAULT_VEHICLE,
  NEUTRAL_INPUT,
  VEHICLE_LABELS,
  VEHICLE_PROFILE_IDS,
  createVehicle,
  groundAt,
  vehicleTuning,
  waterAt,
  type DriveSurface,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleState,
  type VehicleTuning,
} from '@buggies/vehicle'

/** Where a vehicle starts, and which way it is pointing. */
export interface Spawn {
  position: Vec3
  heading: number
}

export interface GameConfig {
  map?: TerrainMap
  profile?: VehicleProfileId
  spawn?: Spawn
}

/** One player's intent for the upcoming tick. */
export interface PlayerInput {
  vehicleId: string
  input: VehicleInput
}

/**
 * The complete headless state of a match. Both the server and every client
 * hold one of these and advance it with the same inputs and the same fixed
 * step. The surface is derived from the map, so a peer rebuilds it from the
 * seed rather than being sent it.
 */
export interface GameState {
  tick: number
  time: number
  surface: DriveSurface
  tuning: VehicleTuning
  spawn: Spawn
  vehicles: Record<string, VehicleState>
}

/** How far along a road to look for the next point when facing a vehicle. */
const FACING_REACH = 3

/** How far above a spawn to look for the surface it should be standing on. */
const SPAWN_PROBE = 3

/**
 * Somewhere worth starting: on a road, at grade, as near the middle of the
 * first city as one runs. Cities are where the map is densest, so that is the
 * most interesting place to be dropped.
 */
export function findSpawn(map: TerrainMap): Spawn {
  const worldSize = map.size * map.cellSize
  const district = map.districts[0]
  const targetX = district?.cx ?? worldSize / 2
  const targetZ = district?.cz ?? worldSize / 2

  let best: Spawn | null = null
  let bestDistance = Infinity
  for (const road of map.roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const point = road.points[i]!
      const distance = Math.hypot(point.x - targetX, point.z - targetZ)
      if (distance >= bestDistance) continue
      const ahead = road.points[Math.min(i + FACING_REACH, count - 1)] ?? point
      bestDistance = distance
      best = {
        position: vec3(point.x, point.y, point.z),
        heading: Math.atan2(ahead.x - point.x, ahead.z - point.z),
      }
    }
  }
  return best ?? { position: vec3(targetX, 0, targetZ), heading: 0 }
}

export function createGame(config: GameConfig = {}): GameState {
  const surface = config.map
    ? createDriveSurface(config.map)
    : flatDriveSurface(flatHeightfield(64, 64))
  const spawn = config.spawn ?? (config.map ? findSpawn(config.map) : { position: vec3(), heading: 0 })
  return {
    tick: 0,
    time: 0,
    surface,
    tuning: vehicleTuning(config.profile ?? DEFAULT_VEHICLE),
    spawn,
    vehicles: { player: spawnVehicle(surface, spawn) },
  }
}

/** Set a vehicle down on the spawn, resting on whatever is actually there. */
export function spawnVehicle(surface: DriveSurface, spawn: Spawn): VehicleState {
  const { x, y, z } = spawn.position
  return createVehicle(vec3(x, groundAt(surface, x, z, y + SPAWN_PROBE), z), spawn.heading)
}

/** Put a vehicle back on the spawn, at rest. Use it when one is stuck or sunk. */
export function respawn(state: GameState, vehicleId = 'player'): GameState {
  return {
    ...state,
    vehicles: { ...state.vehicles, [vehicleId]: spawnVehicle(state.surface, state.spawn) },
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
    vehicles[id] = stepVehicle(vehicle, playerInput, dt, state.surface, state.tuning)
  }
  return { ...state, tick: state.tick + 1, time: state.time + dt, vehicles }
}
