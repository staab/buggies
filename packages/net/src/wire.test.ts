import { describe, expect, it } from 'vitest'

import {
  CLIENT_INPUT,
  PROTOCOL_VERSION,
  REJECT_SERVER_FULL,
  UNACKNOWLEDGED_INPUT_TICK,
} from './protocol.ts'
import {
  INPUT_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_PICKUP_BYTES,
  SNAPSHOT_REMOVED_BYTES,
  SNAPSHOT_ROCKET_BYTES,
  SNAPSHOT_SPILLED_BYTES,
  SNAPSHOT_VEHICLE_BYTES,
  decodeHello,
  decodeInput,
  decodeReject,
  decodeRooms,
  decodeSnapshot,
  decodeWelcome,
  encodeHello,
  encodeInput,
  encodeReject,
  encodeRespawn,
  encodeRooms,
  encodeRoomsRequest,
  encodeSnapshot,
  encodeWelcome,
  isRespawn,
  isRoomsRequest,
  withAck,
  type SnapshotMessage,
} from './wire.ts'

const snapshot: SnapshotMessage = {
  tick: 123456,
  ackInputTick: 123450,
  full: true,
  looseNext: 4321,
  vehicles: [
    {
      seat: 0,
      epoch: 7,
      profile: 'pickup',
      position: { x: 512.5, y: 12.25, z: 1024.75 },
      rotation: { x: 0, y: 0.7071067811865476, z: 0, w: 0.7071067811865476 },
      linearVelocity: { x: 1.5, y: -0.25, z: 30 },
      angularVelocity: { x: 0.125, y: 2, z: -0.5 },
      damage: 1,
      wrecked: true,
      score: 60000,
      weapon: 'machineGun',
      ammoTicks: 1234,
      appliedInput: { steer: -0.5, throttle: 1, brake: 0, handbrake: true, fire: true },
    },
    {
      seat: 5,
      epoch: 255,
      profile: 'raceCar',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      damage: 0.4,
      wrecked: false,
      score: 3,
      weapon: 'none',
      ammoTicks: 0,
      appliedInput: { steer: 0, throttle: 0, brake: 0, handbrake: false, fire: false },
    },
  ],
  pickups: [
    { slot: 0, generation: 0, ticksUntilOut: 0 },
    { slot: 1, generation: 7, ticksUntilOut: 480 },
    { slot: 63, generation: 65535, ticksUntilOut: 12 },
  ],
  loose: [
    { id: 0, kind: 'banana', from: { x: 1, y: 2, z: 3 }, position: { x: 10.5, y: 2.25, z: -3 }, age: 30 },
    { id: 65535, kind: 'bomb', from: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, age: 65535 },
  ],
  removed: [3, 65000],
  rockets: [
    { id: 9, owner: 2, target: 5, position: { x: 1, y: 2, z: 3 }, velocity: { x: 40, y: -1, z: 20 }, age: 12 },
    { id: 65535, owner: 7, target: -1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, age: 0 },
  ],
}

