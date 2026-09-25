import {
  FIXED_TIMESTEP,
  NEUTRAL_INPUT,
  OWN_ACTIONS,
  VEHICLE_PROFILE_LABELS,
  createArena,
  takeSeat,
  type VehicleProfileId,
} from '@buggies/game'
import { LocalPrediction, NetClient } from '@buggies/net'
import type { Vec3 } from '@buggies/physics'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import { ArenaView } from './arena-view.ts'
import type { Sound } from './audio.ts'
import { aimPointOf } from './car-presence.ts'
import { seatColor } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { cameraBounds } from './driver-hud.ts'
import type { HudState } from './hud.ts'
import { Keyboard } from './input.ts'
import type { DriverKeys } from './keys.ts'
import { MirrorCars } from './mirror-cars.ts'
import { PredictedCar } from './predicted-car.ts'
import { SUN_DISTANCE } from './sun.ts'
import { WebSocketClientTransport } from './ws-transport.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

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
  const arena = new ArenaView(prediction, sound, () => prediction.vehicle.frame.position)
  root.add(arena.object)
  const car = new PredictedCar(prediction, (tick, input) => client.sendInput(tick, input), seatColor(welcome.seat), arena.effects)
  root.add(car.object)
  // A player beside you is seen from here, but heard from their own view.
  const others = new MirrorCars(prediction, welcome.seat, arena.effects, (seat) => locals.has(seat))
  root.add(others.object)

  const cameraTuning = createCameraTuning()
  // Far enough to take in the whole island, and the sun beyond it.
  cameraTuning.far = Math.max(map.size * map.cellSize * 2, SUN_DISTANCE * 1.5)
  const chase = new ChaseCamera(cameraTuning)
  chase.setBoundsAt(cameraBounds(map))
  const target = createChaseTarget()

  const onKey = (event: KeyboardEvent): void => {
    if (player.keys.respawn(event)) client.requestRespawn()
  }
  window.addEventListener('keydown', onKey)
  // The keys, told with what this car does of its own.
  const controls = player.keys.controls(OWN_ACTIONS[welcome.profile].label)

  let owed = 0
  let chaseSnapped = false

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
      car.presence.aimAt(aimPointOf(prediction.ownSeat, prediction.seats))
      car.presence.render(owed / FIXED_TIMESTEP, dt)
      arena.update(dt)
      car.presence.aim(target)
      if (chaseSnapped) chase.update(dt, target)
      else {
        chase.snapTo(target)
        chaseSnapped = true
      }
    },
    hud() {
      const players = client.playerCount
      const title = `${VEHICLE_PROFILE_LABELS[welcome.profile]} | seed ${map.seed} | ${players} ${players === 1 ? 'player' : 'players'}`
      if (lost !== null) return { title, state: `disconnected: ${lost}` }
      return car.presence.hudState(title, controls)
    },
    dispose() {
      window.removeEventListener('keydown', onKey)
      keyboard.dispose()
      client.close('left')
      others.dispose()
      car.dispose()
      arena.dispose()
      scene.remove(root)
    },
  }
}
