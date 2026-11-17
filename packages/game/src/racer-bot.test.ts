import { qrotate, v3, vcopy, vdot, vnormalize, type Vec3 } from '@buggies/physics'
import { ROAD_GRADE, generatePlanet, generateWorld, groundDistance, type World, type WorldRoad } from '@buggies/terrain'
import { addMover } from '@buggies/vehicle'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  advance,
  createArena,
  createVehicleInput,
  initPhysics,
  portalCrossed,
  respawn,
  respawnLost,
  spawnHere,
  takeSeat,
  type Arena,
  type Seat,
} from './index.ts'
import { buildCourse, checkpointSpawn, keepOf, withPortals } from './course.ts'
import { botInput, botPace, botPutBackSpot, botStuck, createRacerBot } from './racer-bot.ts'
import { between } from './test-planet.ts'

/** The seed whose first world no bot could finish, how many worlds of it the race runs through, and the cars of the four bots. */
const SEED = 136157345
const WORLDS = 2
const CARS = ['raceCar', 'sportsCar', 'police', 'goKart'] as const

/** How long the bots are given to reach the way out: the go-kart is the slowest car of the four, on a leg nearly two kilometres long. */
const RACE_SECONDS = 200

/** How far apart the points of a route are, in meters: as the legs of a course lay them. */
const ROUTE_STEP = 8
/** How much route the tests give a bot to drive along. */
const ROUTE_METRES = 600
/** How long a bot is given to drive it. */
const DRIVE_SECONDS = 20
/** How far along the route a car is parked in its way, in meters. */
const PARKED_AHEAD = 40

let map: World
let route: Vec3[]

/** How far along the route a point of it is, in meters. */
function distanceTo(index: number): number {
  let total = 0
  for (let i = 0; i < index && i < route.length - 1; i++) total += between(route[i]!, route[i + 1]!)
  return total
}

/** The longest run of a road at grade: where it starts, and how many meters it runs for. */
function longestGradeRun(road: WorldRoad): { from: number; length: number } {
  const segments = road.closed ? road.points.length : road.points.length - 1
  let best = { from: 0, length: 0 }
  let from = 0
  let length = 0
  for (let segment = 0; segment < segments; segment++) {
    const step = between(road.points[segment]!, road.points[(segment + 1) % road.points.length]!)
    if (road.structure[segment] !== ROAD_GRADE) {
      length = 0
      continue
    }
    if (length === 0) from = segment
    length += step
    if (length > best.length) best = { from, length }
  }
  return best
}

/** A road's way from a point on it, a point every few meters: the route a bot is given to follow, tunnels and all. */
function routeAlong(road: WorldRoad, from: number, metres: number): Vec3[] {
  const points: Vec3[] = [{ ...road.points[from]! }]
  let traveled = 0
  for (let index = from + 1; points.length < metres / ROUTE_STEP && index < road.points.length; index++) {
    traveled += between(road.points[index]!, road.points[index - 1]!)
    if (traveled < ROUTE_STEP) continue
    traveled = 0
    points.push({ ...road.points[index]! })
  }
  return points
}

/** A car in the first seat, standing at the start of the route and facing along it. */
function botIn(arena: Arena): Seat {
  const start = route[0]!
  const ahead = route[1]!
  const seat = takeSeat(arena, 0, 'sportsCar')
  respawn(seat, spawnHere(start, v3(ahead.x - start.x, ahead.y - start.y, ahead.z - start.z)))
  return seat
}

/** How far the car is from the route near the point it has reached: how far off the way it is going it has wandered. */
function offRoute(at: Vec3, along: number): number {
  let nearest = Infinity
  for (let point = Math.max(along - 2, 0); point <= Math.min(along + 8, route.length - 1); point++) {
    nearest = Math.min(nearest, between(route[point]!, at))
  }
  return nearest
}

/** The point of the route that stands a given distance along it from its start. */
function pointAlong(metres: number): number {
  let index = 0
  while (index < route.length - 1 && distanceTo(index + 1) <= metres) index++
  return index
}

