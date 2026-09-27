import {
  FLAT,
  cos,
  createChartFrame,
  createPlanet,
  shapeFrame,
  shapeToChart,
  shapeToWorld,
  sin,
  uprightRotation,
  v3,
  vcopy,
  type Vec3,
  type WorldShape,
} from '@buggies/physics'
import { mapExtent, type TerrainMap } from '@buggies/terrain'
import type { Vehicle, VehicleSpawn } from '@buggies/vehicle'

// The game plays on the chart, the map the island is laid out on: where the
// bananas lie, where the robots roll, what the saucer hunts over. On the flat
// that is the world itself. On a planet the cars are bodies on the sphere,
// and each keeps where it is on the chart, and which way it faces there, for
// the rest of the game to read.

/** Where a car is on the chart and which way it faces there, as of its last step. */
export interface SeatChart {
  /** Across the chart, how high over its ground, and down it. */
  readonly position: Vec3
  /** Its nose, its right and its roof, along the chart's axes: unit vectors, as the car's own are. */
  readonly forward: Vec3
  readonly right: Vec3
  readonly up: Vec3
  /** Meters in the world a meter of the chart comes to there. */
  scale: number
}

export function createSeatChart(): SeatChart {
  return { position: v3(), forward: v3(0, 0, -1), right: v3(1, 0, 0), up: v3(0, 1, 0), scale: 1 }
}

const frame = createChartFrame()

/** A world direction along the chart's axes where the frame is. */
function onChart(out: Vec3, direction: Vec3): Vec3 {
  const { east, up, south } = frame
  out.x = direction.x * east.x + direction.y * east.y + direction.z * east.z
  out.y = direction.x * up.x + direction.y * up.y + direction.z * up.z
  out.z = direction.x * south.x + direction.y * south.y + direction.z * south.z
  return out
}

/** Bring a car's place on the chart up to where its body is. */
export function updateSeatChart(shape: WorldShape, vehicle: Vehicle, chart: SeatChart): SeatChart {
  const { position, forward, right, up } = vehicle.frame
  if (shape.kind === 'flat') {
    vcopy(chart.position, position)
    vcopy(chart.forward, forward)
    vcopy(chart.right, right)
    vcopy(chart.up, up)
    chart.scale = 1
    return chart
  }
  shapeToChart(shape, position, chart.position)
  shapeFrame(shape, chart.position.x, chart.position.z, frame)
  onChart(chart.forward, forward)
  onChart(chart.right, right)
  onChart(chart.up, up)
  chart.scale = frame.scale
  return chart
}

/**
 * A spawn on the chart, where it is and which way it faces there, as the
 * world has it: on the flat, the same; on a planet, carried round onto the
 * sphere with the car stood upright there, facing the same way along it.
 */
export function worldSpawn(shape: WorldShape, spawn: VehicleSpawn): VehicleSpawn {
  if (shape.kind === 'flat') return spawn
  const { x, y, z } = spawn.position
  const position = shapeToWorld(shape, x, y, z, v3())
  shapeFrame(shape, x, z, frame)
  // A yaw of nothing faces down the chart's -z, as a car faces its own -z.
  const fx = -sin(spawn.yaw)
  const fz = -cos(spawn.yaw)
  const { east, south } = frame
  const forward = v3(east.x * fx + south.x * fz, east.y * fx + south.y * fz, east.z * fx + south.z * fz)
  const up = v3(frame.up.x, frame.up.y, frame.up.z)
  return { position, yaw: spawn.yaw, up, rotation: uprightRotation(up, forward) }
}

/** A chart point, this high over the chart's ground, in the world. */
export function chartPoint(shape: WorldShape, point: Vec3, out: Vec3 = v3()): Vec3 {
  return shapeToWorld(shape, point.x, point.y, point.z, out)
}

/** The shape of the world a map makes: wrapped round a planet, once round its equator across, or flat. */
export function shapeOf(map: TerrainMap): WorldShape {
  if (!map.planet) return FLAT
  const extent = mapExtent(map)
  return { kind: 'planet', planet: createPlanet(extent.x, extent.z) }
}
