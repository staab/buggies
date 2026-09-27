/**
 * A planet's rivers and lakes settled into its ground. The lakes kept are
 * those big and deep enough to read as water that a river runs through.
 * Each river's course is eased, its water seated in the ground its channel
 * runs through, held to a lake's surface where it meets one, shared where
 * two run together and made to fall all the way to the sea; then its bed is
 * cut under it and its banks shaped. The water's surface over every grid
 * point follows from all of that.
 */

import type { Vec3 } from '@buggies/physics'

import { sphereHeight } from '../sphere.ts'
import type { SphereLake, SphereRiverPoint } from '../sphere-water.ts'
import { DRY } from '../world.ts'
import type { WorldLake, WorldRiver } from '../world.ts'
import { along, angleBetween, lift, unit } from './lines.ts'
import { eachPointNear, nearestPoint, type Land } from './placing.ts'

/** How far past its drawn edge a river's water is taken to reach, as a share of its half width. */
export const RIVER_BANK_LAP = 0.35
/** How many points a lake takes, and how deep it stands over its lowest ground, before it is kept. */
const LAKE_LEAST_POINTS = 12
const LAKE_LEAST_DEPTH = 3
/** River channels are cut this deep below the water's surface, and their banks climb back to the land over this width. */
const CHANNEL_DEPTH = 4.2
const CHANNEL_BANK = 12
/** The steepest a bank may be cut: a narrow river gets a shallow channel rather than a slot. */
const CHANNEL_SLOPE = 0.5
/** The water stands this far below the lip of its channel, so the ribbon's edges are buried in the banks. */
const RIVER_INSET = 1.05
/** The most a channel may cut into a steep bank. */
const CHANNEL_MAX_INCISION = 15
/** Each river point is drawn toward the run of this many neighbors either side, to take the trace's staircase out of the course. */
const RIVER_SMOOTHING = 2
/** How far a lake's surface reaches past its own points, so a river meeting it holds its level up to the shore. */
const LAKE_SHORE = 30
/** How far a river's water may be seated below the course the tracer laid down. */
const RIVER_DROP_MAX = 0.75

/** A planet's water: its rivers and lakes, the water's surface over each grid point or `DRY`, and which points are under a river or lake. */
export interface GlobeWater {
  readonly rivers: WorldRiver[]
  readonly lakes: WorldLake[]
  readonly water: Float32Array
  readonly inland: Uint8Array
}

interface Course {
  points: { at: Vec3; level: number; width: number }[]
}

/** The way across a river's course at one of its points, of unit length along the ground: its left. */
function acrossAt(points: readonly { at: Vec3 }[], i: number): Vec3 {
  const at = points[i]!.at
  const prev = points[i - 1]?.at ?? at
  const next = points[i + 1]?.at ?? at
  let dx = next.x - prev.x
  let dy = next.y - prev.y
  let dz = next.z - prev.z
  const rise = dx * at.x + dy * at.y + dz * at.z
  dx -= at.x * rise
  dy -= at.y * rise
  dz -= at.z * rise
  const ahead = unit({ x: dx, y: dy, z: dz })
  return { x: ahead.y * at.z - ahead.z * at.y, y: ahead.z * at.x - ahead.x * at.z, z: ahead.x * at.y - ahead.y * at.x }
}

