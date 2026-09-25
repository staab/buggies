import { flatHeightfield, type Heightfield } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, type VehicleInput } from './input.ts'
import { addHeightfield } from './terrain.ts'
import { createVehicleTuning, type VehicleTuning } from './tuning.ts'
import { HOLD_SLIP_SPEED } from './tireModel.ts'
import { stepVehicle } from './vehicle.ts'
import { createVehicle, type Vehicle } from './vehicleBody.ts'
import { createVehicleStepState, readVehicleStepState, writeVehicleStepState } from './vehicleStepState.ts'
import { FIXED_TIMESTEP, createPhysicsWorld, initPhysics } from './world.ts'

const CELL = 3
const LENGTH = 200
const WIDTH = 15
const TICKS_PER_SECOND = Math.round(1 / FIXED_TIMESTEP)

/** Ground that rises steadily along +Z at this grade, or lies flat at none. */
function ground(grade: number): Heightfield {
  const field = flatHeightfield(WIDTH, LENGTH, CELL)
  for (let row = 0; row < LENGTH; row++) {
    for (let col = 0; col < WIDTH; col++) field.heights[row * WIDTH + col] = row * CELL * grade
  }
  return field
}

/** What to drive with: an input, or one worked out from the car each tick. */
type Driving = VehicleInput | ((vehicle: Vehicle) => VehicleInput)

interface Parked {
  vehicle: Vehicle
  drive(seconds: number, driving?: Driving): void
  free(): void
}

/** A car put down in the middle of the ground, facing down it, held on the handbrake for a second as a driver would, then let go. */
function park(field: Heightfield, tuning: VehicleTuning, grade: number): Parked {
  const world = createPhysicsWorld()
  addHeightfield(world, field)
  const z = (LENGTH * CELL) / 2
  const vehicle = createVehicle(world, tuning, { position: { x: (WIDTH * CELL) / 2, y: z * grade + 1, z }, yaw: 0 })
  const drive = (seconds: number, driving: Driving = NEUTRAL_INPUT): void => {
    for (let tick = 0; tick < seconds * TICKS_PER_SECOND; tick++) {
      stepVehicle(world, vehicle, tuning, typeof driving === 'function' ? driving(vehicle) : driving, FIXED_TIMESTEP)
      world.step()
    }
  }
  drive(1, { ...NEUTRAL_INPUT, handbrake: true })
  return { vehicle, drive, free: () => world.free() }
}

function traveled(vehicle: Vehicle, from: { x: number; z: number }): number {
  const { x, z } = vehicle.frame.position
  return Math.hypot(x - from.x, z - from.z)
}

describe('a car left alone', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  it.each(['sportsCar', 'semi', 'goKart'] as const)('stays put on flat ground: %s', (profile) => {
    const parked = park(ground(0), createVehicleTuning(profile), 0)
    const from = { ...parked.vehicle.frame.position }
    parked.drive(5)
    expect(traveled(parked.vehicle, from)).toBeLessThan(0.01)
    expect(parked.vehicle.wheels.every((wheel) => wheel.held)).toBe(true)
    parked.free()
  })

  it('stays put on a hill, and drives off it when asked', () => {
    const grade = 0.2
    const parked = park(ground(grade), createVehicleTuning('sportsCar'), grade)
    // The handbrake coming off lets the car settle a few centimeters; from there it stays.
    const released = { ...parked.vehicle.frame.position }
    parked.drive(2)
    expect(traveled(parked.vehicle, released)).toBeLessThan(0.1)
    const from = { ...parked.vehicle.frame.position }
    parked.drive(5)
    expect(traveled(parked.vehicle, from)).toBeLessThan(0.01)
    // Asked to go, it goes: the hold is not a brake.
    parked.drive(2, { ...NEUTRAL_INPUT, throttle: 1 })
    expect(traveled(parked.vehicle, from)).toBeGreaterThan(5)
    expect(parked.vehicle.wheels.some((wheel) => wheel.held)).toBe(false)
    parked.free()
  })

  it('coasts to a stop and then stops, rather than rolling on', () => {
    const parked = park(ground(0), createVehicleTuning('sportsCar'), 0)
    parked.drive(3, { ...NEUTRAL_INPUT, throttle: 1 })
    expect(parked.vehicle.speed).toBeGreaterThan(10)
    // Nothing holds a car doing more than walking pace.
    expect(parked.vehicle.wheels.some((wheel) => wheel.held)).toBe(false)
    // Braked down to a walk and left to roll the rest of the way, it stops, and stays stopped.
    parked.drive(3, (vehicle) => ({ ...NEUTRAL_INPUT, brake: vehicle.speed > HOLD_SLIP_SPEED + 0.1 ? 1 : 0 }))
    parked.drive(5)
    expect(parked.vehicle.speed).toBeLessThan(0.01)
    expect(parked.vehicle.wheels.every((wheel) => wheel.held)).toBe(true)
    const from = { ...parked.vehicle.frame.position }
    parked.drive(3)
    expect(traveled(parked.vehicle, from)).toBeLessThan(0.01)
    parked.free()
  })

  it('carries its hold in the step state, so a replay starts from the same grip', () => {
    const parked = park(ground(0), createVehicleTuning('sportsCar'), 0)
    const state = readVehicleStepState(createVehicleStepState(), parked.vehicle)
    expect(state.wheelHeld).toEqual([true, true, true, true])
    for (const wheel of parked.vehicle.wheels) {
      wheel.held = false
      wheel.holdPoint.x += 100
    }
    writeVehicleStepState(parked.vehicle, state)
    for (const [i, wheel] of parked.vehicle.wheels.entries()) {
      expect(wheel.held).toBe(true)
      expect(wheel.holdPoint).toEqual(state.wheelHoldPoint[i])
    }
    parked.free()
  })
})
