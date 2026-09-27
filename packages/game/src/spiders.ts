import { createRng, v3, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { sampleHeight, type TerrainMap } from '@buggies/terrain'
import { addMover } from '@buggies/vehicle'
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
  /** How many waypoints it has reached, which picks the next. */
  legs: number
  /** How far it has walked, all told, which sets its legs' stride. */
  stride: number
  /** How long until its next bomb, in ticks. */
  bombTicks: number
  /** How much of what brings it down it has taken, 0 to 1, and how many times it has been brought down, which picks where it comes back. */
  damage: number
  deaths: number
  /** Its body, which the cars run into. */
  readonly body: RAPIER.RigidBody
}

function spiderSeed(map: TerrainMap, id: number): number {
  return (map.seed ^ SPIDER_SALT) + id * 7919
}

/** The ground under a point, or the water where that is higher: it wades nothing, and strides over the water as over the land. */
function groundAt(map: TerrainMap, x: number, z: number): number {
  return Math.max(sampleHeight(map.heightfield, x, z), map.seaLevel)
}

/** Where a spider walks to next: a point on the land, picked by how many it has reached. */
export function spiderWaypoint(map: TerrainMap, id: number, legs: number, out: { x: number; z: number }): { x: number; z: number } {
  const rng = createRng(spiderSeed(map, id) + legs * 131)
  const extent = map.size * map.cellSize
  for (let attempt = 0; attempt < 24; attempt++) {
    out.x = extent * (0.1 + 0.8 * rng())
    out.z = extent * (0.1 + 0.8 * rng())
    if (sampleHeight(map.heightfield, out.x, out.z) > map.seaLevel) return out
  }
  out.x = extent / 2
  out.z = extent / 2
  return out
}

/** Its body where its feet are now: at once, or over the next step. */
export function seatSpiderBody(spider: Spider, now: boolean): void {
  const at = { x: spider.position.x, y: spider.position.y + SPIDER_BELLY + SPIDER_BODY.halfHeight, z: spider.position.z }
  const turn = { x: 0, y: sin(spider.heading / 2), z: 0, w: cos(spider.heading / 2) }
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
  const next = spiderWaypoint(map, spider.id, spider.legs, { x: 0, z: 0 })
  spider.heading = atan2(-(next.x - at.x), -(next.z - at.z))
  seatSpiderBody(spider, true)
}

/** The island's spiders, each somewhere on the land, a while from its first bomb. */
export function createSpiders(map: TerrainMap, world: RAPIER.World): Spider[] {
  return Array.from({ length: SPIDERS }, (_, id) => {
    const spider: Spider = {
      id,
      position: v3(),
      heading: 0,
      legs: 0,
      stride: 0,
      bombTicks: SPIDER_BOMB_TICKS,
      damage: 0,
      deaths: 0,
      body: addMover(world, SPIDER_BODY.halfWidth, SPIDER_BODY.halfHeight, SPIDER_BODY.halfDepth, { x: 0, y: -1000, z: 0 }),
    }
    place(map, spider, -1)
    return spider
  })
}

const to = { x: 0, z: 0 }

/**
 * A tick of a spider's walk: turning toward its next waypoint no faster
 * than it can, striding on the way it faces, its feet on the ground, and
 * on to the next waypoint once it is there. Returns whether a bomb is due
 * to fall from it this tick; letting it fall is the owner's call.
 */
export function walkSpider(map: TerrainMap, spider: Spider, dt: number): boolean {
  spiderWaypoint(map, spider.id, spider.legs, to)
  const dx = to.x - spider.position.x
  const dz = to.z - spider.position.z
  if (hypot(dx, dz) < WAYPOINT_REACH) spider.legs += 1
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
