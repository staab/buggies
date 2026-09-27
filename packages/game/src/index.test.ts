import { vdot, type Vec3 } from '@buggies/physics'
import { ROAD_GRADE, ROAD_TUNNEL, alongGround, generatePlanet, groundUnder, heightOver, upOf, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  CEILING,
  CLOUD_HEIGHT,
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  advance,
  changeVehicle,
  createArena,
  findSpawns,
  initPhysics,
  leaveSeat,
  respawn,
  respawnLost,
  respawnNearby,
  restingRideHeight,
  spawnHere,
  takeSeat,
  worldGravity,
  type Arena,
  type Seat,
  type VehicleInput,
  type VehicleSpawn,
} from './index.ts'
import { forwardOf } from './spawns.ts'
import { angleBetween, apart, between, over } from './test-planet.ts'

const FLAT_OUT: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }

let map: World
let planet: World
let SPAWN: VehicleSpawn

/** One driver in the first seat, which is all most of these need. */
function solo(arena: Arena, spawn?: VehicleSpawn): Seat {
  const seat = takeSeat(arena, 0, 'sportsCar')
  if (spawn) {
    Object.assign(seat.spawn, spawn)
    respawn(seat)
  }
  return seat
}

/** How far a point is from the nearest road point, through the planet or not. */
function offRoad(at: Vec3): number {
  let nearest = Infinity
  for (const road of planet.roads) {
    for (const point of road.points) nearest = Math.min(nearest, between(point, at))
  }
  return nearest
}

function run(arena: Arena, input: VehicleInput, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) advance(arena, () => input)
}

