import {
  FIXED_TIMESTEP,
  NEUTRAL_INPUT,
  VEHICLE_PROFILE_LABELS,
  createArena,
  takeSeat,
  type VehicleProfileId,
} from '@buggies/game'
import { LocalPrediction, NetClient } from '@buggies/net'
import type { Vec3 } from '@buggies/physics'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import type { PresenceEffects } from './car-presence.ts'
import { seatColor } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { cameraBounds, tunnelTest } from './driver-hud.ts'
import { Explosions } from './explosion.ts'
import type { HudState } from './hud.ts'
import { Keyboard } from './input.ts'
import type { DriverKeys } from './keys.ts'
import { MirrorCars } from './mirror-cars.ts'
import { PickupField } from './pickups-view.ts'
import { PredictedCar } from './predicted-car.ts'
import { Smoke } from './smoke.ts'
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
  resize(aspect: number): void
  update(dt: number, active: boolean): void
  hud(): HudState
  dispose(): void
}

/**
 * Join a server and drive on its island with whoever else is there. The
 * server owns the map, so it is only known once the server says which one:
 * `mapFor` is asked for it then. `locals` are the seats of everyone on this
 * screen, kept between views so that a player beside you is not also heard
 * as a stranger in the distance.
 */
export async function joinOnline(
  scene: THREE.Scene,
  url: string,
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
  const welcome = await client.connect(player.profile)
  locals.add(welcome.seat)
  const map = await mapFor(welcome.seed)

  // A mirror of the server's arena: same map, same seats, so the local car
  // can be driven here the instant a key goes down.
  const mirror = createArena(map)
  takeSeat(mirror, welcome.seat, welcome.profile)
  const prediction = new LocalPrediction(mirror, welcome.seat, welcome.epoch, client.startTick)

  const root = new THREE.Group()
  scene.add(root)
  const keyboard = new Keyboard(player.keys.bindings)
  const explosions = new Explosions()
  root.add(explosions.object)
  const smoke = new Smoke()
  root.add(smoke.object)
  const effects: PresenceEffects = { explosions, smoke, sound }
  const car = new PredictedCar(prediction, (tick, input) => client.sendInput(tick, input), seatColor(welcome.seat), effects)
  root.add(car.object)
  // A player beside you is seen from here, but heard from their own view.
  const others = new MirrorCars(prediction, welcome.seat, effects, (seat) => locals.has(seat))
  root.add(others.object)
  const ear = (): Vec3 => prediction.vehicle.frame.position
  const pickups = new PickupField(prediction, (at) => {
    explosions.burst(at)
    sound.boom(Math.hypot(at.x - ear().x, at.y - ear().y, at.z - ear().z))
  })
  root.add(pickups.object)

  const cameraTuning = createCameraTuning()
  cameraTuning.far = map.size * map.cellSize * 2
  const chase = new ChaseCamera(cameraTuning)
  chase.setBoundsAt(cameraBounds(map))
  const target = createChaseTarget()
  const inTunnel = tunnelTest(map)

  const onKey = (event: KeyboardEvent): void => {
    if (player.keys.respawn(event)) client.requestRespawn()
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  let chaseSnapped = false

  return {
    root,
    camera: chase.camera,
    seat: welcome.seat,
    resize(aspect) {
      chase.camera.aspect = aspect
      chase.camera.updateProjectionMatrix()
    },
    update(dt, active) {
      // With the menu up the car is not driven, but the world does not wait:
      // the server keeps going, and so must the mirror.
      const input = active ? keyboard.read() : NEUTRAL_INPUT
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        if (car.tick(client.pump(input), others) === 'resynced') chaseSnapped = false
        owed -= FIXED_TIMESTEP
      }
      others.render(owed / FIXED_TIMESTEP, dt)
      car.presence.render(owed / FIXED_TIMESTEP, dt)
      pickups.update(dt)
      smoke.update(dt)
      explosions.update(dt)
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
      return car.presence.hudState(title, player.keys.controls, inTunnel(prediction.vehicle.frame.position))
    },
    dispose() {
      window.removeEventListener('keydown', onKey)
      keyboard.dispose()
      client.close('left')
      pickups.dispose()
      others.dispose()
      car.dispose()
      explosions.dispose()
      smoke.dispose()
      scene.remove(root)
    },
  }
}
