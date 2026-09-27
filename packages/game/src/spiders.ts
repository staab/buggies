import { FLAT, createRng, v3, type Vec3, type WorldShape } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { mapExtent, sampleHeight, type TerrainMap } from '@buggies/terrain'
import { addMover, placeOnShape } from '@buggies/vehicle'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos, hypot, sin } = exact

/** How many giant spiders walk each island. */
export const SPIDERS = 1
/** How fast it walks, in m/s, and how fast it turns, in radians a second. */
export const SPIDER_SPEED = 2.5
const SPIDER_TURN = 0.3
/** How high its belly hangs over the ground, and half its body's size across, up and along: a car drives under it, between its legs. */
export const SPIDER_BELLY = 10
export const SPIDER_BODY = { halfWidth: 5.5, halfHeight: 3, halfDepth: 7 } as const
/** How far its legs reach out from its middle, for whoever draws them. */
export const SPIDER_REACH = 19
/** How often it lets a bomb fall from its belly, in ticks, and how long it waits before its first. */
export const SPIDER_BOMB_TICKS = 60 * 30
/** How near a waypoint it has to come to have reached it. */
const WAYPOINT_REACH = 15
const SPIDER_SALT = 0x5b1d

/**
 * A giant spider: it strides across the island from one spot on the land
 * to the next, over whatever is in the way, high enough for a car to drive
 * under it, and every thirty seconds lets a bomb fall from its belly. It
 * can be shot down, and comes back whole somewhere else.
 */
export interface Spider {
  readonly id: number
  /** Where its feet are: the ground under its middle. */
  readonly position: Vec3
  /** Which way it faces, as a yaw: 0 is toward -Z, as a car's. */
  heading: number
  /** How many waypoints it has reached, which picks the next, and where the one it is walking to is. */
  legs: number
  readonly target: { x: number; z: number }
  /** How far it has walked, all told, which sets its legs' stride. */
  stride: number
  /** How long until its next bomb, in ticks. */
  bombTicks: number
  /** How much of what brings it down it has taken, 0 to 1, and how many times it has been brought down, which picks where it comes back. */
  damage: number
  deaths: number
  /** Its body, which the cars run into. */
  readonly body: RAPIER.RigidBody
  /** The shape of the world its body is in: it walks the map, and its body goes where that is in the world. */
  readonly shape: WorldShape
}

function spiderSeed(map: TerrainMap, id: number): number {
  return (map.seed ^ SPIDER_SALT) + id * 7919
}

/** The ground under a point, or the water where that is higher: it wades nothing, and strides over the water as over the land. */
function groundAt(map: TerrainMap, x: number, z: number): number {
  return Math.max(sampleHeight(map.heightfield, x, z), map.seaLevel)
}

/** How far outside a city's suburbs a spider keeps, beyond the reach of its legs. */
const CITY_BERTH = 20

/** How far a point is inside the ground a spider keeps off around a city, or less than zero outside it. */
function intoCity(map: TerrainMap, x: number, z: number): number {
  let most = -Infinity
  for (const city of map.districts) {
    const keep = city.radius + city.suburbWidth + SPIDER_REACH + CITY_BERTH
    most = Math.max(most, keep - hypot(x - city.cx, z - city.cz))
  }
  return most
}

/** Whether the straight way from one point to another keeps out of every city. */
function clearOfCities(map: TerrainMap, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const steps = Math.max(Math.ceil(hypot(to.x - from.x, to.z - from.z) / 20), 1)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (intoCity(map, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t) > 0) return false
  }
  return true
}

/**
 * Where a spider walks to next: a point on the land and out of the cities,
 * picked by how many it has reached, and one it can walk straight to from
 * where it is without going through a city, when there is one to be had.
 */
export function spiderWaypoint(
  map: TerrainMap,
  id: number,
  legs: number,
  out: { x: number; z: number },
  from?: { x: number; z: number },
): { x: number; z: number } {
  const rng = createRng(spiderSeed(map, id) + legs * 131)
  const extent = mapExtent(map)
  // Failing that, the point on the land least far into a city.
  let fallback = { x: extent.x / 2, z: extent.z / 2, into: Infinity }
  for (let attempt = 0; attempt < 48; attempt++) {
    out.x = extent.x * (0.1 + 0.8 * rng())
    out.z = extent.z * (0.1 + 0.8 * rng())
    if (sampleHeight(map.heightfield, out.x, out.z) <= map.seaLevel) continue
    const into = intoCity(map, out.x, out.z)
    if (into <= 0 && (from === undefined || clearOfCities(map, from, out))) return out
    if (into < fallback.into) fallback = { x: out.x, z: out.z, into }
  }
  out.x = fallback.x
  out.z = fallback.z
  return out
}

