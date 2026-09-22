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
import type * as THREE from 'three'

import { engineRev, type Sound } from './audio.ts'
import { seatColor } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { SOLO_KEYS } from './driver.ts'
import { cameraBounds, driverState, tunnelTest } from './driver-hud.ts'
import { smokeAmount } from './damage.ts'
import { Explosions } from './explosion.ts'
import { Keyboard } from './input.ts'
import { MirrorCars } from './mirror-cars.ts'
import type { ModeView } from './mode.ts'
import { PickupField } from './pickups-view.ts'
import { PredictedCar } from './predicted-car.ts'
import { Smoke } from './smoke.ts'
import { WebSocketClientTransport } from './ws-transport.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

/**
 * Join a server and drive on its island with whoever else is there. The
 * server owns the map, so it is only known once the server says which one:
 * `mapFor` is asked for it then.
 */
/** A knock that takes this much of a car's life is heard at full volume. */
const LOUD_KNOCK = 0.25

export async function createOnlineMode(
  scene: THREE.Scene,
  url: string,
  profile: VehicleProfileId,
  mapFor: (seed: number) => Promise<TerrainMap>,
  sound: Sound,
): Promise<ModeView> {
  let lost: string | null = null
  const client = new NetClient(new WebSocketClientTransport(url), () => performance.now(), {
    onClosed: (reason) => {
      lost = reason
    },
  })
  const welcome = await client.connect(profile)
  const map = await mapFor(welcome.seed)

  // A mirror of the server's arena: same map, same seats, so the local car
  // can be driven here the instant a key goes down.
  const mirror = createArena(map)
  takeSeat(mirror, welcome.seat, welcome.profile)
  const prediction = new LocalPrediction(mirror, welcome.seat, welcome.epoch, client.startTick)

  const keyboard = new Keyboard()
  const car = new PredictedCar(
    prediction,
    (tick, input) => client.sendInput(tick, input),
    welcome.profile,
    seatColor(welcome.seat),
  )
  scene.add(car.object)
  const explosions = new Explosions()
  scene.add(explosions.object)
  const smoke = new Smoke()
  scene.add(smoke.object)
  const ear = (): Vec3 => prediction.vehicle.frame.position
  const distance = (at: Vec3): number => Math.hypot(at.x - ear().x, at.y - ear().y, at.z - ear().z)
  const boom = (at: Vec3): void => {
    explosions.burst(at)
    sound.boom(distance(at))
  }
  const others = new MirrorCars(prediction, welcome.seat, boom, smoke, sound)
  scene.add(others.object)
  const pickups = new PickupField(prediction, boom)
  scene.add(pickups.object)
  let voice = sound.engine(welcome.profile)
  let wasWrecked = false
  let lastDamage = 0
  let lastScore = 0

  const cameraTuning = createCameraTuning()
  cameraTuning.far = map.size * map.cellSize * 2
  const chase = new ChaseCamera(cameraTuning)
  chase.setBoundsAt(cameraBounds(map))
  const target = createChaseTarget()
  const inTunnel = tunnelTest(map)

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') client.requestRespawn()
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  let chaseSnapped = false

  return {
    camera: chase.camera,
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
      car.render(owed / FIXED_TIMESTEP, dt)
      if (car.wrecked && !wasWrecked) boom(prediction.vehicle.frame.position)
      wasWrecked = car.wrecked
      const { vehicle } = prediction
      voice.set(vehicle.wrecked ? 0 : engineRev(vehicle.speed, prediction.tuning.maxSpeed, vehicle.command.throttle))
      const knock = vehicle.damage - lastDamage
      if (knock > 0 && !vehicle.wrecked) sound.thud(knock / LOUD_KNOCK)
      lastDamage = vehicle.damage
      if (prediction.score > lastScore) sound.chime()
      lastScore = prediction.score
      car.setWrecked(wasWrecked)
      if (!wasWrecked) {
        const { position, linearVelocity } = prediction.vehicle.frame
        smoke.trail(position, linearVelocity, smokeAmount(prediction.vehicle.damage), dt)
      }
      pickups.update(dt)
      smoke.update(dt)
      explosions.update(dt)
      car.aim(target)
      if (chaseSnapped) chase.update(dt, target)
      else {
        chase.snapTo(target)
        chaseSnapped = true
      }
    },
    hud() {
      const players = client.playerCount
      const title = `${VEHICLE_PROFILE_LABELS[welcome.profile]} | seed ${map.seed} | ${players} ${players === 1 ? 'player' : 'players'}`
      if (lost !== null) return [{ title, state: `disconnected: ${lost}` }]
      const { vehicle } = prediction
      return [
        {
          title,
          state: driverState(vehicle, prediction.submersion, inTunnel(vehicle.frame.position)),
          speed: vehicle.speed,
          maxSpeed: prediction.tuning.maxSpeed,
          damage: vehicle.wrecked ? 1 : vehicle.damage,
          controls: SOLO_KEYS.controls,
          score: prediction.score,
        },
      ]
    },
    dispose() {
      window.removeEventListener('keydown', onKey)
      keyboard.dispose()
      client.close('left')
      voice.stop()
      pickups.dispose()
      others.dispose()
      car.dispose()
      explosions.dispose()
      smoke.dispose()
    },
  }
}
