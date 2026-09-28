import { createRng, uprightRotation, v3, vaddScaled, vdot, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { atHeight, gridPlace, groundIndex, groundUnder, heightOver, onLand, overSurface, randomDirection, upOf, type World } from '@buggies/terrain'
import { addForceAlong, coastFromBody, writeCoast, type Vehicle, type VehicleTuning } from '@buggies/vehicle'

import { nearestRoadSpotTo } from './spawns.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos, sin } = exact

/** How many flying saucers each island has. */
export const UFOS = 1
/** How high over the ground it cruises, and how low it comes down over a car it is taking. */
export const UFO_CRUISE = 45
export const UFO_HOVER = 18
/** How fast it cruises, and how fast it closes on a car, in m/s; how fast it climbs or sinks. */
export const UFO_SPEED = 14
export const UFO_HUNT_SPEED = 24
const UFO_CLIMB = 8
/** How far off it notices a car to take, and how near overhead it has to be for its beam to take hold. */
export const UFO_HUNT_RANGE = 250
export const UFO_BEAM_REACH = 10
/** How long its beam takes to lift a car up to it, and how long it waits after taking one before it looks for another, in ticks. */
export const UFO_LIFT_TICKS = 60 * 3
export const UFO_COOLDOWN_TICKS = 60 * 40
/** How long it waits at first, how long it hunts a car before giving up, and how long it waits after losing one. */
const UFO_FIRST_TICKS = 60 * 20
const UFO_HUNT_TICKS = 60 * 20
const UFO_LOST_TICKS = 60 * 8
/** How hard the beam pulls a car up, and how fast it lets it rise. */
const LIFT_PULL = 5
const LIFT_RISE = 5
/** How fast it carries a car off, how fast it climbs over what is in the way meanwhile, and how far under it the car hangs. */
export const UFO_CARRY_SPEED = 40
const UFO_CARRY_CLIMB = 30
const UFO_HANG = 6
/** How fast it lets a car down on its beam at the far end, and how far over the road the car is let go. */
const UFO_LOWER_SPEED = 4
const UFO_LET_GO = 0.8
/** How near a waypoint it has to come to have reached it. */
const WAYPOINT_REACH = 12
const UFO_SALT = 0x5a0c

/** What it is doing: cruising between waypoints, closing on a car, lifting one up its beam, carrying it off, or letting it down. */
export type UfoState = 'roam' | 'hunt' | 'lift' | 'carry' | 'lower'
export const UFO_STATES: readonly UfoState[] = ['roam', 'hunt', 'lift', 'carry', 'lower']

/**
 * A flying saucer: it cruises over the island from one waypoint to the
 * next, and every so often comes down over the nearest car it can find,
 * lifts it up its beam and sets it down somewhere else entirely. A car
 * with its shield up slips the beam.
 */
export interface Ufo {
  readonly id: number
  readonly position: Vec3
  state: UfoState
  /** The seat it is after, or taking, or none. */
  target: number
  /** How long it has been at what it is doing, and how long before it may take another car, in ticks. */
  stateTicks: number
  cooldownTicks: number
  /** How many waypoints it has reached, which picks the next, and how many cars it has taken, which picks where the next is set down. */
  legs: number
  abductions: number
  /** How much of what brings it down it has taken, 0 to 1, and how many times it has been brought down, which picks where it comes back. */
  damage: number
  deaths: number
}

/** What a saucer needs of a car: where it is, whether it can be taken, and the car itself for the beam to pull. */
export interface Abductee {
  readonly id: number
  readonly occupied: boolean
  readonly vehicle: Vehicle
  readonly tuning: VehicleTuning
  readonly shieldTicks: number
}

function ufoSeed(map: World, id: number): number {
  return (map.seed ^ UFO_SALT) + id * 15485863
}

/** The ground under a point, or the sea where that is higher, over the planet's radius. */
function groundAt(map: World, point: Vec3): number {
  return Math.max(groundUnder(map, point), map.seaLevel)
}

/** How many cells a side each face of the skyline's grid has: some 15 m a cell. */
const SKYLINE_CELLS = 64
const skylines = new WeakMap<World, Float32Array>()

/**
 * The top of the tallest thing built about a point, over the planet's
 * radius, or the ground there where nothing is: read off a coarse grid of
 * the planet, each cell holding the tallest top in it, and taken over the
 * cell and those round it.
 */
function skylineAt(map: World, point: Vec3): number {
  let tops = skylines.get(map)
  if (tops === undefined) {
    tops = new Float32Array(6 * (SKYLINE_CELLS + 1) * (SKYLINE_CELLS + 1)).fill(-Infinity)
    for (const building of map.buildings) {
      const at = skylineCell(building.at)
      tops[at] = Math.max(tops[at]!, heightOver(map, building.at) + building.height)
    }
    skylines.set(map, tops)
  }
  const place = gridPlace(SKYLINE_CELLS, upOf(point, skyAt), skyPlace)
  let highest = -Infinity
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = Math.round(place.i) + di
      const j = Math.round(place.j) + dj
      if (i < 0 || j < 0 || i > SKYLINE_CELLS || j > SKYLINE_CELLS) continue
      highest = Math.max(highest, tops[groundIndex({ n: SKYLINE_CELLS }, place.face, i, j)]!)
    }
  }
  return highest
}

