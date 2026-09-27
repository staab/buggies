import { createRng, v3, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { roadLift, sampleHeight, type TerrainMap } from '@buggies/terrain'
import { addForceAlong, type Vehicle, type VehicleTuning } from '@buggies/vehicle'

import { nearestRoadSpotTo } from './spawns.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, cos, hypot, sin } = exact

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

function ufoSeed(map: TerrainMap, id: number): number {
  return (map.seed ^ UFO_SALT) + id * 15485863
}

/** The ground under a point, or the sea where that is higher. */
function groundAt(map: TerrainMap, x: number, z: number): number {
  return Math.max(sampleHeight(map.heightfield, x, z), map.seaLevel)
}

/** Where a saucer cruises to next: a point over the land, picked by how many it has reached. */
export function waypoint(map: TerrainMap, ufo: Ufo, out: { x: number; z: number }): { x: number; z: number } {
  const rng = createRng(ufoSeed(map, ufo.id) + ufo.legs * 31)
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

/** The island's saucers, each cruising over it, waiting a while before it takes its first car. */
export function createUfos(map: TerrainMap): Ufo[] {
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
    const start = waypoint(map, { ...ufo, legs: -1 }, { x: 0, z: 0 })
    ufo.position.x = start.x
    ufo.position.z = start.z
    ufo.position.y = groundAt(map, start.x, start.z) + UFO_CRUISE
    return ufo
  })
}

