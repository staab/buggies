import { flatHeightfield, type Heightfield } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, type VehicleInput } from './input.ts'
import { addHeightfield } from './terrain.ts'
import { VEHICLE_PROFILE_IDS, createVehicleTuning, type VehicleTuning } from './tuning.ts'
import { stepVehicle } from './vehicle.ts'
import { createVehicle, restingRideHeight, type Vehicle } from './vehicleBody.ts'
import { FIXED_TIMESTEP, createPhysicsWorld, initPhysics, worldGravity } from './world.ts'

const CELL = 3
const WIDTH = 25
const LENGTH = 500
const START_Z = 1400

/** How far the foot of the hill takes to bend up from the flat to its grade. */
const HILL_FOOT = 60

/**
 * A straight run down -Z, flat until `climbFrom`, then rising at `grade`
 * from there on, the way a road does: bending up over the foot of the hill
 * rather than breaking to the slope at a kink.
 */
function runway(grade = 0, climbFrom = 0): Heightfield {
  const field = flatHeightfield(WIDTH, LENGTH, CELL)
  for (let row = 0; row < LENGTH; row++) {
    const z = row * CELL
    const along = climbFrom - z
    let height = 0
    if (along >= HILL_FOOT) height = (along - HILL_FOOT / 2) * grade
    else if (along > 0) height = (grade * along * along) / (2 * HILL_FOOT)
    for (let col = 0; col < WIDTH; col++) field.heights[row * WIDTH + col] = height
  }
  return field
}

interface Run {
  world: ReturnType<typeof createPhysicsWorld>
  vehicle: Vehicle
  tuning: VehicleTuning
}

function start(tuning: VehicleTuning, field = runway(), at = { x: (WIDTH * CELL) / 2, z: START_Z }): Run {
  const world = createPhysicsWorld()
  addHeightfield(world, field)
  const vehicle = createVehicle(world, tuning, { position: { x: at.x, y: 0, z: at.z }, yaw: 0 })
  world.step()
  return { world, vehicle, tuning }
}

/**
 * Hold an input for so many seconds, or until `done` says so, and say how far
 * off straight and how far off its wheels the car got.
 */
function hold(
  run: Run,
  input: Partial<VehicleInput>,
  seconds: number,
  done: (vehicle: Vehicle) => boolean = () => false,
): { minUp: number; maxDrift: number } {
  let minUp = 1
  let maxDrift = 0
  for (let tick = 0; tick < seconds * 60 && !done(run.vehicle); tick++) {
    stepVehicle(run.world, run.vehicle, run.tuning, { ...NEUTRAL_INPUT, ...input }, FIXED_TIMESTEP)
    run.world.step()
    minUp = Math.min(minUp, run.vehicle.frame.up.y)
    maxDrift = Math.max(maxDrift, Math.abs(run.vehicle.frame.position.x - (WIDTH * CELL) / 2))
  }
  return { minUp, maxDrift }
}

describe('the garage', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  for (const profile of VEHICLE_PROFILE_IDS) {
    describe(profile, () => {
      it('sits on its wheels at rest', () => {
        const run = start(createVehicleTuning(profile))
        const { minUp, maxDrift } = hold(run, {}, 3)
        expect(minUp).toBeGreaterThan(0.99)
        expect(maxDrift).toBeLessThan(0.05)
        const expected = restingRideHeight(run.tuning, worldGravity(run.world))
        expect(Math.abs(run.vehicle.frame.position.y - expected)).toBeLessThan(0.1)
        expect(run.vehicle.damage).toBe(0)
        run.world.free()
      })

      it('gets up to speed in a straight line and stops again', () => {
        const run = start(createVehicleTuning(profile))
        const going = hold(run, { throttle: 1 }, 10)
        expect(going.minUp).toBeGreaterThan(0.95)
        expect(going.maxDrift).toBeLessThan(1)
        expect(run.vehicle.speed).toBeGreaterThan(run.tuning.maxSpeed * 0.45)
        expect(run.vehicle.speed).toBeLessThanOrEqual(run.tuning.maxSpeed * 1.02)
        // On the brakes until it has stopped: held on past that, the pedal
        // would drive it backwards.
        const stopping = hold(run, { brake: 1 }, 8, (vehicle) => vehicle.speed < 1)
        expect(stopping.minUp).toBeGreaterThan(0.95)
        expect(run.vehicle.speed).toBeLessThan(1)
        expect(run.vehicle.damage).toBe(0)
        run.world.free()
      })

      it('turns hard at speed without going over', () => {
        const run = start(createVehicleTuning(profile))
        hold(run, { throttle: 1 }, 6)
        const before = run.vehicle.frame.forward.z
        const turning = hold(run, { throttle: 1, steer: 1 }, 4)
        expect(turning.minUp).toBeGreaterThan(0.75)
        expect(run.vehicle.wrecked).toBe(false)
        // It did turn: the nose has come round from straight down the runway.
        expect(Math.abs(run.vehicle.frame.forward.z - before)).toBeGreaterThan(0.3)
        run.world.free()
      })

      it('holds full lock at speed without spinning', () => {
        const run = start(createVehicleTuning(profile), flatHeightfield(300, 300, 6), { x: 900, z: 1700 })
        // Settled, then sent off at three fifths of its top speed, or 40m/s
        // if that is less (full lock at 75m/s is asking too much of a race
        // car), and given a moment for the tyres to catch up with it.
        hold(run, {}, 1)
        const speed = Math.min(run.tuning.maxSpeed * 0.6, 40)
        run.vehicle.body.setLinvel({ x: 0, y: 0, z: -speed }, true)
        hold(run, { throttle: 1 }, 0.5)
        let maxSlip = 0
        let minUp = 1
        for (let tick = 0; tick < 60 * 4; tick++) {
          const throttle = run.vehicle.speed < speed ? 1 : 0
          stepVehicle(run.world, run.vehicle, run.tuning, { ...NEUTRAL_INPUT, throttle, steer: 1 }, FIXED_TIMESTEP)
          run.world.step()
          maxSlip = Math.max(maxSlip, Math.abs(run.vehicle.slipAngle))
          minUp = Math.min(minUp, run.vehicle.frame.up.y)
        }
        // It slides a little at most: the tail never comes round.
        expect(maxSlip).toBeLessThan(Math.PI / 4)
        expect(minUp).toBeGreaterThan(0.75)
        run.world.free()
      })

      it('climbs a steep hill', () => {
        const run = start(createVehicleTuning(profile), runway(0.35, 1200))
        // Flat out to the foot of the hill, however long that takes, then
        // fifteen seconds up it.
        hold(run, { throttle: 1 }, 40, (vehicle) => vehicle.frame.position.z < 1200)
        expect(run.vehicle.frame.position.z).toBeLessThan(1200)
        hold(run, { throttle: 1 }, 15)
        const climbed = 1200 - run.vehicle.frame.position.z
        expect(climbed).toBeGreaterThan(60)
        // Still going up it, on its wheels, unhurt.
        expect(run.vehicle.forwardSpeed).toBeGreaterThan(3)
        expect(run.vehicle.frame.up.y).toBeGreaterThan(0.9)
        expect(run.vehicle.damage).toBeLessThan(0.05)
        run.world.free()
      })
    })
  }
})