describe('wire', () => {
  it('round-trips the handshake', () => {
    expect(decodeHello(encodeHello('raceCar', 4_000_000_000))).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      profile: 'raceCar',
      seed: 4_000_000_000,
    })
    const welcome = { protocolVersion: 3, seed: 4_000_000_000, seat: 7, epoch: 200, tick: 987654, maxPlayers: 8, profile: 'pickup' as const }
    expect(decodeWelcome(encodeWelcome(welcome))).toEqual(welcome)
    expect(decodeReject(encodeReject({ reason: REJECT_SERVER_FULL }))).toEqual({ reason: REJECT_SERVER_FULL })
    expect(isRespawn(encodeRespawn())).toBe(true)
  })

  it('round-trips an input with its tick', () => {
    const input = { steer: -0.25, throttle: 0.5, brake: 0, handbrake: true, fire: false }
    const payload = encodeInput(77, input)
    expect(payload.length).toBe(INPUT_BYTES)
    const out = { steer: 9, throttle: 9, brake: 9, handbrake: false, fire: true }
    expect(decodeInput(payload, out)).toBe(77)
    expect(out).toEqual(input)
  })

  it('round-trips a snapshot, every vehicle and field', () => {
    const payload = encodeSnapshot(snapshot)
    expect(payload.length).toBe(
      SNAPSHOT_HEADER_BYTES +
        2 * SNAPSHOT_VEHICLE_BYTES +
        3 * SNAPSHOT_PICKUP_BYTES +
        2 * SNAPSHOT_SPILLED_BYTES +
        2 * SNAPSHOT_REMOVED_BYTES +
        2 * SNAPSHOT_ROCKET_BYTES,
    )
    const decoded = decodeSnapshot(payload)!
    expect(decoded.tick).toBe(snapshot.tick)
    expect(decoded.ackInputTick).toBe(snapshot.ackInputTick)
    expect(decoded.full).toBe(true)
    expect(decoded.looseNext).toBe(4321)
    expect(decoded.pickups).toEqual(snapshot.pickups)
    expect(decoded.removed).toEqual(snapshot.removed)
    for (const [i, rocket] of snapshot.rockets.entries()) {
      const got = decoded.rockets[i]!
      expect(got).toMatchObject({ id: rocket.id, owner: rocket.owner, target: rocket.target, age: rocket.age })
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(got.position[axis]).toBeCloseTo(rocket.position[axis], 4)
        expect(got.velocity[axis]).toBeCloseTo(rocket.velocity[axis], 4)
      }
    }
    // With nothing changed, a snapshot is its vehicles alone.
    const quiet = { ...snapshot, full: false, pickups: [], loose: [], removed: [], rockets: [] }
    expect(encodeSnapshot(quiet).length).toBe(SNAPSHOT_HEADER_BYTES + 2 * SNAPSHOT_VEHICLE_BYTES)
    expect(decodeSnapshot(encodeSnapshot(quiet))).toMatchObject({ full: false, pickups: [], loose: [], removed: [] })
    for (const [i, loose] of snapshot.loose.entries()) {
      const got = decoded.loose[i]!
      expect(got).toMatchObject({ id: loose.id, kind: loose.kind, age: loose.age })
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(got.from[axis]).toBeCloseTo(loose.from[axis], 4)
        expect(got.position[axis]).toBeCloseTo(loose.position[axis], 4)
      }
    }
    for (const [i, vehicle] of snapshot.vehicles.entries()) {
      const got = decoded.vehicles[i]!
      expect(got.seat).toBe(vehicle.seat)
      expect(got.epoch).toBe(vehicle.epoch)
      expect(got.profile).toBe(vehicle.profile)
      expect(got.weapon).toBe(vehicle.weapon)
      expect(got.ammoTicks).toBe(vehicle.ammoTicks)
      expect(got.wrecked).toBe(vehicle.wrecked)
      expect(got.score).toBe(vehicle.score)
      expect(got.damage).toBeCloseTo(vehicle.damage, 2)
      expect(got.appliedInput).toEqual(vehicle.appliedInput)
      for (const key of ['position', 'linearVelocity', 'angularVelocity'] as const) {
        for (const axis of ['x', 'y', 'z'] as const) expect(got[key][axis]).toBeCloseTo(vehicle[key][axis], 4)
      }
      for (const axis of ['x', 'y', 'z', 'w'] as const) expect(got.rotation[axis]).toBeCloseTo(vehicle.rotation[axis], 6)
    }
  })

  it('stamps each player their own acknowledgement onto one encoding', () => {
    const shared = encodeSnapshot({ ...snapshot, ackInputTick: -1 })
    expect(decodeSnapshot(shared)!.ackInputTick).toBe(UNACKNOWLEDGED_INPUT_TICK)
    expect(decodeSnapshot(withAck(shared, 42))!.ackInputTick).toBe(42)
    // The original was not touched.
    expect(decodeSnapshot(shared)!.ackInputTick).toBe(UNACKNOWLEDGED_INPUT_TICK)
  })

  it('carries which islands are busy, and the asking after them', () => {
    expect(isRoomsRequest(encodeRoomsRequest())).toBe(true)
    expect(isRoomsRequest(encodeRespawn())).toBe(false)
    expect(decodeHello(encodeRoomsRequest())).toBeNull()
    const rooms = [
      { seed: 4_000_000_000, players: 12 },
      { seed: 7, players: 1 },
    ]
    expect(decodeRooms(encodeRooms(rooms))).toEqual(rooms)
    expect(decodeRooms(encodeRooms([]))).toEqual([])
    // A crowd beyond a byte is a byte's worth.
    expect(decodeRooms(encodeRooms([{ seed: 1, players: 900 }]))).toEqual([{ seed: 1, players: 255 }])
    expect(decodeRooms(encodeRooms(rooms).subarray(0, 6))).toBeNull()
    expect(decodeRooms(encodeRoomsRequest())).toBeNull()
  })

  it('refuses anything the wrong shape', () => {
    expect(decodeHello(new Uint8Array(0))).toBeNull()
    expect(decodeHello(encodeHello('sportsCar', 1).subarray(0, 3))).toBeNull()
    expect(decodeWelcome(encodeHello('sportsCar', 1))).toBeNull()
    expect(decodeInput(encodeInput(1, snapshot.vehicles[0]!.appliedInput).subarray(0, 10), { ...snapshot.vehicles[0]!.appliedInput })).toBeNull()
    expect(decodeSnapshot(encodeSnapshot(snapshot).subarray(0, SNAPSHOT_HEADER_BYTES + 3))).toBeNull()

    // An unknown vehicle profile is not guessed at.
    const badProfile = encodeSnapshot(snapshot)
    badProfile[SNAPSHOT_HEADER_BYTES + 2] = 200
    expect(decodeSnapshot(badProfile)).toBeNull()

    const wrongType = encodeInput(1, snapshot.vehicles[0]!.appliedInput)
    wrongType[0] = CLIENT_INPUT + 40
    expect(decodeInput(wrongType, { ...snapshot.vehicles[0]!.appliedInput })).toBeNull()
  })
})
