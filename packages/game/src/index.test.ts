import {
  ROAD_GRADE,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  boreClearance,
  boreFloorAt,
  generateTerrain,
  tunnelSegments,
  type TerrainMap,
} from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  NEUTRAL_INPUT,
  advance,
  createGame,
  findSpawn,
  initPhysics,
  respawn,
  type GameState,
  type VehicleInput,
} from './index.ts'

const FLAT_OUT: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }

let map: TerrainMap
let SPAWN: { x: number; y: number; z: number }

function run(game: GameState, input: VehicleInput, seconds: number): GameState {
  for (let i = 0; i < Math.round(seconds * 60); i++) advance(game, input)
  return game
}

describe('game', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(7, { size: 513 })
    SPAWN = findSpawn(map).position
  }, 60_000)

  it('spawns on a road, facing along it', () => {
    const spawn = findSpawn(map)
    const nearest = map.roads
      .flatMap((road) => road.points)
      .reduce((best, point) =>
        Math.hypot(point.x - spawn.position.x, point.z - spawn.position.z) <
        Math.hypot(best.x - spawn.position.x, best.z - spawn.position.z)
          ? point
          : best,
      )
    expect(Math.hypot(nearest.x - spawn.position.x, nearest.z - spawn.position.z)).toBeLessThan(1)
    expect(spawn.position.y).toBeCloseTo(nearest.y + ROAD_SURFACE, 5)
  })

  it('settles the vehicle on its springs instead of sinking or falling through', () => {
    const game = createGame({ map })
    const spawn = game.spawn
    run(game, NEUTRAL_INPUT, 2)

    const { position } = game.vehicle.frame
    // Standing on the road, held up by suspension, not buried in it.
    expect(position.y).toBeGreaterThan(spawn.position.y)
    expect(position.y).toBeLessThan(spawn.position.y + 3)
    expect(Math.hypot(position.x - spawn.position.x, position.z - spawn.position.z)).toBeLessThan(2)
    expect(game.vehicle.groundedCount).toBe(4)
  })

  it('drives when told to, and stops when told to', () => {
    const game = createGame({ map })
    run(game, NEUTRAL_INPUT, 1)
    const from = { ...game.vehicle.frame.position }

    run(game, FLAT_OUT, 4)
    expect(game.vehicle.speed).toBeGreaterThan(5)
    const travelled = Math.hypot(
      game.vehicle.frame.position.x - from.x,
      game.vehicle.frame.position.z - from.z,
    )
    expect(travelled).toBeGreaterThan(10)

    // The brake pedal becomes reverse once there is nothing left to stop, so
    // what it has to show is the stopping, not a standstill it never keeps.
    const entry = game.vehicle.forwardSpeed
    expect(entry).toBeGreaterThan(5)
    run(game, { ...NEUTRAL_INPUT, brake: 1 }, 1.5)
    expect(game.vehicle.forwardSpeed).toBeLessThanOrEqual(0)

    run(game, { ...NEUTRAL_INPUT, brake: 1 }, 2)
    expect(game.vehicle.forwardSpeed).toBeLessThan(-2)
  })

  it('puts a stuck vehicle back on its spawn', () => {
    const game = createGame({ map })
    run(game, FLAT_OUT, 4)
    expect(game.vehicle.speed).toBeGreaterThan(1)

    respawn(game)
    expect(game.vehicle.speed).toBe(0)
    const { position } = game.vehicle.frame
    expect(position.x).toBeCloseTo(game.spawn.position.x, 5)
    expect(position.z).toBeCloseTo(game.spawn.position.z, 5)
  })

  it('turns the way it is steered', () => {
    // A chassis faces its own -Z with up at +Y, which puts its right at +X.
    // Steering right has to carry it that way; the old physics had this
    // backwards and every figure that takes an absolute value hid it.
    const straight = createGame({ map, spawn: { position: SPAWN, yaw: 0 } })
    run(straight, FLAT_OUT, 3)
    const ahead = { ...straight.vehicle.frame.position }

    const right = createGame({ map, spawn: { position: SPAWN, yaw: 0 } })
    run(right, { ...FLAT_OUT, steer: 1 }, 3)
    expect(right.vehicle.frame.position.x).toBeGreaterThan(ahead.x + 1)

    const left = createGame({ map, spawn: { position: SPAWN, yaw: 0 } })
    run(left, { ...FLAT_OUT, steer: -1 }, 3)
    expect(left.vehicle.frame.position.x).toBeLessThan(ahead.x - 1)
  })

  it('replays the same drive from the same inputs', () => {
    const drive = (): number[] => {
      const game = createGame({ map })
      for (let i = 0; i < 240; i++) {
        advance(game, { ...NEUTRAL_INPUT, throttle: 1, steer: Math.sin(i / 40) })
      }
      const { x, y, z } = game.vehicle.frame.position
      return [x, y, z, game.vehicle.speed]
    }
    expect(drive()).toEqual(drive())
  })

  it('drives through a tunnel instead of dropping into the hill', () => {
    // Tunnels are rare enough that a cut-down island may have none.
    const island = generateTerrain(3)
    const bores = tunnelSegments(island.roads)
    expect(bores.length).toBeGreaterThan(10)

    // A road that runs into a tunnel, and a spot on the road before it.
    let found: { road: (typeof island.roads)[number]; portal: number } | null = null
    for (const road of island.roads) {
      const count = road.points.length
      const segments = road.closed ? count : count - 1
      for (let i = 20; i < segments - 20; i++) {
        if (road.structure[i] !== ROAD_TUNNEL || road.structure[i - 1] !== ROAD_GRADE) continue
        if (road.structure[i + 3] !== ROAD_TUNNEL) continue
        found = { road, portal: i }
        break
      }
      if (found) break
    }
    expect(found).not.toBeNull()

    const { road, portal } = found!
    // Back off the portal far enough to be on the road, not hanging off it.
    let start = portal
    let backedOff = 0
    while (start > 1 && backedOff < 20) {
      backedOff += Math.hypot(
        road.points[start]!.x - road.points[start - 1]!.x,
        road.points[start]!.z - road.points[start - 1]!.z,
      )
      start--
    }
    const a = road.points[start]!
    const b = road.points[Math.min(start + 3, road.points.length - 1)]!
    const game = createGame({
      map: island,
      spawn: {
        position: { x: a.x, y: a.y + ROAD_SURFACE, z: a.z },
        yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)),
      },
    })

    let inside = 0
    let onTheRoad = 0
    for (let i = 0; i < 20 * 60; i++) {
      advance(game, FLAT_OUT)
      const { x, y, z } = game.vehicle.frame.position
      if (boreClearance(bores, x, z, y) >= 0) continue
      inside++
      // Standing on the carriageway, not on the bed cut beneath it. The two
      // are less than a metre apart, so anything looser than this cannot tell
      // a tunnel with a road in it from a tunnel without one.
      const floor = boreFloorAt(bores, x, z)
      if (floor !== null && y - floor > 0.5 && game.vehicle.groundedCount === 4) onTheRoad++
    }
    expect(inside).toBeGreaterThan(30)
    expect(onTheRoad / inside).toBeGreaterThan(0.8)
  }, 120_000)
})
