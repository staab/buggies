import { v3, vcross, vdistance, vlength, type Vec3 } from '@buggies/physics'
import {
  WORLD_KINDS,
  WORLD_TRAITS,
  alongGround,
  atHeight,
  generateWorld,
  groundDistance,
  onLand,
  overSurface,
  roofOver,
  sphereHeight,
  upOf,
  worldId,
  worldKindOf,
  type World,
} from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  CHECKPOINT_APART,
  CHECKPOINT_LEAST,
  CHECKPOINT_MOST,
  NO_PORTAL,
  RACERS_MOST,
  WORLDS_DEFAULT,
  WORLDS_LEAST,
  WORLDS_MOST,
  buildCourse,
  checkpointSpawn,
  corridorAt,
  keepOf,
  legOf,
  nextWorld,
  planOf,
  withPortals,
  type Course,
  type RaceLeg,
} from './course.ts'
import { forwardOf, nearestRoadSpotTo } from './spawns.ts'

const SEEDS = [7, 11, 4242]
const LENGTHS = [WORLDS_LEAST, WORLDS_DEFAULT, WORLDS_MOST]

/** How tall a gate over a road stands, and so how much room it needs under a roof. */
const GATE_HEIGHT = 9

/** How near a road a gate may stand and still be on it rather than on the ground about it. */
const ROAD_REACH = 20

/** How far apart two cars of a grid stand across it. */
const SPAWN_ABREAST = 5

/**
 * How far apart the points of a leg's route are laid at the most, and how far to either side of a point a corridor's walls are
 * looked for. A point of a way can come closer than a step to the one before it, where the way eases across into the middle of
 * a corridor and the wall it left falls away, but never onto it.
 */
const ROUTE_LEAST = 0.5
const ROUTE_MOST = 12
const CORRIDOR_REACH = 30

/** Each world made once for every course and test that asks for it: making one is seconds of work. */
const made = new Map<number, World>()
function worldOf(world: number): World {
  const known = made.get(world)
  if (known !== undefined) return known
  const fresh = generateWorld(world)
  made.set(world, fresh)
  return fresh
}

/** Whether a gate stands where a car can drive through it: on the land, or on a road or a platform that carries it over water or over air. */
function drivable(world: World, at: Vec3): boolean {
  const spot = nearestRoadSpotTo(world, at)
  if (spot !== null && vdistance(spot.point, at) <= ROAD_REACH) return true
  // A world of nothing but its platforms is driven on their tops, and its ground's grid is nothing at all.
  if (WORLD_TRAITS[world.kind].platformsOnly) return world.platforms.some((platform) => groundDistance(atHeight(world, platform.center, 0), at) <= platform.radius)
  return onLand(world, upOf(at))
}

/** Where a race starts on a world: on a road near the middle of its first city, or on the ground there where it has no roads. */
function startOf(world: World): Vec3 {
  const middle = overSurface(world, world.districts[0]?.center ?? { x: 0, y: 1, z: 0 }, 0)
  return nearestRoadSpotTo(world, middle)?.point ?? middle
}

/** A way out a distance along the ground from a way out, in a way along it, on a world of this radius. */
function stepOut(up: Vec3, way: Vec3, distance: number, radius: number): Vec3 {
  const angle = distance / radius
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: up.x * cos + way.x * sin, y: up.y * cos + way.y * sin, z: up.z * cos + way.z * sin }
}

/**
 * How far to either side of a point the roof comes down to less than a gate's
 * height over the floor, in a way across it; or nothing where it stays open
 * that far, as out in the open and in a room too wide to be a corridor.
 */