/** Move a saucer toward a point across the ground at this speed, and toward this height at this climb rate. */
function fly(ufo: Ufo, x: number, z: number, height: number, speed: number, dt: number, climb = UFO_CLIMB): number {
  const dx = x - ufo.position.x
  const dz = z - ufo.position.z
  const distance = hypot(dx, dz)
  const step = Math.min(distance, speed * dt)
  if (distance > 1e-6) {
    ufo.position.x += (dx / distance) * step
    ufo.position.z += (dz / distance) * step
  }
  const rise = height - ufo.position.y
  ufo.position.y += Math.sign(rise) * Math.min(Math.abs(rise), climb * dt)
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

const to = { x: 0, z: 0 }
const up = v3(0, 1, 0)
const across = v3()

/**
 * A tick of a saucer: cruising on to its next waypoint and, when it may,
 * turning after the nearest car in reach; closing on it until it is right
 * overhead; then holding over it and pulling it up its beam; then carrying
 * it off fast over the island, and letting it down onto a road far away.
 */
export function flyUfo(map: TerrainMap, ufo: Ufo, seats: readonly Abductee[], gravity: number, dt: number): void {
  if (ufo.cooldownTicks > 0) ufo.cooldownTicks -= 1
  ufo.stateTicks += 1
  const target = ufo.target < 0 ? undefined : seats[ufo.target]
  switch (ufo.state) {
    case 'roam': {
      waypoint(map, ufo, to)
      if (fly(ufo, to.x, to.z, groundAt(map, ufo.position.x, ufo.position.z) + UFO_CRUISE, UFO_SPEED, dt) < WAYPOINT_REACH) ufo.legs += 1
      if (ufo.cooldownTicks > 0) return
      let nearest = UFO_HUNT_RANGE
      for (const seat of seats) {
        if (!takeable(seat)) continue
        const { x, z } = seat.vehicle.frame.position
        const distance = hypot(x - ufo.position.x, z - ufo.position.z)
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
      const { x, y, z } = target.vehicle.frame.position
      if (fly(ufo, x, z, y + UFO_HOVER, UFO_HUNT_SPEED, dt) < UFO_BEAM_REACH / 2) {
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
      const off = fly(ufo, position.x, position.z, ufo.position.y, UFO_SPEED, dt)
      if (off > UFO_BEAM_REACH * 2) {
        giveUp(ufo, UFO_LOST_TICKS)
        return
      }
      // Up toward it, no faster than the beam lets it rise, and in under it.
      const { body } = target.vehicle
      const mass = target.tuning.mass
      const rising = Math.min(Math.max(1 - linearVelocity.y / LIFT_RISE, 0), 1)
      if (position.y < ufo.position.y - 4) addForceAlong(body, up, mass * (gravity + LIFT_PULL * rising))
      across.x = (ufo.position.x - position.x) * 2 - linearVelocity.x * 1.5
      across.y = 0
      across.z = (ufo.position.z - position.z) * 2 - linearVelocity.z * 1.5
      body.addForce({ x: across.x * mass, y: 0, z: across.z * mass }, true)
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
      const { x, z } = ufo.position
      if (ufo.state === 'carry') {
        // Off over the island to where it sets the car down, high enough to clear the ground ahead as well as under it.
        const ahead = Math.max(groundAt(map, x, z), groundAt(map, x + (drop.x - x) * 0.05, z + (drop.z - z) * 0.05))
        if (fly(ufo, drop.x, drop.z, ahead + UFO_CRUISE, UFO_CARRY_SPEED, dt, UFO_CARRY_CLIMB) < WAYPOINT_REACH / 4) {
          ufo.state = 'lower'
          ufo.stateTicks = 0
        }
        hold(target, ufo, ufo.position.y - UFO_HANG, dt)
        return
      }
      // Down to hover over the road, then the car let down its beam until it is all but on it.
      fly(ufo, drop.x, drop.z, drop.y + UFO_HOVER, UFO_SPEED, dt, UFO_CARRY_CLIMB)
      const hanging = Math.max(ufo.position.y - UFO_HANG - ufo.stateTicks * dt * UFO_LOWER_SPEED, drop.y + UFO_LET_GO)
      hold(target, ufo, hanging, dt)
      if (hanging <= drop.y + UFO_LET_GO) released(ufo)
      return
    }
  }
}

const spun = { x: 0, y: 0, z: 0, w: 1 }
const drift = v3()

/**
 * Hold a car on the beam this high under a saucer, level and facing the way
 * it was, drawn in under it no faster than the saucer carries it, so it is
 * never put anywhere in a blink.
 */
function hold(seat: Abductee, ufo: Ufo, height: number, dt: number): void {
  const { body, frame, lastLinearVelocity } = seat.vehicle
  const yaw = atan2(-frame.forward.x, -frame.forward.z)
  spun.y = sin(yaw / 2)
  spun.w = cos(yaw / 2)
  const at = body.translation()
  drift.x = ufo.position.x - at.x
  drift.y = height - at.y
  drift.z = ufo.position.z - at.z
  const off = Math.hypot(drift.x, drift.y, drift.z)
  const most = UFO_CARRY_SPEED * dt
  const share = off > most ? most / off : 1
  drift.x *= share / dt
  drift.y *= share / dt
  drift.z *= share / dt
  body.setTranslation({ x: at.x + drift.x * dt, y: at.y + drift.y * dt, z: at.z + drift.z * dt }, true)
  body.setRotation(spun, true)
  body.setLinvel(drift, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  // Carried is not knocked about: the car reads its knocks against the velocity it is given.
  lastLinearVelocity.x = drift.x
  lastLinearVelocity.y = drift.y
  lastLinearVelocity.z = drift.z
}

const drops = new WeakMap<Ufo, { abductions: number; x: number; y: number; z: number }>()

/** The spot on a road a saucer sets the car it has down on, picked by how many it has taken. */
function dropSpot(map: TerrainMap, ufo: Ufo): { x: number; y: number; z: number } {
  const known = drops.get(ufo)
  if (known !== undefined && known.abductions === ufo.abductions) return known
  const at = dropPoint(map, ufo)
  const spot = nearestRoadSpotTo(map, at.x, at.z)
  const found = spot === null
    ? { abductions: ufo.abductions, x: at.x, y: groundAt(map, at.x, at.z), z: at.z }
    : { abductions: ufo.abductions, x: spot.point.x, y: spot.point.y + roadLift(spot.road), z: spot.point.z }
  drops.set(ufo, found)
  return found
}

/** Whether a saucer has a car on its beam: lifting it, carrying it off or letting it down. */
export function carrying(ufo: Ufo): boolean {
  return ufo.state === 'lift' || ufo.state === 'carry' || ufo.state === 'lower'
}

/** Where a car taken is set down: somewhere over the land picked by how many the saucer has taken, then on the road nearest it. */
export function dropPoint(map: TerrainMap, ufo: Ufo): { x: number; z: number } {
  return waypoint(map, { ...ufo, legs: 100000 + ufo.abductions * 7 }, { x: 0, z: 0 })
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
export function rebuildUfo(map: TerrainMap, ufo: Ufo): void {
  ufo.deaths += 1
  ufo.damage = 0
  const at = waypoint(map, { ...ufo, legs: 50000 + ufo.deaths * 13 }, { x: 0, z: 0 })
  ufo.position.x = at.x
  ufo.position.z = at.z
  ufo.position.y = groundAt(map, at.x, at.z) + UFO_CRUISE
  giveUp(ufo, UFO_COOLDOWN_TICKS)
}