/** Its body where its feet are now: at once, or over the next step. */
export function seatSpiderBody(spider: Spider, now: boolean): void {
  const { position: at, rotation: turn } = placeOnShape(
    spider.shape,
    spider.position.x,
    spider.position.y + SPIDER_BELLY + SPIDER_BODY.halfHeight,
    spider.position.z,
    spider.heading,
  )
  if (now) {
    spider.body.setTranslation(at, true)
    spider.body.setRotation(turn, true)
  } else {
    spider.body.setNextKinematicTranslation(at)
    spider.body.setNextKinematicRotation(turn)
  }
}

/** Set a spider down at a waypoint, facing the next. */
function place(map: TerrainMap, spider: Spider, legs: number): void {
  const at = spiderWaypoint(map, spider.id, legs, { x: 0, z: 0 })
  spider.position.x = at.x
  spider.position.z = at.z
  spider.position.y = groundAt(map, at.x, at.z)
  spiderWaypoint(map, spider.id, spider.legs, spider.target, spider.position)
  spider.heading = atan2(-(spider.target.x - at.x), -(spider.target.z - at.z))
  seatSpiderBody(spider, true)
}

/** The island's spiders, each somewhere on the land, a while from its first bomb. */
export function createSpiders(map: TerrainMap, world: RAPIER.World, shape: WorldShape = FLAT): Spider[] {
  return Array.from({ length: SPIDERS }, (_, id) => {
    const spider: Spider = {
      id,
      position: v3(),
      heading: 0,
      legs: 0,
      target: { x: 0, z: 0 },
      stride: 0,
      bombTicks: SPIDER_BOMB_TICKS,
      damage: 0,
      deaths: 0,
      body: addMover(world, SPIDER_BODY.halfWidth, SPIDER_BODY.halfHeight, SPIDER_BODY.halfDepth, { x: 0, y: -1000, z: 0 }),
      shape,
    }
    place(map, spider, -1)
    return spider
  })
}

/**
 * A tick of a spider's walk: turning toward its next waypoint no faster
 * than it can, striding on the way it faces, its feet on the ground, and
 * on to the next waypoint once it is there. Returns whether a bomb is due
 * to fall from it this tick; letting it fall is the owner's call.
 */
export function walkSpider(map: TerrainMap, spider: Spider, dt: number): boolean {
  if (hypot(spider.target.x - spider.position.x, spider.target.z - spider.position.z) < WAYPOINT_REACH) {
    spider.legs += 1
    spiderWaypoint(map, spider.id, spider.legs, spider.target, spider.position)
  }
  const dx = spider.target.x - spider.position.x
  const dz = spider.target.z - spider.position.z
  const wanted = atan2(-dx, -dz)
  const turn = atan2(sin(wanted - spider.heading), cos(wanted - spider.heading))
  spider.heading += Math.max(Math.min(turn, SPIDER_TURN * dt), -SPIDER_TURN * dt)
  // Slower while it turns hard, so it does not stride wide of where it is going.
  const step = SPIDER_SPEED * dt * Math.max(cos(turn), 0.2)
  spider.position.x -= sin(spider.heading) * step
  spider.position.z -= cos(spider.heading) * step
  spider.position.y = groundAt(map, spider.position.x, spider.position.z)
  spider.stride += step
  seatSpiderBody(spider, false)
  spider.bombTicks -= 1
  if (spider.bombTicks > 0) return false
  spider.bombTicks = SPIDER_BOMB_TICKS
  return true
}

/** A spider brought down comes back whole somewhere else on the island, picked by how many times it has been brought down. */
export function rebuildSpider(map: TerrainMap, spider: Spider): void {
  spider.deaths += 1
  spider.damage = 0
  spider.bombTicks = SPIDER_BOMB_TICKS
  spider.legs += 1
  place(map, spider, 70000 + spider.deaths * 17)
}
