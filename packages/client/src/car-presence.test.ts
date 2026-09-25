import {
  DEFAULT_VEHICLE_PROFILE,
  FIXED_TIMESTEP,
  NEUTRAL_INPUT,
  NO_TARGET,
  addHeightfield,
  createPhysicsWorld,
  createVehicle,
  createVehicleTuning,
  initPhysics,
  stepVehicle,
  wreckVehicle,
  type Seat,
} from '@buggies/game'
import { flatHeightfield } from '@buggies/terrain'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

import { CarPresence } from './car-presence.ts'
import { createChaseTarget } from './chase-camera.ts'
import { Explosions } from './explosion.ts'
import { Smoke } from './smoke.ts'

/** A seat on flat ground, with nothing but a vehicle in it. */
function seatOnFlat(): { seat: Seat; free: () => void } {
  const world = createPhysicsWorld()
  addHeightfield(world, flatHeightfield(20, 20, 3))
  const tuning = createVehicleTuning(DEFAULT_VEHICLE_PROFILE)
  const vehicle = createVehicle(world, tuning, { position: { x: 30, y: 0, z: 30 }, yaw: 0 })
  // Settled on its springs, so that it is on the road and not still landing.
  for (let i = 0; i < 60; i++) {
    stepVehicle(world, vehicle, tuning, NEUTRAL_INPUT, FIXED_TIMESTEP)
    world.step()
  }
  const seat: Seat = {
    id: 3,
    spawn: { position: { x: 30, y: 0, z: 30 }, yaw: 0 },
    vehicle,
    tuning,
    profile: DEFAULT_VEHICLE_PROFILE,
    occupied: true,
    epoch: 0,
    submersion: 0,
    lostTicks: 0,
    score: 0,
    weapon: 'none',
    ammoTicks: 0,
    aimTarget: NO_TARGET,
  }
  return { seat, free: () => world.free() }
}

describe('a car on the screen', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  it('draws its body, says its state, and bursts when it is wrecked', () => {
    const { seat, free } = seatOnFlat()
    const explosions = new Explosions()
    const smoke = new Smoke()
    const presence = new CarPresence(seat, 0xff0000, { explosions, smoke, sound: null })
    expect(presence.object.children.length).toBeGreaterThan(0)
    presence.body.captureStep()
    presence.render(0.5, 0.016)
    presence.object.updateMatrixWorld(true)
    // Drawn where the body is.
    expect(presence.object.position.x).toBeCloseTo(30, 1)
    expect(presence.object.position.z).toBeCloseTo(30, 1)

    const target = createChaseTarget()
    presence.aim(target)
    expect(target.position.x).toBeCloseTo(30, 1)
    expect(target.wrecked).toBe(false)

    seat.score = 2
    const hud = presence.hudState('me', [])
    expect(hud).toMatchObject({ title: 'me', score: 2, damage: 0, maxSpeed: seat.tuning.maxSpeed })

    // Blown up: one burst, the car hidden, and the HUD says so.
    expect(explosions.object.children).toHaveLength(0)
    wreckVehicle(seat.vehicle, seat.tuning)
    presence.render(0.5, 0.016)
    expect(explosions.object.children).toHaveLength(1)
    expect(presence.object.visible).toBe(false)
    expect(presence.wrecked).toBe(true)
    expect(presence.hudState('me', [])).toMatchObject({ damage: 1 })
    // And not again while it lies there.
    presence.render(0.5, 0.016)
    expect(explosions.object.children).toHaveLength(1)

    presence.dispose()
    explosions.dispose()
    smoke.dispose()
    free()
  })
})
