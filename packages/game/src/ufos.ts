import { createRng, v3, type Vec3 } from '@buggies/physics'
import * as exact from '@buggies/physics'
import { sampleHeight, type TerrainMap } from '@buggies/terrain'
import { addForceAlong, type Vehicle, type VehicleTuning } from '@buggies/vehicle'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

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
/** How near a waypoint it has to come to have reached it. */
const WAYPOINT_REACH = 12
const UFO_SALT = 0x5a0c

/** What it is doing: cruising between waypoints, closing on a car, or lifting one up its beam. */
export type UfoState = 'roam' | 'hunt' | 'lift'
export const UFO_STATES: readonly UfoState[] = ['roam', 'hunt', 'lift']

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
    }
    const start = waypoint(map, { ...ufo, legs: -1 }, { x: 0, z: 0 })
    ufo.position.x = start.x
    ufo.position.z = start.z
    ufo.position.y = groundAt(map, start.x, start.z) + UFO_CRUISE
    return ufo
  })
}

/** Move a saucer toward a point across the ground at this speed, and toward this height at its climb rate. */
function fly(ufo: Ufo, x: number, z: number, height: number, speed: number, dt: number): number {
  const dx = x - ufo.position.x
  const dz = z - ufo.position.z
  const distance = hypot(dx, dz)
  const step = Math.min(distance, speed * dt)
  if (distance > 1e-6) {
    ufo.position.x += (dx / distance) * step
    ufo.position.z += (dz / distance) * step
  }
  const rise = height - ufo.position.y
  ufo.position.y += Math.sign(rise) * Math.min(Math.abs(rise), UFO_CLIMB * dt)
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
 * overhead; then holding over it and pulling it up its beam. What becomes
 * of a car once it is up is the owner's call: see `abduct`.
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
      return
    }
  }
}

/** Whether a saucer has had a car up its beam long enough to take it away. */
export function carried(ufo: Ufo): boolean {
  return ufo.state === 'lift' && ufo.stateTicks >= UFO_LIFT_TICKS
}

/**
 * Where a car taken is set down: somewhere over the land picked by how
 * many the saucer has taken, for the owner to put on the nearest road.
 */
export function dropPoint(map: TerrainMap, ufo: Ufo): { x: number; z: number } {
  return waypoint(map, { ...ufo, legs: 100000 + ufo.abductions * 7 }, { x: 0, z: 0 })
}

/** Done with a car it took: back to cruising, to wait a good while before it takes another. */
export function released(ufo: Ufo): void {
  ufo.abductions += 1
  giveUp(ufo, UFO_COOLDOWN_TICKS)
}
