/**
 * A planet's highway: one closed loop through three of its cities, routed
 * over its own ground from each city to the next, eased into a road that
 * turns gradually, given a deck that climbs no steeper than a highway may,
 * and bridged over water and tunneled under hills where the deck must.
 * Its interchanges are built each in a small frame of its own.
 */

import type { Vec3 } from '@buggies/physics'

import {
  BRIDGE_CLEARANCE,
  DECK_HEIGHT,
  INTERCHANGE_CLEAR,
  INTERCHANGE_SEARCH,
  INTERCHANGE_SPACING,
  KIND_BRIDGE,
  KIND_TUNNEL,
  MAX_ROAD_CURVATURE,
  MAX_ROAD_GRADE,
  RAMP_ALONG,
  RAMP_DROP,
  RAMP_REACH,
  RAMP_WIDTH,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  ROAD_WIDTH,
  SAMPLE_STEP,
  TURN_RADIUS_FRACTION,
  TUNNEL_DEPTH,
  UNDERPASS_CLEARANCE,
  UNDERPASS_SPAN,
  WATER_PROBE_RADIUS,
} from '../roads/constants.ts'
import { buildInterchanges, crossRoad, findDryCrossing, sampleOpen } from '../roads/crossings.ts'
import { cumulativeLengths, type Vec2 } from '../roads/geometry.ts'
import { limitGradeAlong, limitVerticalCurvatureAlong } from '../roads/grades.ts'
import { gridPlace, groundIndex, sphereHeight, type GridPlace, type SphereGround } from '../sphere.ts'
import type { WorldDistrict, WorldRoad } from '../world.ts'
import { DRY } from '../water.ts'
import { fieldOnFrame, frameAt, fromFrame, pointOnFrame, toFrame } from './frame.ts'
import { angleBetween, easeTurns, lift, resample, runs, smooth, slerp } from './lines.ts'
import type { Nav } from './nav.ts'

/** What the roads of a planet are laid out over. */
export interface Planet {
  readonly ground: SphereGround
  readonly nav: Nav
  /** The water's surface over each grid point of the ground, or `DRY`. */
  readonly water: Float32Array
  readonly seaLevel: number
  readonly districts: readonly WorldDistrict[]
}

/** The water's surface in a direction, at the nearest grid point, or `DRY`. */
export function waterAt(planet: Planet, direction: Vec3): number {
  return planet.water[waterIndex(planet.ground, direction)] ?? DRY
}

const place: GridPlace = { face: 0, i: 0, j: 0 }
function waterIndex(ground: SphereGround, direction: Vec3): number {
  gridPlace(ground.n, direction, place)
  return groundIndex(ground, place.face, Math.round(place.i), Math.round(place.j))
}

/** How many cities the highway visits. */
const HIGHWAY_CITIES = 3
/** A meter of highway over open sea counts this many times one over land in choosing its cities. */
const SEA_RUN_WEIGHT = 3
/** Each square meter of ground standing above both cities, under the run between them, counts this many meters of highway. */
const HIGH_GROUND_WEIGHT = 0.1
/** The ground is looked at this often along a run between two cities. */
const RUN_PROBE_STEP = 8
const FINE_PASSES = 30
/** The tightest the highway turns, as the radius of its bend, in meters. */
const HIGHWAY_TURN = 100

/** What the run from one city to another along the ground counts for: its length, more over the sea and more over high ground. */
function runCost(planet: Planet, a: WorldDistrict, b: WorldDistrict): number {
  const { ground, seaLevel } = planet
  const length = angleBetween(a.center, b.center) * ground.radius
  const steps = Math.max(1, Math.ceil(length / RUN_PROBE_STEP))
  const step = length / steps
  const level = Math.max(sphereHeight(ground, a.center), sphereHeight(ground, b.center))
  let cost = length
  for (let k = 0; k <= steps; k++) {
    const height = sphereHeight(ground, slerp(a.center, b.center, k / steps))
    if (height <= seaLevel) cost += SEA_RUN_WEIGHT * step
    else cost += HIGH_GROUND_WEIGHT * Math.max(height - level, 0) * step
  }
  return cost
}