function walls(world: World, at: Vec3, forward: Vec3): { left: number; right: number } | null {
  if (!Number.isFinite(roofOver(world, at))) return null
  const up = upOf(at)
  const way = alongGround(forward, up)
  const length = vlength(way) || 1
  const side = vcross(v3(), up, v3(way.x / length, way.y / length, way.z / length))
  const roomy = (distance: number, sign: 1 | -1): boolean => {
    const across = stepOut(up, side, sign * distance, world.radius)
    const floor = sphereHeight({ n: world.ground.n, radius: world.radius, heights: world.bored }, across)
    return roofOver(world, atHeight(world, across, floor)) - floor >= GATE_HEIGHT && onLand(world, across)
  }
  const wall = (sign: 1 | -1): number | null => {
    for (let distance = 1; distance <= CORRIDOR_REACH; distance++) if (!roomy(distance, sign)) return distance
    return null
  }
  const left = wall(1)
  const right = left === null ? null : wall(-1)
  return left === null || right === null ? null : { left, right }
}

/** The point of a leg's route nearest a place. */
function nearestRouteIndex(leg: RaceLeg, at: Vec3): number {
  let best = 0
  let nearest = Infinity
  for (const [index, point] of leg.route.entries()) {
    const distance = vdistance(point, at)
    if (distance >= nearest) continue
    nearest = distance
    best = index
  }
  return best
}

/**
 * How far a point stands over the surface a car would be driving on there, or under it: the deck of a road where it is on one,
 * and the ground it is over where it is not.
 */
function surfaceGapOf(world: World, at: Vec3): number {
  const ground = vlength(at) - world.radius - sphereHeight({ n: world.ground.n, radius: world.radius, heights: world.bored }, upOf(at))
  const spot = nearestRoadSpotTo(world, at)
  if (spot === null || vdistance(spot.point, at) > ROAD_REACH) return ground
  const road = vlength(at) - vlength(spot.point)
  return Math.abs(road) <= Math.abs(ground) ? road : ground
}

/** The way a car faces out of a spawn, and the way along the ground to the gate after it, as one. */
function facesNext(spawn: Vec3, passed: Vec3, next: Vec3): number {
  const way = alongGround(v3(next.x - passed.x, next.y - passed.y, next.z - passed.z), upOf(passed))
  const length = vlength(way) || 1
  return (spawn.x * way.x + spawn.y * way.y + spawn.z * way.z) / length
}

