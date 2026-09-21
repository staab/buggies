import {
  ROAD_GRADE,
  ROAD_TUNNEL,
  boreClearance,
  boreFloorAt,
  generateTerrain,
  roadLift,
  tunnelSegments,
  type TerrainMap,
} from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  advance,
  createArena,
  findSpawns,
  initPhysics,
  leaveSeat,
  respawn,
  respawnLost,
  takeSeat,
  type Arena,
  type Seat,
  type VehicleInput,
  type VehicleSpawn,
} from './index.ts'

const FLAT_OUT: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }

let map: TerrainMap
let SPAWN: { x: number; y: number; z: number }

/** One driver in the first seat, which is all most of these need. */
function solo(arena: Arena, spawn?: VehicleSpawn): Seat {
  const seat = takeSeat(arena, 0, 'mustang')
  if (spawn) {
    Object.assign(seat.spawn, spawn)
    respawn(seat)
  }
  return seat
}

function run(arena: Arena, input: VehicleInput, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) advance(arena, () => input)
}

describe('game', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(7, { size: 513 })
    SPAWN = findSpawns(map, 1)[0]!.position
  }, 60_000)

  it('spawns on a road, facing along it', () => {
    const spawn = findSpawns(map, 1)[0]!
    // The nearest road surface in three dimensions: under a bridge, the deck
    // overhead is as near in plan as the road the spawn is on.
    let nearest = { road: map.roads[0]!, point: map.roads[0]!.points[0]!, distance: Infinity }
    for (const road of map.roads) {
      for (const point of road.points) {
        const distance = Math.hypot(
          point.x - spawn.position.x,
          point.y + roadLift(road) - spawn.position.y,
          point.z - spawn.position.z,
        )
        if (distance < nearest.distance) nearest = { road, point, distance }
      }
    }
    expect(nearest.distance).toBeLessThan(1)
    expect(spawn.position.y).toBeCloseTo(nearest.point.y + roadLift(nearest.road), 5)
  })

  it('lines a full field up along the road without overlapping', () => {
    const spawns = findSpawns(map, MAX_PLAYERS)
    expect(spawns).toHaveLength(MAX_PLAYERS)
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        const a = spawns[i]!.position
        const b = spawns[j]!.position
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(6)
      }
    }
    // Everyone faces roughly the same way down the road.
    for (const spawn of spawns) {
      const turn = Math.abs(Math.atan2(Math.sin(spawn.yaw - spawns[0]!.yaw), Math.cos(spawn.yaw - spawns[0]!.yaw)))
      expect(turn).toBeLessThan(Math.PI / 2)
    }
  })

  it('settles the vehicle on its springs instead of sinking or falling through', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    run(arena, NEUTRAL_INPUT, 2)

    const { position } = seat.vehicle.frame
    // Standing on the road, held up by suspension, not buried in it.
    expect(position.y).toBeGreaterThan(seat.spawn.position.y)
    expect(position.y).toBeLessThan(seat.spawn.position.y + 3)
    expect(Math.hypot(position.x - seat.spawn.position.x, position.z - seat.spawn.position.z)).toBeLessThan(2)
    expect(seat.vehicle.groundedCount).toBe(4)
  })

  it('drives when told to, and stops when told to', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    run(arena, NEUTRAL_INPUT, 1)
    const from = { ...seat.vehicle.frame.position }

    run(arena, FLAT_OUT, 4)
    expect(seat.vehicle.speed).toBeGreaterThan(5)
    const travelled = Math.hypot(
      seat.vehicle.frame.position.x - from.x,
      seat.vehicle.frame.position.z - from.z,
    )
    expect(travelled).toBeGreaterThan(10)

    // The brake pedal becomes reverse once there is nothing left to stop, so
    // what it has to show is the stopping, not a standstill it never keeps.
    const entry = seat.vehicle.forwardSpeed
    expect(entry).toBeGreaterThan(5)
    run(arena, { ...NEUTRAL_INPUT, brake: 1 }, 1.5)
    expect(seat.vehicle.forwardSpeed).toBeLessThanOrEqual(0)

    run(arena, { ...NEUTRAL_INPUT, brake: 1 }, 2)
    expect(seat.vehicle.forwardSpeed).toBeLessThan(-2)
  })

  it('puts a stuck vehicle back on its spawn, and counts the reset', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    const epoch = seat.epoch
    run(arena, FLAT_OUT, 4)
    expect(seat.vehicle.speed).toBeGreaterThan(1)

    respawn(seat)
    expect(seat.epoch).not.toBe(epoch)
    expect(seat.vehicle.speed).toBe(0)
    const { position } = seat.vehicle.frame
    // The body keeps single-precision coordinates, so a kilometre in is only good to a few tens of microns.
    expect(position.x).toBeCloseTo(seat.spawn.position.x, 3)
    expect(position.z).toBeCloseTo(seat.spawn.position.z, 3)
  })

  it('only drives the seats someone is in', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'pickup')
    const b = takeSeat(arena, 3, 'raceCar')
    expect(a.profile).toBe('pickup')
    expect(b.tuning.mass).not.toBe(a.tuning.mass)

    const idle = { ...arena.seats[1]!.vehicle.frame.position }
    run(arena, FLAT_OUT, 2)
    expect(a.vehicle.speed).toBeGreaterThan(3)
    expect(b.vehicle.speed).toBeGreaterThan(3)
    expect(arena.seats[1]!.vehicle.frame.position).toEqual(idle)

    // Leaving takes the car out of the world; the seat is free for the next
    // driver, who gets a fresh epoch so nobody mistakes them for the last one.
    const epoch = a.epoch
    leaveSeat(arena, 0)
    expect(a.occupied).toBe(false)
    expect(a.vehicle.body.isEnabled()).toBe(false)
    const again = takeSeat(arena, 0, 'mustang')
    expect(again.epoch).not.toBe(epoch)
    expect(again.profile).toBe('mustang')
  })

  it('brings back a vehicle that has fallen off the world', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    run(arena, NEUTRAL_INPUT, 1)
    seat.vehicle.body.setTranslation({ x: -50, y: 20, z: -50 }, true)

    let brought = 0
    let landed = { x: 0, z: 0 }
    for (let i = 0; i < 60 * 5; i++) {
      advance(arena)
      const back = respawnLost(arena)
      brought += back.length
      if (back.length > 0) landed = { ...seat.vehicle.frame.position }
    }
    expect(brought).toBe(1)
    expect(landed.x).toBeCloseTo(seat.spawn.position.x, 0)
    expect(landed.z).toBeCloseTo(seat.spawn.position.z, 0)
  })

  it('turns the way it is steered', () => {
    // A chassis faces its own -Z with up at +Y, which puts its right at +X.
    // Steering right has to carry it that way; the old physics had this
    // backwards and every figure that takes an absolute value hid it.
    const straightArena = createArena(map, 1)
    const straight = solo(straightArena, { position: SPAWN, yaw: 0 })
    run(straightArena, FLAT_OUT, 3)
    const ahead = { ...straight.vehicle.frame.position }

    const rightArena = createArena(map, 1)
    const right = solo(rightArena, { position: SPAWN, yaw: 0 })
    run(rightArena, { ...FLAT_OUT, steer: 1 }, 3)
    expect(right.vehicle.frame.position.x).toBeGreaterThan(ahead.x + 1)

    const leftArena = createArena(map, 1)
    const left = solo(leftArena, { position: SPAWN, yaw: 0 })
    run(leftArena, { ...FLAT_OUT, steer: -1 }, 3)
    expect(left.vehicle.frame.position.x).toBeLessThan(ahead.x - 1)
  })

  it('replays the same drive from the same inputs', () => {
    const drive = (): number[] => {
      const arena = createArena(map)
      const seat = solo(arena)
      for (let i = 0; i < 240; i++) {
        advance(arena, () => ({ ...NEUTRAL_INPUT, throttle: 1, steer: Math.sin(i / 40) }))
      }
      const { x, y, z } = seat.vehicle.frame.position
      return [x, y, z, seat.vehicle.speed]
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
    const arena = createArena(island, 1)
    const seat = solo(arena, {
      position: { x: a.x, y: a.y + roadLift(road), z: a.z },
      yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)),
    })

    // Driven like a driver would: aimed at the road ahead, flat out.
    const LOOK_AHEAD = 22
    let at = start
    const follow = (): VehicleInput => {
      const { position, forward } = seat.vehicle.frame
      while (at < road.points.length - 1) {
        const point = road.points[at]!
        if (Math.hypot(point.x - position.x, point.z - position.z) > LOOK_AHEAD) break
        at++
      }
      const target = road.points[at]!
      const wanted = Math.atan2(target.x - position.x, target.z - position.z)
      const facing = Math.atan2(forward.x, forward.z)
      let error = wanted - facing
      while (error > Math.PI) error -= 2 * Math.PI
      while (error < -Math.PI) error += 2 * Math.PI
      // Headings grow from +Z toward +X, and a chassis facing -Z has +X on its
      // right, so a target at a greater heading is off to the left.
      return { ...FLAT_OUT, steer: Math.max(-1, Math.min(1, -error * 2.5)) }
    }

    let inside = 0
    let onTheRoad = 0
    for (let i = 0; i < 20 * 60; i++) {
      advance(arena, follow)
      const { x, y, z } = seat.vehicle.frame.position
      if (boreClearance(bores, x, z, y) >= 0) continue
      inside++
      // Standing on the carriageway, not on the bed cut beneath it. The two
      // are less than a metre apart, so anything looser than this cannot tell
      // a tunnel with a road in it from a tunnel without one.
      const floor = boreFloorAt(bores, x, z)
      if (floor !== null && y - floor > 0.5 && seat.vehicle.groundedCount === 4) onTheRoad++
    }
    expect(inside).toBeGreaterThan(30)
    expect(onTheRoad / inside).toBeGreaterThan(0.8)
  }, 120_000)
})
