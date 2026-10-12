/**
 * What is where on a planet: the ground and the water under a point, the
 * way up there, and a spot on the land, for anything that goes about it.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { gridPlace, groundIndex, sphereHeight, type GridPlace } from './sphere.ts'
import { DRY, type World } from './world.ts'
import { roofedAt, roomAt } from './worlds/hollows.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos, sin } = exact

/** The way up at a point, away from the planet's middle. */
export function upOf(point: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1
  out.x = point.x / length
  out.y = point.y / length
  out.z = point.z / length
  return out
}

/** How high a point is over the planet's radius. */
export function heightOver(world: World, point: Vec3): number {
  return Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) - world.radius
}

const up = { x: 0, y: 0, z: 0 }
const place: GridPlace = { face: 0, i: 0, j: 0 }

/** The height over the planet's radius of the ground under a point. */
export function groundUnder(world: World, point: Vec3): number {
  return sphereHeight(world.ground, upOf(point, up))
}

/** How high a point is over the ground under it. */
export function overGround(world: World, point: Vec3): number {
  return heightOver(world, point) - groundUnder(world, point)
}

/** The grid point of the ground nearest under a point. */
export function nearestGridPoint(world: World, point: Vec3): number {
  const { n } = world.ground
  gridPlace(n, upOf(point, up), place)
  return groundIndex(world.ground, place.face, Math.min(Math.max(Math.round(place.i), 0), n), Math.min(Math.max(Math.round(place.j), 0), n))
}

/** The water's surface over the planet's radius under a point, or `DRY`. */
export function waterUnder(world: World, point: Vec3): number {
  return world.water[nearestGridPoint(world, point)]!
}

/** The point this high over the planet's radius in a direction. */
export function atHeight(world: World, direction: Vec3, height: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const r = world.radius + height
  out.x = direction.x * r
  out.y = direction.y * r
  out.z = direction.z * r
  return out
}

/** The height over the radius of what is driven on in a direction: the ground, or the water where that is over it and nothing keeps it out. */
export function surfaceUnder(world: World, direction: Vec3): number {
  const ground = sphereHeight(world.ground, direction)
  return roofedAt(world.roof, nearestGridPoint(world, direction)) ? ground : Math.max(ground, world.seaLevel)
}

/** A point on the ground, or on the water where that is higher, this far over it. */
export function overSurface(world: World, direction: Vec3, rise: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  return atHeight(world, direction, surfaceUnder(world, direction) + rise, out)
}

/** The roof's height over the radius over a point, read between the four grid points round it; `Infinity` where any of them is open to the sky. */
export function roofOver(world: World, point: Vec3): number {
  if (world.roof.length === 0) return Number.POSITIVE_INFINITY
  const { n } = world.ground
  gridPlace(n, upOf(point, up), place)
  const i0 = Math.min(Math.max(Math.floor(place.i), 0), n - 1)
  const j0 = Math.min(Math.max(Math.floor(place.j), 0), n - 1)
  const fi = Math.min(Math.max(place.i - i0, 0), 1)
  const fj = Math.min(Math.max(place.j - j0, 0), 1)
  const at = (i: number, j: number): number => world.roof[groundIndex(world.ground, place.face, i, j)]!
  const low = at(i0, j0) * (1 - fi) + at(i0 + 1, j0) * fi
  const high = at(i0, j0 + 1) * (1 - fi) + at(i0 + 1, j0 + 1) * fi
  const roof = low * (1 - fj) + high * fj
  return Number.isNaN(roof) ? Number.POSITIVE_INFINITY : roof
}

/** Whether a point is lost to the world: fallen this far through the ground beneath it, or sunk this far under the sea over it. */
export function lostUnder(world: World, point: Vec3, depth: number): boolean {
  const height = heightOver(world, point)
  // The ground as it is driven on, bored out under the tunnels.
  if (height < sphereHeight({ n: world.ground.n, radius: world.radius, heights: world.bored }, upOf(point, up)) - depth) return true
  return height < world.seaLevel - depth && waterUnder(world, point) !== DRY
}

/** A direction picked evenly over the whole sphere by two draws of a generator. */
export function randomDirection(rng: () => number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const y = rng() * 2 - 1
  const around = rng() * 2 * Math.PI
  const ring = Math.sqrt(Math.max(1 - y * y, 0))
  out.x = ring * sin(around)
  out.y = y
  out.z = ring * cos(around)
  return out
}

/**
 * Whether the ground in a direction is land to drive on: clear of the sea,
 * or kept dry under a roof; and with room over it, not shut in the rock.
 */
export function onLand(world: World, direction: Vec3): boolean {
  if (world.roof.length === 0) return sphereHeight(world.ground, direction) > world.seaLevel
  const at = nearestGridPoint(world, direction)
  if (!roomAt(world.roof, world.ground.heights, at)) return false
  return roofedAt(world.roof, at) ? world.water[at] === DRY : sphereHeight(world.ground, direction) > world.seaLevel
}

/** A vector with its part along the way up taken out: its run along the ground. */
export function alongGround(vector: Vec3, way: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const rise = vector.x * way.x + vector.y * way.y + vector.z * way.z
  out.x = vector.x - way.x * rise
  out.y = vector.y - way.y * rise
  out.z = vector.z - way.z * rise
  return out
}

/** How far apart two points are along the ground, round the planet at the height of the second, leaving out how much higher one stands than the other. */
export function groundDistance(a: Vec3, b: Vec3): number {
  const cx = a.y * b.z - a.z * b.y
  const cy = a.z * b.x - a.x * b.z
  const cz = a.x * b.y - a.y * b.x
  const across = Math.sqrt(cx * cx + cy * cy + cz * cz)
  const along = a.x * b.x + a.y * b.y + a.z * b.z
  const length = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
  return length === 0 ? 0 : (atan2(across, along) * Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z))
}