/** Everything a leg must be, whatever world of whatever course it is: its gates, its portals, the way across it, and the way out of it. */
function checkLeg(course: Course, index: number): void {
  const leg = course.legs[index]!
  const world = worldOf(leg.world)
  const last = index === course.legs.length - 1
  const gates = leg.checkpoints

  // A run of gates from a few to the most the wire carries, the last of them the way out.
  expect(gates.length).toBeGreaterThanOrEqual(CHECKPOINT_LEAST)
  expect(gates.length).toBeLessThanOrEqual(CHECKPOINT_MOST)
  for (const [at, gate] of gates.entries()) {
    expect(drivable(world, gate.at), `gate ${at + 1} of ${world.kind}`).toBe(true)
    const room = roofOver(world, gate.at) - sphereHeight({ n: world.ground.n, radius: world.radius, heights: world.bored }, upOf(gate.at))
    expect(room, `room over gate ${at + 1} of ${world.kind}`).toBeGreaterThanOrEqual(GATE_HEIGHT)
    expect(vlength(gate.forward)).toBeCloseTo(1, 6)
    if (at > 0) expect(groundDistance(gates[at - 1]!.at, gate.at), `gate ${at + 1} of ${world.kind} from the one before`).toBeGreaterThanOrEqual(CHECKPOINT_APART)
  }

  // The last gate is the portal out, where the leg has one, and the last leg has none: it finishes at a line.
  const out = gates[gates.length - 1]!
  expect(leg.arrival === NO_PORTAL).toBe(index === 0)
  if (last) {
    expect(leg.exit).toBe(NO_PORTAL)
  } else {
    expect(leg.exit).not.toBe(NO_PORTAL)
    expect(groundDistance(world.portals[leg.keep[leg.exit]!]!.at, out.at), `${world.kind}'s way out`).toBeLessThan(0.01)
  }

  // The way the leg is driven: from where it is entered to its way out, a point every few metres, all of them on what is driven on.
  const route = leg.route
  expect(route.length).toBeGreaterThan(1)
  expect(vdistance(route[route.length - 1]!, out.at), `${world.kind}'s route to its way out`).toBeLessThan(0.01)
  for (const [at, point] of route.entries()) {
    expect(drivable(world, point), `route point ${at + 1} of ${world.kind}`).toBe(true)
    if (at === 0) continue
    const apart = vdistance(route[at - 1]!, point)
    expect(apart, `route point ${at + 1} of ${world.kind} from the one before`).toBeGreaterThanOrEqual(ROUTE_LEAST)
    expect(apart, `route point ${at + 1} of ${world.kind} from the one before`).toBeLessThanOrEqual(ROUTE_MOST)
  }
  // It starts where the leg does: at the start of the world a race starts on, or out of the portal it arrives by.
  if (index === 0) expect(groundDistance(route[0]!, startOf(world)), `${world.kind}'s start`).toBeLessThan(1)
  else expect(vdistance(route[0]!, withPortals(world, leg.keep).portals[leg.arrival]!.at), `${world.kind}'s arrival`).toBeLessThan(20)

  // The portals it keeps, each one of the world's own, named once.
  expect(keepOf(leg)).toBe(leg.keep)
  expect(new Set(leg.keep).size).toBe(leg.keep.length)
  expect(leg.keep).toHaveLength(index === 0 || last ? 1 : 2)
  for (const portal of leg.keep) expect(portal >= 0 && portal < world.portals.length, `portal ${portal} of ${world.kind}`).toBe(true)

  // The field lines up on a grid on the world it starts on, and nowhere else.
  if (index === 0) {
    expect(leg.grid).toHaveLength(RACERS_MOST)
    for (const [place, spawn] of leg.grid.entries()) {
      expect(vdistance(spawn.position, out.at)).toBeGreaterThan(CHECKPOINT_APART)
      for (const other of leg.grid.slice(place + 1)) expect(vdistance(spawn.position, other.position)).toBeGreaterThan(2)
    }
  } else {
    expect(leg.grid).toHaveLength(0)
  }

  // The course knows the world it runs through, and what comes after it.
  expect(legOf(course, leg.world)).toEqual({ leg, index })
  const next = nextWorld(course, index)
  if (last) expect(next).toBeNull()
  else expect(next).toEqual({ world: course.legs[index + 1]!.world, arrival: course.legs[index + 1]!.arrival })
  expect(planOf(course, index, 7)).toEqual({
    game: 7,
    world: index + 1,
    ofWorlds: course.legs.length,
    keep: leg.keep,
    checkpoints: leg.checkpoints,
    exit: last ? null : leg.exit,
    next,
    worlds: course.legs.map((each) => each.world),
  })
}

