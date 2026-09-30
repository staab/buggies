import { describe, expect, it } from 'vitest'

import {
  CLIENT_INPUT,
  PROTOCOL_VERSION,
  REJECT_SERVER_FULL,
  UNACKNOWLEDGED_INPUT_TICK,
} from './protocol.ts'
import {
  INPUT_BYTES,
  decodePeek,
  decodePeekRequest,
  encodePeek,
  encodePeekRequest,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_PROP_BYTES,
  SNAPSHOT_ROBOT_BYTES,
  SNAPSHOT_SPIDER_BYTES,
  SNAPSHOT_UFO_BYTES,
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
  decodeGoal,
  encodeGoal,
  isRespawn,
  isRoomsRequest,
  NO_ARRIVAL,
  NO_PASS,
  SNAPSHOT_VEHICLE_CORE_BYTES,
  withAck,
  type SnapshotMessage,
  type VehicleSnapshot,
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
      collected: 1234,
      robotKills: 1,
    kills: 7,
      goal: { kind: 'location', target: 0, from: 0, x: 0.5, y: 0, z: 0.75 },
      goalsWon: 3,
      weapon: 'machineGun',
      wins: 255,
      ammoTicks: 1234,
      actionTicks: 180,
      cooldownTicks: 600,
      lightsOn: true,
      abilityHeld: false,
      npc: true,
      rocketsFired: 65535,
      stunnedTicks: 300,
      slowedTicks: 2,
      slowedBy: 0.5,
      shieldTicks: 480,
      magnetTicks: 360,
      plowTicks: 600,
      slipTicks: 120,
      grappleTicks: 240,
      grappleTarget: 5,
      appliedInput: { steer: -0.5, throttle: 1, brake: 0, handbrake: true, fire: true, ability: false },
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
      collected: 3,
      robotKills: 1,
    kills: 0,
      goal: { kind: 'kills', target: 5, from: 2, x: 0, y: 0, z: 0 },
      goalsWon: 0,
      weapon: 'none',
      wins: 0,
      ammoTicks: 0,
      actionTicks: 0,
      cooldownTicks: 0,
      lightsOn: false,
      abilityHeld: true,
      npc: false,
      rocketsFired: 7,
      stunnedTicks: 0,
      slowedTicks: 0,
      slowedBy: 0,
      shieldTicks: 0,
      magnetTicks: 0,
      plowTicks: 0,
      slipTicks: 0,
      grappleTicks: 0,
      grappleTarget: -1,
      appliedInput: { steer: 0, throttle: 0, brake: 0, handbrake: false, fire: false, ability: true },
    },
  ],
  pickups: [
    { slot: 0, generation: 0, ticksUntilOut: 0 },
    { slot: 1, generation: 7, ticksUntilOut: 480 },
    { slot: 63, generation: 65535, ticksUntilOut: 12 },
  ],
  loose: [
    { id: 0, kind: 'banana', owner: 3, power: 0, from: { x: 1, y: 2, z: 3 }, position: { x: 10.5, y: 2.25, z: -3 }, age: 30 },
    { id: 65535, kind: 'bomb', owner: -1, power: 1, from: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, age: 65535 },
    { id: 12, kind: 'mine', owner: 1, power: 0.3, from: { x: 5, y: 1, z: 5 }, position: { x: 6, y: 2, z: 7 }, age: 3 },
    { id: 13, kind: 'oil', owner: 2, power: 0.5, from: { x: 5, y: 1, z: 5 }, position: { x: 6, y: 0.05, z: 7 }, age: 900 },
  ],
  removed: [3, 65000],
  rockets: [
    { id: 9, owner: 2, target: 5, position: { x: 1, y: 2, z: 3 }, velocity: { x: 40, y: -1, z: 20 }, age: 12, power: 1 },
    { id: 65535, owner: 7, target: -1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, age: 0, power: 0 },
  ],
  props: [
    {
      id: 17,
      position: { x: 100.5, y: 3.25, z: 200.75 },
      rotation: { x: 0, y: 0.7071067811865476, z: 0, w: 0.7071067811865476 },
      linearVelocity: { x: 2, y: -1, z: 0.5 },
      angularVelocity: { x: 0.1, y: 0.2, z: 0.3 },
    },
  ],
  robots: [
    { id: 0, road: 412, along: 187.5, direction: -1, legs: 9, target: 3, beamTicks: 42, cooldownTicks: 0, damage: 0, deaths: 3 },
    { id: 1, road: 7, along: 0.25, direction: 1, legs: 0, target: -1, beamTicks: 0, cooldownTicks: 180, damage: 1, deaths: 0 },
  ],
  ufos: [
    {
      id: 0,
      position: { x: 1200.5, y: 88.25, z: 640.75 },
      state: 'lift',
      target: 2,
      stateTicks: 90,
      cooldownTicks: 0,
      legs: 13,
      abductions: 2,
      damage: 0,
      deaths: 1,
    },
  ],
  spiders: [{ id: 0, position: { x: 800.5, y: 12.25, z: 900.75 }, forward: { x: 0, y: 0.5, z: -0.75 }, legs: 4, target: { x: 1000.5, y: -2.5, z: 700.25 }, stride: 321.5, bombTicks: 1200, damage: 0, deaths: 2 }],
}