/** The cities the highway loop runs through: of every three, the ones it reaches most cheaply. The rest are left to the arterials. */
export function highwayCities(planet: Planet): WorldDistrict[] {
  const { districts } = planet
  if (districts.length <= HIGHWAY_CITIES) return districts.slice()
  let best = districts.slice(0, HIGHWAY_CITIES)
  let bestCost = Infinity
  for (let i = 0; i < districts.length; i++) {
    for (let j = i + 1; j < districts.length; j++) {
      for (let k = j + 1; k < districts.length; k++) {
        const trio = [districts[i]!, districts[j]!, districts[k]!]
        let cost = 0
        for (let side = 0; side < 3; side++) cost += runCost(planet, trio[side]!, trio[(side + 1) % 3]!)
        if (cost < bestCost) {
          bestCost = cost
          best = trio
        }
      }
    }
  }
  return best
}

/**
 * The loop's course along the ground: a closed curve round the middle of
 * its cities, seen from which each city has its bearing and its distance.
 * Between each two cities a midpoint is added, drawn in toward the middle
 * onto the land where it would stand in the sea; the distance out from the
 * middle is then carried smoothly round from bearing to bearing through
 * them all, and kept no nearer the middle than the turning radius, so the
 * loop is simple, meets every city, and never doubles back. With one city,
 * it is a ring round it.
 */
export function routeLoop(planet: Planet, cities: readonly WorldDistrict[]): Vec3[] {
  const { ground, seaLevel } = planet
  const { radius } = ground
  if (cities.length === 0) return []
  const turn = Math.min(...cities.map((city) => city.radius)) * TURN_RADIUS_FRACTION
  let mx = 0
  let my = 0
  let mz = 0
  for (const city of cities) {
    mx += city.center.x
    my += city.center.y
    mz += city.center.z
  }
  const frame = frameAt(unitOf({ x: mx, y: my, z: mz }), radius)
  if (cities.length === 1) {
    const city = cities[0]!
    const around = frameAt(city.center, radius)
    const reach = city.radius + city.suburbWidth + 24
    const points = Math.ceil((2 * Math.PI * reach) / SAMPLE_STEP)
    return Array.from({ length: points }, (_, k) => {
      const angle = (k / points) * 2 * Math.PI
      return fromFrame(around, Math.cos(angle) * reach, Math.sin(angle) * reach)
    })
  }
  // Each city by its bearing and distance from the middle, round in order.
  const polar = cities
    .map((city) => {
      const { x, z } = toFrame(frame, city.center)
      return { bearing: Math.atan2(-z, x), out: Math.max(Math.hypot(x, z), turn) }
    })
    .sort((a, b) => a.bearing - b.bearing)
  // Two cities: a point either side between them, out as far as the turning radius takes it, so the loop goes round and not along.
  if (polar.length === 2) {
    const [a, b] = polar as [(typeof polar)[number], (typeof polar)[number]]
    polar.push({ bearing: (a.bearing + b.bearing) / 2, out: turn }, { bearing: (a.bearing + b.bearing) / 2 + Math.PI, out: turn })
    polar.sort((p, q) => p.bearing - q.bearing)
  }
  const controls: { bearing: number; out: number }[] = []
  for (let i = 0; i < polar.length; i++) {
    const a = polar[i]!
    const b = polar[(i + 1) % polar.length]!
    controls.push(a)
    let span = b.bearing - a.bearing
    if (span <= 0) span += 2 * Math.PI
    const bearing = a.bearing + span / 2
    let out = (a.out + b.out) / 2
    // Drawn in toward the middle, a step at a time, off the sea onto the land.
    for (let k = 0; k < 20; k++) {
      if (sphereHeight(ground, fromFrame(frame, Math.cos(bearing) * out, -Math.sin(bearing) * out)) > seaLevel) break
      out = Math.max(out * 0.9, turn)
    }
    controls.push({ bearing, out })
  }
  // The distance out, carried round through the controls smoothly, and walked a step at a time.
  const n = controls.length
  const at = (k: number): { bearing: number; out: number } => {
    const wrapped = ((k % n) + n) % n
    const turns = Math.floor(k / n)
    const control = controls[wrapped]!
    return { bearing: control.bearing + turns * 2 * Math.PI, out: control.out }
  }
  const course: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const span = p2.bearing - p1.bearing
    const steps = Math.max(2, Math.ceil((span * Math.max(p1.out, p2.out)) / SAMPLE_STEP))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      // Catmull-Rom on the distance out, against the bearing.
      const t2 = t * t
      const t3 = t2 * t
      const out =
        0.5 * (2 * p1.out + (-p0.out + p2.out) * t + (2 * p0.out - 5 * p1.out + 4 * p2.out - p3.out) * t2 + (-p0.out + 3 * p1.out - 3 * p2.out + p3.out) * t3)
      const bearing = p1.bearing + span * t
      const reach = Math.max(out, turn)
      course.push(fromFrame(frame, Math.cos(bearing) * reach, -Math.sin(bearing) * reach))
    }
  }
  const fine = smooth(resample(course, SAMPLE_STEP, radius, true), FINE_PASSES, true)
  return resample(easeTurns(fine, HIGHWAY_TURN, radius, true), SAMPLE_STEP, radius, true)
}