/** Settle a planet's rivers and lakes into its ground, and say where its water stands. */
export function settleWater(land: Land, courses: readonly SphereRiverPoint[][], found: readonly SphereLake[]): GlobeWater {
  const { ground, radius, seaLevel } = land
  const { heights } = ground
  const cell = (radius * Math.PI) / 2 / ground.n
  const rivers: Course[] = courses.map((course) => ({ points: course.map(({ direction, level, width }) => ({ at: direction, level, width })) }))

  // The lakes that read as water and that a river runs through.
  const traversed = new Set<number>()
  for (const river of rivers) for (const point of river.points) traversed.add(nearestPoint(ground, point.at))
  const lakes = found.filter((lake) => {
    if (lake.points.length < LAKE_LEAST_POINTS) return false
    let lowest = Infinity
    for (const at of lake.points) lowest = Math.min(lowest, heights[at]!)
    return lake.level - lowest >= LAKE_LEAST_DEPTH && lake.points.some((at) => traversed.has(at))
  })
  const lakeLevel = new Map<number, number>()
  for (const lake of lakes) for (const at of lake.points) lakeLevel.set(at, lake.level)
  /** The surface of a lake covering a point, or standing within `reach` of it. */
  const lakeAt = (p: Vec3, reach = 0): number | undefined => {
    if (reach <= 0) return lakeLevel.get(nearestPoint(ground, p))
    let lowest: number | undefined
    eachPointNear(land, p, reach, (at) => {
      const level = lakeLevel.get(at)
      if (level !== undefined && (lowest === undefined || level < lowest)) lowest = level
    })
    return lowest
  }
  const groundAt = (p: Vec3): number => sphereHeight(ground, p)

  // Take the staircase out of each course, its spring and mouth held.
  for (const river of rivers) {
    const before = river.points.map((point) => ({ ...point }))
    for (let i = 1; i < before.length - 1; i++) {
      let x = 0
      let y = 0
      let z = 0
      let level = 0
      let count = 0
      for (let k = -RIVER_SMOOTHING; k <= RIVER_SMOOTHING; k++) {
        const p = before[Math.min(Math.max(i + k, 0), before.length - 1)]!
        x += p.at.x
        y += p.at.y
        z += p.at.z
        level += p.level
        count += 1
      }
      river.points[i] = { at: unit({ x, y, z }), level: level / count, width: before[i]!.width }
    }
  }
  const traced = rivers.map((river) => river.points.map((point) => point.level))

  /** Drop every water line to the land its own channel runs through, or hold it to the lake it is part of. */
  const seat = (): void => {
    for (const [r, river] of rivers.entries()) {
      for (const [i, point] of river.points.entries()) {
        const lake = lakeAt(point.at, point.width / 2 + LAKE_SHORE)
        if (lake !== undefined && (lakeAt(point.at) !== undefined || groundAt(point.at) - lake <= CHANNEL_MAX_INCISION)) {
          point.level = lake
          continue
        }
        const across = acrossAt(river.points, i)
        const half = point.width / 2
        // The lowest ground the channel touches, across the ribbon and out to the foot of each bank.
        let lip = groundAt(point.at)
        for (const offset of [half, half + CHANNEL_BANK]) {
          lip = Math.min(lip, groundAt(along(point.at, across, offset, radius)), groundAt(along(point.at, across, -offset, radius)))
        }
        point.level = Math.max(Math.min(point.level, lip) - RIVER_INSET, traced[r]![i]! - RIVER_DROP_MAX)
      }
    }
  }
  /** Give two courses that run together the one surface, read from a snapshot so one cannot drag another through it. */
  const share = (): void => {
    const before = rivers.map((river) => river.points.map((point) => point.level))
    for (const river of rivers) {
      for (const point of river.points) {
        if (lakeAt(point.at) !== undefined) continue
        for (const [other, otherRiver] of rivers.entries()) {
          if (otherRiver === river) continue
          for (const [i, mate] of otherRiver.points.entries()) {
            if (angleBetween(mate.at, point.at) * radius > (point.width + mate.width) / 4) continue
            point.level = Math.min(point.level, before[other]![i]!)
          }
        }
      }
    }
  }
  /** Hold the surface to one that only ever falls downstream. */
  const fall = (): void => {
    for (const river of rivers) {
      for (let i = river.points.length - 2; i >= 0; i--) river.points[i]!.level = Math.max(river.points[i]!.level, river.points[i + 1]!.level)
    }
  }
  /**
   * Cut the bed under each ribbon and the bank that closes it in: the
   * deepest bed and the highest bank any stamp along the course asks for,
   * gathered before anything is cut, so no stamp's bank carves away the
   * bank its neighbor needs.
   */
  const carve = (): void => {
    const bedOf = new Map<number, number>()
    const bankOf = new Map<number, number>()
    for (const river of rivers) {
      const stamps: { at: Vec3; level: number; width: number }[] = []
      for (const [i, point] of river.points.entries()) {
        stamps.push(point)
        const next = river.points[i + 1]
        if (next !== undefined) stamps.push({ at: unit({ x: point.at.x + next.at.x, y: point.at.y + next.at.y, z: point.at.z + next.at.z }), level: (point.level + next.level) / 2, width: (point.width + next.width) / 2 })
      }
      for (const point of stamps) {
        const half = point.width / 2
        const bed = half * 0.5
        const climbRun = Math.max(half - bed, cell)
        const cut = Math.min(CHANNEL_DEPTH, climbRun * CHANNEL_SLOPE)
        // A headwater's thread narrower than a cell is still over the nearest point.
        const reach = Math.max(half, cell * Math.SQRT1_2)
        const outer = reach + CHANNEL_BANK
        eachPointNear(land, point.at, outer, (at, p) => {
          const distance = angleBetween(p, point.at) * radius
          if (distance <= reach) {
            const climb = distance <= bed ? 0 : Math.min((distance - bed) / climbRun, 1)
            const level = point.level - cut * (1 - climb)
            const known = bedOf.get(at)
            if (known === undefined || level < known) bedOf.set(at, level)
          } else {
            // Past the ribbon the bank lifts at the same slope and its cut fades out to the land at the far edge.
            const fade = (distance - reach) / CHANNEL_BANK
            const bank = point.level + (distance - reach) * CHANNEL_SLOPE
            const level = bank + (heights[at]! - bank) * fade
            const known = bankOf.get(at)
            if (known === undefined || level > known) bankOf.set(at, level)
          }
        })
      }
    }
    const cutTo = (at: number, level: number): void => {
      const target = Math.max(level, heights[at]! - CHANNEL_MAX_INCISION)
      if (target < heights[at]!) heights[at] = target
    }
    for (const [at, level] of bedOf) cutTo(at, level)
    for (const [at, level] of bankOf) if (!bedOf.has(at)) cutTo(at, level)
  }
  for (let pass = 0; pass < 2; pass++) {
    seat()
    share()
    fall()
    carve()
  }

  // The water's surface: the sea, each lake over its own ground below its level, and each river out to its banks.
  const water = new Float32Array(heights.length).fill(DRY)
  const inland = new Uint8Array(heights.length)
  for (let at = 0; at < heights.length; at++) if (heights[at]! <= seaLevel) water[at] = seaLevel
  const worldLakes: WorldLake[] = []
  for (const [id, lake] of lakes.entries()) {
    const points = lake.points.filter((at) => heights[at]! < lake.level)
    if (points.length === 0) continue
    for (const at of points) {
      water[at] = Math.max(water[at]!, lake.level)
      inland[at] = 1
    }
    worldLakes.push({ id, level: lake.level, points })
  }
  for (const river of rivers) {
    for (const point of river.points) {
      inland[nearestPoint(ground, point.at)] = 1
      eachPointNear(land, point.at, (point.width / 2) * (1 + RIVER_BANK_LAP), (at) => {
        if (point.level > water[at]!) water[at] = point.level
      })
    }
  }
  return {
    rivers: rivers.map((river, id) => ({ id, points: river.points.map((point) => ({ at: lift(point.at, radius, point.level), width: point.width })) })),
    lakes: worldLakes,
    water,
    inland,
  }
}
