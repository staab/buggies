import { quatFromYaw } from '@buggies/physics'
import { flatHeightfield } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT } from './input.ts'
import { addHeightfield } from './terrain.ts'
import { createVehicleTuning } from './tuning.ts'
import { DAMAGE_SMOKING, DURABILITY, stepVehicle } from './vehicle.ts'
import { createVehicle, levelSpawn, type Vehicle } from './vehicleBody.ts'
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
  const vehicle = createVehicle(world, tuning, levelSpawn(START, 0))
  world.step()
  return { world, vehicle, tuning }
}

/**
 * Drive at the wall at a given speed, once, and report what became of the
 * car. The car is put back on its mark first, but what has already happened
 * to it is not undone.
 */
function crash(
  { world, vehicle, tuning }: Range,
  speed: number,
  runUp = START.z - WALL_Z,
): { liftedOff: boolean; drivenAfter: number } {
  const { body } = vehicle
  body.setTranslation({ x: START.x, y: START.y, z: WALL_Z + runUp }, true)
  body.setRotation(quatFromYaw(0), true)
  body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)

  let wreckTick = -1
  let liftedOff = false
  let drivenAfter = 0
  for (let tick = 0; tick < 60 * 25; tick++) {
    // Flat out at the wall, and flat out afterward: a wreck takes no driving.
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

    // A nudge does next to nothing.
    crash(track, 3)
    expect(vehicle.damage).toBeLessThan(0.05)
    expect(vehicle.wrecked).toBe(false)

    // Every hard hit dents it further, and it takes a good few of them to blow it up.
    let hits = 0
    let last = crash(track, 24)
    let before = 0
    while (!vehicle.wrecked && hits < 20) {
      hits += 1
      expect(vehicle.damage).toBeGreaterThan(before)
      before = vehicle.damage
      last = crash(track, 24)
    }
    expect(hits).toBeGreaterThan(3 * DURABILITY - 3)
    expect(vehicle.damage).toBe(1)
    expect(vehicle.wrecked).toBe(true)
    expect(before).toBeGreaterThanOrEqual(DAMAGE_SMOKING)
    // Thrown into the air, and not driven again however hard the throttle is held.
    expect(last.liftedOff).toBe(true)
    expect(last.drivenAfter).toBe(0)
    track.world.free()
  })

  it('takes a hard crash at speed without blowing up, however hard it hits', () => {
    const track = range()
    // A long run at it, to be going fast enough to matter.
    crash(track, 80, 440)
    expect(track.vehicle.damage).toBeGreaterThan(0.2)
    expect(track.vehicle.wrecked).toBe(false)
    track.world.free()
  })
})
