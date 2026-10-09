import {
  FIXED_TIMESTEP,
  GAME_LABELS,
  NEUTRAL_INPUT,
  NOT_RACING,
  VEHICLE_PROFILE_LABELS,
  hasSiren,
  createArena,
  gameProgress,
  lapOf,
  nextMark,
  portalCrossed,
  takeSeat,
  type Game,
  type Race,
  type Robot,
  type Seat,
  type Spider,
  type Ufo,
  type VehicleProfileId,
} from '@buggies/game'
import { LocalPrediction, NO_ARRIVAL, NO_PASS, NetClient } from '@buggies/net'
import type { Vec3 } from '@buggies/physics'
import { alongGround, groundDistance, overSurface, tangentFrame, upOf, type World } from '@buggies/terrain'
import * as THREE from 'three'

import { ArenaView } from './arena-view.ts'
import type { Sound } from './audio.ts'
import { bendAround, bendMaterials } from './bend.ts'
import { aimPointOf } from './car-presence.ts'
import { seatColor } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { cameraBounds } from './driver-hud.ts'
import { GameBanners, playerTag } from './game-banners.ts'
import { Keyboard } from './input.ts'
import { SOLO_KEYS } from './keys.ts'
import type { ModeView } from './mode.ts'
import { MirrorCars } from './mirror-cars.ts'
import { PredictedCar } from './predicted-car.ts'
import type { RadarBlip, RadarState } from './radar.ts'
import { standOn } from './stand.ts'
import { SUN_DISTANCE, type Sun } from './sun.ts'
import { WebSocketClientTransport } from './ws-transport.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

/** The color a race's next mark is marked in, on the mini-map and over the island. */
const MARK_COLOR = 0xffd24a
/** How tall the beacon over a race's next mark stands, and how wide. */
const BEACON_HEIGHT = 160
const BEACON_RADIUS = 3
/** The colors the robots, the cars nobody drives, the saucers and the spiders are marked in on the mini-map. */
const ROBOT_COLOR = 0xff3030
const NPC_COLOR = 0x9aa0a6
const UFO_COLOR = 0x5cff8a
const SPIDER_COLOR = 0xc15cff

/**
 * The mini-map from a seat: where it is and faces, every other occupied
 * seat, the robots, and the race's next mark for it, laid out on the
 * ground round the car, east across and south down, as a map is.
 */
function radarOf(own: Seat, seats: readonly Seat[], robots: readonly Robot[], ufos: readonly Ufo[], spiders: readonly Spider[], race: Race | null, radius: number): RadarState {
  const { position, forward } = own.vehicle.frame
  const { east, north } = tangentFrame(upOf(position))
  /** A point on the ground round the car, as far from it and the same way as it is round the planet. */
  const onRadar = (at: Vec3, color: number): RadarBlip => {
    const toward = alongGround({ x: at.x - position.x, y: at.y - position.y, z: at.z - position.z }, upOf(position))
    const length = Math.sqrt(toward.x * toward.x + toward.y * toward.y + toward.z * toward.z) || 1
    const distance = groundDistance(at, position)
    return { x: ((toward.x * east.x + toward.y * east.y + toward.z * east.z) / length) * distance, z: (-(toward.x * north.x + toward.y * north.y + toward.z * north.z) / length) * distance, color }
  }
  const others: RadarBlip[] = []
  for (const seat of seats) {
    if (seat.id === own.id || !seat.occupied) continue
    others.push(onRadar(seat.vehicle.frame.position, seat.npc ? NPC_COLOR : seatColor(seat.id)))
  }
  for (const robot of robots) others.push(onRadar(robot.position, ROBOT_COLOR))
  for (const ufo of ufos) others.push(onRadar(ufo.position, UFO_COLOR))
  for (const spider of spiders) others.push(onRadar(spider.position, SPIDER_COLOR))
  const mark = race === null ? null : nextMark(own, race)
  if (mark !== null) others.push(onRadar({ x: mark.x * radius, y: mark.y * radius, z: mark.z * radius }, MARK_COLOR))
  return {
    position: { x: 0, z: 0 },
    forward: { x: forward.x * east.x + forward.y * east.y + forward.z * east.z, z: -(forward.x * north.x + forward.y * north.y + forward.z * north.z) },
    others,
  }
}

