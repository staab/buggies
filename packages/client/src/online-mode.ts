import {
  FIXED_TIMESTEP,
  HOLD_FOREVER,
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  VEHICLE_PROFILE_LABELS,
  createArena,
  hasSiren,
  portalCrossed,
  takeSeat,
  type Robot,
  type Seat,
  type Spider,
  type Ufo,
  type VehicleInput,
  type VehicleProfileId,
} from '@buggies/game'
import { HELD, LocalPrediction, NetClient, rulesOf, type RaceRacerView } from '@buggies/net'
import type { Vec3 } from '@buggies/physics'
import { WORLD_TRAITS, alongGround, groundDistance, planetSeedOf, tangentFrame, upOf, type World } from '@buggies/terrain'
import * as THREE from 'three'

import { AchievementWatch } from './achievement-toast.ts'
import { ArenaView } from './arena-view.ts'
import { bendAround, bendMaterials } from './bend.ts'
import { aimPointOf } from './car-presence.ts'
import { seatColor } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { cameraBounds } from './driver-hud.ts'
import { GameBanners, playerTag } from './game-banners.ts'
import { playerKey } from './identity.ts'
import { Keyboard } from './input.ts'
import { SOLO_KEYS } from './keys.ts'
import { MirrorCars } from './mirror-cars.ts'
import type { ControlHint, DriveMode, FinishedRacer, GateArrow, PlayRequest, RaceHud, RadarBlip, RadarGate, RadarState } from './mode.ts'
import { PredictedCar } from './predicted-car.ts'
import { RaceView, gateLabels } from './race-view.ts'
import { SUN_DISTANCE } from './sun.ts'
import { WORLD_LOOKS } from './world-looks.ts'
import { WebSocketClientTransport } from './ws-transport.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

/**
 * How slow a finished car must be going forward, in m/s, before the brake
 * comes off and the handbrake holds it: under half a metre a second the
 * brake pedal drives a car backwards, so it is let go well before that.
 */
const PARKED_SPEED = 1

/**
 * What a car that has finished its race is driven with, whatever the player
 * holds: the brake hard on while it rolls forward, the handbrake alone once
 * it has all but stopped, and no weapon to fire. Only these two are ever
 * driven, so each is made once.
 */
const BRAKING_INPUT: VehicleInput = { steer: 0, throttle: 0, brake: 1, handbrake: false, weapon: 0, fire: false, signal: false }
const HANDBRAKE_INPUT: VehicleInput = { steer: 0, throttle: 0, brake: 0, handbrake: true, weapon: 0, fire: false, signal: false }

/** The colors the robots, the cars nobody drives, the saucers and the spiders are marked in on the mini-map. */
const ROBOT_COLOR = 0xff3030
const NPC_COLOR = 0x9aa0a6
const UFO_COLOR = 0x5cff8a
const SPIDER_COLOR = 0xc15cff

/** The mini-map as it is filled: the HUD's own state, with the blips that are moved frame by frame left open to being moved. */
interface RadarBoardState extends RadarState {
  position: { x: number; z: number }
  forward: { x: number; z: number }
  others: RadarBlip[]
  gates: RadarGate[]
}

/**
 * The mini-map from a seat: where it is and faces, every other occupied
 * seat, the robots and the course's gates, laid out on the ground round the
 * car, east across and south down, as a map is. What it fills is made once
 * and moved frame by frame: the HUD reads it as it is drawn, and nothing
 * keeps it.
 */
class RadarBoard {
  private readonly state: RadarBoardState = { position: { x: 0, z: 0 }, forward: { x: 0, z: 0 }, others: [], gates: [] }
  /** The car the map is laid round, and its ground: what every blip is placed on. */
  private from: Vec3 = { x: 0, y: 0, z: 0 }
  private up: Vec3 = { x: 0, y: 0, z: 0 }
  private east: Vec3 = { x: 0, y: 0, z: 1 }
  private north: Vec3 = { x: 0, y: 0, z: 0 }
  /** What is worked out of a point before it is a place on the map: a scratch of its own, frame after frame. */
  private readonly delta: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly toward: Vec3 = { x: 0, y: 0, z: 0 }

