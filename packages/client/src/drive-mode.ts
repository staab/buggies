import {
  FIXED_TIMESTEP,
  VEHICLE_PROFILE_LABELS,
  advance,
  createArena,
  respawn,
  respawnLost,
  takeSeat,
  type VehicleProfileId,
} from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import { BodyView } from './body-view.ts'
import { CarView } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { cameraBounds, driverLine, tunnelTest } from './driver-hud.ts'
import { smokeAmount } from './damage.ts'
import { Explosions } from './explosion.ts'
import { Keyboard } from './input.ts'
import type { ModeView } from './mode.ts'
import { Smoke } from './smoke.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

/** A colour each, so the three are told apart at a glance. */
const COLORS: Record<VehicleProfileId, number> = {
  pickup: 0x3f6fb5,
  mustang: 0xd8452f,
  raceCar: 0xe8a33a,
}

/** Alone on the island, in a one-seat arena. */
export function createDriveMode(
  map: TerrainMap,
  scene: THREE.Scene,
  profile: VehicleProfileId,
): ModeView {
  const arena = createArena(map, 1)
  const seat = takeSeat(arena, 0, profile)
  const { vehicle } = seat
  const keyboard = new Keyboard()
  const car = new CarView(COLORS[profile])
  car.syncDimensions(seat.tuning)
  scene.add(car.object)
  const explosions = new Explosions()
  scene.add(explosions.object)
  const smoke = new Smoke()
  scene.add(smoke.object)
  let wasWrecked = false

  const body = new BodyView(vehicle.body, car.object)
  const cameraTuning = createCameraTuning()
  cameraTuning.far = map.size * map.cellSize * 2
  const chase = new ChaseCamera(cameraTuning)
  chase.setBoundsAt(cameraBounds(map))
  const target = createChaseTarget()
  const inTunnel = tunnelTest(map)

  const aimCamera = (): void => {
    vehicle.body.translation(target.position)
    vehicle.body.rotation(target.rotation)
    vehicle.body.linvel(target.velocity)
    target.speed = vehicle.speed
  }

  const snap = (): void => {
    body.reset()
    aimCamera()
    chase.snapTo(target)
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return
    respawn(seat)
    keyboard.release()
    snap()
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  snap()

  return {
    camera: chase.camera,
    resize(aspect) {
      chase.camera.aspect = aspect
      chase.camera.updateProjectionMatrix()
    },
    update(dt, active) {
      // A menu over the top pauses the world rather than letting it run on
      // unattended behind the panel.
      if (!active) return
      const input = keyboard.read()
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        advance(arena, () => input)
        if (respawnLost(arena).length > 0) snap()
        body.capture()
        owed -= FIXED_TIMESTEP
      }
      // Render between the last two steps rather than on the newest one, or a
      // 60Hz simulation shown at any other rate stutters.
      body.apply(owed / FIXED_TIMESTEP)
      car.applySimulatedWheels(vehicle.wheels, seat.tuning)
      if (vehicle.wrecked && !wasWrecked) explosions.burst(vehicle.frame.position)
      wasWrecked = vehicle.wrecked
      car.setWrecked(wasWrecked)
      if (!wasWrecked) {
        smoke.trail(vehicle.frame.position, vehicle.frame.linearVelocity, smokeAmount(vehicle.damage), dt)
      }
      smoke.update(dt)
      explosions.update(dt)
      aimCamera()
      chase.update(dt, target)
    },
    hud() {
      return (
        `${VEHICLE_PROFILE_LABELS[profile]} | seed ${map.seed}\n` +
        driverLine(vehicle, seat.submersion, inTunnel(vehicle.frame.position))
      )
    },
    dispose() {
      window.removeEventListener('keydown', onKey)
      keyboard.dispose()
      car.dispose()
      explosions.dispose()
      smoke.dispose()
      arena.world.free()
    },
  }
}