/** A car nobody drives, standing on the route at one of its points, facing along it. */
function parkOn(arena: Arena, id: number, index: number): Seat {
  const seat = takeSeat(arena, id, 'sportsCar')
  const point = route[index]!
  const ahead = route[Math.min(index + 1, route.length - 1)]!
  respawn(seat, spawnHere(point, v3(ahead.x - point.x, ahead.y - point.y, ahead.z - point.z)))
  return seat
}

describe('bots', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(11)
    const highway = map.roads.find((road) => road.kind === 'highway')!
    const run = longestGradeRun(highway)
    expect(run.length).toBeGreaterThan(100)
    route = routeAlong(highway, run.from, ROUTE_METRES)
    expect(route.length).toBeGreaterThan(ROUTE_METRES / 12)
  }, 60_000)

  it('drive their route, getting well along it in twenty seconds', () => {
    const arena = createArena(map)
    const seat = botIn(arena)
    const bot = createRacerBot(0)
    const input = createVehicleInput()
    let wandered = 0
    let farthest = 0
    for (let tick = 0; tick < DRIVE_SECONDS * 60; tick++) {
      advance(arena, () => botInput(bot, seat, route, input, arena))
      farthest = Math.max(farthest, distanceTo(bot.along))
      if (offRoute(seat.vehicle.frame.position, bot.along) > 12) wandered++
      if (botStuck(bot)) break
    }
    // Well along the route, most of the way near it, and never so far off as to be driving round the houses.
    expect(farthest).toBeGreaterThan(150)
    expect(wandered).toBeLessThan(60 * 3)
    expect(botStuck(bot)).toBe(false)
    expect(seat.vehicle.wrecked).toBe(false)
    // And it asks for nothing but driving.
    expect(seat.weapon).toBe('none')
    expect(input.weapon).toBe(0)
    expect(input.fire).toBe(false)
    expect(input.handbrake).toBe(false)
    arena.world.free()
  }, 60_000)

  it('back out when they cannot go on, and only say they are stuck after a couple of tries', () => {
    const arena = createArena(map)
    const seat = botIn(arena)
    const bot = createRacerBot(0)
    const input = createVehicleInput()
    // Held where it is: it asks to go, gets nowhere, and after a second of that it backs out.
    let backedOut = false
    for (let tick = 0; tick < 4 * 60; tick++) {
      botInput(bot, seat, route, input, arena)
      if (bot.reverseFor > 0) {
        backedOut = true
        expect(input.brake).toBe(1)
        expect(input.throttle).toBe(0)
      }
      expect(botStuck(bot)).toBe(false)
    }
    expect(backedOut).toBe(true)
    // Two tries at backing out, and then it says it needs putting back: about five seconds of getting nowhere.
    for (let tick = 0; tick < 2 * 60; tick++) botInput(bot, seat, route, input, arena)
    expect(botStuck(bot)).toBe(true)
    // Going again, everything counted against it is forgotten.
    for (let tick = 0; tick < 120; tick++) advance(arena, () => botInput(bot, seat, route, input, arena))
    expect(seat.vehicle.speed).toBeGreaterThan(2)
    expect(botStuck(bot)).toBe(false)
    arena.world.free()
  })

  it('go round a car parked on their route, and are never put back for it', () => {
    const arena = createArena(map)
    const seat = botIn(arena)
    parkOn(arena, 1, pointAlong(PARKED_AHEAD))
    const bot = createRacerBot(0)
    const input = createVehicleInput()
    let putBack = 0
    let farthest = 0
    for (let tick = 0; tick < DRIVE_SECONDS * 60; tick++) {
      advance(arena, (driving) => (driving === seat ? botInput(bot, seat, route, input, arena) : NEUTRAL_INPUT))
      farthest = Math.max(farthest, distanceTo(bot.along))
      if (botStuck(bot)) putBack++
    }
    // Sixty metres beyond the parked car in twenty seconds, and never once given up on.
    expect(farthest - PARKED_AHEAD).toBeGreaterThan(60)
    expect(putBack).toBe(0)
    arena.world.free()
  }, 60_000)

  it('back out of a wall they are nose first against, and go on', () => {
    const arena = createArena(map)
    const seat = botIn(arena)
    const { position, forward } = seat.vehicle.frame
    // A wall a few meters ahead, across the way, with nothing to be seen in it: the bot drives into it and stops.
    const wall = addMover(arena.world, 6, 6, 6, {
      x: position.x + forward.x * 12,
      y: position.y + forward.y * 12,
      z: position.z + forward.z * 12,
    })
    const bot = createRacerBot(0)
    const input = createVehicleInput()
    let backedOut = false
    let cleared = false
    let astern = 0
    for (let tick = 0; tick < DRIVE_SECONDS * 60; tick++) {
      advance(arena, () => botInput(bot, seat, route, input, arena))
      astern = Math.min(astern, seat.vehicle.forwardSpeed)
      if (bot.reverseFor > 0) backedOut = true
      // Once it has backed off the wall, the wall is cleared away and it drives on: what it was stuck on is gone.
      if (backedOut && bot.reverseFor === 0 && !cleared) {
        cleared = true
        const where = wall.translation()
        wall.setTranslation({ x: where.x, y: where.y - 60, z: where.z }, true)
      }
    }
    expect(backedOut).toBe(true)
    // Backing out is braking at a standstill, which drives a car in reverse.
    expect(astern).toBeLessThan(-1)
    expect(distanceTo(bot.along)).toBeGreaterThan(150)
    expect(botStuck(bot)).toBe(false)
    arena.world.free()
  }, 60_000)

  it('put a stuck one back clear of the cars about it, a few points back down its route', () => {
    const along = pointAlong(PARKED_AHEAD + 60)
    const taken = route[along - 3]!
    const spot = botPutBackSpot(route, along, [taken])
    expect(spot).not.toBeNull()
    // Not on the car, still near the way it had got to, and facing along it.
    expect(between(spot!.spawn.position, taken)).toBeGreaterThanOrEqual(4)
    expect(between(spot!.spawn.position, route[spot!.along]!)).toBeLessThan(4)
    expect(spot!.along).toBeLessThan(along)
    const facing = qrotate(v3(), spot!.spawn.rotation, { x: 0, y: 0, z: -1 })
    const way = route[spot!.along]!
    const after = route[Math.min(spot!.along + 1, route.length - 1)]!
    const forward = vnormalize(v3(), v3(after.x - way.x, after.y - way.y, after.z - way.z))
    expect(vdot(facing, forward)).toBeGreaterThan(0.9)
    expect(vdot(facing, spot!.spawn.up)).toBeCloseTo(0, 2)
    // With every spot about the way taken, there is nowhere to put it.
    expect(botPutBackSpot(route, along, route)).toBeNull()
  })

  it('hold a pace of their own: the slower brakes where the quicker pulls', () => {
    expect(botPace(0)).toBe(1)
    expect(botPace(7)).toBeCloseTo(0.86, 6)
    for (let slot = 0; slot < 8; slot++) {
      const pace = createRacerBot(slot).pace
      expect(pace).toBeGreaterThanOrEqual(0.86)
      expect(pace).toBeLessThanOrEqual(1)
      if (slot > 0) expect(pace).toBeLessThan(botPace(slot - 1))
    }
    const arena = createArena(map)
    const seat = botIn(arena)
    const input = createVehicleInput()
    // Well up its pace, the quickest still pulls; the slowest is over its own by then, and brakes.
    seat.vehicle.speed = 0.9 * seat.tuning.maxSpeed
    botInput(createRacerBot(0), seat, route, input, arena)
    expect(input.throttle).toBeGreaterThan(0)
    expect(input.brake).toBe(0)
    botInput(createRacerBot(7), seat, route, input, arena)
    expect(input.throttle).toBe(0)
    expect(input.brake).toBeGreaterThan(0)
    // Standing at the off of the route, they both want to go.
    seat.vehicle.speed = 0
    expect(botInput(createRacerBot(7), seat, route, input, arena).throttle).toBeGreaterThan(0)
    arena.world.free()
  })

  it('ask for nothing but driving: no weapon, no fire, no handbrake', () => {
    const arena = createArena(map)
    const seat = botIn(arena)
    const bot = createRacerBot(3)
    const input = createVehicleInput()
    for (let tick = 0; tick < 60 * 5; tick++) {
      advance(arena, () => botInput(bot, seat, route, input, arena))
      expect(input.weapon).toBe(0)
      expect(input.fire).toBe(false)
      expect(input.handbrake).toBe(false)
      expect(input.signal).toBe(false)
    }
    expect(seat.weapon).toBe('none')
    expect(arena.rockets).toHaveLength(0)
    arena.world.free()
  }, 60_000)

  it('wait at the off of a route too short to follow, asking for nothing', () => {
    const arena = createArena(map)
    const seat = botIn(arena)
    const bot = createRacerBot(0)
    const input = createVehicleInput()
    expect(botInput(bot, seat, [], input, arena)).toEqual(NEUTRAL_INPUT)
    expect(botInput(bot, seat, [route[0]!], input, arena)).toEqual(NEUTRAL_INPUT)
    arena.world.free()
  })
})

