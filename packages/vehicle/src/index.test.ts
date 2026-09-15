import { FIXED_TIMESTEP } from '@buggies/physics'
import {
  ROAD_BRIDGE,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  flatHeightfield,
  generateTerrain,
  type Heightfield,
} from '@buggies/terrain'
import { describe, expect, it } from 'vitest'

import {
  NEUTRAL_INPUT,
  createDriveSurface,
  createVehicle,
  flatDriveSurface,
  groundAt,
  stepVehicle,
  vehicleTuning,
  type DriveSurface,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleState,
} from './index.ts'

const dt = FIXED_TIMESTEP
const SIZE = 256
const CELL = 4

function shaped(height: (x: number, z: number) => number): Heightfield {
  const field = flatHeightfield(SIZE, SIZE, CELL)
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      field.heights[row * SIZE + col] = height(col * CELL, row * CELL)
    }
  }
  return field
}

function drive(
  state: VehicleState,
  surface: DriveSurface,
  profile: VehicleProfileId,
  input: Partial<VehicleInput>,
  seconds: number,
  topSpeed = Infinity,
): VehicleState {
  const tuning = vehicleTuning(profile)
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const throttle = state.forwardSpeed < topSpeed ? 1 : 0
    state = stepVehicle(state, { ...NEUTRAL_INPUT, throttle, ...input }, dt, surface, tuning)
  }
  return state
}

/** Get up to `speed` on the flat, or as near as this vehicle ever gets. */
function atSpeed(profile: VehicleProfileId, speed: number): [VehicleState, DriveSurface] {
  const surface = flatDriveSurface(flatHeightfield(SIZE, SIZE, CELL))
  const tuning = vehicleTuning(profile)
  let state = createVehicle({ x: 500, y: 0, z: 40 })
  for (let i = 0; i < Math.round(60 / dt) && state.forwardSpeed < speed; i++) {
    state = stepVehicle(state, { ...NEUTRAL_INPUT, throttle: 1 }, dt, surface, tuning)
  }
  return [state, surface]
}

function driftAngle(state: VehicleState): number {
  return Math.atan2(state.slip, Math.abs(state.forwardSpeed))
}

