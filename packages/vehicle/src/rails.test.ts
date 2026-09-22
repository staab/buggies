import { flatHeightfield, type Road } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT } from './input.ts'
import { addHeightfield, addRailRuns } from './terrain.ts'
import { createVehicleTuning } from './tuning.ts'
import { stepVehicle } from './vehicle.ts'
import { createVehicle } from './vehicleBody.ts'
import { FIXED_TIMESTEP, createPhysicsWorld, initPhysics } from './world.ts'

const CELL = 3
const LENGTH = 300
const WIDTH = 15
const MIDDLE = (WIDTH * CELL) / 2
/** A rail down the runway, a little to the right of where the car starts. */
const RAIL_X = MIDDLE + 4

describe('guardrails', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  it('let a car that meets them at a shallow angle scrape along and carry on', () => {
    const world = createPhysicsWorld()
    addHeightfield(world, flatHeightfield(WIDTH, LENGTH, CELL))
    // The car drives down -Z; a rail on its right is the road's right edge,
    // already alongside it where it starts.
    const points = [{ x: RAIL_X, y: 0, z: 795 }, { x: RAIL_X, y: 0, z: 400 }, { x: RAIL_X, y: 0, z: 50 }]
    const road: Road = {
      id: 0,
      kind: 'highway',
      closed: false,
      width: 2 * (RAIL_X - MIDDLE),
      points: points.map((point) => ({ ...point, x: MIDDLE })),
      structure: new Uint8Array(points.length - 1),
    }
    addRailRuns(world, [{ road, points, side: -1, flaredStart: false, flaredEnd: false }])
    const tuning = createVehicleTuning('sportsCar')
    const vehicle = createVehicle(world, tuning, { position: { x: MIDDLE, y: 0, z: 800 }, yaw: 0 })
    world.step()

    // Up to speed, then held gently toward the rail: it should be met at a
    // few degrees and slid along, not stopped.
    let touched = false
    let entrySpeed = 0
    let slowest = Infinity
    let farthest = 800
    for (let tick = 0; tick < 60 * 15; tick++) {
      const steer = vehicle.speed > 20 ? 0.06 : 0
      const throttle = vehicle.speed < 25 ? 1 : 0
      stepVehicle(world, vehicle, tuning, { ...NEUTRAL_INPUT, throttle, steer }, FIXED_TIMESTEP)
      world.step()
      const { x, z } = vehicle.frame.position
      // Never through the wall.
      expect(x).toBeLessThan(RAIL_X + tuning.chassisHalfWidth)
      if (!touched && x > RAIL_X - tuning.chassisHalfLength) {
        touched = true
        entrySpeed = vehicle.speed
      }
      if (touched) slowest = Math.min(slowest, vehicle.speed)
      farthest = Math.min(farthest, z)
    }
    expect(touched).toBe(true)
    expect(entrySpeed).toBeGreaterThan(15)
    // Along the rail rather than into it: most of the speed survives, and the
    // car is far down the runway by the end, a little short of where it would
    // be had it never touched the rail.
    expect(slowest).toBeGreaterThan(entrySpeed * 0.5)
    expect(farthest).toBeLessThan(500)
    // A scrape is not a crash: it costs the car a little, never the lot.
    expect(vehicle.damage).toBeLessThan(0.3)
    expect(vehicle.wrecked).toBe(false)
    world.free()
  })

  it('let a car scrape round a bend in the rail, seam after seam, without catching', () => {
    // A wide runway, and a rail that starts beside the car and bends into
    // its path a little at every point: every seam between the facets is
    // met by the chassis corner sliding along the rail, and each one is a
    // chance to catch.
    const width = 40
    const middle = (width * CELL) / 2
    const railX = middle + 4
    const world = createPhysicsWorld()
    addHeightfield(world, flatHeightfield(width, LENGTH, CELL))
    const points = [{ x: railX, y: 0, z: 795 }]
    for (let k = 1; k <= 24; k++) {
      const heading = (k * 1.5 * Math.PI) / 180
      const last = points[points.length - 1]!
      points.push({ x: last.x - 6 * Math.sin(heading), y: 0, z: last.z - 6 * Math.cos(heading) })
    }
    const road: Road = {
      id: 0,
      kind: 'highway',
      closed: false,
      width: 2 * (railX - middle),
      points: points.map((point) => ({ ...point, x: point.x - (railX - middle) })),
      structure: new Uint8Array(points.length - 1),
    }
    addRailRuns(world, [{ road, points, side: -1, flaredStart: false, flaredEnd: false }])
    const railAt = (z: number): number => {
      for (let k = 0; k + 1 < points.length; k++) {
        const a = points[k]!
        const b = points[k + 1]!
        if (z <= a.z && z >= b.z) return a.x + ((b.x - a.x) * (a.z - z)) / (a.z - b.z || 1)
      }
      return Number.POSITIVE_INFINITY
    }
    const tuning = createVehicleTuning('sportsCar')
    const vehicle = createVehicle(world, tuning, { position: { x: middle, y: 0, z: 800 }, yaw: 0 })
    world.step()

    let touched = false
    let entrySpeed = 0
    let slowest = Infinity
    let farthest = 800
    for (let tick = 0; tick < 60 * 12; tick++) {
      const throttle = vehicle.speed < 25 ? 1 : 0
      stepVehicle(world, vehicle, tuning, { ...NEUTRAL_INPUT, throttle }, FIXED_TIMESTEP)
      world.step()
      const { x, z } = vehicle.frame.position
      expect(x).toBeLessThan(railAt(z) + tuning.chassisHalfWidth)
      if (!touched && x > railAt(z) - tuning.chassisHalfWidth - 0.3) {
        touched = true
        entrySpeed = vehicle.speed
      }
      if (touched) slowest = Math.min(slowest, vehicle.speed)
      farthest = Math.min(farthest, z)
    }
    expect(touched).toBe(true)
    expect(entrySpeed).toBeGreaterThan(20)
    // Turned by the rail, not stopped by it: the bend costs a little speed
    // and nothing more, and the car is round it by the end.
    expect(slowest).toBeGreaterThan(entrySpeed * 0.7)
    expect(farthest).toBeLessThan(points[points.length - 1]!.z)
    world.free()
  })
})
