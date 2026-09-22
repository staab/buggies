import { describe, expect, it } from 'vitest'

import {
  CLIENT_INPUT,
  PROTOCOL_VERSION,
  REJECT_SERVER_FULL,
  UNACKNOWLEDGED_INPUT_TICK,
} from './protocol.ts'
import {
  INPUT_BYTES,
  SNAPSHOT_PICKUP_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_VEHICLE_BYTES,
  decodeHello,
  decodeInput,
  decodeReject,
  decodeSnapshot,
  decodeWelcome,
  encodeHello,
  encodeInput,
  encodeReject,
  encodeRespawn,
  encodeSnapshot,
  encodeWelcome,
  isRespawn,
  withAck,
  type SnapshotMessage,
} from './wire.ts'

const snapshot: SnapshotMessage = {
  tick: 123456,
  ackInputTick: 123450,
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
      appliedInput: { steer: -0.5, throttle: 1, brake: 0, handbrake: true },
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
      appliedInput: { steer: 0, throttle: 0, brake: 0, handbrake: false },
    },
  ],
  pickups: [
    { generation: 0, ticksUntilOut: 0 },
    { generation: 7, ticksUntilOut: 480 },
    { generation: 65535, ticksUntilOut: 12 },
  ]
}

describe('wire', () => {
  it('round-trips the handshake', () => {
    expect(decodeHello(encodeHello('raceCar'))).toEqual({ protocolVersion: PROTOCOL_VERSION, profile: 'raceCar' })
    const welcome = { protocolVersion: 3, seed: 4_000_000_000, seat: 7, epoch: 200, tick: 987654, maxPlayers: 8, profile: 'pickup' as const }
    expect(decodeWelcome(encodeWelcome(welcome))).toEqual(welcome)
    expect(decodeReject(encodeReject({ reason: REJECT_SERVER_FULL }))).toEqual({ reason: REJECT_SERVER_FULL })
    expect(isRespawn(encodeRespawn())).toBe(true)
  })

  it('round-trips an input with its tick', () => {
    const input = { steer: -0.25, throttle: 0.5, brake: 0, handbrake: true }
    const payload = encodeInput(77, input)
    expect(payload.length).toBe(INPUT_BYTES)
    const out = { steer: 9, throttle: 9, brake: 9, handbrake: false }
    expect(decodeInput(payload, out)).toBe(77)
    expect(out).toEqual(input)
  })

  it('round-trips a snapshot, every vehicle and field', () => {
    const payload = encodeSnapshot(snapshot)
    expect(payload.length).toBe(SNAPSHOT_HEADER_BYTES + 2 * SNAPSHOT_VEHICLE_BYTES + 3 * SNAPSHOT_PICKUP_BYTES)
    const decoded = decodeSnapshot(payload)!
    expect(decoded.tick).toBe(snapshot.tick)
    expect(decoded.ackInputTick).toBe(snapshot.ackInputTick)
    expect(decoded.pickups).toEqual(snapshot.pickups)
    for (const [i, vehicle] of snapshot.vehicles.entries()) {
      const got = decoded.vehicles[i]!
      expect(got.seat).toBe(vehicle.seat)
      expect(got.epoch).toBe(vehicle.epoch)
      expect(got.profile).toBe(vehicle.profile)
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

  it('refuses anything the wrong shape', () => {
    expect(decodeHello(new Uint8Array(0))).toBeNull()
    expect(decodeHello(encodeHello('sportsCar').subarray(0, 3))).toBeNull()
    expect(decodeWelcome(encodeHello('sportsCar'))).toBeNull()
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
