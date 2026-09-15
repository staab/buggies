import { FIXED_TIMESTEP } from '@buggies/physics'
import {
  DRY,
  ROAD_GRADE,
  ROAD_SURFACE,
  buildWaterLevels,
  waterLevelAt,
  type TerrainMap,
} from '@buggies/terrain'
import {
  DEFAULT_VEHICLE_PROFILE,
  NEUTRAL_INPUT,
  addTerrain,
  applyWaterResponse,
  applyWorldTuning,
  createPhysicsWorld,
  createVehicle,
  createVehicleTuning,
  createWorldTuning,
  resetVehicle,
  stepVehicle,
  type Vehicle,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleSpawn,
  type VehicleTuning,
  type WorldTuning,
} from '@buggies/vehicle'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export { FIXED_TIMESTEP } from '@buggies/physics'
export {
  CHASSIS_FORWARD,
  DEFAULT_VEHICLE_PROFILE,
  NEUTRAL_INPUT,
  VEHICLE_PROFILE_IDS,
  VEHICLE_PROFILE_LABELS,
  WHEEL_CORNERS,
  WHEEL_COUNT,
  createVehicleTuning,
  initPhysics,
  restingRideHeight,
  wheelMountLocal,
  type Vehicle,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleSpawn,
  type VehicleTuning,
  type WheelState,
} from '@buggies/vehicle'
export type { Vec3 as Point } from '@buggies/physics'

export interface GameConfig {
  map: TerrainMap
  profile?: VehicleProfileId
  spawn?: VehicleSpawn
}

/**
 * A match in progress. Unlike the rest of buggies this is not a value that gets
 * replaced each step: a physics world is a live thing that is advanced in
 * place, and every handle in here points into it.
 */
export interface GameState {
  readonly map: TerrainMap
  readonly world: RAPIER.World
  readonly worldTuning: WorldTuning
  readonly vehicle: Vehicle
  readonly spawn: VehicleSpawn
  /** Water surface per terrain cell, for whatever the vehicle is sitting in. */
  readonly water: Float32Array
  tuning: VehicleTuning
  tick: number
  time: number
  /** How much of the chassis is under water, as of the last step. */
  submersion: number
}

/** How far along a road to look for the next point when facing a vehicle. */
const FACING_REACH = 3

/**
 * Somewhere worth starting: on a road, at grade, as near the middle of the
 * first city as one runs. Cities are where the map is densest, so that is the
 * most interesting place to be dropped.
 */
export function findSpawn(map: TerrainMap): VehicleSpawn {
  const worldSize = map.size * map.cellSize
  const district = map.districts[0]
  const targetX = district?.cx ?? worldSize / 2
  const targetZ = district?.cz ?? worldSize / 2

  let best: VehicleSpawn | null = null
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
        position: { x: point.x, y: point.y + ROAD_SURFACE, z: point.z },
        // A chassis faces its own -Z, so a yaw of zero looks down -Z too.
        yaw: Math.atan2(-(ahead.x - point.x), -(ahead.z - point.z)),
      }
    }
  }
  return best ?? { position: { x: targetX, y: 0, z: targetZ }, yaw: 0 }
}

export function createGame(config: GameConfig): GameState {
  const { map } = config
  const worldTuning = createWorldTuning()
  const world = createPhysicsWorld(worldTuning)
  addTerrain(world, map)

  const tuning = createVehicleTuning(config.profile ?? DEFAULT_VEHICLE_PROFILE)
  const spawn = config.spawn ?? findSpawn(map)
  const vehicle = createVehicle(world, tuning, spawn)

  // Queries read the structures a step builds, so until the world has taken
  // one there is nothing for a wheel to find: the first frame would come back
  // with every ray missing and drop the vehicle through the road.
  world.step()

  return {
    map,
    world,
    worldTuning,
    vehicle,
    spawn,
    water: buildWaterLevels(map),
    tuning,
    tick: 0,
    time: 0,
    submersion: 0,
  }
}

/** Water surface where the vehicle is, or nothing at all where it is dry. */
function waterUnder(game: GameState): number {
  const { x, z } = game.vehicle.frame.position
  return waterLevelAt(game.map.heightfield, game.water, x, z)
}

/**
 * Advance the match by exactly one fixed step. `stepVehicle` only applies
 * forces, so the world is stepped once afterwards however many vehicles were
 * driven into it.
 */
export function advance(
  game: GameState,
  input: VehicleInput = NEUTRAL_INPUT,
  dt = FIXED_TIMESTEP,
): GameState {
  applyWorldTuning(game.world, game.worldTuning)
  stepVehicle(game.world, game.vehicle, game.tuning, input, dt)

  const level = waterUnder(game)
  game.submersion =
    level === DRY ? 0 : applyWaterResponse(game.vehicle, game.tuning, game.worldTuning, level)

  game.world.step()
  game.tick += 1
  game.time += dt
  return game
}

/** Put the vehicle back on its spawn, at rest. Use it when one is stuck or sunk. */
export function respawn(game: GameState): GameState {
  resetVehicle(game.vehicle, game.spawn)
  game.submersion = 0
  return game
}

/** Swap the vehicle for a different one without rebuilding the world. */
export function setProfile(game: GameState, profile: VehicleProfileId): GameState {
  game.tuning = createVehicleTuning(profile)
  return game
}
