import { atan2, cos, exp, hypot, log, sin, type Vec3 } from './math.ts'

// The world as a small planet, its center at the origin and its north pole up
// the y axis. The ground is laid out on a flat chart and wrapped round it: a
// point's x across the chart is how far east it is, all the way round once,
// and its z down the chart how far south, by Mercator's projection, which
// keeps every small shape as it is and only scales it. So that what stands on
// the chart stands on the sphere the same, only smaller, a height over the
// chart is scaled by the same amount: near the equator by nothing at all, and
// by less than one further toward the poles.

/** A planet: how big it is, and the chart its ground is laid out on. */
export interface Planet {
  /** Its radius, in meters, at the chart's ground level. */
  readonly radius: number
  /** The chart's extent, in meters: once round the equator across, and pole to pole down, as far as the chart goes. */
  readonly chartX: number
  readonly chartZ: number
}

/** A planet whose equator is once across a chart this wide, and whose chart is this deep. */
export function createPlanet(chartX: number, chartZ: number): Planet {
  return { radius: chartX / (2 * Math.PI), chartX, chartZ }
}

/** Where a chart point lies on the planet: its longitude and latitude, in radians, and how much the chart is scaled there. */
export interface ChartPlace {
  longitude: number
  latitude: number
  /** Meters on the planet a meter of the chart comes to there. */
  scale: number
}

/** Longitude and latitude of a chart point, and the chart's scale there. */
export function placeOf(planet: Planet, x: number, z: number, out: ChartPlace): ChartPlace {
  out.longitude = (x / planet.chartX) * 2 * Math.PI - Math.PI
  // North is up the chart, toward smaller z: the Gudermannian of how far north of the middle it is.
  const north = (planet.chartZ / 2 - z) / planet.radius
  out.latitude = 2 * atan2(exp(north), 1) - Math.PI / 2
  out.scale = cos(out.latitude)
  return out
}

/** The unit direction from the planet's center through a longitude and latitude. */
export function directionOf(longitude: number, latitude: number, out: Vec3): Vec3 {
  const c = cos(latitude)
  out.x = c * sin(longitude)
  out.y = sin(latitude)
  out.z = c * cos(longitude)
  return out
}

const place: ChartPlace = { longitude: 0, latitude: 0, scale: 1 }

/**
 * A point of the chart, this high over the chart's ground level, as a point
 * in the world: on the planet's surface, out from it by the height scaled as
 * the chart is there.
 */
export function chartToWorld(planet: Planet, x: number, height: number, z: number, out: Vec3): Vec3 {
  placeOf(planet, x, z, place)
  directionOf(place.longitude, place.latitude, out)
  const r = planet.radius + height * place.scale
  out.x *= r
  out.y *= r
  out.z *= r
  return out
}

/** A world point as a point of the chart: across, how high over the chart's ground level, and down. */
export function worldToChart(planet: Planet, point: Vec3, out: Vec3): Vec3 {
  const around = hypot(point.x, point.z)
  const latitude = atan2(point.y, around)
  const longitude = atan2(point.x, point.z)
  const scale = cos(latitude)
  // Mercator's northing: the log of the tangent of half the way from the south pole.
  const north = log((1 + sin(latitude)) / scale)
  const r = hypot(around, point.y)
  out.x = ((longitude + Math.PI) / (2 * Math.PI)) * planet.chartX
  out.y = (r - planet.radius) / scale
  out.z = planet.chartZ / 2 - north * planet.radius
  return out
}

/**
 * The directions a chart point's axes run in the world: its x, east; its
 * height, up, away from the planet's center; and its z, south. Each a unit
 * vector, and together a right-handed frame, as the chart's own axes are.
 */
export interface ChartFrame {
  readonly east: Vec3
  readonly up: Vec3
  readonly south: Vec3
  /** Meters on the planet a meter of the chart comes to there. */
  scale: number
}

export function createChartFrame(): ChartFrame {
  return { east: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, south: { x: 0, y: 0, z: 1 }, scale: 1 }
}

/** The frame of the chart's axes at a chart point. */
export function chartFrame(planet: Planet, x: number, z: number, out: ChartFrame): ChartFrame {
  placeOf(planet, x, z, place)
  const { longitude, latitude } = place
  directionOf(longitude, latitude, out.up)
  const sl = sin(longitude)
  const cl = cos(longitude)
  const sp = sin(latitude)
  out.east.x = cl
  out.east.y = 0
  out.east.z = -sl
  // South is down the meridian: the way latitude falls.
  out.south.x = sp * sl
  out.south.y = -cos(latitude)
  out.south.z = sp * cl
  out.scale = place.scale
  return out
}

/** The way up, away from the planet's center, at a world point. */
export function upAt(point: Vec3, out: Vec3): Vec3 {
  const r = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1
  out.x = point.x / r
  out.y = point.y / r
  out.z = point.z / r
  return out
}
