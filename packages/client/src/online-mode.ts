import {
  FIXED_TIMESTEP,
  GOAL_PRIZE,
  NEUTRAL_INPUT,
  OWN_ACTIONS,
  VEHICLE_PROFILE_LABELS,
  createArena,
  goalProgress,
  takeSeat,
  type Goal,
  type GoalRequest,
  type Robot,
  type Seat,
  type Spider,
  type Ufo,
  type VehicleProfileId,
} from '@buggies/game'
import { LocalPrediction, NetClient } from '@buggies/net'
import type { Vec3 } from '@buggies/physics'
import { mapExtent, sampleHeight, type TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import { ArenaView } from './arena-view.ts'
import type { Sound } from './audio.ts'
import { aimPointOf, hookPointOf } from './car-presence.ts'
import { seatColor } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { cameraBounds } from './driver-hud.ts'
import type { HudState } from './hud.ts'
import { Keyboard } from './input.ts'
import type { DriverKeys } from './keys.ts'
import { MirrorCars } from './mirror-cars.ts'
import { PredictedCar } from './predicted-car.ts'
import type { RadarBlip, RadarState } from './radar.ts'
import { SUN_DISTANCE } from './sun.ts'
import { WebSocketClientTransport } from './ws-transport.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

/** The color a spot played for is marked in, on the mini-map and over the island. */
const GOAL_COLOR = 0xffd24a
/** How tall the beacon over a spot played for stands, and how wide. */
const BEACON_HEIGHT = 160
const BEACON_RADIUS = 3
/** How long a goal reached is told of, in seconds. */
const GOAL_WON_SECONDS = 5

/** The colors the robots, the cars nobody drives, the saucers and the spiders are marked in on the mini-map. */
const ROBOT_COLOR = 0xff3030
const NPC_COLOR = 0x9aa0a6
const UFO_COLOR = 0x5cff8a
const SPIDER_COLOR = 0xc15cff

/** The mini-map from a seat: where it is and faces, every other occupied seat, the robots, and the spot it is playing for. */
function radarOf(own: Seat, seats: readonly Seat[], robots: readonly Robot[], ufos: readonly Ufo[], spiders: readonly Spider[]): RadarState {
  const others: RadarBlip[] = []
  for (const seat of seats) {
    if (seat.id === own.id || !seat.occupied) continue
    const { x, z } = seat.vehicle.frame.position
    others.push({ x, z, color: seat.npc ? NPC_COLOR : seatColor(seat.id) })
  }
  for (const robot of robots) others.push({ x: robot.position.x, z: robot.position.z, color: ROBOT_COLOR })
  for (const ufo of ufos) others.push({ x: ufo.position.x, z: ufo.position.z, color: UFO_COLOR })
  for (const spider of spiders) others.push({ x: spider.position.x, z: spider.position.z, color: SPIDER_COLOR })
  if (own.goal?.kind === 'location') others.push({ x: own.goal.x, z: own.goal.z, color: GOAL_COLOR })
  return { position: own.vehicle.frame.position, forward: own.vehicle.frame.forward, others }
}

/** How a goal is coming along, in a line. */
function goalLine(seat: Seat, goal: Goal): string {
  const progress = goalProgress(seat, goal)
  if (goal.kind === 'location') return `Goal: ${Math.round(progress)} m to the spot`
  const done = Math.min(Math.max(progress, 0), goal.target)
  return `Goal: ${done} / ${goal.target} ${goal.kind === 'score' ? 'bananas' : goal.kind === 'kills' ? 'wrecks' : 'robots'}`
}

/** A column of light standing over a spot, to be seen from anywhere on the island. */
function buildBeacon(): THREE.Mesh {
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 16, 1, true).translate(0, BEACON_HEIGHT / 2, 0),
    new THREE.MeshBasicMaterial({ color: GOAL_COLOR, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  )
  beacon.visible = false
  return beacon
}

/** Someone to put on the server: in what, and on which keys. */
export interface OnlinePlayer {
  profile: VehicleProfileId
  keys: DriverKeys
}

/** One player's connection, car and camera. */
export interface OnlineView {
  /** Everything this view draws, to be hidden while another view of the same scene is drawn. */
  readonly root: THREE.Group
  readonly camera: THREE.PerspectiveCamera
  readonly seat: number
  /** Where the play is: the car. */
  readonly focus: Vec3
  resize(aspect: number): void
  update(dt: number, active: boolean): void
  /** The mirror's tick: the game's time, the same on every mirror. */
  readonly tick: number
  hud(): HudState
  /** Swap into another vehicle where the car is, keeping the seat and its bananas. */
  changeVehicle(profile: VehicleProfileId): void
  /** The island being played. */
  readonly map: TerrainMap
  /** The goal being played for, as the server last said, if any. */
  goal(): Goal | null
  /** Play for this goal, or for none. */
  setGoal(goal: GoalRequest | null): void
  dispose(): void
}

/**
 * Join the server's room for an island and drive on it with whoever else is
 * there. The server has the last word on which island, so the map is asked
 * for once it has said: `mapFor` is asked for it then. `locals` are the
 * seats of everyone on this screen, kept between views so that a player
 * beside you is not also heard as a stranger in the distance.
 */
export async function joinOnline(
  scene: THREE.Scene,
  url: string,
  seed: number,
  player: OnlinePlayer,
  locals: Set<number>,
  mapFor: (seed: number) => Promise<TerrainMap>,
  sound: Sound,
): Promise<OnlineView> {
  let lost: string | null = null
  const client = new NetClient(new WebSocketClientTransport(url), () => performance.now(), {
    onClosed: (reason) => {
      lost = reason
    },
  })
  const welcome = await client.connect(player.profile, seed)
  locals.add(welcome.seat)
  const map = await mapFor(welcome.seed)

  // A mirror of the server's arena: same map, same seats, so the local car
  // can be driven here the instant a key goes down.
  const mirror = createArena(map)
  takeSeat(mirror, welcome.seat, welcome.profile)
  const prediction = new LocalPrediction(mirror, welcome.seat, welcome.epoch, client.startTick, client.bananas)

  const root = new THREE.Group()
  scene.add(root)
  const keyboard = new Keyboard(player.keys.bindings)
  // The island around the cars, heard from the local car.
  const arena = new ArenaView(prediction, sound, () => prediction.vehicle.frame.position, map)
  root.add(arena.object)
  const car = new PredictedCar(prediction, (tick, input) => client.sendInput(tick, input), seatColor(welcome.seat), arena.effects)
  root.add(car.object)
  // A player beside you is seen from here, but heard from their own view.
  const others = new MirrorCars(prediction, welcome.seat, arena.effects, (seat) => locals.has(seat))
  root.add(others.object)

  const cameraTuning = createCameraTuning()
  // Far enough to take in the whole island, and the sun beyond it.
  cameraTuning.far = Math.max(Math.max(mapExtent(map).x, mapExtent(map).z) * 2, SUN_DISTANCE * 1.5)
  const chase = new ChaseCamera(cameraTuning)
  chase.setBoundsAt(cameraBounds(map))
  const target = createChaseTarget()

  const onKey = (event: KeyboardEvent): void => {
    if (player.keys.respawn(event)) client.requestRespawn()
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  let chaseSnapped = false
  // A goal reached: how many the server has counted, and how much longer that is told of.
  let goalsWon = prediction.ownSeat.goalsWon
  let wonFor = 0
  const beacon = buildBeacon()
  root.add(beacon)

  return {
    root,
    camera: chase.camera,
    seat: welcome.seat,
    get focus() {
      return prediction.vehicle.frame.position
    },
    get tick() {
      return prediction.tick
    },
    resize(aspect) {
      chase.camera.aspect = aspect
      chase.camera.updateProjectionMatrix()
    },
    update(dt, active) {
      // With the menu up the car is not driven, but the world does not wait:
      // the server keeps going, and so must the mirror.
      const held = active ? keyboard.read() : null
      // Nothing goes while the roll that reveals what was won is still on.
      if (held !== null && car.presence.rolling) held.fire = false
      const input = held ?? NEUTRAL_INPUT
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        if (car.tick(client.pump(input), others) === 'resynced') chaseSnapped = false
        owed -= FIXED_TIMESTEP
      }
      others.render(owed / FIXED_TIMESTEP, dt)
      car.presence.aimAt(aimPointOf(prediction.ownSeat, prediction))
      car.presence.hookAt(hookPointOf(prediction.ownSeat, prediction.seats))
      car.presence.render(owed / FIXED_TIMESTEP, dt)
      arena.update(dt)
      const own = prediction.ownSeat
      if (own.goalsWon !== goalsWon) {
        goalsWon = own.goalsWon
        wonFor = GOAL_WON_SECONDS
        sound.chime()
      }
      wonFor = Math.max(wonFor - dt, 0)
      beacon.visible = own.goal?.kind === 'location'
      if (own.goal?.kind === 'location') {
        beacon.position.set(own.goal.x, sampleHeight(map.heightfield, own.goal.x, own.goal.z), own.goal.z)
      }
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
      const controls = player.keys.controls(OWN_ACTIONS[profile].label)
      const title = `${VEHICLE_PROFILE_LABELS[profile]} | seed ${map.seed} | ${players} ${players === 1 ? 'player' : 'players'}`
      // Cut off from the server, there is nothing more to show but that, and what to do about it.
      if (lost !== null) return { title, goal: `Disconnected from the server (${lost}). Pick the island again from the menu to rejoin.` }
      const { stats } = prediction
      const sync =
        `${Math.round(stats.ticksAheadOfServer)} ticks ahead · lead ${client.leadTicks} · ` +
        `last correction ${stats.lastCorrectionMeters.toFixed(2)} m · ${stats.hardResyncs} resyncs`
      const own = prediction.ownSeat
      const goal = wonFor > 0 ? `Goal reached! +${GOAL_PRIZE} bananas` : own.goal === null ? null : goalLine(own, own.goal)
      return {
        ...car.presence.hudState(title, controls, sync),
        radar: radarOf(own, prediction.seats, prediction.robots, prediction.ufos, prediction.spiders),
        ...(goal === null ? {} : { goal, goalWon: wonFor > 0 }),
      }
    },
    changeVehicle(profile) {
      client.changeVehicle(profile)
    },
    map,
    goal() {
      return prediction.ownSeat.goal
    },
    setGoal(goal) {
      client.setGoal(goal)
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
