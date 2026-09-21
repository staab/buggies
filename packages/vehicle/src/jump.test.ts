import type * as RAPIER from '@dimforge/rapier3d-compat'
import { flatHeightfield, type Heightfield } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT } from './input.ts'
import { addHeightfield } from './terrain.ts'
import { createVehicleTuning, type VehicleTuning } from './tuning.ts'
import { stepVehicle } from './vehicle.ts'
import { createVehicle, type Vehicle } from './vehicleBody.ts'
import { FIXED_TIMESTEP, addDynamicBox, createPhysicsWorld, initPhysics } from './world.ts'

const CELL = 3
const LENGTH = 400
const WIDTH = 15

/** A straight run down -Z with whatever `profile` puts in the way. */
function runway(profile: (z: number) => number): Heightfield {
  const field = flatHeightfield(WIDTH, LENGTH, CELL)
  for (let row = 0; row < LENGTH; row++) {
    for (let col = 0; col < WIDTH; col++) field.heights[row * WIDTH + col] = profile(row * CELL)
  }
  return field
}

/** A massive kicker: a 30% climb over 45m to a lip 13.5m up, then nothing. */
function kicker(z: number): number {
  return z >= 800 && z <= 845 ? (845 - z) * 0.3 : 0
}

interface Flight {
  airborneTicks: number
  /** The lowest the car's up came to pointing while in the air. */
  lowestUp: number
  /** Which way was up the instant it came back down. */
  landedUp: number
  farthest: number
  /** What the whole flight, landing included, cost the car. */
  damage: number
}

/** Drive at a kicker holding a target speed; watch the flight, and how it ends. */
function fly(
  field: Heightfield,
  tuning: VehicleTuning,
  targetSpeed: number,
  disturb?: (world: RAPIER.World, vehicle: Vehicle) => void,
): Flight {
  const world = createPhysicsWorld()
  addHeightfield(world, field)
  const vehicle = createVehicle(world, tuning, {
    position: { x: (WIDTH * CELL) / 2, y: 0, z: 1150 },
    yaw: 0,
  })
  world.step()

  let airborneTicks = 0
  let lowestUp = 1
  let landedUp = 1
  let farthest = 1150
  let disturbed = false
  let flying = false
  for (let tick = 0; tick < 60 * 30; tick++) {
    const throttle = vehicle.speed < targetSpeed ? 1 : 0
    stepVehicle(world, vehicle, tuning, { ...NEUTRAL_INPUT, throttle }, FIXED_TIMESTEP)
    world.step()
    const { z } = vehicle.frame.position
    farthest = Math.min(farthest, z)
    const airborne = vehicle.groundedCount === 0
    if (airborne && z < 800) {
      airborneTicks++
      if (disturb && !disturbed && airborneTicks === 12) {
        disturb(world, vehicle)
        disturbed = true
      }
      flying = true
      lowestUp = Math.min(lowestUp, vehicle.frame.up.y)
    } else if (flying) {
      landedUp = vehicle.frame.up.y
      flying = false
      if (airborneTicks > 30) break
    }
    if (z < 200) break
  }
  world.free()
  return { airborneTicks, lowestUp, landedUp, farthest, damage: vehicle.damage }
}

describe('jumps', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  it('carries a car off a massive kicker and lands it on its wheels', () => {
    for (const profile of ['mustang', 'pickup', 'raceCar'] as const) {
      const flight = fly(runway(kicker), createVehicleTuning(profile), 40)
      // A long flight, held level all the way, down on its wheels.
      expect(flight.airborneTicks).toBeGreaterThan(60)
      expect(flight.lowestUp).toBeGreaterThan(0.7)
      expect(flight.landedUp).toBeGreaterThan(0.85)
      expect(flight.farthest).toBeLessThan(800)
      // Coming down hard is a landing, not a crash.
      expect(flight.damage).toBeLessThan(0.3)
    }
  })

  it('lets a car that is hit in the air tumble, and levels one that is not', () => {
    // The same knock, a car's worth of mass coming across at roof height:
    // once with the crash noticed, once with it not.
    const shove = (world: RAPIER.World, vehicle: Vehicle): void => {
      const { position, linearVelocity } = vehicle.frame
      addDynamicBox(world, {
        halfExtents: { x: 1, y: 0.5, z: 1 },
        position: { x: position.x + 3, y: position.y + 0.6, z: position.z },
        mass: 1200,
      }).setLinvel({ x: linearVelocity.x - 12, y: linearVelocity.y, z: linearVelocity.z }, true)
    }
    const tuning = createVehicleTuning('mustang')
    const knocked = fly(runway(kicker), tuning, 40, shove)
    const levelled = fly(runway(kicker), { ...tuning, impactSpeedChange: Number.POSITIVE_INFINITY }, 40, shove)
    expect(knocked.lowestUp).toBeLessThan(0)
    expect(levelled.lowestUp).toBeGreaterThan(0.5)
    expect(levelled.landedUp).toBeGreaterThan(0.85)
  })
})
