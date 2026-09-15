import {
  FIXED_TIMESTEP,
  VEHICLE_LABELS,
  advance,
  createGame,
  groundAt,
  respawn,
  type VehicleProfileId,
} from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import type * as THREE from 'three'

import { CarView } from './car-view.ts'
import { ChaseCamera } from './chase-camera.ts'
import { Keyboard } from './input.ts'
import type { ModeView } from './mode.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

const TO_KPH = 3.6

/** Sideways speed at which the HUD starts calling it a slide. */
const SLIDE_SPEED = 3

/** A colour each, so the three are told apart at a glance. */
const COLORS: Record<VehicleProfileId, string> = {
  buggy: '#e8873a',
  truck: '#3f6fb5',
  racer: '#c0392b',
}

export function createDriveMode(
  map: TerrainMap,
  scene: THREE.Scene,
  profile: VehicleProfileId,
): ModeView {
  let game = createGame({ map, profile })
  const keyboard = new Keyboard()
  const car = new CarView(game.tuning, COLORS[profile])
  const camera = new ChaseCamera(map.size * map.cellSize * 2)
  scene.add(car.object)

  const floor = (x: number, z: number): number =>
    groundAt(game.surface, x, z, Number.POSITIVE_INFINITY)

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return
    game = respawn(game)
    keyboard.release()
    camera.snap()
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  car.sync(game.vehicles.player!)
  camera.update(0, game.vehicles.player!, floor)

  return {
    camera: camera.camera,
    resize(aspect) {
      camera.camera.aspect = aspect
      camera.camera.updateProjectionMatrix()
    },
    update(dt) {
      const input = keyboard.read()
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        game = advance(game, [{ vehicleId: 'player', input }])
        owed -= FIXED_TIMESTEP
      }
      const player = game.vehicles.player!
      car.sync(player)
      camera.update(dt, player, floor)
    },
    hud() {
      const player = game.vehicles.player!
      const speed = Math.round(Math.hypot(player.velocity.x, player.velocity.z) * TO_KPH)
      const state = player.submerged
        ? 'swimming'
        : !player.grounded
          ? 'airborne'
          : player.slip > SLIDE_SPEED
            ? 'sliding'
            : 'on the road'
      return (
        `${VEHICLE_LABELS[profile]} | seed ${map.seed}\n` +
        `${String(speed).padStart(3)} km/h  ${state}`
      )
    },
    dispose() {
      window.removeEventListener('keydown', onKey)
      keyboard.dispose()
      car.dispose()
    },
  }
}
