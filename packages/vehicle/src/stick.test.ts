import { flatHeightfield, type Heightfield } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT } from './input.ts'
import { addHeightfield } from './terrain.ts'
import { createVehicleTuning, type VehicleTuning } from './tuning.ts'
import { stepVehicle } from './vehicle.ts'
import { createVehicle } from './vehicleBody.ts'
import { FIXED_TIMESTEP, createPhysicsWorld, initPhysics } from './world.ts'

const CELL = 3
const LENGTH = 300
const WIDTH = 15

/** A straight run down -Z with whatever bump `profile` puts in the way. */
function runway(profile: (z: number) => number): Heightfield {
  const field = flatHeightfield(WIDTH, LENGTH, CELL)
  for (let row = 0; row < LENGTH; row++) {
    for (let col = 0; col < WIDTH; col++) field.heights[row * WIDTH + col] = profile(row * CELL)
  }
  return field
}

/**
 * A rounded crest, a metre and a half over forty metres: at 30m/s it throws a
 * car off the ground for a third of a second, and it reads as a bump.
 */
function crest(z: number): number {
  const centre = 480
  const halfWidth = 20
  const distance = Math.abs(z - centre)
  return distance >= halfWidth ? 0 : 1.5 * 0.5 * (1 + Math.cos((Math.PI * distance) / halfWidth))
}

/** A launch ramp: a 20% climb over 30m toward -Z, the way the car goes, then nothing. */
function jump(z: number): number {
  return z >= 470 && z <= 500 ? (500 - z) * 0.2 : 0
}

interface Drive {
  airborneTicks: number
  reached: boolean
}

/** Drive the length of the runway holding a target speed, counting ticks off the ground. */
function drive(field: Heightfield, tuning: VehicleTuning, targetSpeed: number): Drive {
  const world = createPhysicsWorld()
  addHeightfield(world, field)
  const vehicle = createVehicle(world, tuning, {
    position: { x: (WIDTH * CELL) / 2, y: 0, z: 800 },
    yaw: 0,
  })
  world.step()

  let airborneTicks = 0
  let reached = false
  for (let tick = 0; tick < 60 * 40; tick++) {
    const throttle = vehicle.speed < targetSpeed ? 1 : 0
    stepVehicle(world, vehicle, tuning, { ...NEUTRAL_INPUT, throttle }, FIXED_TIMESTEP)
    world.step()
    const { z } = vehicle.frame.position
    if (z < 520 && z > 400 && vehicle.groundedCount === 0) airborneTicks++
    if (z < 300) {
      reached = true
      break
    }
  }
  world.free()
  return { airborneTicks, reached }
}

describe('ground stick', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  it('holds the car to the road over a crest it would otherwise leave', () => {
    const tuning = createVehicleTuning('sportsCar')
    const floating: VehicleTuning = { ...tuning, groundStickRange: 0 }

    const without = drive(runway(crest), floating, 30)
    const withStick = drive(runway(crest), tuning, 30)

    expect(without.reached).toBe(true)
    expect(withStick.reached).toBe(true)
    expect(without.airborneTicks).toBeGreaterThan(0)
    expect(withStick.airborneTicks).toBe(0)
  })

  it('still lets go off a real jump', () => {
    const flown = drive(runway(jump), createVehicleTuning('sportsCar'), 30)
    expect(flown.reached).toBe(true)
    // Half a second or more in the air: the ramp threw it, and nothing dragged it back down.
    expect(flown.airborneTicks).toBeGreaterThan(30)
  })
})
