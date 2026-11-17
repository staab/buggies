import { describe, expect, it } from 'vitest'

import { CLIENT_INPUT, NO_SEAT, PROTOCOL_VERSION, REJECT_SERVER_FULL, UNACKNOWLEDGED_INPUT_TICK } from './protocol.ts'
import { authTemplate, newChallenge, newSecretKey, publicKeyOf, signEvent, verifyAuth } from './nostr.ts'
import {
  CHECKPOINT_BYTES,
  COURSE_WORLD_BYTES,
  GAME_EDIT_BYTES,
  GAME_READY_BYTES,
  GAME_SLOT_BYTES,
  GAME_START_BYTES,
  GAME_SUMMARY_BYTES,
  GAME_VIEW_BYTES,
  GAMES_HEADER_BYTES,
  HELLO_BYTES,
  INPUT_BYTES,
  JOIN_GAME_BYTES,
  KEEP_PORTAL_BYTES,
  LEAVE_GAME_BYTES,
  LOBBY_HEADER_BYTES,
  LOBBY_HELLO_BYTES,
  LOBBY_PLAYER_BYTES,
  LOBBY_WELCOME_BYTES,
  RACE_PLAN_HEADER_BYTES,
  RACE_PLAN_TAIL_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_METEOR_BYTES,
  SNAPSHOT_PICKUP_BYTES,
  SNAPSHOT_PROP_BYTES,
  SNAPSHOT_RACER_BYTES,
  SNAPSHOT_RACE_BYTES,
  SNAPSHOT_REMOVED_BYTES,
  SNAPSHOT_ROBOT_BYTES,
  SNAPSHOT_ROCKET_BYTES,
  SNAPSHOT_SPIDER_BYTES,
  SNAPSHOT_SPILLED_BYTES,
  SNAPSHOT_UFO_BYTES,
  SNAPSHOT_VEHICLE_BYTES,
  SNAPSHOT_VEHICLE_CORE_BYTES,
  SNAPSHOT_VEHICLE_EXTRAS_BYTES,
  SLOT_ADD_BYTES,
  SLOT_REMOVE_BYTES,
  SLOT_VEHICLE_BYTES,
  STANDING_BYTES,
  STANDINGS_HEADER_BYTES,
  WELCOME_BYTES,
  cleanName,
  decodeAuth,
  decodeCreateGame,
  decodeGame,
  decodeGameEdit,
  decodeGameReady,
  decodeGames,
  decodeHello,
  decodeInput,
  decodeJoinGame,
  decodeLobby,
  decodeLobbyHello,
  decodeLobbyWelcome,
  decodeRacePlan,
  decodeReject,
  decodeSignedIn,
  decodeSlotRemove,
  decodeSlotVehicle,
  decodeSnapshot,
  decodeStandings,
  decodeWelcome,
  encodeAuth,
  encodeCreateGame,
  encodeGame,
  encodeGameEdit,
  encodeGameReady,
  encodeGameStart,
  encodeGames,
  encodeHello,
  encodeInput,
  encodeJoinGame,
  encodeLeaveGame,
  encodeLobby,
  encodeLobbyHello,
  encodeLobbyWelcome,
  encodeRacePlan,
  encodeReject,
  encodeRespawn,
  encodeSignedIn,
  encodeSlotAdd,
  encodeSlotRemove,
  encodeSlotVehicle,
  encodeSnapshot,
  encodeStandings,
  encodeWelcome,
  flagsOf,
  isGameStart,
  isLeaveGame,
  isRespawn,
  isSlotAdd,
  messageTypeOf,
  modeCode,
  modeOf,
  rulesOf,
  statusCode,
  statusOf,
  CREATE_GAME_BYTES,
  HELD,
  NO_ARRIVAL,
  NO_PASS,
  withAck,
  type GameOptions,
  type GameView,
  type RacePlan,
  type SnapshotMessage,
  type VehicleSnapshot,
} from './wire.ts'