describe('vehicle', () => {
  it('accelerates, then stops when the brake goes on', () => {
    const [rolling, surface] = atSpeed('buggy', 30)
    expect(rolling.forwardSpeed).toBeGreaterThan(29)

    const stopped = drive(rolling, surface, 'buggy', { throttle: 0, brake: 1 }, 4)
    expect(stopped.forwardSpeed).toBeLessThanOrEqual(0)
  })

  it('reverses once the brake pedal has nothing left to stop', () => {
    const surface = flatDriveSurface(flatHeightfield(SIZE, SIZE, CELL))
    const state = drive(createVehicle({ x: 500, y: 0, z: 400 }), surface, 'buggy', { throttle: 0, brake: 1 }, 3)
    expect(state.forwardSpeed).toBeLessThan(-3)
    expect(state.position.z).toBeLessThan(400)
  })

  it('turns the way it is steered', () => {
    // Nose along +Z and up along +Y puts the vehicle's right at -X, so steering
    // right has to carry it that way. Getting this backwards is invisible in
    // every figure that takes an absolute value, and obvious the moment anyone
    // drives it.
    const [rolling, surface] = atSpeed('buggy', 18)
    expect(rolling.heading).toBe(0)
    const startX = rolling.position.x

    const right = drive(rolling, surface, 'buggy', { steer: 1 }, 2, 18)
    expect(right.position.x).toBeLessThan(startX - 5)
    expect(right.steerAngle).toBeLessThan(0)

    const left = drive(rolling, surface, 'buggy', { steer: -1 }, 2, 18)
    expect(left.position.x).toBeGreaterThan(startX + 5)
    expect(left.steerAngle).toBeGreaterThan(0)
  })

  it('holds a steady corner at the grip its tyres are given', () => {
    for (const profile of ['buggy', 'truck', 'racer'] as const) {
      const [rolling, surface] = atSpeed(profile, 20)
      const turning = drive(rolling, surface, profile, { steer: 1 }, 4, 20)
      const radius = Math.abs(turning.forwardSpeed / turning.yawRate)
      const lateral = (turning.forwardSpeed * turning.forwardSpeed) / radius
      expect(lateral).toBeCloseTo(vehicleTuning(profile).gripLimit, 0)
      // Planted, not sliding: a steady corner has to be somewhere to live.
      expect(driftAngle(turning)).toBeLessThan(0.15)
    }
  })

  it('steps the back out on the handbrake, most in the racer and least in the truck', () => {
    const drifts = (['truck', 'buggy', 'racer'] as const).map((profile) => {
      const [rolling, surface] = atSpeed(profile, 20)
      return driftAngle(drive(rolling, surface, profile, { steer: 1, handbrake: true }, 1, 0))
    })
    expect(drifts[0]).toBeLessThan(drifts[1]!)
    expect(drifts[1]).toBeLessThan(drifts[2]!)
    // The truck is meant to plough, the racer to swap ends.
    expect(drifts[0]).toBeLessThan(0.45)
    expect(drifts[2]).toBeGreaterThan(1)
  })

  it('lets a slide be caught by winding the lock off', () => {
    for (const profile of ['buggy', 'truck', 'racer'] as const) {
      const [rolling, surface] = atSpeed(profile, 24)
      const sliding = drive(rolling, surface, profile, { steer: 1, handbrake: true }, 1, 24)
      expect(sliding.slip).toBeGreaterThan(2)
      const caught = drive(sliding, surface, profile, { steer: -1 }, 1, 24)
      expect(caught.slip).toBeLessThan(1)
    }
  })

  it('trades grip between driving and turning, so a trailed brake rotates it', () => {
    const rotation = (['truck', 'buggy', 'racer'] as const).map((profile) => {
      const [rolling, surface] = atSpeed(profile, 25)
      const turning = drive(rolling, surface, profile, { steer: 1 }, 0.6, 25)
      return drive(turning, surface, profile, { steer: 1, brake: 1 }, 0.6, 0).slip
    })
    expect(rotation[0]).toBeLessThan(rotation[1]!)
    expect(rotation[1]).toBeLessThan(rotation[2]!)
  })

  it('climbs a slope it has the grip for and is stopped by one it has not', () => {
    const rise = (grade: number) => flatDriveSurface(shaped((_x, z) => Math.max(0, z - 200) * grade))

    const climbed = drive(createVehicle({ x: 500, y: 0, z: 40 }), rise(0.3), 'buggy', {}, 12)
    expect(climbed.position.y).toBeGreaterThan(40)
    // Still pulling, not grinding to a halt on the way up.
    expect(climbed.forwardSpeed).toBeGreaterThan(5)

    const stopped = drive(createVehicle({ x: 500, y: 0, z: 40 }), rise(3), 'buggy', {}, 12)
    expect(stopped.position.z).toBeLessThan(215)
    expect(stopped.position.y).toBeLessThan(15)
  })

  it('keeps its wheels on a steady climb all the way up', () => {
    const surface = flatDriveSurface(shaped((_x, z) => Math.max(0, z - 200) * 0.25))
    let state = createVehicle({ x: 500, y: 0, z: 40 })
    let lifted = 0
    for (let i = 0; i < Math.round(14 / dt); i++) {
      state = stepVehicle(state, { ...NEUTRAL_INPUT, throttle: 1 }, dt, surface, vehicleTuning('buggy'))
      if (state.position.z > 260 && !state.grounded) lifted++
    }
    // Nothing about a constant gradient should take the wheels off it.
    expect(lifted).toBe(0)
    expect(state.position.y).toBeGreaterThan(30)
  })

  it('leaves the ground over a lip and comes down level', () => {
    const surface = flatDriveSurface(shaped((_x, z) => Math.min(Math.max(z - 200, 0), 40) * 0.5))
    let state = createVehicle({ x: 500, y: 0, z: 40 })
    let airborne = 0
    let peak = 0
    for (let i = 0; i < Math.round(14 / dt); i++) {
      state = stepVehicle(state, { ...NEUTRAL_INPUT, throttle: 1 }, dt, surface, vehicleTuning('buggy'))
      if (!state.grounded) {
        airborne++
        peak = Math.max(peak, state.position.y - groundAt(surface, state.position.x, state.position.z, state.position.y))
      }
    }
    expect(airborne).toBeGreaterThan(10)
    expect(peak).toBeGreaterThan(1)
    // Back on the ground, and flat enough to drive away from.
    expect(state.grounded).toBe(true)
    expect(Math.abs(state.pitch)).toBeLessThan(0.2)
  })

  it('floats in water instead of sinking through it', () => {
    const surface = flatDriveSurface(flatHeightfield(SIZE, SIZE, CELL))
    surface.water.fill(6)
    let state = createVehicle({ x: 500, y: 0, z: 400 })
    for (let i = 0; i < Math.round(8 / dt); i++) {
      state = stepVehicle(state, NEUTRAL_INPUT, dt, surface, vehicleTuning('buggy'))
    }
    expect(state.submerged).toBe(true)
    expect(state.position.y).toBeGreaterThan(3)
    expect(state.position.y).toBeLessThan(6)
    expect(Math.abs(state.velocity.y)).toBeLessThan(0.5)
  })

  it('can paddle out of water it has floated into', () => {
    const surface = flatDriveSurface(flatHeightfield(SIZE, SIZE, CELL))
    surface.water.fill(6)
    let state = createVehicle({ x: 500, y: 0, z: 400 })
    for (let i = 0; i < Math.round(4 / dt); i++) {
      state = stepVehicle(state, NEUTRAL_INPUT, dt, surface, vehicleTuning('buggy'))
    }
    expect(state.submerged).toBe(true)
    const adrift = state.position.z

    const paddled = drive(state, surface, 'buggy', {}, 8)
    expect(paddled.position.z).toBeGreaterThan(adrift + 5)
    // Slowly, though. Water is not a road.
    expect(paddled.forwardSpeed).toBeLessThan(5)
  })

  it('drives on the road that is drawn, not the bed cut under it', () => {
    const map = generateTerrain(3, { size: 513 })
    const surface = createDriveSurface(map)
    let worst = 0
    for (const road of map.roads) {
      const count = road.points.length
      for (const [i, point] of road.points.entries()) {
        const structure = road.structure
        if (structure[i % count] === ROAD_TUNNEL) continue
        if (structure[(i - 1 + count) % count] === ROAD_TUNNEL) continue
        const want = point.y + ROAD_SURFACE
        worst = Math.max(worst, want - groundAt(surface, point.x, point.z, want))
      }
    }
    // Never below the carriageway: that gap is a vehicle buried in the road.
    expect(worst).toBeLessThan(0.05)
  })

  it('crosses a bridge instead of dropping into what it spans', () => {
    const map = generateTerrain(3, { size: 513 })
    const bridge = map.roads.flatMap((road) => {
      const count = road.points.length
      const segmentCount = road.closed ? count : count - 1
      return Array.from({ length: segmentCount }, (_, i) => ({ road, i })).filter(
        ({ i }) => road.structure[i] === ROAD_BRIDGE,
      )
    })[0]
    expect(bridge).toBeDefined()

    const { road, i } = bridge!
    const a = road.points[i]!
    const b = road.points[(i + 1) % road.points.length]!
    const midX = (a.x + b.x) / 2
    const midZ = (a.z + b.z) / 2
    const deck = (a.y + b.y) / 2 + ROAD_SURFACE

    const surface = createDriveSurface(map)
    const standing = groundAt(surface, midX, midZ, deck)
    // On the span. Spans overlap at bends and the highest wins, so it can read
    // a little proud of the midpoint, but never below it.
    expect(standing).toBeGreaterThanOrEqual(deck - 1e-6)
    expect(standing).toBeLessThan(deck + 0.5)
    // Well clear of the ground the span was built to get over.
    expect(groundAt(surface, midX, midZ, deck)).toBeGreaterThan(
      groundAt(surface, midX, midZ, Number.NEGATIVE_INFINITY) + 1,
    )
    // And a vehicle underneath is not yanked up onto it.
    expect(groundAt(surface, midX, midZ, deck - 6)).toBeLessThan(deck - 1)
  })

  it('steps deterministically for the same inputs', () => {
    const run = () => {
      const surface = flatDriveSurface(shaped((x, z) => Math.sin(x / 90) * 4 + Math.cos(z / 70) * 3))
      let state = createVehicle({ x: 500, y: 0, z: 40 })
      for (let i = 0; i < 600; i++) {
        const steer = Math.sin(i / 37)
        state = stepVehicle(state, { ...NEUTRAL_INPUT, throttle: 1, steer }, dt, surface, vehicleTuning('racer'))
      }
      return state
    }
    expect(run()).toEqual(run())
  })
})
