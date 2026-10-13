/**
 * Spirals: a ramp wound up round a tower from its foot to its top, and a
 * road wound down round a pit's wall from its rim to its floor. Each turns
 * evenly about a middle, climbing or falling at one grade all the way, the
 * way a road is driven.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

import { ROAD_BRIDGE } from '../roads/constants.ts'
import { smoothstep } from '../noise.ts'
import type { WorldRoad } from '../world.ts'
import { frameAt, fromFrame, toFrame } from '../globe/frame.ts'
import { lift } from '../globe/lines.ts'
import { eachPointNear, type Land } from '../globe/placing.ts'

const { atan2, cos, hypot, sin } = exact

/** How far apart a spiral's points are laid along it, in meters. */
const STEP = 3

/**
 * A ramp wound round a tower: about what middle, how far its own middle
 * line runs from the tower's, how wide it is, how high it starts and how
 * high it climbs to, how steeply, and from which way round it starts.
 */
export interface Screw {
  readonly center: Vec3
  readonly reach: number
  readonly width: number
  readonly foot: number
  readonly top: number
  readonly grade: number
  readonly start: number
}

/** How far round a screw's ramp turns from its foot to its top. */
function sweepOf(screw: Screw): number {
  return (screw.top - screw.foot) / (screw.reach * screw.grade)
}

/** Where a screw's ramp is, across its tower's frame, this far round from where it starts, and which way it is going there. */
function screwAt(screw: Screw, turned: number): { x: number; z: number; wayX: number; wayZ: number } {
  const angle = screw.start + turned
  return { x: cos(angle) * screw.reach, z: sin(angle) * screw.reach, wayX: -sin(angle), wayZ: cos(angle) }
}

/** The way out `distance` on past the top of a screw's ramp, straight on the way it leaves the tower, laid in as the ramp is up there. */
export function pastScrew(screw: Screw, distance: number, radius: number): Vec3 {
  const end = screwAt(screw, sweepOf(screw))
  const near = radius / (radius + screw.top)
  return fromFrame(frameAt(screw.center, radius), (end.x + end.wayX * distance) * near, (end.z + end.wayZ * distance) * near)
}

/**
 * The ramp wound up round a tower from the ground at its foot to its top,
 * and on from there straight off the way it was going, as far as `beyond`,
 * level: a bridge all the way, so that it is built and railed like one. It
 * is no road the world lists, so nothing drives it but the players.
 *
 * A road is laid out by how far along the ground its points are, and
 * lifted: so high up, each meter of it would be wider than one by as much
 * as it is further from the planet's middle. The ramp is laid in by as
 * much, to wind round its tower as close at its top as at its foot.
 */
export function screwRamp(screw: Screw, beyond: number, radius: number): WorldRoad {
  const frame = frameAt(screw.center, radius)
  const sweep = sweepOf(screw)
  const steps = Math.ceil((sweep * screw.reach) / STEP)
  const points: Vec3[] = []
  const widths: number[] = []
  const put = (x: number, z: number, height: number): void => {
    const near = radius / (radius + height)
    points.push(lift(fromFrame(frame, x * near, z * near), radius, height))
    widths.push(screw.width * near)
  }
  for (let i = 0; i <= steps; i++) {
    const at = screwAt(screw, (sweep * i) / steps)
    put(at.x, at.z, screw.foot + ((screw.top - screw.foot) * i) / steps)
  }
  const end = screwAt(screw, sweep)
  for (let along = STEP; along <= beyond; along += STEP) put(end.x + end.wayX * along, end.z + end.wayZ * along, screw.top)
  return {
    id: -1,
    kind: 'arterial',
    closed: false,
    points,
    widths: Float32Array.from(widths),
    structure: new Uint8Array(points.length - 1).fill(ROAD_BRIDGE),
  }
}

/**
 * A pit dug round a middle: how far out its rim is and its flat floor,
 * how far apart the turns of the road down its wall are and how wide the
 * road is, how steeply it falls, which way round it leaves the rim, and
 * how high the rim is.
 */
export interface Pit {
  readonly center: Vec3
  readonly rim: number
  readonly floor: number
  readonly pitch: number
  readonly road: number
  readonly grade: number
  readonly start: number
  readonly level: number
}

/** The way out this far from a pit's middle, this far round from where its road leaves the rim, as the pit is dug. */
export function roundPit(center: Vec3, angle: number, distance: number, radius: number): Vec3 {
  return fromFrame(frameAt(center, radius), cos(angle) * distance, sin(angle) * distance)
}

/**
 * Dig a pit into the ground: from its rim a road wound down round its
 * wall, falling evenly, a bench a turn with a cliff down from each to the
 * next, and a flat floor at the bottom where the road comes out. Answers
 * how deep the floor is under the rim.
 */
export function digPit(land: Land, pit: Pit): number {
  const { heights } = land.ground
  const frame = frameAt(pit.center, land.radius)
  // The road's middle line: this far out from the pit's middle at its rim, and in a pitch each turn.
  const outer = pit.rim - pit.pitch / 2
  const inner = pit.floor + pit.road / 2
  const sweep = ((outer - inner) * 2 * Math.PI) / pit.pitch
  const laneAt = (turned: number): number => outer - (pit.pitch * turned) / (2 * Math.PI)
  // How far down the road is this far round: its grade over how far it has run, round ever smaller turns.
  const depthAt = (turned: number): number => pit.grade * (outer * turned - (pit.pitch * turned * turned) / (4 * Math.PI))
  const bottom = depthAt(sweep)
  // How high the road is this far round, past either end the rim's ground or the floor.
  const heightAt = (turned: number): number => (turned < 0 ? pit.level : turned > sweep ? pit.level - bottom : pit.level - depthAt(turned))
  const wall = pit.pitch - pit.road
  eachPointNear(land, pit.center, pit.rim, (at, p) => {
    const { x, z } = toFrame(frame, p)
    const out = hypot(x, z)
    if (out >= pit.rim) return
    if (out <= pit.floor) {
      heights[at] = pit.level - bottom
      return
    }
    // Which turn of the road this point is nearest, and how far out from that turn's middle it lies.
    const round = (((atan2(z, x) - pit.start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const turn = Math.max(0, Math.round(((outer - out) / pit.pitch) - round / (2 * Math.PI)))
    const turned = round + 2 * Math.PI * turn
    const off = out - laneAt(turned)
    const here = heightAt(turned)
    if (Math.abs(off) <= pit.road / 2) {
      heights[at] = here
      return
    }
    // On the wall between this turn and the next out, higher, or in, lower: a cliff, eased at its top and its foot.
    const next = heightAt(turned + (off > 0 ? -2 * Math.PI : 2 * Math.PI))
    heights[at] = here + (next - here) * smoothstep(0, 1, (Math.abs(off) - pit.road / 2) / wall)
  })
  return bottom
}
