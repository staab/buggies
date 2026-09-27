import {
  FIXED_TIMESTEP,
  FLAT,
  createPlanet,
  shapeToChart,
  shapeToWorld,
  shapeUp,
  uprightRotation,
  v3,
  vdot,
  vsub,
  type WorldShape,
} from '@buggies/physics'
import { PLANET_TERRAIN, ROAD_GRADE, generateTerrain, mapExtent, roadLift, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  NEUTRAL_INPUT,
  addTerrain,
  createPhysicsWorld,
  createVehicle,
  createVehicleTuning,
  initPhysics,
  stepVehicle,
  type Vehicle,
  type VehicleInput,
} from './index.ts'

let map: TerrainMap
let shape: WorldShape

describe('a car on a planet', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(1, PLANET_TERRAIN)
    const extent = mapExtent(map)
    shape = { kind: 'planet', planet: createPlanet(extent.x, extent.z) }
  }, 60_000)

  it.each([['flat'], ['planet']])('%s: stands on its wheels on the highway, and drives on along it, round the curve of the ground on a planet', (kind) => {
    if (kind === 'flat') shape = FLAT
    else shape = { kind: 'planet', planet: createPlanet(mapExtent(map).x, mapExtent(map).z) }
    const world = createPhysicsWorld(undefined, kind === 'planet')
    addTerrain(world, map, shape)
    const tuning = createVehicleTuning('sportsCar')
    // A straight run of the highway at grade, as near the equator as it runs.
    const highway = map.roads.find((road) => road.kind === 'highway')!
    const middle = (map.depth * map.cellSize) / 2
    let best = 0
    for (let i = 0; i + 12 < highway.points.length; i++) {
      if ([...Array(12).keys()].some((k) => highway.structure[i + k] !== ROAD_GRADE)) continue
      if (Math.abs(highway.points[i]!.z - middle) < Math.abs(highway.points[best]!.z - middle)) best = i
    }
    const at = highway.points[best]!
    const ahead = highway.points[best + 3]!
    const lift = roadLift(highway)
    const position = shapeToWorld(shape, at.x, at.y + lift, at.z, v3())
    const up = shapeUp(shape, position, v3())
    const heading = vsub(v3(), shapeToWorld(shape, ahead.x, ahead.y + lift, ahead.z, v3()), position)
    const vehicle = createVehicle(world, tuning, { position, yaw: 0, up, rotation: uprightRotation(up, heading) })
    world.step()

    const step = (input: VehicleInput): void => {
      shapeUp(shape, vehicle.frame.position, vehicle.up)
      stepVehicle(world, vehicle, tuning, input, FIXED_TIMESTEP)
      world.step()
    }
    /** How high the chassis is over the highway's surface nearest it, along the chart. */
    const clearance = (car: Vehicle): number => {
      const chart = shapeToChart(shape, car.frame.position, v3())
      let nearest = highway.points[0]!
      for (const point of highway.points) {
        if (Math.hypot(point.x - chart.x, point.z - chart.z) < Math.hypot(nearest.x - chart.x, nearest.z - chart.z)) nearest = point
      }
      return chart.y - (nearest.y + lift)
    }

    for (let i = 0; i < 120; i++) step(NEUTRAL_INPUT)
    expect(vdot(vehicle.frame.up, vehicle.up)).toBeGreaterThan(0.98)
    expect(vehicle.groundedCount).toBe(4)
    expect(clearance(vehicle)).toBeGreaterThan(0)
    expect(clearance(vehicle)).toBeLessThan(1.5)
    expect(vehicle.damage).toBe(0)

    const start = shapeToChart(shape, vehicle.frame.position, v3())
    for (let i = 0; i < 60 * 4; i++) step({ ...NEUTRAL_INPUT, throttle: 1 })
    const end = shapeToChart(shape, vehicle.frame.position, v3())
    // Well on along the ground, still on its wheels and on the ground: it followed the curve, not flown off it.
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(40)
    expect(vdot(vehicle.frame.up, vehicle.up)).toBeGreaterThan(0.9)
    expect(Math.abs(clearance(vehicle))).toBeLessThan(1.5)
    world.free()
  }, 60_000)
})