const skyAt = v3()
const skyPlace = { face: 0, i: 0, j: 0 }

function skylineCell(point: Vec3): number {
  const place = gridPlace(SKYLINE_CELLS, upOf(point, skyAt), skyPlace)
  return groundIndex({ n: SKYLINE_CELLS }, place.face, Math.round(place.i), Math.round(place.j))
}

/** Where a saucer cruises to next: a point on the land, picked by how many it has reached. */
export function waypoint(map: World, ufo: Ufo, out: Vec3): Vec3 {
  const rng = createRng(ufoSeed(map, ufo.id) + ufo.legs * 31)
  // Most of the planet is sea, so it tries a good many spots for one on the land.
  for (let attempt = 0; attempt < 96; attempt++) {
    randomDirection(rng, out)
    if (onLand(map, out)) return overSurface(map, out, 0, out)
  }
  return overSurface(map, map.districts[0]?.center ?? { x: 0, y: 0, z: 1 }, 0, out)
}

/** The island's saucers, each cruising over it, waiting a while before it takes its first car. */
export function createUfos(map: World): Ufo[] {
  return Array.from({ length: UFOS }, (_, id) => {
    const ufo: Ufo = {
      id,
      position: v3(),
      state: 'roam',
      target: -1,
      stateTicks: 0,
      cooldownTicks: UFO_FIRST_TICKS,
      legs: 0,
      abductions: 0,
      damage: 0,
      deaths: 0,
    }
    const start = waypoint(map, { ...ufo, legs: -1 }, v3())
    atHeight(map, upOf(start), groundAt(map, start) + UFO_CRUISE, ufo.position)
    return ufo
  })
}

const from = v3()
const toward = v3()

/**
 * Move a saucer round the planet toward over a point at this speed, and
 * toward this height over the planet's radius at this climb rate. How far
 * it had to go, along the ground.
 */
function fly(map: World, ufo: Ufo, point: Vec3, height: number, speed: number, dt: number, climb = UFO_CLIMB): number {
  upOf(ufo.position, from)
  upOf(point, toward)
  // The way round from one to the other, and how far: the great circle between them.
  const dot = vdot(from, toward)
  vaddScaled(toward, toward, from, -dot)
  const aside = Math.sqrt(vdot(toward, toward))
  const angle = atan2(aside, dot)
  const distance = angle * map.radius
  const turn = Math.min(distance, speed * dt) / map.radius
  const reached = heightOver(map, ufo.position)
  const rise = height - reached
  const next = reached + Math.sign(rise) * Math.min(Math.abs(rise), climb * dt)
  if (aside > 1e-9) {
    const c = cos(turn)
    const s = sin(turn) / aside
    from.x = from.x * c + toward.x * s
    from.y = from.y * c + toward.y * s
    from.z = from.z * c + toward.z * s
  }
  atHeight(map, upOf(from, from), next, ufo.position)
  return distance
}

/** Whether a car can be taken: in play, and not behind its shield. */
function takeable(seat: Abductee | undefined): seat is Abductee {
  return seat !== undefined && seat.occupied && !seat.vehicle.wrecked && seat.shieldTicks <= 0
}

/** Set a saucer back to cruising, to wait this long before it looks for a car again. */
function giveUp(ufo: Ufo, wait: number): void {
  ufo.state = 'roam'
  ufo.target = -1
  ufo.stateTicks = 0
  ufo.cooldownTicks = wait
}

const to = v3()
const across = v3()

/**
 * A tick of a saucer: cruising on to its next waypoint and, when it may,
 * turning after the nearest car in reach; closing on it until it is right
 * overhead; then holding over it and pulling it up its beam; then carrying
 * it off fast over the island, and letting it down onto a road far away.
 */
