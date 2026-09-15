import {
  FIXED_TIMESTEP,
  VEHICLE_PROFILE_LABELS,
  advance,
  createGame,
  respawn,
  type GameState,
  type VehicleProfileId,
} from '@buggies/game'
import { boreClearance, sampleHeight, tunnelSegments, type TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import { BodyView } from './body-view.ts'
import { CarView } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { Keyboard } from './input.ts'
import type { ModeView } from './mode.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

const TO_KPH = 3.6

/** Slip angle past which the HUD starts calling it a slide, in radians. */
const SLIDE_ANGLE = 0.35

/** A colour each, so the three are told apart at a glance. */
const COLORS: Record<VehicleProfileId, number> = {
  pickup: 0x3f6fb5,
  mustang: 0xd8452f,
  raceCar: 0xe8a33a,
}

export function createDriveMode(
  map: TerrainMap,
  scene: THREE.Scene,
  profile: VehicleProfileId,
): ModeView {
  const game: GameState = createGame({ map, profile })
  const keyboard = new Keyboard()
  const car = new CarView(COLORS[profile])
  car.syncDimensions(game.tuning)
  scene.add(car.object)

  const body = new BodyView(game.vehicle.body, car.object)
  const cameraTuning = createCameraTuning()
  cameraTuning.far = map.size * map.cellSize * 2
  const chase = new ChaseCamera(cameraTuning)
  chase.setGroundAt((x, z) => sampleHeight(map.heightfield, x, z))
  const target = createChaseTarget()

  // Tunnels are the one place a chase camera cannot work: the arm would sit
  // inside the hill, and the ground it holds itself above is the mountain
  // overhead. Inside a bore the view moves into the cabin instead.
  const bores = tunnelSegments(map.roads)
  const inTunnel = (): boolean => {
    if (bores.length === 0) return false
    const { x, y, z } = game.vehicle.frame.position
    return boreClearance(bores, x, z, y) < 0
  }

  const aimCamera = (): void => {
    const { body: rigid, speed } = game.vehicle
    rigid.translation(target.position)
    rigid.rotation(target.rotation)
    rigid.linvel(target.velocity)
    target.speed = speed
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return
    respawn(game)
    keyboard.release()
    body.reset()
    aimCamera()
    chase.snapTo(target)
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  body.reset()
  aimCamera()
  chase.snapTo(target)

  return {
    camera: chase.camera,
    resize(aspect) {
      chase.camera.aspect = aspect
      chase.camera.updateProjectionMatrix()
    },
    update(dt) {
      const input = keyboard.read()
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        advance(game, input)
        body.capture()
        owed -= FIXED_TIMESTEP
      }
      // Render between the last two steps rather than on the newest one, or a
      // 60Hz simulation shown at any other rate stutters.
      body.apply(owed / FIXED_TIMESTEP)
      car.applySimulatedWheels(game.vehicle.wheels, game.tuning)
      aimCamera()
      chase.setSeated(inTunnel())
      chase.update(dt, target)
    },
    hud() {
      const { vehicle } = game
      const speed = Math.round(vehicle.speed * TO_KPH)
      const state = game.submersion > 0.2
        ? 'in the water'
        : vehicle.selfRighting
          ? 'righting itself'
          : inTunnel()
            ? 'in a tunnel'
            : vehicle.groundedCount === 0
              ? 'airborne'
              : Math.abs(vehicle.slipAngle) > SLIDE_ANGLE
                ? 'sliding'
                : 'on the road'
      return (
        `${VEHICLE_PROFILE_LABELS[profile]} | seed ${map.seed}\n` +
        `${String(speed).padStart(3)} km/h  ${state}`
      )
    },
    dispose() {
      window.removeEventListener('keydown', onKey)
      keyboard.dispose()
      car.dispose()
      game.world.free()
    },
  }
}