  /** Take the map round this seat: its car in the middle, its heading straight up. */
  read(
    own: Seat,
    seats: readonly Seat[],
    robots: readonly Robot[],
    ufos: readonly Ufo[],
    spiders: readonly Spider[],
    checkpoints: readonly { at: Vec3 }[],
    next: number,
  ): RadarState {
    const { position, forward } = own.vehicle.frame
    this.from = position
    this.up = upOf(position, this.up)
    const frame = tangentFrame(this.up)
    this.east = frame.east
    this.north = frame.north
    const state = this.state
    state.position.x = 0
    state.position.z = 0
    state.forward.x = forward.x * this.east.x + forward.y * this.east.y + forward.z * this.east.z
    state.forward.z = -(forward.x * this.north.x + forward.y * this.north.y + forward.z * this.north.z)
    let blips = 0
    for (const seat of seats) {
      if (seat.id === own.id || !seat.occupied) continue
      blips = this.addBlip(blips, seat.vehicle.frame.position, seat.npc ? NPC_COLOR : seatColor(seat.id))
    }
    for (const robot of robots) blips = this.addBlip(blips, robot.position, ROBOT_COLOR)
    for (const ufo of ufos) blips = this.addBlip(blips, ufo.position, UFO_COLOR)
    for (const spider of spiders) blips = this.addBlip(blips, spider.position, SPIDER_COLOR)
    // Whatever is not there this frame is not drawn: its blip was made by a fuller one.
    state.others.length = blips
    for (let i = 0; i < checkpoints.length; i++) {
      let gate = state.gates[i]
      if (gate === undefined) {
        gate = { x: 0, z: 0, label: String(i + 1), next: false }
        state.gates[i] = gate
      }
      this.place(checkpoints[i]!.at, gate)
      gate.next = i === next
    }
    state.gates.length = checkpoints.length
    return state
  }

  /** Put a blip of this color on the map at this place, making a place for it if the last frame had fewer. */
  private addBlip(count: number, at: Vec3, color: number): number {
    let blip = this.state.others[count]
    if (blip === undefined) {
      blip = { x: 0, z: 0, color }
      this.state.others[count] = blip
    }
    blip.color = color
    this.place(at, blip)
    return count + 1
  }

  /** A point on the ground round the car, as far from it and the same way as it is round the planet. */
  private place(at: Vec3, out: { x: number; z: number }): void {
    const from = this.from
    const delta = this.delta
    delta.x = at.x - from.x
    delta.y = at.y - from.y
    delta.z = at.z - from.z
    const toward = alongGround(delta, this.up, this.toward)
    const length = Math.sqrt(toward.x * toward.x + toward.y * toward.y + toward.z * toward.z) || 1
    const distance = groundDistance(at, from)
    out.x = ((toward.x * this.east.x + toward.y * this.east.y + toward.z * this.east.z) / length) * distance
    out.z = (-(toward.x * this.north.x + toward.y * this.north.y + toward.z * this.north.z) / length) * distance
  }
}

/**
 * The way to a gate, in radians clockwise from straight up on the screen,
 * and how far it is; nothing for a car sitting on it. The car's own heading
 * is straight up: the chase camera looks along it.
 */
function arrowTo(own: Seat, gate: Vec3, label: string): GateArrow | undefined {
  const { position, forward } = own.vehicle.frame
  const up = upOf(position)
  const { east, north } = tangentFrame(up)
  /** A way flat on the ground, as the screen has it: across to the right and down the screen. */
  const flat = (way: Vec3): { x: number; z: number } => ({
    x: way.x * east.x + way.y * east.y + way.z * east.z,
    z: -(way.x * north.x + way.y * north.y + way.z * north.z),
  })
  const toward = flat(alongGround({ x: gate.x - position.x, y: gate.y - position.y, z: gate.z - position.z }, up))
  if (Math.hypot(toward.x, toward.z) < 1e-3) return undefined
  const nose = flat({ x: forward.x, y: forward.y, z: forward.z })
  // Clockwise from up the screen, which is straight ahead of the car.
  const off = Math.atan2(toward.x, -toward.z) - Math.atan2(nose.x, -nose.z)
  return { angle: Math.atan2(Math.sin(off), Math.cos(off)), meters: groundDistance(position, gate), label }
}