describe('a race of bots', () => {
  it('drives a whole leg of a course, every one of them through its way out', async () => {
    // One lap of the first world of a course, driven as the server drives it: four bots on the first four grid places, each
    // under its own bot's wheel, put back at its last gate when it is lost or stuck fast.
    await initPhysics()
    const made = new Map<number, World>()
    const worldOf = (id: number): World => {
      let world = made.get(id)
      if (world === undefined) {
        world = generateWorld(id)
        made.set(id, world)
      }
      return world
    }
    const course = await buildCourse(SEED, WORLDS, worldOf)
    const leg = course.legs[0]!
    const planet = withPortals(worldOf(leg.world), keepOf(leg))
    const arena = createArena(planet, MAX_PLAYERS, { weapons: true, bananas: true })
    const racers = CARS.map((profile, place) => {
      const seat = takeSeat(arena, place, profile)
      seat.npc = false
      seat.driver = null
      seat.rover = null
      respawn(seat, leg.grid[place]!)
      return { seat, place, bot: createRacerBot(place), checkpoint: 0, done: 0, previous: v3() }
    })
    for (const racer of racers) vcopy(racer.previous, racer.seat.vehicle.frame.position)
    const input = createVehicleInput()
    for (let tick = 1; tick <= RACE_SECONDS * 60 && racers.some((racer) => racer.done === 0); tick++) {
      advance(arena, (seat) => {
        const racer = racers.find((each) => each.seat === seat)
        return racer === undefined || racer.done !== 0 ? NEUTRAL_INPUT : botInput(racer.bot, seat, leg.route, input, arena)
      })
      for (const racer of racers) {
        if (racer.done !== 0) continue
        const position = racer.seat.vehicle.frame.position
        const gate = leg.checkpoints[racer.checkpoint]
        if (gate !== undefined && !racer.seat.vehicle.wrecked && groundDistance(position, gate.at) <= gate.radius) racer.checkpoint++
        if (racer.checkpoint >= leg.checkpoints.length && portalCrossed(planet, racer.previous, position) === leg.exit) racer.done = tick
        vcopy(racer.previous, position)
      }
      for (const seat of respawnLost(arena)) {
        const racer = racers.find((each) => each.seat === seat)
        if (racer !== undefined) respawn(seat, checkpointSpawn(course, planet, 0, racer.checkpoint, racer.place))
      }
      for (const racer of racers) {
        if (racer.done !== 0 || !botStuck(racer.bot)) continue
        racer.bot.stuckFor = 0
        respawn(racer.seat, checkpointSpawn(course, planet, 0, racer.checkpoint, racer.place))
      }
    }
    for (const racer of racers) {
      const seconds = racer.done === 0 ? Infinity : racer.done / 60
      expect(seconds, `${racer.seat.profile} through the way out in ${seconds.toFixed(0)} s`).toBeLessThan(RACE_SECONDS)
    }
    arena.world.free()
  }, 240_000)
})