function unitOf(point: Vec3): Vec3 {
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1
  return { x: point.x / length, y: point.y / length, z: point.z / length }
}

/** The water's surface near a point, within the probe's reach of it, or nothing. */
function wetNear(planet: Planet, direction: Vec3): number | null {
  const radius = planet.ground.radius
  const frame = frameAt(direction, radius)
  let found: number | null = null
  for (const [x, z] of [[0, 0], [WATER_PROBE_RADIUS, 0], [-WATER_PROBE_RADIUS, 0], [0, WATER_PROBE_RADIUS], [0, -WATER_PROBE_RADIUS]] as const) {
    const level = waterAt(planet, fromFrame(frame, x, z))
    if (level !== DRY && (found === null || level > found)) found = level
  }
  return found
}

/** The highway, the cross roads and ramps of its interchanges, and the ground each interchange takes. */
export interface Highway {
  readonly highway: WorldRoad
  readonly access: WorldRoad[]
  readonly footprints: Vec3[][]
  readonly cities: WorldDistrict[]
}

/** How far each way along the highway an interchange's own frame takes in, in samples. */
const INTERCHANGE_WINDOW = 60
/** How far each way from an interchange's nominal site its frame's ground is read, and how finely. */
const FRAME_REACH = 360
const FRAME_CELL = 3

/**
 * Build the highway loop and its interchanges. The deck aims to stand clear
 * of dry land and over the water; the grade limit then carves it into the
 * hills and lifts it out of the valleys. Wherever it ends up in the ground
 * it is a tunnel, and over water a bridge. Every so often, on dry, level
 * ground clear of tunnels, an interchange lets a cross road under it.
 */