describe('wire', () => {
  it('round-trips the handshake', () => {
    expect(decodeHello(encodeHello('raceCar', 4_000_000_000))).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      profile: 'raceCar',
      seed: 4_000_000_000,
      arrival: NO_ARRIVAL,
      pass: NO_PASS,
    })
    expect(decodeHello(encodeHello('tank', 7, 2, 4_000_000_001))).toMatchObject({ seed: 7, arrival: 2, pass: 4_000_000_001 })
    const welcome = { protocolVersion: 3, seed: 4_000_000_000, seat: 7, epoch: 200, tick: 987654, maxPlayers: 8, profile: 'pickup' as const, pass: 3_000_000_000 }
    expect(decodeWelcome(encodeWelcome(welcome))).toEqual(welcome)
    expect(decodeReject(encodeReject({ reason: REJECT_SERVER_FULL }))).toEqual({ reason: REJECT_SERVER_FULL })
    expect(isRespawn(encodeRespawn())).toBe(true)
  })

  it('round-trips an input with its tick', () => {
    const input = { steer: -0.25, throttle: 0.5, brake: 0, handbrake: true, fire: false, ability: true }
    const payload = encodeInput(77, input)
    expect(payload.length).toBe(INPUT_BYTES)
    const out = { steer: 9, throttle: 9, brake: 9, handbrake: false, fire: true, ability: false }
    expect(decodeInput(payload, out)).toBe(77)
    expect(out).toEqual(input)
  })

  it('round-trips a goal, a count or a spot, and the clearing of one', () => {
    expect(decodeGoal(encodeGoal({ kind: 'score', target: 20, x: 0, y: 0, z: 0 }))).toEqual({ kind: 'score', target: 20, x: 0, y: 0, z: 0 })
    expect(decodeGoal(encodeGoal({ kind: 'location', target: 0, x: 0.625, y: -0.5, z: 0.25 }))).toEqual({
      kind: 'location',
      target: 0,
      x: 0.625,
      y: -0.5,
      z: 0.25,
    })
    expect(decodeGoal(encodeGoal(null))).toBeNull()
    // Not a goal at all: the wrong length, or a kind that is none of them.
    expect(decodeGoal(encodeRespawn())).toBeUndefined()
    const bad = encodeGoal(null)
    bad[1] = 99
    expect(decodeGoal(bad)).toBeUndefined()
  })

  it('round-trips a snapshot, every vehicle and field', () => {
    const payload = encodeSnapshot(snapshot)
    expect(payload.length).toBe(
      SNAPSHOT_HEADER_BYTES +
        snapshot.props.length * SNAPSHOT_PROP_BYTES +
        snapshot.robots.length * SNAPSHOT_ROBOT_BYTES +
        snapshot.ufos.length * SNAPSHOT_UFO_BYTES +
        snapshot.spiders.length * SNAPSHOT_SPIDER_BYTES +
        2 * SNAPSHOT_VEHICLE_BYTES +
        3 * SNAPSHOT_PICKUP_BYTES +
        snapshot.loose.length * SNAPSHOT_SPILLED_BYTES +
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
      expect(got).toMatchObject({ id: rocket.id, owner: rocket.owner, target: rocket.target, age: rocket.age, power: rocket.power })
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(got.position[axis]).toBeCloseTo(rocket.position[axis], 4)
        expect(got.velocity[axis]).toBeCloseTo(rocket.velocity[axis], 4)
      }
    }
    expect(decoded.robots).toEqual(snapshot.robots)
    expect(decoded.ufos).toEqual(snapshot.ufos)
    // With nothing changed, a snapshot is its vehicles, robots and saucers alone.
    const quiet = { ...snapshot, full: false, pickups: [], loose: [], removed: [], rockets: [], props: [] }
    expect(encodeSnapshot(quiet).length).toBe(SNAPSHOT_HEADER_BYTES + 2 * SNAPSHOT_VEHICLE_BYTES + 2 * SNAPSHOT_ROBOT_BYTES + SNAPSHOT_UFO_BYTES + SNAPSHOT_SPIDER_BYTES)
    expect(decodeSnapshot(encodeSnapshot(quiet))).toMatchObject({ full: false, pickups: [], loose: [], removed: [] })
    for (const [i, loose] of snapshot.loose.entries()) {
      const got = decoded.loose[i]!
      expect(got).toMatchObject({ id: loose.id, kind: loose.kind, owner: loose.owner, age: loose.age })
      expect(got.power).toBeCloseTo(loose.power, 2)
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
      expect(got.wins).toBe(vehicle.wins)
      expect(got.ammoTicks).toBe(vehicle.ammoTicks)
      expect(got.actionTicks).toBe(vehicle.actionTicks)
      expect(got.cooldownTicks).toBe(vehicle.cooldownTicks)
      expect(got.lightsOn).toBe(vehicle.lightsOn)
      expect(got.abilityHeld).toBe(vehicle.abilityHeld)
      expect(got.rocketsFired).toBe(vehicle.rocketsFired)
      expect(got.stunnedTicks).toBe(vehicle.stunnedTicks)
      expect(got.slowedTicks).toBe(vehicle.slowedTicks)
      expect(got.slowedBy).toBeCloseTo(vehicle.slowedBy, 2)
      for (const key of ['shieldTicks', 'magnetTicks', 'plowTicks', 'slipTicks', 'grappleTicks', 'grappleTarget'] as const) {
        expect(got[key]).toBe(vehicle[key])
      }
      expect(got.wrecked).toBe(vehicle.wrecked)
      expect(got.score).toBe(vehicle.score)
      expect(got.damage).toBeCloseTo(vehicle.damage, 2)
      // The input a mirror runs a car on is told to within a byte's step.
      const { steer, throttle, brake, ...buttons } = got.appliedInput
      expect(steer).toBeCloseTo(vehicle.appliedInput.steer, 1)
      expect(throttle).toBeCloseTo(vehicle.appliedInput.throttle, 2)
      expect(brake).toBeCloseTo(vehicle.appliedInput.brake, 2)
      expect(buttons).toEqual({ handbrake: vehicle.appliedInput.handbrake, fire: vehicle.appliedInput.fire, ability: vehicle.appliedInput.ability })
      expect(got.goal).toEqual(vehicle.goal)
      expect(got.npc).toBe(vehicle.npc)
      for (const key of ['position', 'linearVelocity', 'angularVelocity'] as const) {
        for (const axis of ['x', 'y', 'z'] as const) expect(got[key][axis]).toBeCloseTo(vehicle[key][axis], 4)
      }
      for (const axis of ['x', 'y', 'z', 'w'] as const) expect(got.rotation[axis]).toBeCloseTo(vehicle.rotation[axis], 6)
    }
    for (const [i, prop] of snapshot.props.entries()) {
      const got = decoded.props[i]!
      expect(got.id).toBe(prop.id)
      for (const key of ['position', 'linearVelocity', 'angularVelocity'] as const) {
        for (const axis of ['x', 'y', 'z'] as const) expect(got[key][axis]).toBeCloseTo(prop[key][axis], 4)
      }
      for (const axis of ['x', 'y', 'z', 'w'] as const) expect(got.rotation[axis]).toBeCloseTo(prop.rotation[axis], 6)
    }
  })

  it('tells a car nobody drives with nothing going on in its core alone, and one with something going on in full', () => {
    const driven = snapshot.vehicles[1]!
    const quiet: VehicleSnapshot = {
      ...driven,
      seat: 9,
      npc: true,
      score: 0,
      collected: 0,
      robotKills: 0,
      goal: null,
      rocketsFired: 0,
      grappleTarget: -1,
      abilityHeld: false,
      appliedInput: { steer: 0.25, throttle: 0.6, brake: 0, handbrake: false, fire: false, ability: false },
    }
    const busy: VehicleSnapshot = { ...quiet, seat: 10, weapon: 'shield', shieldTicks: 90 }
    const message = { ...snapshot, full: false, pickups: [], loose: [], removed: [], rockets: [], props: [], robots: [], ufos: [], spiders: [], vehicles: [quiet, busy, driven] }
    const payload = encodeSnapshot(message)
    expect(payload.length).toBe(SNAPSHOT_HEADER_BYTES + SNAPSHOT_VEHICLE_CORE_BYTES + 2 * SNAPSHOT_VEHICLE_BYTES)
    const [gotQuiet, gotBusy, gotDriven] = decodeSnapshot(payload)!.vehicles
    expect(gotQuiet).toMatchObject({ seat: 9, npc: true, score: 0, goal: null, weapon: 'none', grappleTarget: -1, shieldTicks: 0 })
    expect(gotQuiet!.appliedInput.throttle).toBeCloseTo(0.6, 2)
    expect(gotBusy).toMatchObject({ seat: 10, npc: true, weapon: 'shield', shieldTicks: 90 })
    expect(gotDriven).toMatchObject({ seat: driven.seat, npc: false, score: driven.score, goal: driven.goal })
  })

  it('tells any turn, however it is written, to within a hundred-thousandth, and a velocity to within a step', () => {
    const turns = [
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: 0, z: 0, w: -1 },
      { x: 0.5, y: -0.5, z: 0.5, w: -0.5 },
      { x: -0.9, y: 0.1, z: 0.3, w: 0.2 },
      { x: 0.01, y: 0.99, z: -0.05, w: -0.1 },
    ].map(({ x, y, z, w }) => {
      const length = Math.hypot(x, y, z, w)
      return { x: x / length, y: y / length, z: z / length, w: w / length }
    })
    for (const rotation of turns) {
      const vehicle = { ...snapshot.vehicles[1]!, rotation, linearVelocity: { x: -97.123, y: 12.345, z: 0.005 }, angularVelocity: { x: 7.8912, y: -0.0004, z: 31 } }
      const got = decodeSnapshot(encodeSnapshot({ ...snapshot, vehicles: [vehicle] }))!.vehicles[0]!
      // A turn and its every part negated are the same turn.
      const sign = Math.sign(got.rotation.x * rotation.x + got.rotation.y * rotation.y + got.rotation.z * rotation.z + got.rotation.w * rotation.w)
      for (const axis of ['x', 'y', 'z', 'w'] as const) expect(Math.abs(got.rotation[axis] * sign - rotation[axis])).toBeLessThan(1e-4)
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Math.abs(got.linearVelocity[axis] - vehicle.linearVelocity[axis])).toBeLessThanOrEqual(0.005 + 1e-9)
        expect(Math.abs(got.angularVelocity[axis] - vehicle.angularVelocity[axis])).toBeLessThanOrEqual(0.0005 + 1e-9)
      }
    }
  })

  it('refuses a snapshot a byte too long or too short', () => {
    const payload = encodeSnapshot(snapshot)
    expect(decodeSnapshot(payload)).not.toBeNull()
    expect(decodeSnapshot(payload.subarray(0, payload.length - 1))).toBeNull()
    const longer = new Uint8Array(payload.length + 1)
    longer.set(payload)
    expect(decodeSnapshot(longer)).toBeNull()
  })

  it('stamps each player their own acknowledgment onto one encoding', () => {
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
    // Every island with anyone on it fits, up to a byte's count.
    const many = Array.from({ length: 255 }, (_, i) => ({ seed: i + 1, players: 1 }))
    expect(decodeRooms(encodeRooms(many))).toEqual(many)
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

  it('round-trips a peek at an island, the question and the answer', () => {
    expect(decodePeekRequest(encodePeekRequest(4_000_000_000))).toBe(4_000_000_000)
    const marks = [
      { kind: 'player' as const, seat: 3, position: { x: 100.5, y: 12.25, z: 900.75 } },
      { kind: 'npc' as const, seat: 31, position: { x: 1.5, y: 2.5, z: 3.5 } },
    ]
    expect(decodePeek(encodePeek(marks))).toEqual(marks)
  })
})
