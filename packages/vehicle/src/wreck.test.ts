import { quatFromYaw } from '@buggies/physics'
import { flatHeightfield } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT } from './input.ts'
import { addHeightfield } from './terrain.ts'
import { createVehicleTuning } from './tuning.ts'
import { DAMAGE_SMOKING, stepVehicle } from './vehicle.ts'
import { createVehicle, type Vehicle } from './vehicleBody.ts'
import { FIXED_TIMESTEP, addStaticWall, createPhysicsWorld, initPhysics } from './world.ts'

const CELL = 3
const WIDTH = 15
const LENGTH = 400
const WALL_Z = 700
const START = { x: (WIDTH * CELL) / 2, y: 0.6, z: WALL_Z + 150 }

interface Range {
  world: ReturnType<typeof createPhysicsWorld>
  vehicle: Vehicle
  tuning: ReturnType<typeof createVehicleTuning>
}

/** A race car in front of a wall. */
function range(): Range {
  const world = createPhysicsWorld()
  addHeightfield(world, flatHeightfield(WIDTH, LENGTH, CELL))
  addStaticWall(world, {
    halfExtents: { x: 20, y: 3, z: 1 },
    position: { x: (WIDTH * CELL) / 2, y: 3, z: WALL_Z },
  })
  const tuning = createVehicleTuning('raceCar')
  const vehicle = createVehicle(world, tuning, { position: START, yaw: 0 })
  world.step()
  return { world, vehicle, tuning }
}

/**
 * Drive at the wall at a given speed, once, and report what became of the
 * car. The car is put back on its mark first, but what has already happened
 * to it is not undone.
 */
function crash({ world, vehicle, tuning }: Range, speed: number): { liftedOff: boolean; drivenAfter: number } {
  const { body } = vehicle
  body.setTranslation({ x: START.x, y: START.y, z: START.z }, true)
  body.setRotation(quatFromYaw(0), true)
  body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)

  let wreckTick = -1
  let liftedOff = false
  let drivenAfter = 0
  for (let tick = 0; tick < 60 * 25; tick++) {
    // Flat out at the wall, and flat out afterwards: a wreck takes no driving.
    const throttle = vehicle.wrecked || vehicle.speed < speed ? 1 : 0
    stepVehicle(world, vehicle, tuning, { ...NEUTRAL_INPUT, throttle }, FIXED_TIMESTEP)
    world.step()
    if (vehicle.wrecked && wreckTick < 0) wreckTick = tick
    if (wreckTick >= 0 && tick < wreckTick + 30 && vehicle.frame.linearVelocity.y > 2) liftedOff = true
    if (wreckTick >= 0 && tick > wreckTick) drivenAfter = Math.max(drivenAfter, vehicle.command.throttle)
    // Bounced off, or blown clear: done with this run.
    if (vehicle.frame.position.z > WALL_Z + 40 && vehicle.forwardSpeed < -1) break
    if (wreckTick >= 0 && tick > wreckTick + 90) break
  }
  return { liftedOff, drivenAfter }
}

describe('damage', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  it('adds up hit by hit until the car blows up, and lets it be nudged into a wall', () => {
    const track = range()
    const { vehicle } = track

    // A nudge does nothing.
    crash(track, 3)
    expect(vehicle.damage).toBe(0)
    expect(vehicle.wrecked).toBe(false)

    crash(track, 14)
    const dented = vehicle.damage
    expect(dented).toBeGreaterThan(0.25)
    expect(dented).toBeLessThan(0.5)
    expect(vehicle.wrecked).toBe(false)

    crash(track, 14)
    expect(vehicle.damage).toBeGreaterThan(dented)
    expect(vehicle.damage).toBeGreaterThanOrEqual(DAMAGE_SMOKING)
    expect(vehicle.damage).toBeLessThan(1)
    expect(vehicle.wrecked).toBe(false)

    const last = crash(track, 14)
    expect(vehicle.damage).toBe(1)
    expect(vehicle.wrecked).toBe(true)
    // Thrown into the air, and not driven again however hard the throttle is held.
    expect(last.liftedOff).toBe(true)
    expect(last.drivenAfter).toBe(0)
    track.world.free()
  })

  it('blows a car up outright when it hits hard enough for that', () => {
    const track = range()
    crash(track, 45)
    expect(track.vehicle.damage).toBe(1)
    expect(track.vehicle.wrecked).toBe(true)
    track.world.free()
  })
})