export function buildHighway(planet: Planet, firstId: number): Highway | null {
  const { ground, seaLevel } = planet
  const { radius } = ground
  const cities = highwayCities(planet)
  const course = routeLoop(planet, cities)
  const count = course.length
  if (count < 3) return null
  const lengths = runs(course, radius, true)

  const groundAt = new Float32Array(count)
  const wet = new Uint8Array(count)
  const surface = new Float32Array(count)
  for (const [i, direction] of course.entries()) {
    groundAt[i] = sphereHeight(ground, direction)
    const level = wetNear(planet, direction)
    const sea = groundAt[i]! <= seaLevel
    wet[i] = level !== null || sea ? 1 : 0
    surface[i] = level ?? (sea ? seaLevel : groundAt[i]!)
  }
  const profile = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    profile[i] = wet[i] ? Math.max(surface[i]! + BRIDGE_CLEARANCE, groundAt[i]! + DECK_HEIGHT) : groundAt[i]! + DECK_HEIGHT
  }
  // However the grade limit cuts the line down, a deck over water stays above it.
  const floor = Float32Array.from(surface, (level, i) => (wet[i] ? level + DECK_OVER_WATER : -Infinity))
  const deck = Float32Array.from(profile)
  limitGradeAlong(deck, lengths, MAX_ROAD_GRADE, floor)
  const buried = Uint8Array.from(groundAt, (height, i) => (height - deck[i]! > TUNNEL_DEPTH ? 1 : 0))

  // The interchanges, each found and built in a frame of its own, where the flat builders can work.
  let total = 0
  for (const length of lengths) total += length
  const cum = new Float32Array(count)
  for (let i = 1; i < count; i++) cum[i] = cum[i - 1]! + lengths[i - 1]!
  const step = total / count
  const search = Math.max(1, Math.round(INTERCHANGE_SEARCH / step))
  // Each nominal site's stretch of highway in a frame of its own, taking in as far as a site may slide from it.
  const window = search + INTERCHANGE_WINDOW
  const sites: { c: number; run: LocalRun; at: number }[] = []
  const gapTo = (c: number): number => {
    let gap = Infinity
    for (const { c: other } of sites) {
      const apart = Math.abs(cum[other]! - cum[c]!)
      gap = Math.min(gap, apart, total - apart)
    }
    return gap
  }
  for (let distance = 0; distance < total; distance += INTERCHANGE_SPACING) {
    let index = 0
    while (index + 1 < count && cum[index + 1]! <= distance) index++
    const run = localRun(planet, course, index, window, deck, wet, buried, profile)
    const permits = (at: number): boolean => gapTo(run.indices[at]!) >= INTERCHANGE_CLEAR
    const find = (strict: boolean): number =>
      findDryCrossing(run.field, seaLevel, run.samples, run.wet, run.buried, run.wetAt, run.deck, run.cum, run.total, run.center, search, permits, strict)
    let at = find(true)
    if (at < 0) at = find(false)
    if (at >= 0) sites.push({ c: run.indices[at]!, run, at })
  }
  const crossings = sites.map((site) => ({ ...site, cross: crossRoad(site.run.field, site.run.samples, site.at) }))

  // Raise the deck over each crossing until it clears the cross road below;
  // the grade limit spreads each lift into approach ramps.
  const bridgeSteps = Math.max(1, Math.round(UNDERPASS_SPAN / step))
  for (let pass = 0; pass < 20; pass++) {
    let raised = false
    for (const { c, cross } of crossings) {
      const required = cross.heights[cross.centerIndex]! + UNDERPASS_CLEARANCE
      for (let j = -bridgeSteps; j <= bridgeSteps; j++) {
        const k = (c + j + count) % count
        if (profile[k]! < required) {
          profile[k] = required
          raised = true
        }
      }
    }
    if (!raised) break
    limitGradeAlong(profile, lengths, MAX_ROAD_GRADE, floor)
    limitVerticalCurvatureAlong(profile, lengths, MAX_ROAD_CURVATURE, true)
  }
  limitGradeAlong(profile, lengths, MAX_ROAD_GRADE, floor)
  limitVerticalCurvatureAlong(profile, lengths, MAX_ROAD_CURVATURE, true)

  // A sample near its water is a bridge deck; one pushed beneath the ground is a tunnel.
  const kind = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    if (groundAt[i]! - profile[i]! > TUNNEL_DEPTH) kind[i] = KIND_TUNNEL
    else if (wet[i]) kind[i] = KIND_BRIDGE
  }
  const structure = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    if (kind[i] === KIND_BRIDGE || kind[next] === KIND_BRIDGE) structure[i] = ROAD_BRIDGE
    else if (kind[i] === KIND_TUNNEL || kind[next] === KIND_TUNNEL) structure[i] = ROAD_TUNNEL
    else structure[i] = ROAD_GRADE
  }

  // Nothing of an interchange may be in a tunnel, nor may its ramps have to drop further than a ramp can.
  const mouths = Math.ceil((RAMP_ALONG + RAMP_WIDTH) / step) + 1
  const built = crossings.filter(({ c, cross }) => {
    for (let k = -mouths; k <= mouths; k++) if (kind[(c + k + count) % count] === KIND_TUNNEL) return false
    if (profile[c]! - cross.heights[cross.centerIndex]! < UNDERPASS_CLEARANCE - 0.5) return false
    const drop = profile[c]! + ROAD_SURFACE - Math.min(sampleOpen(cross.heights, -RAMP_REACH), sampleOpen(cross.heights, RAMP_REACH))
    return drop <= RAMP_DROP
  })

  // Each interchange's cross road and ramps, built in its frame and stood on the planet.
  const access: WorldRoad[] = []
  const footprints: Vec3[][] = []
  let id = firstId + 1
  for (const { run, at, cross } of built) {
    // The deck as it finally stands, raised over the crossings.
    const standing = Float32Array.from(run.indices, (index) => profile[index]!)
    const stretch = Uint8Array.from(run.indices, (index) => structure[index]!)
    const made = buildInterchanges(run.samples, standing, [{ index: at, cross }], bridgeSteps, stretch, id)
    // Its bridge over the cross road, marked on the whole loop.
    for (const [k, index] of run.indices.entries()) structure[index] = stretch[k]!
    for (const road of made.roads) {
      access.push({
        id: id++,
        kind: road.kind,
        closed: false,
        points: road.points.map((point) => pointOnFrame(run.frame, point.x - FRAME_REACH, point.z - FRAME_REACH, point.y)),
        widths: new Float32Array(road.points.length).fill(road.width),
        structure: road.structure,
      })
    }
    for (const hull of made.footprints) footprints.push(hull.map((point) => lift(fromFrame(run.frame, point.x - FRAME_REACH, point.z - FRAME_REACH), radius, 0)))
  }

  const highway: WorldRoad = {
    id: firstId,
    kind: 'highway',
    closed: true,
    // The deck's surface, which rides its surface's thickness over the profile.
    points: course.map((direction, i) => lift(direction, radius, profile[i]! + ROAD_SURFACE)),
    widths: new Float32Array(count).fill(ROAD_WIDTH),
    structure,
  }
  return { highway, access, footprints, cities: cities.slice() }
}

