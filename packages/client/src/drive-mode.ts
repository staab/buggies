import { FIXED_TIMESTEP, advance, createArena, respawnLost, takeSeat, type VehicleProfileId } from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import { Driver, type DriverKeys } from './driver.ts'
import { Explosions } from './explosion.ts'
import type { ModeView } from './mode.ts'
import { PickupField } from './pickups-view.ts'
import { Smoke } from './smoke.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should resume, not fast-forward a minute of driving.
 */
const MAX_CATCH_UP = 0.25

/** Someone to put on the island: in what, and on which keys. */
export interface Player {
  profile: VehicleProfileId
  keys: DriverKeys
}

/**
 * On the island with no server: one player with the whole screen, or two
 * with half each, side by side, in the one arena so that they can run into
 * each other.
 */
export function createDriveMode(map: TerrainMap, scene: THREE.Scene, players: readonly Player[]): ModeView {
  const arena = createArena(map, players.length)
  const explosions = new Explosions()
  scene.add(explosions.object)
  const smoke = new Smoke()
  scene.add(smoke.object)
  const pickups = new PickupField(arena, (at) => explosions.burst(at))
  scene.add(pickups.object)
  const drivers = players.map(
    (player, seat) =>
      new Driver(scene, map, takeSeat(arena, seat, player.profile), player.profile, player.keys, { explosions, smoke }),
  )
  const split = drivers.length > 1

  const onKey = (event: KeyboardEvent): void => {
    for (const driver of drivers) {
      if (driver.keys.respawn(event)) driver.respawn(arena)
    }
  }
  window.addEventListener('keydown', onKey)

  let owed = 0
  const viewport = new THREE.Vector4()

  return {
    camera: drivers[0]!.camera,
    resize(aspect) {
      // Side by side, each has half the width.
      for (const driver of drivers) {
        driver.camera.aspect = split ? aspect / 2 : aspect
        driver.camera.updateProjectionMatrix()
      }
    },
    update(dt, active) {
      // A menu over the top pauses the world rather than letting it run on
      // unattended behind the panel.
      if (!active) return
      const inputs = drivers.map((driver) => driver.input())
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        advance(arena, (seat) => inputs[seat.id]!)
        for (const lost of respawnLost(arena)) drivers[lost.id]?.snap()
        for (const driver of drivers) driver.captureStep()
        owed -= FIXED_TIMESTEP
      }
      // Render between the last two steps rather than on the newest one, or a
      // 60Hz simulation shown at any other rate stutters.
      for (const driver of drivers) driver.render(owed / FIXED_TIMESTEP, dt)
      pickups.update(dt)
      smoke.update(dt)
      explosions.update(dt)
    },
    render(renderer) {
      if (!split) {
        renderer.render(scene, drivers[0]!.camera)
        return
      }
      renderer.getViewport(viewport)
      const { x, y, z: width, w: height } = viewport
      const half = Math.floor(width / 2)
      renderer.setScissorTest(true)
      drivers.forEach((driver, side) => {
        const left = x + side * half
        renderer.setViewport(left, y, half, height)
        renderer.setScissor(left, y, half, height)
        renderer.render(scene, driver.camera)
      })
      renderer.setScissorTest(false)
      renderer.setViewport(viewport)
    },
    setVehicle(profile, player = 0) {
      drivers[player]?.setVehicle(arena, profile)
    },
    hud() {
      return drivers.map((driver) => driver.hud())
    },
    dispose() {
      window.removeEventListener('keydown', onKey)
      for (const driver of drivers) driver.dispose()
      pickups.dispose()
      explosions.dispose()
      smoke.dispose()
      arena.world.free()
    },
  }
}
