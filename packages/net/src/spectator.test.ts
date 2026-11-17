import { MAX_PLAYERS, OPEN_RULES, createArena, createVehicleInput, initPhysics, type VehicleInput, type VehicleProfileId, type VehicleSpawn } from '@buggies/game'
import { vdistance, type Vec3 } from '@buggies/physics'
import { generatePlanet, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { BananaLedger } from './ledger.ts'
import { SpectatorMirror } from './spectator.ts'
import type { RaceView, SnapshotMessage, VehicleSnapshot } from './wire.ts'

let map: World

/** A car as the server has it: where it was spawned, or anywhere else it is said to be, driven by this input. */
function vehicleAt(seat: number, profile: VehicleProfileId, spawn: VehicleSpawn, input: VehicleInput = createVehicleInput()): VehicleSnapshot {
  return {
    seat,
    epoch: 0,
    profile,
    position: { ...spawn.position },
    rotation: { ...spawn.rotation },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    damage: 0,
    wrecked: false,
    score: 0,
    collected: 0,
    kills: 0,
    robotKills: 0,
    achievements: 0,
    lastAchievement: 0,
    weapon: 'none',
    weaponHeld: 0,
    burnLeft: 0,
    npc: false,
    rocketsFired: 0,
    stunnedTicks: 0,
    shockTicks: 0,
    magnetTicks: 0,
    plowTicks: 0,
    lightsOn: false,
    hornTicks: 0,
    signalHeld: false,
    appliedInput: { ...input },
  }
}

/** A snapshot of a free drive with these cars on it, and nothing loose. */
function snapshotAt(tick: number, vehicles: VehicleSnapshot[], race: RaceView | null = null): SnapshotMessage {
  return {
    tick,
    ackInputTick: 0,
    full: true,
    looseNext: 0,
    race,
    vehicles,
    pickups: [],
    loose: [],
    removed: [],
    rockets: [],
    props: [],
    robots: [],
    ufos: [],
    spiders: [],
    meteors: [],
  }
}

/** Where the mirror has the car in this seat: its chassis, as the snapshot puts it. */
function positionOf(mirror: SpectatorMirror, seat: number): Vec3 {
  return { ...mirror.arena.seats[seat]!.vehicle.body.translation() }
}

/** A car moved this far along the x axis, for a snapshot that has it somewhere else. */
function moved(spawn: VehicleSpawn, meters: number): VehicleSpawn {
  return { ...spawn, position: { x: spawn.position.x + meters, y: spawn.position.y, z: spawn.position.z } }
}

describe("a watcher's mirror", () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(5)
  }, 120_000)

  it('takes in the snapshots it is given, seating and moving every car', () => {
    const mirror = new SpectatorMirror(createArena(map, MAX_PLAYERS, OPEN_RULES), 100, new BananaLedger())
    const first = mirror.arena.seats[0]!.spawn
    const second = mirror.arena.seats[1]!.spawn

    expect(mirror.take(snapshotAt(100, [vehicleAt(0, 'pickup', first), vehicleAt(1, 'raceCar', second)]))).toBe('resynced')
    // A watcher has no car of its own: the seat a player would call its own is one more car to watch.
    expect(mirror.arena.seats[0]!.occupied).toBe(true)
    expect(mirror.arena.seats[0]!.profile).toBe('pickup')
    expect(mirror.arena.seats[1]!.occupied).toBe(true)
    expect(mirror.arena.seats[1]!.profile).toBe('raceCar')
    expect(mirror.arena.seats[2]!.occupied).toBe(false)
    expect(mirror.tick()).toBe(100)
    expect(vdistance(positionOf(mirror, 0), first.position)).toBeLessThan(0.01)

    // Forty meters on, three ticks later: the mirror is where the server has them, both of them.
    const on = moved(first, 40)
    const also = moved(second, 40)
    expect(mirror.take(snapshotAt(103, [vehicleAt(0, 'pickup', on), vehicleAt(1, 'raceCar', also)]))).toBe('resynced')
    expect(vdistance(positionOf(mirror, 0), on.position)).toBeLessThan(0.01)
    expect(vdistance(positionOf(mirror, 1), also.position)).toBeLessThan(0.01)
    expect(mirror.tick()).toBe(103)

    // The same snapshot again, and one from before it, say nothing new.
    expect(mirror.take(snapshotAt(103, [vehicleAt(0, 'pickup', first)]))).toBe('idle')
    expect(mirror.take(snapshotAt(102, [vehicleAt(0, 'pickup', first)]))).toBe('idle')
    expect(vdistance(positionOf(mirror, 0), on.position)).toBeLessThan(0.01)
    expect(mirror.tick()).toBe(103)

    // A car the server no longer has leaves its seat, and the seat is empty again.
    expect(mirror.take(snapshotAt(106, [vehicleAt(1, 'raceCar', also)]))).toBe('resynced')
    expect(mirror.arena.seats[0]!.occupied).toBe(false)
    mirror.dispose()
  })

  it('carries the cars on at the input the server last saw them give', () => {
    const mirror = new SpectatorMirror(createArena(map, MAX_PLAYERS, OPEN_RULES), 100, new BananaLedger())
    const driving = createVehicleInput()
    driving.throttle = 1
    expect(mirror.take(snapshotAt(100, [vehicleAt(0, 'raceCar', mirror.arena.seats[0]!.spawn, driving)]))).toBe('resynced')
    const from = positionOf(mirror, 0)

    // A second of frames: a step a frame, as a player's own mirror runs.
    for (let frame = 0; frame < 60; frame++) mirror.run(() => 1)
    expect(mirror.tick()).toBe(160)
    expect(vdistance(positionOf(mirror, 0), from)).toBeGreaterThan(2)
    mirror.dispose()
  })

  it('holds the cars it watches through a countdown, as the server holds them', () => {
    const mirror = new SpectatorMirror(createArena(map, MAX_PLAYERS, OPEN_RULES), 100, new BananaLedger())
    const driving = createVehicleInput()
    driving.throttle = 1
    const race: RaceView = { world: 1, ofWorlds: 2, elapsed: -180, over: false, racing: 1, racers: [{ seat: 0, place: 0, checkpoint: 0, finished: false }] }
    expect(mirror.take(snapshotAt(100, [vehicleAt(0, 'raceCar', mirror.arena.seats[0]!.spawn, driving)], race))).toBe('resynced')
    expect(mirror.race).toEqual(race)
    const from = positionOf(mirror, 0)

    for (let frame = 0; frame < 60; frame++) mirror.run(() => 1)
    // From the grid to Go is three seconds: the car is still standing on it,
    // settling on its wheels and no more.
    expect(vdistance(positionOf(mirror, 0), from)).toBeLessThan(1)

    // Let go, it goes.
    mirror.take({ ...snapshotAt(400, [vehicleAt(0, 'raceCar', mirror.arena.seats[0]!.spawn, driving)], { ...race, elapsed: 60 }), tick: 400 })
    for (let frame = 0; frame < 60; frame++) mirror.run(() => 1)
    expect(vdistance(positionOf(mirror, 0), from)).toBeGreaterThan(2)
    mirror.dispose()
  })
})