/** The least a deck over water stands above it, however the grade limit cuts the line down. */
const DECK_OVER_WATER = 1

/** A stretch of the highway round a sample, laid out flat in a frame of its own, for the flat builders to work on. */
interface LocalRun {
  readonly frame: ReturnType<typeof frameAt>
  /** The loop's samples it takes in, in order, and which of them is the one it is round. */
  readonly indices: number[]
  readonly center: number
  /** The samples where the frame's heightfield has them: `FRAME_REACH` on from the frame's own coordinates. */
  readonly samples: Vec2[]
  readonly profile: Float32Array
  readonly deck: Float32Array
  readonly wet: Uint8Array
  readonly buried: Uint8Array
  readonly cum: Float32Array
  readonly total: number
  readonly field: ReturnType<typeof fieldOnFrame>
  readonly wetAt: (x: number, z: number) => boolean
}

function localRun(
  planet: Planet,
  course: readonly Vec3[],
  c: number,
  window: number,
  deck: Float32Array,
  wet: Uint8Array,
  buried: Uint8Array,
  profile: Float32Array,
): LocalRun {
  const count = course.length
  const frame = frameAt(course[c]!, planet.ground.radius)
  const indices: number[] = []
  for (let k = -window; k <= window; k++) indices.push((c + k + count) % count)
  const samples = indices.map((index) => {
    const { x, z } = toFrame(frame, course[index]!)
    return { x: x + FRAME_REACH, z: z + FRAME_REACH }
  })
  const cum = cumulativeLengths(samples)
  const total = cum[samples.length - 1]! + Math.hypot(samples[0]!.x - samples.at(-1)!.x, samples[0]!.z - samples.at(-1)!.z)
  return {
    frame,
    indices,
    center: window,
    samples,
    profile: Float32Array.from(indices, (index) => profile[index]!),
    deck: Float32Array.from(indices, (index) => deck[index]!),
    wet: Uint8Array.from(indices, (index) => wet[index]!),
    buried: Uint8Array.from(indices, (index) => buried[index]!),
    cum,
    total,
    field: fieldOnFrame(frame, planet.ground, FRAME_REACH, FRAME_CELL),
    wetAt: (x, z) => waterAt(planet, fromFrame(frame, x - FRAME_REACH, z - FRAME_REACH)) !== DRY,
  }
}

