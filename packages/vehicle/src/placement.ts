// Where something laid out on the chart stands in the world: on the flat,
// just where the chart has it; on a planet, carried round onto the sphere,
// turned to stand upright there, and scaled as the chart is there.

import {
  createChartFrame,
  qmultiply,
  quatFromBasis,
  quatFromYaw,
  shapeFrame,
  shapeToWorld,
  v3,
  type Quat,
  type Vec3,
  type WorldShape,
} from '@buggies/physics'

/** Something's place in the world: where it is, how it is turned, and how much it is scaled from the chart. */
export interface Placement {
  readonly position: Vec3
  rotation: Quat
  scale: number
}

const frame = createChartFrame()

/**
 * Where a thing is that the chart has here, this high over its ground and
 * turned by this yaw about its own up: the yaw alone on the flat, and on a
 * planet the turn that stands the chart's axes on the sphere there, then
 * the yaw about the way up.
 */
export function placeOnShape(shape: WorldShape, x: number, height: number, z: number, yaw: number): Placement {
  const position = shapeToWorld(shape, x, height, z, v3())
  if (shape.kind === 'flat') return { position, rotation: quatFromYaw(yaw), scale: 1 }
  shapeFrame(shape, x, z, frame)
  const { east, up, south } = frame
  const standing = quatFromBasis(east.x, east.y, east.z, up.x, up.y, up.z, south.x, south.y, south.z)
  return { position, rotation: qmultiply(standing, quatFromYaw(yaw)), scale: frame.scale }
}

/** A run of chart points, x, height and z each, carried into the world: as they are on the flat. */
export function bendPositions(shape: WorldShape, positions: Float32Array | number[]): Float32Array {
  const out = Float32Array.from(positions)
  if (shape.kind === 'flat') return out
  const point = v3()
  for (let i = 0; i < out.length; i += 3) {
    shapeToWorld(shape, out[i]!, out[i + 1]!, out[i + 2]!, point)
    out[i] = point.x
    out[i + 1] = point.y
    out[i + 2] = point.z
  }
  return out
}