export function flyUfo(map: World, ufo: Ufo, seats: readonly Abductee[], gravity: number, dt: number): void {
  if (ufo.cooldownTicks > 0) ufo.cooldownTicks -= 1
  ufo.stateTicks += 1
  const target = ufo.target < 0 ? undefined : seats[ufo.target]
  switch (ufo.state) {
    case 'roam': {
      waypoint(map, ufo, to)
      if (fly(map, ufo, to, groundAt(map, ufo.position) + UFO_CRUISE, UFO_SPEED, dt) < WAYPOINT_REACH) ufo.legs += 1
      if (ufo.cooldownTicks > 0) return
      let nearest = UFO_HUNT_RANGE
      for (const seat of seats) {
        if (!takeable(seat)) continue
        const distance = alongGroundBetween(map, seat.vehicle.frame.position, ufo.position)
        if (distance >= nearest) continue
        nearest = distance
        ufo.target = seat.id
      }
      if (ufo.target >= 0) {
        ufo.state = 'hunt'
        ufo.stateTicks = 0
      }
      return
    }
    case 'hunt': {
      if (!takeable(target) || ufo.stateTicks > UFO_HUNT_TICKS) {
        giveUp(ufo, UFO_LOST_TICKS)
        return
      }
      const at = target.vehicle.frame.position
      if (fly(map, ufo, at, heightOver(map, at) + UFO_HOVER, UFO_HUNT_SPEED, dt) < UFO_BEAM_REACH / 2) {
        ufo.state = 'lift'
        ufo.stateTicks = 0
      }
      return
    }
    case 'lift': {
      if (!takeable(target)) {
        giveUp(ufo, UFO_LOST_TICKS)
        return
      }
      const { position, linearVelocity } = target.vehicle.frame
      const { up } = target.vehicle
      const off = fly(map, ufo, position, heightOver(map, ufo.position), UFO_SPEED, dt)
      if (off > UFO_BEAM_REACH * 2) {
        giveUp(ufo, UFO_LOST_TICKS)
        return
      }
      // Up toward it, no faster than the beam lets it rise, and in under it.
      const { body } = target.vehicle
      const mass = target.tuning.mass
      const rising = Math.min(Math.max(1 - vdot(linearVelocity, up) / LIFT_RISE, 0), 1)
      if (heightOver(map, position) < heightOver(map, ufo.position) - 4) addForceAlong(body, up, mass * (gravity + LIFT_PULL * rising))
      // In toward the point under the saucer at the car's own height, along the ground: nothing up or down.
      atHeight(map, upOf(ufo.position, under), heightOver(map, position), under)
      const at = position
      across.x = (under.x - at.x) * 2 - linearVelocity.x * 1.5
      across.y = (under.y - at.y) * 2 - linearVelocity.y * 1.5
      across.z = (under.z - at.z) * 2 - linearVelocity.z * 1.5
      vaddScaled(across, across, up, -vdot(across, up))
      body.addForce({ x: across.x * mass, y: across.y * mass, z: across.z * mass }, true)
      if (ufo.stateTicks >= UFO_LIFT_TICKS) {
        ufo.state = 'carry'
        ufo.stateTicks = 0
      }
      return
    }
    case 'carry':
    case 'lower': {
      if (target === undefined || !target.occupied || target.vehicle.wrecked) {
        giveUp(ufo, UFO_LOST_TICKS)
        return
      }
      const drop = dropSpot(map, ufo)
      const floor = heightOver(map, drop)
      const { position } = ufo
      if (ufo.state === 'carry') {
        // Off over the island to where it sets the car down, high enough to clear the ground ahead as well as under it.
        const ahead = v3(position.x + (drop.x - position.x) * 0.05, position.y + (drop.y - position.y) * 0.05, position.z + (drop.z - position.z) * 0.05)
        // Over the ground, and over whatever is built there, which the car hanging under it would be carried into.
        const clear = Math.max(groundAt(map, position), groundAt(map, ahead), skylineAt(map, position), skylineAt(map, ahead))
        // Still climbing to clear it, it goes on over the ground the slower the further below it is, so the car is lifted over what is ahead rather than into it.
        const below = clear + UFO_CRUISE - heightOver(map, position)
        const pace = Math.min(Math.max(1 - below / UFO_CRUISE, 0), 1)
        if (fly(map, ufo, drop, clear + UFO_CRUISE, UFO_CARRY_SPEED * pace, dt, UFO_CARRY_CLIMB) < WAYPOINT_REACH / 4) {
          ufo.state = 'lower'
          ufo.stateTicks = 0
        }
        hold(map, target, ufo, heightOver(map, position) - UFO_HANG, dt)
        return
      }
      // Down to hover over the road, then the car let down its beam until it is all but on it.
      fly(map, ufo, drop, floor + UFO_HOVER, UFO_SPEED, dt, UFO_CARRY_CLIMB)
      const hanging = Math.max(heightOver(map, position) - UFO_HANG - ufo.stateTicks * dt * UFO_LOWER_SPEED, floor + UFO_LET_GO)
      hold(map, target, ufo, hanging, dt)
      if (hanging <= floor + UFO_LET_GO) released(ufo)
      return
    }
  }
}

