import { createRng, uprightRotation, v3, vdistance, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { alongGround, overSurface, randomDirection, upOf, type World } from '@buggies/terrain'
import { addMover } from '@buggies/vehicle'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos, sin } = exact

/** How many giant spiders walk each moon: none walk a planet. */
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
 * A giant spider: it strides across the moon from one spot on it to the
 * next, over whatever is in the way, high enough for a car to drive
 * under it, and every thirty seconds lets a bomb fall from its belly. It
 * can be shot down, and comes back whole somewhere else.
 */
export interface Spider {
  readonly id: number
  /** Where its feet are: the ground under its middle, or the water over it. */
  readonly position: Vec3
  /** Which way it faces, along the ground. */
  readonly forward: Vec3
  /** How many waypoints it has reached, which picks the next, and where the one it is walking to is. */
  legs: number
  readonly target: Vec3
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

function spiderSeed(map: World, id: number): number {
  return (map.seed ^ SPIDER_SALT) + id * 7919
}

/** Where a spider walks to next: a point anywhere on the moon, picked by how many it has reached. */
export function spiderWaypoint(map: World, id: number, legs: number, out: Vec3): Vec3 {
  const rng = createRng(spiderSeed(map, id) + legs * 131)
  return overSurface(map, randomDirection(rng, v3()), 0, out)
}

function copy(out: Vec3, from: Vec3): Vec3 {
  out.x = from.x
  out.y = from.y
  out.z = from.z
  return out
}

const up = v3()

/** Its body where its feet are now: at once, or over the next step. */
export function seatSpiderBody(spider: Spider, now: boolean): void {
  const { position, forward } = spider
  upOf(position, up)
  const rise = SPIDER_BELLY + SPIDER_BODY.halfHeight
  const at = { x: position.x + up.x * rise, y: position.y + up.y * rise, z: position.z + up.z * rise }
  const turn = uprightRotation(up, forward)
  if (now) {
    spider.body.setTranslation(at, true)
    spider.body.setRotation(turn, true)
  } else {
    spider.body.setNextKinematicTranslation(at)
    spider.body.setNextKinematicRotation(turn)
  }
}

/** Face a spider along the ground toward a point. */
function faceToward(spider: Spider, point: Vec3): void {
  upOf(spider.position, up)
  const way = alongGround({ x: point.x - spider.position.x, y: point.y - spider.position.y, z: point.z - spider.position.z }, up)
  const length = Math.sqrt(way.x * way.x + way.y * way.y + way.z * way.z)
  if (length < 1e-9) return
  copy(spider.forward, { x: way.x / length, y: way.y / length, z: way.z / length })
}

/** Set a spider down at a waypoint, facing the next. */
function place(map: World, spider: Spider, legs: number): void {
  spiderWaypoint(map, spider.id, legs, spider.position)
  spiderWaypoint(map, spider.id, spider.legs, spider.target)
  faceToward(spider, spider.target)
  seatSpiderBody(spider, true)
}

/** The moon's spiders, each somewhere on it, a while from its first bomb; a planet has none. */
export function createSpiders(map: World, world: RAPIER.World): Spider[] {
  return Array.from({ length: map.kind === 'moon' ? SPIDERS : 0 }, (_, id) => {
    const spider: Spider = {
      id,
      position: v3(),
      forward: v3(1, 0, 0),
      legs: 0,
      target: v3(),
      stride: 0,
      bombTicks: SPIDER_BOMB_TICKS,
      damage: 0,
      deaths: 0,
      body: addMover(world, SPIDER_BODY.halfWidth, SPIDER_BODY.halfHeight, SPIDER_BODY.halfDepth, { x: 0, y: 0, z: 0 }),
    }
    place(map, spider, -1)
    return spider
  })
}

const way = v3()

/**
 * A tick of a spider's walk: turning toward its next waypoint no faster
 * than it can, striding on the way it faces, its feet on the ground, and
 * on to the next waypoint once it is there. Returns whether a bomb is due
 * to fall from it this tick; letting it fall is the owner's call.
 */
export function walkSpider(map: World, spider: Spider, dt: number): boolean {
  if (vdistance(spider.target, spider.position) < WAYPOINT_REACH) {
    spider.legs += 1
    spiderWaypoint(map, spider.id, spider.legs, spider.target)
  }
  const { position, forward } = spider
  upOf(position, up)
  alongGround({ x: spider.target.x - position.x, y: spider.target.y - position.y, z: spider.target.z - position.z }, up, way)
  // How far round it has to turn, about the way up: positive to its left.
  const left = { x: up.y * forward.z - up.z * forward.y, y: up.z * forward.x - up.x * forward.z, z: up.x * forward.y - up.y * forward.x }
  const turn = atan2(way.x * left.x + way.y * left.y + way.z * left.z, way.x * forward.x + way.y * forward.y + way.z * forward.z)
  const by = Math.max(Math.min(turn, SPIDER_TURN * dt), -SPIDER_TURN * dt)
  const c = cos(by)
  const s = sin(by)
  copy(forward, { x: forward.x * c + left.x * s, y: forward.y * c + left.y * s, z: forward.z * c + left.z * s })
  // Slower while it turns hard, so it does not stride wide of where it is going.
  const step = SPIDER_SPEED * dt * Math.max(cos(turn), 0.2)
  position.x += forward.x * step
  position.y += forward.y * step
  position.z += forward.z * step
  overSurface(map, upOf(position, up), 0, position)
  // Still along the ground where it now stands.
  alongGround(forward, upOf(position, up), forward)
  const length = Math.sqrt(forward.x * forward.x + forward.y * forward.y + forward.z * forward.z) || 1
  forward.x /= length
  forward.y /= length
  forward.z /= length
  spider.stride += step
  seatSpiderBody(spider, false)
  spider.bombTicks -= 1
  if (spider.bombTicks > 0) return false
  spider.bombTicks = SPIDER_BOMB_TICKS
  return true
}

/** A spider brought down comes back whole somewhere else on the island, picked by how many times it has been brought down. */
export function rebuildSpider(map: World, spider: Spider): void {
  spider.deaths += 1
  spider.damage = 0
  spider.bombTicks = SPIDER_BOMB_TICKS
  spider.legs += 1
  place(map, spider, 70000 + spider.deaths * 17)
}