const snapshot: SnapshotMessage = {
  tick: 123456,
  ackInputTick: 123450,
  full: true,
  looseNext: 4321,
  race: {
    world: 2,
    ofWorlds: 3,
    elapsed: -180,
    over: false,
    racing: 5,
    racers: [
      { seat: 0, place: 0, checkpoint: 3, finished: false },
      { seat: 1, place: 1, checkpoint: 8, finished: true },
    ],
  },
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
      achievements: 7,
      lastAchievement: 42,
      weapon: 'machineGun',
      weaponHeld: 2,
      burnLeft: 59,
      npc: true,
      rocketsFired: 65535,
      stunnedTicks: 300,
      shockTicks: 30,
      magnetTicks: 360,
      plowTicks: 600,
      lightsOn: true,
      hornTicks: 0,
      signalHeld: false,
      appliedInput: { steer: -0.5, throttle: 1, brake: 0, handbrake: true, weapon: 2, fire: true, signal: false },
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
      achievements: 0,
      lastAchievement: 0,
      weapon: 'none',
      weaponHeld: 2,
      burnLeft: 0,
      npc: false,
      rocketsFired: 7,
      stunnedTicks: 0,
      shockTicks: 0,
      magnetTicks: 0,
      plowTicks: 0,
      lightsOn: false,
      hornTicks: 45,
      signalHeld: true,
      appliedInput: { steer: 0, throttle: 0, brake: 0, handbrake: false, weapon: 2, fire: false, signal: true },
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
  ],
  removed: [3, 65000],
  rockets: [
    { id: 9, owner: 2, target: 5, position: { x: 1, y: 2, z: 3 }, velocity: { x: 40, y: -1, z: 20 }, age: 12 },
    { id: 65535, owner: 7, target: -1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, age: 0 },
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
      velocity: { x: 12.5, y: -0.5, z: 2.25 },
      climb: -3.25,
    },
  ],
  spiders: [{ id: 0, position: { x: 800.5, y: 12.25, z: 900.75 }, forward: { x: 0, y: 0.5, z: -0.75 }, legs: 4, target: { x: 1000.5, y: -2.5, z: 700.25 }, stride: 321.5, bombTicks: 1200, damage: 0, deaths: 2 }],
  meteors: [{ id: 7, from: { x: 300.5, y: 250.25, z: -40.75 }, to: { x: 150.25, y: 20.5, z: -10.5 }, age: 90 }],
}

const options: GameOptions = { mode: 'race', seed: 4_000_000_001, weapons: true, bananas: false, raceLength: 3 }

const view: GameView = {
  id: 7,
  status: 'starting',
  host: 2,
  options,
  slots: [
    { slot: 0, bot: false, member: 1, name: 'Ada', vehicle: 'pickup', ready: true, driving: false },
    { slot: 1, bot: true, member: 0, name: 'Axle', vehicle: 'raceCar', ready: true, driving: true },
    { slot: 2, bot: false, member: 2, name: 'Bo', vehicle: 'sportsCar', ready: false, driving: true },
  ],
  you: 2,
  drivePass: 3_000_000_000,
  fault: null,
}

const plan: RacePlan = {
  game: 7,
  world: 2,
  ofWorlds: 3,
  keep: [0, 1],
  checkpoints: Array.from({ length: 8 }, (_, k) => ({
    at: { x: 100.5 + k * 40, y: 12.25, z: 200.75 - k * 8 },
    forward: { x: 0.5, y: 0, z: -0.5 },
    radius: 14,
  })),
  exit: 1,
  next: { world: 1_000_000_002, arrival: 1 },
  worlds: [1_000_000_001, 1_000_000_002, 1_000_000_003],
}