/** How much faster than the saucer a car on its beam is drawn in under it. */
const CATCH_UP = 1.5

const drift = v3()
const under = v3()

/**
 * Hold a car on the beam this high under a saucer, level and facing the way
 * it was, drawn in under it a little faster than the saucer carries it, so it is
 * never put anywhere in a blink.
 */
function hold(map: World, seat: Abductee, ufo: Ufo, height: number, dt: number): void {
  const { body, frame, lastLinearVelocity, up } = seat.vehicle
  // A car coasting in a mirror is held from where it has coasted to, and goes on from where it is held.
  writeCoast(seat.vehicle)
  const at = body.translation()
  atHeight(map, upOf(ufo.position, under), height, under)
  drift.x = under.x - at.x
  drift.y = under.y - at.y
  drift.z = under.z - at.z
  const off = Math.hypot(drift.x, drift.y, drift.z)
  // A little faster than the saucer goes, so a car that has fallen behind it catches up.
  const most = UFO_CARRY_SPEED * CATCH_UP * dt
  const share = off > most ? most / off : 1
  drift.x *= share / dt
  drift.y *= share / dt
  drift.z *= share / dt
  // Carried by its velocity alone: moved as well as given it, a step would carry it twice as far.
  body.setRotation(uprightRotation(up, frame.forward), true)
  body.setLinvel(drift, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  coastFromBody(seat.vehicle)
  // Carried is not knocked about: the car reads its knocks against the velocity it is given.
  lastLinearVelocity.x = drift.x
  lastLinearVelocity.y = drift.y
  lastLinearVelocity.z = drift.z
}

const drops = new WeakMap<Ufo, { abductions: number; x: number; y: number; z: number }>()

/** The spot on a road a saucer sets the car it has down on, picked by how many it has taken. */
function dropSpot(map: World, ufo: Ufo): Vec3 {
  const known = drops.get(ufo)
  if (known !== undefined && known.abductions === ufo.abductions) return known
  const at = dropPoint(map, ufo)
  const point = nearestRoadSpotTo(map, at)?.point ?? at
  const found = { abductions: ufo.abductions, x: point.x, y: point.y, z: point.z }
  drops.set(ufo, found)
  return found
}

/** How far apart two points are along the ground, round the planet. */
function alongGroundBetween(map: World, a: Vec3, b: Vec3): number {
  upOf(a, from)
  upOf(b, toward)
  const dot = vdot(from, toward)
  const cx = from.y * toward.z - from.z * toward.y
  const cy = from.z * toward.x - from.x * toward.z
  const cz = from.x * toward.y - from.y * toward.x
  return atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), dot) * map.radius
}

/** Whether a saucer has a car on its beam: lifting it, carrying it off or letting it down. */
export function carrying(ufo: Ufo): boolean {
  return ufo.state === 'lift' || ufo.state === 'carry' || ufo.state === 'lower'
}

/** Where a car taken is set down: somewhere over the land picked by how many the saucer has taken, then on the road nearest it. */
export function dropPoint(map: World, ufo: Ufo): Vec3 {
  return waypoint(map, { ...ufo, legs: 100000 + ufo.abductions * 7 }, v3())
}

/** Done with a car it took: back to cruising, to wait a good while before it takes another. */
export function released(ufo: Ufo): void {
  ufo.abductions += 1
  giveUp(ufo, UFO_COOLDOWN_TICKS)
}

/**
 * A saucer brought down comes back whole high over somewhere else on the
 * island, picked by how many times it has been brought down, letting go
 * of whatever car it had and waiting a good while before it takes another.
 */
export function rebuildUfo(map: World, ufo: Ufo): void {
  ufo.deaths += 1
  ufo.damage = 0
  const at = waypoint(map, { ...ufo, legs: 50000 + ufo.deaths * 13 }, v3())
  atHeight(map, upOf(at), groundAt(map, at) + UFO_CRUISE, ufo.position)
  giveUp(ufo, UFO_COOLDOWN_TICKS)
}