/** Which world the play is on: the island by its seed, or another world by its name and its island's. */
function whereOf(map: World): string {
  const seed = planetSeedOf(map.seed)
  return map.kind === 'planet' ? `seed ${seed}` : `${WORLD_TRAITS[map.kind].name} of seed ${seed}`
}

/**
 * Join the server's room for one world of one game and drive on it with
 * whoever else is there, with the whole screen: the world drawn round the
 * car, bent as though the planet were bigger, and the sun's shadows cast
 * around it. In a race the course's gates are drawn over the roads of the
 * world, the HUD says how the race is going and an arrow points to the next
 * gate when it is out of sight; the portals this world keeps for the course
 * are the only ones it has, and the one out is followed to the next world.
 */
export async function createOnlineMode(request: PlayRequest): Promise<DriveMode> {
  const { scene, driver, sound, sun } = request
  let lost: string | null = null
  const client = new NetClient(
    new WebSocketClientTransport(request.url),
    () => performance.now(),
    {
      onClosed: (reason) => {
        lost = reason
      },
    },
    playerKey(),
  )
  const welcome = await client.connect(driver.profile, request.world, request.game, request.arrival, driver.pass, driver.name)
  // A race's gates and the portals its world keeps come with the welcome; a free drive builds the world whole.
  const plan = await client.racePlan()
  const map = await request.mapFor(welcome.seed, plan?.keep ?? null)
  // A mirror of the server's arena: the same map, the same rules, the same
  // seats, so the local car can be driven here the instant a key goes down.
  const mirror = createArena(map, MAX_PLAYERS, rulesOf(welcome.flags))
  takeSeat(mirror, welcome.seat, welcome.profile)
  const prediction = new LocalPrediction(mirror, welcome.seat, welcome.epoch, client.startTick(), client.bananas)

  const root = new THREE.Group()
  scene.add(root)
  const keyboard = new Keyboard(SOLO_KEYS.bindings)
  // The world around the cars, heard from the local car.
  const arena = new ArenaView(prediction, sound, () => prediction.vehicle.frame.position, mirror.planet)
  root.add(arena.object)
  const car = new PredictedCar(prediction, (tick, input) => client.sendInput(tick, input), seatColor(welcome.seat), arena.effects)
  root.add(car.object)
  const others = new MirrorCars(prediction, welcome.seat, arena.effects)
  root.add(others.object)
  // The course's gates, bright on the one to head for and faint on the one after it.
  const gates = plan === null ? null : new RaceView(map, plan.checkpoints, plan.exit === null)
  if (gates !== null) root.add(gates.object)

  const cameraTuning = createCameraTuning()
  // Far enough to take in the whole world, and the sun beyond it.
  cameraTuning.far = Math.max(4 * Math.PI * mirror.planet.radius, SUN_DISTANCE * 1.5)
  const chase = new ChaseCamera(cameraTuning)
  chase.setBoundsAt(cameraBounds(mirror.planet))
  const target = createChaseTarget()

  const onKey = (event: KeyboardEvent): void => {
    // A car that is home stays where it stopped: no respawn for a race already done.
    if (came === null && SOLO_KEYS.respawn(event)) client.requestRespawn()
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  /**
   * How the car's own race ended, noted the once as it crosses the line:
   * where it came, out of how many in all, and the race's clock then.
   */
  let came: { place: number; of: number; ticks: number } | null = null
  // Where the car was before each tick, and the portal it has driven through since last asked.
  const from = { x: 0, y: 0, z: 0 }
  let crossed = -1
  let chaseSnapped = false
  /** What a seat goes by: the name its player gave, or else its tag. */
  const nameOf = (seat: number): string => client.lobby().players.find((player) => player.seat === seat)?.name || playerTag(welcome.seed, seat)
  // The big words for a race starting or over.
  const banners = new GameBanners(welcome.seed, sound, nameOf)
  // A feat paid for, told of at the top of the screen.
  const achievements = new AchievementWatch(sound)

  /** The racer this car is in the race, as the server last said, if this world is one of its course's. */
  const ownRacer = (): RaceRacerView | undefined => {
    const race = prediction.race
    if (race === null) return undefined
    const seat = prediction.ownSeat.id
    for (const racer of race.racers) {
      if (racer.seat === seat) return racer
    }
    return undefined
  }

  /** Note the moment the car comes home, if it has: where it came, out of how many, and the race's clock then. */
  const noteFinish = (): void => {
    if (came !== null) return
    const race = prediction.race
    const racer = ownRacer()
    if (race === null || racer === undefined || !racer.finished || racer.place <= 0) return
    came = { place: racer.place, of: Math.max(race.racing, racer.place), ticks: Math.max(race.elapsed, 0) }
  }

  /** The racers home so far in this world, in the order they came, the car's own left out: the celebration says where it came itself. */
  const home = { placed: -1, racers: [] as FinishedRacer[] }
  const homeNow = (): readonly FinishedRacer[] => {
    const race = prediction.race
    if (race === null) return home.racers
    // Only as they come home does the list change, and it is asked for every frame the celebration is up.
    let placed = 0
    for (const racer of race.racers) {
      if (racer.finished && racer.place > 0) placed += 1
    }
    if (placed === home.placed) return home.racers
    home.placed = placed
    home.racers = race.racers
      .filter((racer) => racer.finished && racer.place > 0 && racer.seat !== prediction.ownSeat.id)
      .sort((one, other) => one.place - other.place)
      .map((racer) => ({ place: racer.place, name: nameOf(racer.seat) }))
    return home.racers
  }

  /**
   * The mirror is held still whenever the server holds its cars: through the
   * wait for every racer to be on the grid, and through the 3-2-1 after it.
   * A race's world holds its cars from the first frame, before the server's
   * word has come, so that the car cannot creep off the grid unladen.
   */
  const holdMirror = (): void => {
    const race = prediction.race
    if (race === null) mirror.holdUntil = plan === null ? 0 : HOLD_FOREVER
    else if (race.elapsed > 0) mirror.holdUntil = 0
    else mirror.holdUntil = race.elapsed === HELD ? HOLD_FOREVER : mirror.tick - race.elapsed
  }

  /** How the race is going for the car, for the HUD, or nothing in a free drive or before the server has said. */
  const raceHud = (): RaceHud | undefined => {
    const race = prediction.race
    const racer = ownRacer()
    if (plan === null || race === null || racer === undefined) return undefined
    return {
      place: Math.max(racer.place, 1),
      of: Math.max(race.racing, racer.place, 1),
      checkpoint: racer.checkpoint,
      ofCheckpoints: plan.checkpoints.length,
      world: plan.world,
      ofWorlds: plan.ofWorlds,
      seconds: Math.max(race.elapsed, 0) * FIXED_TIMESTEP,
    }
  }

  /** What each of this world's gates is called, on its sign and on the compass. */
  const labels = plan === null ? [] : gateLabels(plan.checkpoints.length, plan.exit === null)

  /** This world's gates, as the mini-map has them, and the one to head for next. */
  const radar = new RadarBoard()

  /** What the title over the HUD says, and the keys under it: the same frame after frame until the car or the company changes. */
  let heading: { profile: VehicleProfileId; players: number; title: string; controls: readonly ControlHint[] } | null = null
  const headingNow = (profile: VehicleProfileId, players: number): { title: string; controls: readonly ControlHint[] } => {
    if (heading !== null && heading.profile === profile && heading.players === players) return heading
    heading = {
      profile,
      players,
      title: `${nameOf(welcome.seat)} · ${VEHICLE_PROFILE_LABELS[profile]} | ${whereOf(map)} | ${players} ${players === 1 ? 'player' : 'players'}`,
      // The keys, told with what this car does of its own.
      controls: SOLO_KEYS.controls(hasSiren(profile) ? 'siren' : 'horn'),
    }
    return heading
  }

  return {
    camera: chase.camera,
    // The game's time, the same on every mirror, so the day, the boats and the clouds are where they are for everyone.
    tick: () => prediction.tick,
    render(renderer) {
      const { frame, up } = prediction.vehicle
      sun.follow(frame.position, up)
      sun.shade(scene, WORLD_LOOKS[map.kind].skies)
      bendMaterials(scene)
      bendAround(frame.position, map.radius)
      renderer.render(scene, chase.camera)
      bendAround(null)
    },
    resize(aspect) {
      chase.camera.aspect = aspect
      chase.camera.updateProjectionMatrix()
    },
    update(dt, active) {
      // With a screen up over the top the car is not driven, but the world
      // does not wait: the server keeps going, and so must the mirror. A car
      // that is home is never driven again, whatever keys are held: it brakes
      // to a stop past the line and sits there while the others come in.
      const racing = came === null
      const held = active && racing ? keyboard.read() : null
      const input = held ?? (racing ? NEUTRAL_INPUT : prediction.ownSeat.vehicle.forwardSpeed > PARKED_SPEED ? BRAKING_INPUT : HANDBRAKE_INPUT)
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        holdMirror()
        const before = prediction.ownSeat.vehicle.frame.position
        from.x = before.x
        from.y = before.y
        from.z = before.z
        if (car.tick(client.pump(input), others) === 'resynced') chaseSnapped = false
        else if (crossed < 0) crossed = portalCrossed(map, from, prediction.ownSeat.vehicle.frame.position)
        arena.captureStep()
        noteFinish()
        owed -= FIXED_TIMESTEP
      }
      others.render(owed / FIXED_TIMESTEP, dt)
      car.presence.aimAt(aimPointOf(prediction.ownSeat, prediction))
      car.presence.render(owed / FIXED_TIMESTEP, dt)
      arena.update(dt, owed / FIXED_TIMESTEP)
      const own = prediction.ownSeat
      const { race } = prediction
      gates?.show(ownRacer()?.checkpoint ?? 0)
      banners.update(dt, { own, seats: prediction.seats, race, standings: client.standings() })
      achievements.update(dt, own, client.playerCount() > 0)
      car.presence.aim(target)
      if (chaseSnapped) chase.update(dt, target)
      else {
        chase.snapTo(target)
        chaseSnapped = true
      }
    },
    hud() {
      // Those driving here, not the cars nobody drives.
      const players = Math.max(client.lobby().players.length, 1)
      const { profile } = prediction.ownSeat
      const { title, controls } = headingNow(profile, players)
      // Cut off from the server, there is nothing more to show but that: the shell is on its way back.
      if (lost !== null) return { title, game: `Disconnected from the server (${lost}). Reconnecting...` }
      const { stats } = prediction
      const sync =
        `${Math.round(stats.ticksAheadOfServer)} ticks ahead · lead ${client.leadTicks()} · ` +
        `last correction ${stats.lastCorrectionMeters.toFixed(2)} m · ${stats.hardResyncs} resyncs`
      const own = prediction.ownSeat
      const racer = ownRacer()
      const nextGate = plan === null || racer === undefined ? undefined : plan.checkpoints[racer.checkpoint]
      const arrow = nextGate === undefined || racer === undefined ? undefined : arrowTo(own, nextGate.at, labels[racer.checkpoint] ?? '')
      const banner = banners.state()
      const achievement = achievements.state()
      const block = raceHud()
      return {
        ...car.presence.hudState(title, controls, sync),
        radar: radar.read(own, prediction.seats, prediction.robots, prediction.ufos, prediction.spiders, plan?.checkpoints ?? [], racer?.checkpoint ?? 0),
        ...(block === undefined ? {} : { race: block }),
        ...(arrow === undefined ? {} : { arrow }),
        ...(banner === undefined ? {} : { banner }),
        ...(achievement === undefined ? {} : { achievement }),
      }
    },
    portal() {
      // In a race the world's only portals are the course's, and the way on is `trip`, once the exit is the next gate.
      if (plan !== null) return -1
      const through = crossed
      crossed = -1
      return through
    },
    trip() {
      if (plan === null || plan.next === null || crossed < 0) return null
      const through = crossed
      crossed = -1
      // Only the gate out of this world leads on, and only once every gate before it has been passed.
      if (plan.exit === null || through !== plan.exit) return null
      const racer = ownRacer()
      if (racer === undefined || racer.checkpoint < plan.checkpoints.length - 1) return null
      return { to: plan.next.world, arrival: plan.next.arrival }
    },
    standings() {
      return client.standings()
    },
    finished() {
      if (came === null) return null
      return { place: came.place, of: came.of, ticks: came.ticks, home: homeNow() }
    },
    lost() {
      return lost
    },
    dispose() {
      window.removeEventListener('keydown', onKey)
      keyboard.dispose()
      client.close('left')
      others.dispose()
      car.dispose()
      arena.dispose()
      gates?.dispose()
      scene.remove(root)
    },
  }
}