describe('wire', () => {
  it('cleans a name of what cannot be shown, and keeps it short', () => {
    expect(cleanName('  Ada \n  Lovelace\u0000 ')).toBe('Ada Lovelace')
    expect(cleanName('a'.repeat(40))).toBe('a'.repeat(16))
    expect(cleanName('🍌'.repeat(20))).toBe('🍌'.repeat(16))
    expect(cleanName('\u200b')).toBe('')
  })

  it('round-trips who is on the island, by name', () => {
    const lobby = { players: [{ seat: 0, name: 'Ada' }, { seat: 3, name: 'Zoë ✨' }, { seat: 4, name: '' }] }
    const payload = encodeLobby(lobby)
    expect(payload.length).toBe(LOBBY_HEADER_BYTES + LOBBY_PLAYER_BYTES * 3 + 3 + 8)
    expect(decodeLobby(payload)).toEqual(lobby)
    expect(decodeLobby(encodeLobby({ players: [] }))).toEqual({ players: [] })
    // Cut short, or with a name that is not UTF-8, it is refused.
    expect(decodeLobby(payload.subarray(0, payload.length - 1))).toBeNull()
    const broken = encodeLobby({ players: [{ seat: 0, name: 'ab' }] })
    broken[5] = 0xff
    expect(decodeLobby(broken)).toBeNull()
  })

  it('round-trips a lobby connection and the game it asks to be in', () => {
    const browsing = encodeLobbyHello()
    expect(browsing.length).toBe(LOBBY_HELLO_BYTES)
    expect(decodeLobbyHello(browsing)).toEqual({ protocolVersion: PROTOCOL_VERSION, game: 0, name: '' })
    const joining = encodeLobbyHello(7, 'Ada')
    expect(joining.length).toBe(LOBBY_HELLO_BYTES + 3)
    expect(decodeLobbyHello(joining)).toEqual({ protocolVersion: PROTOCOL_VERSION, game: 7, name: 'Ada' })
    expect(decodeLobbyHello(joining.subarray(0, joining.length - 1))).toBeNull()
  })

  it('round-trips the handshake, with the game a world belongs to', () => {
    const hello = encodeHello('raceCar', 7, 4_000_000_000)
    expect(hello.length).toBe(HELLO_BYTES)
    expect(decodeHello(hello)).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      profile: 'raceCar',
      game: 7,
      seed: 4_000_000_000,
      arrival: NO_ARRIVAL,
      pass: NO_PASS,
      name: '',
    })
    expect(decodeHello(encodeHello('tank', 9, 7, 2, 4_000_000_001, 'Zoë'))).toMatchObject({ game: 9, seed: 7, arrival: 2, pass: 4_000_000_001, name: 'Zoë' })
    // A spectator drives nothing, and says so in its profile byte.
    const watching = encodeHello(null, 7, 4_000_000_000)
    expect(watching.length).toBe(HELLO_BYTES)
    expect(decodeHello(watching)).toEqual({ protocolVersion: PROTOCOL_VERSION, profile: null, game: 7, seed: 4_000_000_000, arrival: NO_ARRIVAL, pass: NO_PASS, name: '' })
    const noSuchCar = encodeHello('raceCar', 7, 4_000_000_000)
    noSuchCar[3] = 200
    expect(decodeHello(noSuchCar)).toBeNull()
    const welcome = {
      protocolVersion: 3,
      game: 7,
      seed: 4_000_000_000,
      seat: 7,
      epoch: 200,
      tick: 987654,
      maxPlayers: 8,
      profile: 'pickup' as const,
      pass: 3_000_000_000,
      race: true,
      flags: 3,
      challenge: '00ff1234abcd00ff1234abcd00ff9876',
      signedIn: '',
    }
    expect(encodeWelcome(welcome).length).toBe(WELCOME_BYTES)
    expect(decodeWelcome(encodeWelcome(welcome))).toEqual(welcome)
    const known = { ...welcome, signedIn: 'ab'.repeat(32) }
    expect(decodeWelcome(encodeWelcome(known))).toEqual(known)
    // A spectator's welcome has no seat, and says nothing about a car to drive.
    const spectating = { ...welcome, seat: NO_SEAT, pass: 0 }
    expect(decodeWelcome(encodeWelcome(spectating))).toEqual(spectating)
    expect(decodeReject(encodeReject({ reason: REJECT_SERVER_FULL }))).toEqual({ reason: REJECT_SERVER_FULL })
    expect(isRespawn(encodeRespawn())).toBe(true)
    expect(decodeReject(encodeWelcome(welcome))).toBeNull()
  })

  it('round-trips an input with its tick', () => {
    const input = { steer: -0.25, throttle: 0.5, brake: 0, handbrake: true, weapon: 9, fire: true, signal: true }
    const payload = encodeInput(77, input)
    expect(payload.length).toBe(INPUT_BYTES)
    const out = { steer: 9, throttle: 9, brake: 9, handbrake: false, weapon: 3, fire: false, signal: false }
    expect(decodeInput(payload, out)).toBe(77)
    expect(out).toEqual(input)
    // A key past the last weapon's is none.
    decodeInput(encodeInput(78, { ...input, weapon: 12 }), out)
    expect(out.weapon).toBe(0)
    expect(out.signal).toBe(true)
    expect(out.fire).toBe(true)
  })

  it('round-trips making, joining, leaving and driving a game', () => {
    expect(decodeCreateGame(encodeCreateGame('tank'))).toBe('tank')
    expect(encodeCreateGame('pickup').length).toBe(CREATE_GAME_BYTES)
    expect(decodeCreateGame(encodeCreateGame('pickup').subarray(0, CREATE_GAME_BYTES - 1))).toBeNull()
    expect(decodeCreateGame(encodeGameStart())).toBeNull()

    const join = encodeJoinGame(4_000_000_000, 'raceCar')
    expect(join.length).toBe(JOIN_GAME_BYTES)
    expect(decodeJoinGame(join)).toEqual({ game: 4_000_000_000, vehicle: 'raceCar' })
    expect(decodeJoinGame(encodeGameStart())).toBeNull()

    expect(isLeaveGame(encodeLeaveGame())).toBe(true)
    expect(encodeLeaveGame().length).toBe(LEAVE_GAME_BYTES)
    expect(isLeaveGame(encodeGameStart())).toBe(false)
    expect(isGameStart(encodeGameStart())).toBe(true)
    expect(isGameStart(encodeLeaveGame())).toBe(false)
    expect(encodeGameStart().length).toBe(GAME_START_BYTES)

    const ready = encodeGameReady('sportsCar', true)
    expect(ready.length).toBe(GAME_READY_BYTES)
    expect(decodeGameReady(ready)).toEqual({ vehicle: 'sportsCar', ready: true })
    expect(decodeGameReady(encodeGameReady('pickup', false))).toEqual({ vehicle: 'pickup', ready: false })
    const unsure = encodeGameReady('pickup', true)
    unsure[2] = 7
    expect(decodeGameReady(unsure)).toBeNull()
  })

  it('round-trips the slot a host adds, removes and fills with a vehicle', () => {
    const add = encodeSlotAdd()
    expect(add.length).toBe(SLOT_ADD_BYTES)
    expect(isSlotAdd(add)).toBe(true)
    expect(isSlotAdd(encodeGameStart())).toBe(false)

    const remove = encodeSlotRemove(5)
    expect(remove.length).toBe(SLOT_REMOVE_BYTES)
    expect(decodeSlotRemove(remove)).toBe(5)
    expect(decodeSlotRemove(encodeSlotRemove(9))).toBeNull()
    expect(decodeSlotRemove(remove.subarray(0, remove.length - 1))).toBeNull()

    const vehicle = encodeSlotVehicle(3, 'sportsCar')
    expect(vehicle.length).toBe(SLOT_VEHICLE_BYTES)
    expect(decodeSlotVehicle(vehicle)).toEqual({ slot: 3, vehicle: 'sportsCar' })
    const noSuchCar = encodeSlotVehicle(3, 'sportsCar')
    noSuchCar[2] = 200
    expect(decodeSlotVehicle(noSuchCar)).toBeNull()
    expect(decodeSlotVehicle(encodeSlotVehicle(200, 'tank'))).toBeNull()
    expect(decodeSlotVehicle(vehicle.subarray(0, vehicle.length - 1))).toBeNull()
  })

  it('round-trips a game\'s mode, world and rules, as its host edits them', () => {
    const edit = encodeGameEdit(options)
    expect(edit.length).toBe(GAME_EDIT_BYTES)
    expect(decodeGameEdit(edit)).toEqual(options)
    expect(decodeGameEdit(encodeGameEdit({ ...options, mode: 'free', weapons: false, bananas: true, raceLength: 4 }))).toEqual({
      ...options,
      mode: 'free',
      weapons: false,
      bananas: true,
      raceLength: 4,
    })
    const badMode = encodeGameEdit(options)
    badMode[1] = 200
    expect(decodeGameEdit(badMode)).toBeNull()
    expect(decodeGameEdit(edit.subarray(0, edit.length - 1))).toBeNull()
  })

  it('round-trips the games listed, each with its host and how full it is', () => {
    const games = [
      { id: 1, seed: 4_000_000_001, mode: 'race' as const, status: 'open' as const, host: 'Ada', humans: 3, slots: 4, leader: 0, demo: false },
      { id: 2, seed: 7, mode: 'free' as const, status: 'racing' as const, host: 'Bo', humans: 1, slots: 1, leader: 4_000_000_003, demo: true },
    ]
    const payload = encodeGames(games)
    expect(payload.length).toBe(GAMES_HEADER_BYTES + 2 * GAME_SUMMARY_BYTES + 3 + 2)
    expect(decodeGames(payload)).toEqual(games)
    expect(decodeGames(encodeGames([]))).toEqual([])
    expect(decodeGames(payload.subarray(0, payload.length - 1))).toBeNull()
    const wrongMode = encodeGames(games)
    wrongMode[GAMES_HEADER_BYTES + 8] = 99
    expect(decodeGames(wrongMode)).toBeNull()
    const wrongDemo = encodeGames(games)
    wrongDemo[GAMES_HEADER_BYTES + 16] = 9
    expect(decodeGames(wrongDemo)).toBeNull()
  })

  it('round-trips a game room, its slots and who is ready', () => {
    const payload = encodeGame(view, view.you, view.drivePass)
    expect(payload.length).toBe(GAME_VIEW_BYTES + 1 + 3 * GAME_SLOT_BYTES + 3 + 4 + 2)
    expect(decodeGame(payload)).toEqual(view)
    const faulted = { ...view, fault: 'no road from the grid to the portal' }
    expect(decodeGame(encodeGame(faulted, 0, 0))).toEqual({ ...faulted, you: 0, drivePass: 0 })
    expect(decodeGame(payload.subarray(0, payload.length - 1))).toBeNull()
    expect(decodeGame(encodeGames([]))).toBeNull()
    // The type byte, then the game's id, then where it is in its life.
    const badStatus = encodeGame(view, 0, 0)
    badStatus[5] = 99
    expect(decodeGame(badStatus)).toBeNull()
    // A slot's flag is a flag, and its index one of the slots a game has.
    const badBot = encodeGame(view, 0, 0)
    badBot[GAME_VIEW_BYTES + 1 + 1] = 9
    expect(decodeGame(badBot)).toBeNull()
    const badSlot = encodeGame(view, 0, 0)
    badSlot[GAME_VIEW_BYTES + 1] = 200
    expect(decodeGame(badSlot)).toBeNull()
  })

  it('round-trips the challenge a lobby connection answers', () => {
    const welcome = { challenge: '00ff1234abcd00ff1234abcd00ff9876', signedIn: '' }
    const payload = encodeLobbyWelcome(welcome)
    expect(payload.length).toBe(LOBBY_WELCOME_BYTES)
    expect(decodeLobbyWelcome(payload)).toEqual(welcome)
    const known = { ...welcome, signedIn: 'ab'.repeat(32) }
    expect(decodeLobbyWelcome(encodeLobbyWelcome(known))).toEqual(known)
    expect(decodeLobbyWelcome(payload.subarray(0, payload.length - 1))).toBeNull()
  })

  it('round-trips a leg of a race course, its gates and where it leads', () => {
    const payload = encodeRacePlan(plan)
    expect(payload.length).toBe(RACE_PLAN_HEADER_BYTES + 2 * KEEP_PORTAL_BYTES + 8 * CHECKPOINT_BYTES + RACE_PLAN_TAIL_BYTES + 3 * COURSE_WORLD_BYTES)
    const decoded = decodeRacePlan(payload)!
    expect(decoded).toMatchObject({ game: 7, world: 2, ofWorlds: 3, keep: [0, 1], exit: 1, next: { world: 1_000_000_002, arrival: 1 }, worlds: [1_000_000_001, 1_000_000_002, 1_000_000_003] })
    for (const [k, checkpoint] of plan.checkpoints.entries()) {
      const got = decoded.checkpoints[k]!
      expect(got.radius).toBe(checkpoint.radius)
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(got.at[axis]).toBeCloseTo(checkpoint.at[axis], 4)
        expect(got.forward[axis]).toBeCloseTo(checkpoint.forward[axis], 4)
      }
    }
    // The last leg keeps its arrival alone, and leads nowhere.
    const last = decodeRacePlan(encodeRacePlan({ ...plan, keep: [0], exit: null, next: null, checkpoints: [] }))!
    expect(last).toEqual({ ...plan, keep: [0], exit: null, next: null, checkpoints: [] })
    expect(decodeRacePlan(payload.subarray(0, payload.length - 1))).toBeNull()
    expect(decodeRacePlan(encodeGames([]))).toBeNull()
  })

  it('round-trips the standings, bots among them', () => {
    const standings = [
      { place: 1, name: 'Ada', vehicle: 'pickup' as const, seconds: 93, dnf: false, bot: false },
      { place: 2, name: 'Axle', vehicle: 'raceCar' as const, seconds: 120, dnf: true, bot: true },
    ]
    const payload = encodeStandings(standings)
    expect(payload.length).toBe(STANDINGS_HEADER_BYTES + 2 * STANDING_BYTES + 3 + 4)
    expect(decodeStandings(payload)).toEqual(standings)
    expect(decodeStandings(encodeStandings([]))).toEqual([])
    expect(decodeStandings(payload.subarray(0, payload.length - 1))).toBeNull()
    const badDnf = encodeStandings(standings)
    badDnf[badDnf.length - 2] = 9
    expect(decodeStandings(badDnf)).toBeNull()
    const badBot = encodeStandings(standings)
    badBot[badBot.length - 1] = 9
    expect(decodeStandings(badBot)).toBeNull()
  })

  it('round-trips a snapshot, every vehicle and field', () => {
    const payload = encodeSnapshot(snapshot)
    expect(payload.length).toBe(
      SNAPSHOT_HEADER_BYTES +
        SNAPSHOT_RACE_BYTES +
        2 * SNAPSHOT_RACER_BYTES +
        snapshot.props.length * SNAPSHOT_PROP_BYTES +
        snapshot.robots.length * SNAPSHOT_ROBOT_BYTES +
        snapshot.ufos.length * SNAPSHOT_UFO_BYTES +
        snapshot.spiders.length * SNAPSHOT_SPIDER_BYTES +
        snapshot.meteors.length * SNAPSHOT_METEOR_BYTES +
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
    expect(decoded.race).toEqual(snapshot.race)
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
    expect(decoded.robots).toEqual(snapshot.robots)
    expect(decoded.ufos).toEqual(snapshot.ufos)
    expect(decoded.meteors).toEqual(snapshot.meteors)
    // With nothing changed, a snapshot is its vehicles, robots and saucers alone.
    const quiet = { ...snapshot, full: false, race: null, pickups: [], loose: [], removed: [], rockets: [], props: [], meteors: [] }
    expect(encodeSnapshot(quiet).length).toBe(SNAPSHOT_HEADER_BYTES + 2 * SNAPSHOT_VEHICLE_BYTES + 2 * SNAPSHOT_ROBOT_BYTES + SNAPSHOT_UFO_BYTES + SNAPSHOT_SPIDER_BYTES)
    expect(decodeSnapshot(encodeSnapshot(quiet))).toMatchObject({ full: false, race: null, pickups: [], loose: [], removed: [] })
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
      for (const key of ['weaponHeld', 'burnLeft', 'rocketsFired', 'stunnedTicks', 'shockTicks', 'magnetTicks', 'plowTicks', 'lightsOn', 'hornTicks', 'signalHeld'] as const) {
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
      expect(buttons).toEqual({ handbrake: vehicle.appliedInput.handbrake, weapon: vehicle.appliedInput.weapon, fire: vehicle.appliedInput.fire, signal: vehicle.appliedInput.signal })
      expect(got.achievements).toBe(vehicle.achievements)
      expect(got.lastAchievement).toBe(vehicle.lastAchievement)
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

  it('tells the race as one world sees it, with the cars held still before the countdown', () => {
    const held = { ...snapshot.race!, elapsed: HELD, over: true, racers: [] }
    const decoded = decodeSnapshot(encodeSnapshot({ ...snapshot, race: held }))!
    expect(decoded.race).toEqual(held)
    expect(decoded.race!.elapsed).toBe(HELD)
  })

  it('tells a car nobody drives with nothing going on in its core alone, and one with something going on in full', () => {
    expect(SNAPSHOT_VEHICLE_EXTRAS_BYTES).toBe(23)
    const driven = snapshot.vehicles[1]!
    const quiet: VehicleSnapshot = {
      ...driven,
      seat: 9,
      npc: true,
      score: 0,
      collected: 0,
      robotKills: 0,
      kills: 0,
      rocketsFired: 0,
      weaponHeld: 0,
      hornTicks: 0,
      signalHeld: false,
      appliedInput: { steer: 0.25, throttle: 0.6, brake: 0, handbrake: false, weapon: 0, fire: false, signal: false },
    }
    const busy: VehicleSnapshot = { ...quiet, seat: 10, weapon: 'magnet', magnetTicks: 90 }
    const message = { ...snapshot, full: false, race: null, pickups: [], loose: [], removed: [], rockets: [], props: [], robots: [], ufos: [], spiders: [], meteors: [], vehicles: [quiet, busy, driven] }
    const payload = encodeSnapshot(message)
    expect(payload.length).toBe(SNAPSHOT_HEADER_BYTES + SNAPSHOT_VEHICLE_CORE_BYTES + 2 * SNAPSHOT_VEHICLE_BYTES)
    const [gotQuiet, gotBusy, gotDriven] = decodeSnapshot(payload)!.vehicles
    expect(gotQuiet).toMatchObject({ seat: 9, npc: true, score: 0, weapon: 'none', weaponHeld: 0, magnetTicks: 0 })
    expect(gotQuiet!.appliedInput.throttle).toBeCloseTo(0.6, 2)
    expect(gotBusy).toMatchObject({ seat: 10, npc: true, weapon: 'magnet', magnetTicks: 90 })
    expect(gotDriven).toMatchObject({ seat: driven.seat, npc: false, score: driven.score })
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

  it('reads and writes the modes, statuses and rules a game goes by', () => {
    expect(modeOf(modeCode('race'))).toBe('race')
    expect(modeOf(modeCode('free'))).toBe('free')
    expect(modeOf(9)).toBeNull()
    for (const status of ['open', 'preparing', 'starting', 'racing', 'finished'] as const) expect(statusOf(statusCode(status))).toBe(status)
    expect(statusOf(9)).toBeNull()
    expect(rulesOf(flagsOf({ ...options, weapons: true, bananas: true }))).toEqual({ weapons: true, bananas: true })
    expect(rulesOf(flagsOf({ ...options, weapons: false, bananas: true }))).toEqual({ weapons: false, bananas: true })
    expect(flagsOf({ ...options, weapons: true, bananas: false })).toBe(1)
  })

  it('refuses anything the wrong shape', () => {
    expect(decodeHello(new Uint8Array(0))).toBeNull()
    expect(decodeHello(encodeHello('sportsCar', 1, 2).subarray(0, 3))).toBeNull()
    expect(decodeWelcome(encodeHello('sportsCar', 1, 2))).toBeNull()
    expect(decodeInput(encodeInput(1, snapshot.vehicles[0]!.appliedInput).subarray(0, 10), { ...snapshot.vehicles[0]!.appliedInput })).toBeNull()
    expect(decodeSnapshot(encodeSnapshot(snapshot).subarray(0, SNAPSHOT_HEADER_BYTES + 3))).toBeNull()

    // An unknown vehicle profile is not guessed at.
    const badProfile = encodeSnapshot({ ...snapshot, race: null })
    badProfile[SNAPSHOT_HEADER_BYTES + 2] = 200
    expect(decodeSnapshot(badProfile)).toBeNull()

    const wrongType = encodeInput(1, snapshot.vehicles[0]!.appliedInput)
    wrongType[0] = CLIENT_INPUT + 40
    expect(decodeInput(wrongType, { ...snapshot.vehicles[0]!.appliedInput })).toBeNull()

    // One message is never read as another.
    expect(messageTypeOf(encodeGames([]))).not.toBe(messageTypeOf(encodeGame(view, 0, 0)))
    expect(decodeGames(encodeGame(view, 0, 0))).toBeNull()
    expect(decodeGame(encodeGames([]))).toBeNull()
    expect(decodeRacePlan(encodeGame(view, 0, 0))).toBeNull()
    expect(decodeStandings(encodeLobbyWelcome({ challenge: '', signedIn: '' }))).toBeNull()
    expect(decodeLobbyWelcome(encodeStandings([]))).toBeNull()
  })

  it('carries a signed answer to the challenge over, and who the server has taken it to be back', () => {
    const secret = newSecretKey()
    const event = signEvent(authTemplate(newChallenge(), publicKeyOf(secret), 1_800_000_000), secret)
    expect(decodeAuth(encodeAuth(event))).toEqual(event)
    expect(decodeSignedIn(encodeSignedIn({ pubkey: event.pubkey, earned: 42 }))).toEqual({ pubkey: event.pubkey, earned: 42 })
  })
})

/**
 * A fingerprint of a run of bytes: the same bytes always give the same
 * number, and one byte changed in a thousand gives another.
 */
function fingerprint(bytes: Uint8Array): number {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

describe('wire bytes', () => {
  it('keeps the bytes of every message where they were, as the clients in the wild read them', () => {
    // A message that changes shape takes a new `PROTOCOL_VERSION` with it, never a quiet edit of one of these.
    const lobbyBytes = encodeLobby({ players: [{ seat: 0, name: 'Ada' }, { seat: 3, name: 'Zoë ✨' }, { seat: 4, name: '' }] })
    const gamesBytes = encodeGames([
      { id: 1, seed: 4_000_000_001, mode: 'race', status: 'open', host: 'Ada', humans: 3, slots: 4, leader: 0, demo: false },
    ])
    const roomBytes = encodeGame(view, view.you, view.drivePass)
    const planBytes = encodeRacePlan(plan)
    const standingsBytes = encodeStandings([{ place: 1, name: 'Ada', vehicle: 'pickup', seconds: 93, dnf: false, bot: false }])
    const fullBytes = encodeSnapshot(snapshot)
    const changesBytes = encodeSnapshot({ ...snapshot, full: false, pickups: [], loose: [], removed: [], rockets: [], props: [] })
    expect([lobbyBytes, gamesBytes, roomBytes, planBytes, standingsBytes, fullBytes, changesBytes].map(fingerprint)).toEqual([
      2879811925, 885305893, 4247210214, 4060262060, 2328184866, 3503868358, 2839255302,
    ])
  })
})

describe('proving a nostr key', () => {
  const secret = newSecretKey()
  const pubkey = publicKeyOf(secret)
  const challenge = newChallenge()
  const now = 1_800_000_000
  const answer = signEvent(authTemplate(challenge, pubkey, now), secret)

  it('believes a fresh event signed by the key, naming the challenge', () => {
    expect(verifyAuth(answer, challenge, now + 5)).toBe(pubkey)
  })

  it('believes nothing else: another challenge, a stale or forged event, another key, or not an event at all', () => {
    expect(verifyAuth(answer, newChallenge(), now)).toBeNull()
    expect(verifyAuth(answer, challenge, now + 3600)).toBeNull()
    expect(verifyAuth({ ...answer, content: 'changed' }, challenge, now)).toBeNull()
    expect(verifyAuth({ ...answer, kind: 1 }, challenge, now)).toBeNull()
    const other = newSecretKey()
    expect(verifyAuth({ ...answer, pubkey: publicKeyOf(other) }, challenge, now)).toBeNull()
    expect(verifyAuth({ ...answer, sig: signEvent(authTemplate(challenge, pubkey, now), other).sig }, challenge, now)).toBeNull()
    expect(verifyAuth('nope', challenge, now)).toBeNull()
    expect(verifyAuth(null, challenge, now)).toBeNull()
  })
})