describe('a race course', () => {
  for (const seed of SEEDS) {
    describe(`of ${seed}`, () => {
      // Every world of the planet, made before the courses that run through them: most of the work of the tests.
      beforeAll(() => {
        for (const kind of WORLD_KINDS) worldOf(worldId(seed, kind))
      }, 180_000)

      it(`runs from the planet through ${WORLDS_LEAST}, ${WORLDS_DEFAULT} or ${WORLDS_MOST} worlds, gate by gate`, async () => {
        for (const length of LENGTHS) {
          const course = await buildCourse(seed, length, worldOf)
          expect(course.seed).toBe(seed)
          expect(course.legs).toHaveLength(length)
          expect(course.legs[0]!.world).toBe(worldId(seed, 'planet'))
          // Two legs never share a world: a room is one world of one game.
          expect(new Set(course.legs.map((leg: RaceLeg) => leg.world)).size).toBe(length)
          expect(new Set(course.legs.map((leg: RaceLeg) => worldKindOf(leg.world))).size).toBe(length)
          for (let index = 0; index < length; index++) checkLeg(course, index)
        }
      })
    })
  }

  it('makes the same course from the same seed every time, both made at once and one after the other', async () => {
    for (const seed of [7, 11, 4242]) {
      const once = await buildCourse(seed, WORLDS_DEFAULT, worldOf)
      const again = await buildCourse(seed, WORLDS_DEFAULT, worldOf)
      expect(again).toEqual(once)
      // And a course of another length of the same seed is a course of its own.
      const longer = await buildCourse(seed, WORLDS_MOST, worldOf)
      expect(longer.legs).toHaveLength(WORLDS_MOST)
    }
  })

  it('refuses a race of fewer or more worlds than it can run through', async () => {
    await expect(buildCourse(7, WORLDS_LEAST - 1, worldOf)).rejects.toThrow(`${WORLDS_LEAST} to ${WORLDS_MOST}`)
    await expect(buildCourse(7, WORLDS_MOST + 1, worldOf)).rejects.toThrow(`${WORLDS_LEAST} to ${WORLDS_MOST}`)
    await expect(buildCourse(7, 2.5, worldOf)).rejects.toThrow(`${WORLDS_LEAST} to ${WORLDS_MOST}`)
  })

  it('keeps only the portals a leg is raced through, in the order it keeps them, and leaves the world untouched', () => {
    const world = worldOf(worldId(7, 'mars'))
    expect(world.portals.length).toBeGreaterThan(2)
    const kept = withPortals(world, [2, 0])
    expect(kept.portals).toEqual([world.portals[2], world.portals[0]])
    expect(kept.roads).toBe(world.roads)
    expect(kept.ground).toBe(world.ground)
    // The world it came from still has every portal it had.
    expect(world.portals).toHaveLength(worldOf(worldId(7, 'mars')).portals.length)
    expect(withPortals(world, [])).toMatchObject({ portals: [] })
  })

  it('puts a racer back on the last gate it passed, facing the next, and on its grid or out of a portal before any', async () => {
    const course = await buildCourse(7, WORLDS_DEFAULT, worldOf)
    const first = course.legs[0]!
    const world = withPortals(worldOf(first.world), first.keep)
    for (let checkpoint = 1; checkpoint < first.checkpoints.length; checkpoint++) {
      const passed = first.checkpoints[checkpoint - 1]!
      const next = first.checkpoints[checkpoint]!
      const spawn = checkpointSpawn(course, world, 0, checkpoint, 0)
      expect(vdistance(spawn.position, passed.at)).toBeLessThan(1e-6)
      expect(facesNext(forwardOf(spawn), passed.at, next.at)).toBeGreaterThan(0.99)
    }
    // Before it has passed one it stands where it lines up, and out of the portal it arrives by on the legs after.
    expect(checkpointSpawn(course, world, 0, 0, 3)).toEqual(first.grid[3])
    const later = course.legs[1]!
    const arrived = checkpointSpawn(course, withPortals(worldOf(later.world), later.keep), 1, 0, 0)
    expect(vdistance(arrived.position, withPortals(worldOf(later.world), later.keep).portals[later.arrival]!.at)).toBeLessThan(20)
    // Past the way out it stands facing through it, waiting to be taken to the world after.
    const beyond = checkpointSpawn(course, world, 0, first.checkpoints.length, 0)
    expect(vdistance(beyond.position, first.checkpoints[first.checkpoints.length - 1]!.at)).toBeLessThan(1e-6)
  })

  it('runs through the moon, which no race starts on', async () => {
    // The moon has no roads, and two portals a drive apart: a course can cross it in the middle of a race. Which courses
    // draw it there is the dice's to say, so one of them is asked for.
    const course = await buildCourse(2, WORLDS_DEFAULT, worldOf)
    expect(course.legs[0]!.world).toBe(worldId(2, 'planet'))
    const index = course.legs.findIndex((leg) => worldKindOf(leg.world) === 'moon')
    expect(index, 'a course that runs through the moon').toBeGreaterThan(0)
    expect(worldOf(course.legs[index]!.world).roads).toHaveLength(0)
    checkLeg(course, index)
  }, 120_000)

  it('says nothing of a corridor out in the open', () => {
    const world = worldOf(worldId(7, 'planet'))
    const spot = nearestRoadSpotTo(world, overSurface(world, world.districts[0]!.center, 0))
    expect(spot).not.toBeNull()
    const ahead = spot!.road.points[Math.min(spot!.index + 1, spot!.road.points.length - 1)]!
    const way = v3(ahead.x - spot!.point.x, ahead.y - spot!.point.y, ahead.z - spot!.point.z)
    expect(corridorAt(world, spot!.point, way)).toBeNull()
  })

  it('keeps a route on what is driven on and off the air, from the grid to the way out', async () => {
    // Every point of a leg's route stands on the surface a car drives there: no chord through the air, and nothing to fall off.
    // And no step of it climbs or drops more than a car can drive: a leg that fails this is laid again rather than shipped.
    for (const seed of [136157345, 7, 113556236]) {
      const course = await buildCourse(seed, WORLDS_LEAST, worldOf)
      for (const leg of course.legs) {
        const world = worldOf(leg.world)
        const route = leg.route
        for (const [at, point] of route.entries()) {
          const gap = surfaceGapOf(world, point)
          expect(Math.abs(gap), `route point ${at + 1} of ${route.length} of ${world.kind} stands ${gap.toFixed(1)} m off the surface`).toBeLessThan(1.5)
          if (at === 0) continue
          const rise = vlength(point) - vlength(route[at - 1]!)
          const run = vdistance(route[at - 1]!, point)
          expect(Math.abs(rise), `route point ${at + 1} of ${route.length} of ${world.kind} steps ${rise.toFixed(1)} m`).toBeLessThan(Math.max(run, 1))
        }
      }
    }
  }, 240_000)

  it('lines the grid up along the route of the leg it starts, on the surface of it', async () => {
    // The field is laid along the route itself, two abreast, the pole furthest on: every spot is close to the route and level
    // with the point of it it stands off, so a grid on a bridge stays on the bridge's deck and nobody starts beside the road.
    for (const seed of [136157345, 7, 113556236]) {
      const course = await buildCourse(seed, WORLDS_LEAST, worldOf)
      const leg = course.legs[0]!
      const world = worldOf(leg.world)
      expect(leg.grid).toHaveLength(RACERS_MOST)
      for (const [place, spawn] of leg.grid.entries()) {
        let nearest = Infinity
        for (const point of leg.route) nearest = Math.min(nearest, vdistance(point, spawn.position))
        expect(nearest, `grid place ${place} of ${world.kind}`).toBeLessThan(SPAWN_ABREAST * 0.75)
        expect(Math.abs(surfaceGapOf(world, spawn.position)), `grid place ${place} of ${world.kind} off the surface`).toBeLessThan(1.5)
      }
      // Everyone faces along the route where they stand.
      for (const spawn of leg.grid) {
        const near = nearestRouteIndex(leg, spawn.position)
        const point = leg.route[near]!
        const next = leg.route[Math.min(near + 2, leg.route.length - 1)]!
        expect(facesNext(forwardOf(spawn), point, next), `grid place of ${world.kind} faces along the route`).toBeGreaterThan(0.5)
      }
    }
  }, 240_000)

  it('centers the gates it lays down a tunnel', async () => {
    // Mercury is all tunnels and caverns, so a race through it passes down a few: those gates stand midway between the walls.
    let inCorridors = 0
    for (const seed of SEEDS) {
      const course = await buildCourse(seed, WORLDS_MOST, worldOf)
      for (const leg of course.legs) {
        const world = worldOf(leg.world)
        for (const gate of leg.checkpoints) {
          const across = walls(world, gate.at, gate.forward)
          if (across === null) continue
          inCorridors++
          expect(Math.abs(across.left - across.right), `a gate ${Math.round(gate.at.x)},${Math.round(gate.at.y)},${Math.round(gate.at.z)} down a tunnel of ${world.kind}`).toBeLessThan(1.5)
        }
      }
    }
    expect(inCorridors, 'gates that stand down a tunnel').toBeGreaterThan(0)
  })
})