/** How a count is coming along, in a line. */
function countLine(seat: Seat, game: Game): string {
  const done = Math.min(Math.max(gameProgress(seat, game), 0), game.target)
  return `${GAME_LABELS[game.kind]}: ${done} / ${game.target} ${game.kind === 'score' ? 'bananas' : game.kind === 'kills' ? 'wrecks' : 'robots'}`
}

/** How a race is going for a seat, in a line: how far to which mark, and how long it has been on. */
function raceLine(seat: Seat, race: Race, tick: number, radius: number): string {
  const mark = nextMark(seat, race)
  if (mark === null) return 'A race is on.'
  const meters = Math.round(groundDistance(seat.vehicle.frame.position, { x: mark.x * radius, y: mark.y * radius, z: mark.z * radius }))
  const checkpoints = race.course.length - 2
  const along = seat.racePassed % race.course.length
  const toward = along === 0 ? 'the start' : along === race.course.length - 1 ? 'the finish' : `checkpoint ${along} of ${checkpoints}`
  const lap = race.laps === 1 ? '' : ` · lap ${lapOf(seat, race)} of ${race.laps}`
  const seconds = Math.max(Math.floor((tick - race.startTick) * FIXED_TIMESTEP), 0)
  return `Race: ${meters} m to ${toward}${lap} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A column of light standing over a spot, to be seen from anywhere on the island. */
function buildBeacon(): THREE.Mesh {
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 16, 1, true).translate(0, BEACON_HEIGHT / 2, 0),
    new THREE.MeshBasicMaterial({ color: MARK_COLOR, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  )
  beacon.visible = false
  return beacon
}

/**
 * Join the server's room for an island and drive on it with whoever else is
 * there, with the whole screen: the island drawn round the car, bent as
 * though the planet were bigger, and the sun's shadows cast around it. The
 * server has the last word on which island, so the map is asked for once it
 * has said: `mapFor` is asked for it then.
 */
export async function createOnlineMode(
  scene: THREE.Scene,
  url: string,
  seed: number,
  profile: VehicleProfileId,
  mapFor: (seed: number) => Promise<World>,
  sound: Sound,
  sun: Sun,
  arrival = NO_ARRIVAL,
  pass = NO_PASS,
): Promise<ModeView> {
  let lost: string | null = null
  const client = new NetClient(new WebSocketClientTransport(url), () => performance.now(), {
    onClosed: (reason) => {
      lost = reason
    },
  })
  const welcome = await client.connect(profile, seed, arrival, pass)
  const map = await mapFor(welcome.seed)
  // A mirror of the server's arena: same map, same seats, so the local car
  // can be driven here the instant a key goes down.
  const mirror = createArena(map)
  takeSeat(mirror, welcome.seat, welcome.profile)
  const prediction = new LocalPrediction(mirror, welcome.seat, welcome.epoch, client.startTick, client.bananas)

  const root = new THREE.Group()
  scene.add(root)
  const keyboard = new Keyboard(SOLO_KEYS.bindings)
  // The island around the cars, heard from the local car.
  const arena = new ArenaView(prediction, sound, () => prediction.vehicle.frame.position, mirror.planet)
  root.add(arena.object)
  const car = new PredictedCar(prediction, (tick, input) => client.sendInput(tick, input), seatColor(welcome.seat), arena.effects)
  root.add(car.object)
  const others = new MirrorCars(prediction, welcome.seat, arena.effects)
  root.add(others.object)

  const cameraTuning = createCameraTuning()
  // Far enough to take in the whole island, and the sun beyond it.
  cameraTuning.far = Math.max(4 * Math.PI * mirror.planet.radius, SUN_DISTANCE * 1.5)
  const chase = new ChaseCamera(cameraTuning)
  chase.setBoundsAt(cameraBounds(mirror.planet))
  const target = createChaseTarget()

  const onKey = (event: KeyboardEvent): void => {
    if (SOLO_KEYS.respawn(event)) client.requestRespawn()
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  // Where the car was before each tick, and the portal it has driven through since last asked.
  const from = { x: 0, y: 0, z: 0 }
  let crossed = -1
  let chaseSnapped = false
  // The big words for a game starting or over.
  const banners = new GameBanners(welcome.seed, sound)
  // How far along the race the car was, for a mark passed to be heard.
  let racePassed = prediction.ownSeat.racePassed
  const beacon = buildBeacon()
  root.add(beacon)

  return {
    camera: chase.camera,
    // The game's time, the same on every mirror, so the day, the boats and the clouds are where they are for everyone.
    get tick() {
      return prediction.tick
    },
    pass: () => welcome.pass,
    position: () => prediction.vehicle.frame.position,
    render(renderer) {
      const { frame, up } = prediction.vehicle
      sun.follow(frame.position, up)
      sun.shade(scene, map.kind === 'moon')
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
      // With the menu up the car is not driven, but the world does not wait:
      // the server keeps going, and so must the mirror.
      const held = active ? keyboard.read() : null
      const input = held ?? NEUTRAL_INPUT
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        const before = prediction.ownSeat.vehicle.frame.position
        from.x = before.x
        from.y = before.y
        from.z = before.z
        if (car.tick(client.pump(input), others) === 'resynced') chaseSnapped = false
        else if (crossed < 0) crossed = portalCrossed(map, from, prediction.ownSeat.vehicle.frame.position)
        arena.captureStep()
        owed -= FIXED_TIMESTEP
      }
      others.render(owed / FIXED_TIMESTEP, dt)
      car.presence.aimAt(aimPointOf(prediction.ownSeat, prediction))
      car.presence.render(owed / FIXED_TIMESTEP, dt)
      arena.update(dt, owed / FIXED_TIMESTEP)
      const own = prediction.ownSeat
      const { race } = prediction
      if (own.racePassed > racePassed && racePassed !== NOT_RACING) sound.chime()
      racePassed = own.racePassed
      banners.update(dt, { own, seats: prediction.seats, race, tick: prediction.tick })
      const mark = race === null ? null : nextMark(own, race)
      beacon.visible = mark !== null
      if (mark !== null) standOn(beacon, overSurface(mirror.planet, mark, 0))
      car.presence.aim(target)
      if (chaseSnapped) chase.update(dt, target)
      else {
        chase.snapTo(target)
        chaseSnapped = true
      }
    },
    hud() {
      const players = client.playerCount
      const { profile } = prediction.ownSeat
      // The keys, told with what this car does of its own.
      const controls = SOLO_KEYS.controls(hasSiren(profile) ? 'siren' : 'horn')
      const title = `${playerTag(welcome.seed, welcome.seat)} · ${VEHICLE_PROFILE_LABELS[profile]} | seed ${map.seed} | ${players} ${players === 1 ? 'player' : 'players'}`
      // Cut off from the server, there is nothing more to show but that: the shell is on its way back.
      if (lost !== null) return { title, game: `Disconnected from the server (${lost}). Reconnecting...` }
      const { stats } = prediction
      const sync =
        `${Math.round(stats.ticksAheadOfServer)} ticks ahead · lead ${client.leadTicks} · ` +
        `last correction ${stats.lastCorrectionMeters.toFixed(2)} m · ${stats.hardResyncs} resyncs`
      const own = prediction.ownSeat
      const { race } = prediction
      const banner = banners.state()
      const lines = [
        ...(race === null ? [] : [raceLine(own, race, prediction.tick, mirror.planet.radius)]),
        ...(own.game === null ? [] : [countLine(own, own.game)]),
      ]
      return {
        ...car.presence.hudState(title, controls, sync),
        radar: radarOf(own, prediction.seats, prediction.robots, prediction.ufos, prediction.spiders, race, mirror.planet.radius),
        ...(lines.length === 0 ? {} : { game: lines.join('\n') }),
        ...(banner === undefined ? {} : { banner }),
      }
    },
    changeVehicle(profile) {
      client.changeVehicle(profile)
    },
    map,
    game() {
      return prediction.ownSeat.game
    },
    race() {
      const { race } = prediction
      return race === null ? null : { race, mine: welcome.seat === race.starter }
    },
    setGame(game) {
      client.setGame(game)
    },
    portal() {
      const through = crossed
      crossed = -1
      return through
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
      beacon.geometry.dispose()
      ;(beacon.material as THREE.Material).dispose()
      scene.remove(root)
    },
  }
}