describe('game', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(1)
    planet = map
    SPAWN = findSpawns(planet, 1)[0]!
  }, 60_000)

  it('spawns on a road, facing along it', () => {
    const spawn = findSpawns(planet, 1)[0]!
    // The nearest road surface in three dimensions: under a bridge, the deck
    // overhead is as near along the ground as the road the spawn is on.
    let nearest = { road: planet.roads[0]!, index: 0, distance: Infinity }
    for (const road of planet.roads) {
      for (const [index, point] of road.points.entries()) {
        const distance = between(point, spawn.position)
        if (distance < nearest.distance) nearest = { road, index, distance }
      }
    }
    // In its lane: off the middle of the road, but on it, at its height.
    expect(nearest.distance).toBeLessThan(nearest.road.widths[nearest.index]! / 2)
    expect(Math.abs(over(spawn.position, nearest.road.points[nearest.index]!))).toBeLessThan(0.05)
  })

  it('lines a full field up along the road without overlapping', () => {
    const spawns = findSpawns(planet, MAX_PLAYERS)
    expect(spawns).toHaveLength(MAX_PLAYERS)
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) expect(apart(spawns[i]!.position, spawns[j]!.position)).toBeGreaterThan(6)
    }
    // Nearly everyone faces roughly the same way: all down the road, and those seated on the roads nearby where they can.
    const lead = forwardOf(spawns[0])
    const along = spawns.filter((spawn) => angleBetween(forwardOf(spawn), lead) < Math.PI / 2)
    expect(along.length).toBeGreaterThan(MAX_PLAYERS * 0.75)
  })

  it('settles the vehicle on its springs instead of sinking or falling through', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    run(arena, NEUTRAL_INPUT, 2)

    const { position } = seat.vehicle.frame
    // Standing on the road, held up by suspension, not buried in it.
    expect(over(position, seat.spawn.position)).toBeGreaterThan(0)
    expect(over(position, seat.spawn.position)).toBeLessThan(3)
    expect(apart(position, seat.spawn.position)).toBeLessThan(2)
    expect(seat.vehicle.groundedCount).toBe(4)
  })

  it('drives when told to, and stops when told to', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    run(arena, NEUTRAL_INPUT, 1)
    const from = { ...seat.vehicle.frame.position }

    run(arena, FLAT_OUT, 4)
    expect(seat.vehicle.speed).toBeGreaterThan(5)
    expect(apart(seat.vehicle.frame.position, from)).toBeGreaterThan(10)

    // The brake pedal becomes reverse once there is nothing left to stop, so
    // what it has to show is the stopping, not a standstill it never keeps.
    const entry = seat.vehicle.forwardSpeed
    expect(entry).toBeGreaterThan(5)
    run(arena, { ...NEUTRAL_INPUT, brake: 1 }, 3)
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
    // Its middle stands its ride height up from the spawn, give or take where the chassis carries its weight.
    expect(apart(seat.vehicle.frame.position, seat.spawn.position)).toBeLessThan(0.01)
  })

  it('puts a wreck back on the road once it has lain there long enough', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    const epoch = seat.epoch
    run(arena, FLAT_OUT, 2)
    // Blown up: the wreck is left where it is for a while, then put back.
    seat.vehicle.wrecked = true
    run(arena, FLAT_OUT, 2)
    expect(respawnLost(arena)).toHaveLength(0)
    expect(seat.vehicle.wrecked).toBe(true)
    for (let i = 0; i < 60 * 6 && seat.epoch === epoch; i++) {
      advance(arena, () => FLAT_OUT)
      respawnLost(arena)
    }
    expect(seat.epoch).not.toBe(epoch)
    expect(seat.vehicle.wrecked).toBe(false)
    expect(seat.vehicle.damage).toBe(0)
    // Put back on the nearest road, at rest, its ride height over it.
    expect(offRoad(seat.vehicle.frame.position)).toBeLessThan(1.5)
    expect(seat.vehicle.speed).toBe(0)
  })

  it('keeps a vehicle under the ceiling, a little over the clouds, however hard it is thrown up', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    expect(CEILING).toBeGreaterThan(CLOUD_HEIGHT)
    const up = upOf(seat.vehicle.frame.position)
    const high = arena.planet.radius + CEILING + 40
    seat.vehicle.body.setTranslation({ x: up.x * high, y: up.y * high, z: up.z * high }, true)
    seat.vehicle.body.setLinvel({ x: up.x * 30, y: up.y * 30, z: up.z * 30 }, true)
    for (let i = 0; i < 60; i++) {
      advance(arena)
      expect(heightOver(arena.planet, seat.vehicle.body.translation())).toBeLessThanOrEqual(CEILING + 1e-6)
    }
    // Let go of, it falls back down under it.
    const velocity = seat.vehicle.body.linvel()
    expect(velocity.x * up.x + velocity.y * up.y + velocity.z * up.z).toBeLessThan(0)
    arena.world.free()
  })

  it('puts a vehicle back on the nearest road, facing the way it was going', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    run(arena, FLAT_OUT, 4)
    const before = { position: { ...seat.vehicle.frame.position }, forward: { ...seat.vehicle.frame.forward } }
    expect(apart(before.position, seat.spawn.position)).toBeGreaterThan(60)

    seat.vehicle.damage = 0.4
    respawnNearby(arena, seat)
    const after = seat.vehicle.frame
    // Put back, not made new: the knocks it had come with it.
    expect(seat.vehicle.damage).toBe(0.4)
    // Near where it was, no further than the nearest road, not back at the start, on a road, still heading the same way.
    expect(apart(after.position, before.position)).toBeLessThan(offRoad(before.position) + 5)
    expect(apart(after.position, seat.spawn.position)).toBeGreaterThan(45)
    expect(vdot(after.forward, before.forward)).toBeGreaterThan(0.7)
    expect(offRoad(after.position)).toBeLessThan(1.5)
    expect(seat.vehicle.speed).toBe(0)
  })

  it('puts someone in a different vehicle where they are, and the map goes on', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    run(arena, FLAT_OUT, 6)
    const before = { position: { ...seat.vehicle.frame.position }, forward: { ...seat.vehicle.frame.forward } }
    const tick = arena.tick

    changeVehicle(arena, seat, 'tank')
    expect(seat.profile).toBe('tank')
    expect(seat.tuning.mass).toBe(14000)
    const after = seat.vehicle.frame
    // The new one starts right where the old one was, heading the same way;
    // the arena itself was not started over.
    expect(apart(after.position, before.position)).toBeLessThan(0.01)
    // Heading the same way along the ground: set down level with the planet, not pitched as the old one was on its slope.
    const up = upOf(after.position)
    expect(angleBetween(alongGround(after.forward, up), alongGround(before.forward, up))).toBeLessThan(0.05)
    expect(arena.tick).toBe(tick)
    // And it sits as the new vehicle: on the tank's springs, at the tank's height.
    run(arena, NEUTRAL_INPUT, 1)
    expect(vdot(seat.vehicle.frame.up, seat.vehicle.up)).toBeGreaterThan(0.95)
    expect(seat.vehicle.rideHeight).toBeCloseTo(restingRideHeight(seat.tuning, worldGravity(arena.world)), 5)
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
    const again = takeSeat(arena, 0, 'sportsCar')
    expect(again.epoch).not.toBe(epoch)
    expect(again.profile).toBe('sportsCar')
  })

  it('brings back a vehicle that has sunk through the world', () => {
    const arena = createArena(map)
    const seat = solo(arena)
    run(arena, NEUTRAL_INPUT, 1)
    // Deep inside the planet, far under the sea floor.
    const { x, y, z } = seat.vehicle.frame.position
    seat.vehicle.body.setTranslation({ x: x * 0.5, y: y * 0.5, z: z * 0.5 }, true)
    seat.vehicle.damage = 0.6

    let brought = 0
    let landed = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 60 * 5; i++) {
      advance(arena)
      const back = respawnLost(arena)
      brought += back.length
      if (back.length > 0) landed = { ...seat.vehicle.frame.position }
    }
    expect(brought).toBe(1)
    expect(seat.vehicle.damage).toBe(0.6)
    // Back on the road nearest to where it went down.
    expect(offRoad(landed)).toBeLessThan(1.5)
  })

  it('turns the way it is steered', () => {
    // A chassis faces its own -Z with up at +Y, which puts its right at +X;
    // turned as the spawn stands it, that is the way steering right has to
    // carry it. Measured along the ground, from the spawn.
    const forward = forwardOf(SPAWN)
    const up = SPAWN.up
    const right = { x: forward.y * up.z - forward.z * up.y, y: forward.z * up.x - forward.x * up.z, z: forward.x * up.y - forward.y * up.x }
    const drift = (steer: number): number => {
      const arena = createArena(map, 1)
      const seat = solo(arena, SPAWN)
      run(arena, { ...FLAT_OUT, steer }, 3)
      const { x, y, z } = seat.vehicle.frame.position
      return (x - SPAWN.position.x) * right.x + (y - SPAWN.position.y) * right.y + (z - SPAWN.position.z) * right.z
    }
    const ahead = drift(0)
    expect(drift(1)).toBeGreaterThan(ahead + 1)
    expect(drift(-1)).toBeLessThan(ahead - 1)
  }, 60_000)

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
    // Tunnels are rare enough that many an island has none: this one has a good few.
    const island = generatePlanet(1)
    const world = island

    // A road that runs into a tunnel, and a spot on the road before it.
    let found: { road: World['roads'][number]; portal: number } | null = null
    for (const road of world.roads) {
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
      backedOff += between(road.points[start]!, road.points[start - 1]!)
      start--
    }
    const a = road.points[start]!
    const b = road.points[Math.min(start + 3, road.points.length - 1)]!
    const arena = createArena(island, 1)
    const seat = solo(arena, spawnHere(a, { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }))

    // Driven like a driver would: aimed at the road ahead, flat out.
    const LOOK_AHEAD = 22
    let at = start
    const follow = (): VehicleInput => {
      const { position, forward, right } = seat.vehicle.frame
      while (at < road.points.length - 1 && between(road.points[at]!, position) <= LOOK_AHEAD) at++
      const target = road.points[at]!
      const toward = { x: target.x - position.x, y: target.y - position.y, z: target.z - position.z }
      const error = Math.atan2(vdot(toward, right), vdot(toward, forward))
      return { ...FLAT_OUT, steer: Math.max(-1, Math.min(1, error * 2.5)) }
    }

    /** The road point nearest a point, and whether the segment from it is bored through. */
    const nearestOnRoad = (point: Vec3): { at: Vec3; bored: boolean } => {
      let best = 0
      for (const [i, candidate] of road.points.entries()) if (between(candidate, point) < between(road.points[best]!, point)) best = i
      return { at: road.points[best]!, bored: road.structure[Math.min(best, road.structure.length - 1)] === ROAD_TUNNEL }
    }

    let inside = 0
    let onTheRoad = 0
    for (let i = 0; i < 20 * 60; i++) {
      advance(arena, follow)
      const { position } = seat.vehicle.frame
      const nearest = nearestOnRoad(position)
      // Inside: over a bored stretch, under the hill.
      if (!nearest.bored || heightOver(world, position) > groundUnder(world, position)) continue
      inside++
      // Standing on the roadway, not on the bed cut beneath it. The two are
      // less than a meter apart, so anything looser than this cannot tell a
      // tunnel with a road in it from a tunnel without one.
      if (over(position, nearest.at) > 0.5 && seat.vehicle.groundedCount === 4) onTheRoad++
    }
    expect(inside).toBeGreaterThan(30)
    expect(onTheRoad / inside).toBeGreaterThan(0.8)
  }, 120_000)
})
