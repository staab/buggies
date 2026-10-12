/**
 * What the worlds past the planet are made with: their ground as land to
 * place on, spots level enough to stand something on, the portals, the
 * places linked up by roads or tubes, and the trees, rocks and buildings
 * scattered over them. Each world asks of these what it needs, so a dome
 * city on Mars and a village on Venus are raised the same way.
 */

import * as exact from '@buggies/physics'
import { createRng, randomRange, type Rng, type Vec3 } from '@buggies/physics'

import { fbm3D } from '../noise.ts'
import { createSphereGround, sphereHeight, type SphereGround } from '../sphere.ts'
import { groundDirections, groundNeighbors } from '../sphere-water.ts'
import type { BuildingKind, PropKind } from '../types.ts'
import { randomDirection } from '../world-queries.ts'
import { DRY, type WorldBuilding, type WorldDistrict, type WorldPortal, type WorldProp, type WorldRoad, type WorldRock, type WorldTree } from '../world.ts'
import { fromFrame } from '../globe/frame.ts'
import { angleBetween, lift, unit } from '../globe/lines.ts'
import { axisAt, eachPointNear, Placed, roadClearance, spotFrame, spotSamples, turnOf, type Clearance, type Land, type Spot } from '../globe/placing.ts'
import { PLANET_RADIUS, SPHERE_CELLS } from '../globe/planet.ts'
import { PROPS_MOST } from '../globe/sizes.ts'
import { PORTAL_RADIUS, portalRun } from '../globe/portals.ts'

const { cos, sin } = exact

/** A world's ground, made this big as a share of the planet's, with its grid as fine as the planet's or finer. */
export function groundOfSize(size: number, cells = Math.round(SPHERE_CELLS * size)): SphereGround {
  return createSphereGround(cells, PLANET_RADIUS * size)
}

/** A world's ground as land to place things on. */
export function landOf(ground: SphereGround, seaLevel: number, water?: Float32Array, districtOf?: Uint8Array): Land {
  const count = ground.heights.length
  return {
    ground,
    neighbors: groundNeighbors(ground),
    directions: groundDirections(ground),
    water: water ?? new Float32Array(count).fill(DRY),
    districtOf: districtOf ?? new Uint8Array(count),
    seaLevel,
    radius: ground.radius,
  }
}

/** Rolling ground: noise this high, this broad, laid over every grid point at its own place on the sphere. */
export function rollGround(land: Land, seed: number, height: number, frequency: number, base = 0, octaves = 3): void {
  const { ground, directions, radius } = land
  for (let at = 0; at < ground.heights.length; at++) {
    const x = directions[at * 3]! * radius * frequency
    const y = directions[at * 3 + 1]! * radius * frequency
    const z = directions[at * 3 + 2]! * radius * frequency
    ground.heights[at] = base + (fbm3D(x, y, z, seed, octaves) - 0.5) * 2 * height
  }
}

/**
 * Bring the ground level to a height over a round reach about a way out,
 * eased back into the ground as it was over `blend` beyond: a dome's
 * floor, a platform's top.
 */
export function levelGround(land: Land, center: Vec3, reach: number, blend: number, height: number): void {
  const { heights } = land.ground
  eachPointNear(land, center, reach + blend, (at, p) => {
    const d = angleBetween(p, center) * land.radius
    const share = d <= reach ? 1 : 1 - smootherstep((d - reach) / blend)
    heights[at] = heights[at]! + (height - heights[at]!) * share
  })
}

function smootherstep(t: number): number {
  const x = Math.min(Math.max(t, 0), 1)
  return x * x * (3 - 2 * x)
}

/** The ground's mean height over a round reach about a way out. */
export function meanHeight(land: Land, center: Vec3, reach: number): number {
  let sum = 0
  let count = 0
  eachPointNear(land, center, reach, (at) => {
    sum += land.ground.heights[at]!
    count++
  })
  return count === 0 ? 0 : sum / count
}

/** How far the ground rises and falls over a round reach about a way out: highest less lowest. */
export function reliefOver(land: Land, center: Vec3, reach: number): number {
  let low = Infinity
  let high = -Infinity
  eachPointNear(land, center, reach, (at) => {
    low = Math.min(low, land.ground.heights[at]!)
    high = Math.max(high, land.ground.heights[at]!)
  })
  return high - low
}

/** Places scattered over the sphere, each `apart` from every other along the ground, and passing `fits`; as many as are wanted, or as many as are found. */
export function scatterPlaces(rng: Rng, radius: number, wanted: number, apart: (a: number, b: number) => number, reachOf: () => number, fits: (center: Vec3, reach: number) => boolean = () => true, tries = 600): { center: Vec3; reach: number }[] {
  const places: { center: Vec3; reach: number }[] = []
  for (let attempt = 0; attempt < tries && places.length < wanted; attempt++) {
    const center = randomDirection(rng)
    const reach = reachOf()
    if (places.some((other) => angleBetween(center, other.center) * radius < apart(reach, other.reach))) continue
    if (!fits(center, reach)) continue
    places.push({ center, reach })
  }
  return places
}

/**
 * Which places to link, as pairs of their indices: a tree of the shortest
 * links that joins them all, and then the next shortest that do not, as
 * many as `extra`, each linking two not yet linked.
 */
export function linkPlaces(centers: readonly Vec3[], extra: number): [number, number][] {
  const pairs: { a: number; b: number; d: number }[] = []
  for (let a = 0; a < centers.length; a++) for (let b = a + 1; b < centers.length; b++) pairs.push({ a, b, d: angleBetween(centers[a]!, centers[b]!) })
  pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b)
  const parent = centers.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const links: [number, number][] = []
  const spare: [number, number][] = []
  for (const { a, b } of pairs) {
    if (find(a) !== find(b)) {
      parent[find(a)] = find(b)
      links.push([a, b])
    } else spare.push([a, b])
  }
  return [...links, ...spare.slice(0, extra)]
}

/** Every pair of places, to link each with every other. */
export function linkAll(count: number): [number, number][] {
  const links: [number, number][] = []
  for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) links.push([a, b])
  return links
}

/** The way out this far along the ground from a way out, toward another. */
export function toward(from: Vec3, to: Vec3, distance: number, radius: number): Vec3 {
  const angle = angleBetween(from, to)
  if (angle < 1e-9) return { ...from }
  const share = distance / radius / angle
  const s = sin(angle)
  const wa = sin((1 - share) * angle) / s
  const wb = sin(share * angle) / s
  return unit({ x: from.x * wa + to.x * wb, y: from.y * wa + to.y * wb, z: from.z * wa + to.z * wb })
}

/** A city as the world has it: a place, numbered. */
export function districtOfPlace(id: number, center: Vec3, reach: number): WorldDistrict {
  return { id, center, radius: reach, suburbWidth: 0, area: Math.PI * reach * reach, island: 0 }
}

/** What stands on a world, as it is placed: kept off its roads and off what is already placed. */
export class Stands {
  readonly placed: Placed
  readonly clear: Clearance
  readonly buildings: WorldBuilding[] = []
  readonly trees: WorldTree[] = []
  readonly rocks: WorldRock[] = []
  readonly props: WorldProp[] = []

  constructor(
    readonly land: Land,
    roads: readonly WorldRoad[],
  ) {
    this.placed = new Placed(land.radius)
    this.clear = roadClearance(roads, land.radius, 0)
  }

  /** Whether a spot is clear of the roads by this much, of everything placed by this gap, and on ground no more uneven than this. */
  fits(spot: Spot, roadMargin: number, gap: number, relief: number): { low: number; high: number } | null {
    if (!this.clear(spot, roadMargin) || this.placed.meets(spot, gap)) return null
    let low = Infinity
    let high = -Infinity
    for (const p of spotSamples(spot, this.land.radius)) {
      const height = sphereHeight(this.land.ground, p)
      low = Math.min(low, height)
      high = Math.max(high, height)
    }
    return high - low > relief ? null : { low, high }
  }

  /** A building on a spot, buried a little under its lowest ground and standing `height` over its highest. */
  raise(kind: BuildingKind, spot: Spot, ground: { low: number; high: number }, height: number, tone: number): WorldBuilding {
    this.placed.add(spot)
    const bury = 0.6
    const building: WorldBuilding = {
      kind,
      at: lift(spot.at, this.land.radius, ground.low - bury),
      turn: turnOf(spot.at, spot.u),
      width: spot.width,
      depth: spot.depth,
      height: ground.high - ground.low + bury + height,
      tone,
    }
    this.buildings.push(building)
    return building
  }

  /** A tree at a way out, its crown kept clear of everything placed and the roads, if there is room. */
  plant(p: Vec3, kind: WorldTree['kind'], height: number, radius: number, tone: number, footing = radius * 2): boolean {
    const spot: Spot = { at: p, u: axisAt(p, 0), width: footing, depth: footing }
    if (!this.clear(spot, 0) || this.placed.meets(spot, 0)) return false
    // A shrub is driven through, and only keeps clear of the roads.
    if (kind !== 'shrub') this.placed.add(spot)
    this.trees.push({ kind, at: lift(p, this.land.radius, sphereHeight(this.land.ground, p)), height, radius, tone })
    return true
  }

  /** A crate or a barrel standing on the ground at a way out, to be knocked about, while the world has room for more and nothing is in the way. */
  prop(p: Vec3, kind: PropKind, rng: Rng): boolean {
    if (this.props.length >= PROPS_MOST) return false
    const spot: Spot = { at: p, u: axisAt(p, randomRange(rng, 0, Math.PI)), width: 1.2, depth: 1.2 }
    if (!this.clear(spot, 1) || this.placed.meets(spot, 0.3)) return false
    this.placed.add(spot)
    this.props.push({ kind, at: lift(p, this.land.radius, sphereHeight(this.land.ground, p)), turn: turnOf(p, spot.u) })
    return true
  }

  /** A rock at a way out, sunk a little into the ground, if there is room. */
  rock(p: Vec3, kind: WorldRock['kind'], size: number, rng: Rng): boolean {
    const spot: Spot = { at: p, u: axisAt(p, randomRange(rng, 0, Math.PI)), width: size, depth: size }
    if (!this.clear(spot, 1) || (kind === 'boulder' && this.placed.meets(spot, 0.5))) return false
    if (kind === 'boulder') this.placed.add(spot)
    this.rocks.push({ kind, at: lift(p, this.land.radius, sphereHeight(this.land.ground, p) - size * 0.2), turn: turnOf(p, spot.u), size, tone: rng() })
    return true
  }
}

/** A way out within a round reach of a middle, picked evenly over its disc. */
export function pointWithin(rng: Rng, center: Vec3, reach: number, radius: number): Vec3 {
  const frame = spotFrame(center, axisAt(center, 0), radius)
  const r = reach * Math.sqrt(rng())
  const angle = randomRange(rng, 0, Math.PI * 2)
  return fromFrame(frame, cos(angle) * r, sin(angle) * r)
}

/** What a settlement is built of, and how close: a city's towers and blocks, or a village's houses. */
export interface SettlementStyle {
  /** The kinds of building, each with its odds, size and height. */
  readonly kinds: readonly { kind: BuildingKind; odds: number; width: [number, number]; depth: [number, number]; height: [number, number] }[]
  readonly count: number
  /** How far apart buildings stand, and how far off the roads. */
  readonly gap: number
  readonly roadMargin: number
  /** How uneven the ground under one may be. */
  readonly relief: number
}

/**
 * Buildings scattered over a settlement's reach, each turned to face the
 * middle, off the roads and apart from each other, none so tall that it
 * passes the most `highest` allows over its foot.
 */
export function buildSettlement(stands: Stands, rng: Rng, center: Vec3, reach: number, style: SettlementStyle, highest: (p: Vec3) => number = () => Infinity): void {
  const total = style.kinds.reduce((sum, kind) => sum + kind.odds, 0)
  const radius = stands.land.radius
  let built = 0
  for (let attempt = 0; attempt < style.count * 30 && built < style.count; attempt++) {
    let pick = rng() * total
    const choice = style.kinds.find((kind) => (pick -= kind.odds) < 0) ?? style.kinds[0]!
    const at = pointWithin(rng, center, reach, radius)
    // Square to the way to the middle, as streets would set it.
    const bearing = angleBetween(at, center) < 1e-6 ? axisAt(at, 0) : unit({ x: center.x - at.x, y: center.y - at.y, z: center.z - at.z })
    const spot: Spot = { at, u: bearing, width: randomRange(rng, ...choice.width), depth: randomRange(rng, ...choice.depth) }
    const ground = stands.fits(spot, style.roadMargin, style.gap, style.relief)
    if (ground === null) continue
    const room = Math.min(...spotSamples(spot, radius).map(highest)) - ground.high
    const height = Math.min(randomRange(rng, ...choice.height), room)
    if (height < choice.height[0] * 0.6) continue
    stands.raise(choice.kind, spot, ground, height, rng())
    built++
  }
}

/** What furniture of one kind is: how big it is across, along and up, and where it may stand. */
export interface FurnitureStyle {
  readonly kind: BuildingKind
  readonly width: readonly [number, number]
  readonly depth: readonly [number, number]
  readonly height: readonly [number, number]
  /** How far it keeps off the roads and off everything placed, and how uneven the ground under it may be. */
  readonly roadMargin?: number
  readonly gap?: number
  readonly relief?: number
}

/**
 * Furniture of a kind, a piece at each way out `pick` gives that it fits
 * at, turned any way, until there are as many as are wanted or the picks
 * run out; none so tall that it passes what `highest` allows over its
 * foot. Answers how many stand.
 */
export function furnish(stands: Stands, rng: Rng, wanted: number, pick: () => Vec3 | null, style: FurnitureStyle, highest: (p: Vec3) => number = () => Infinity): number {
  let built = 0
  for (let attempt = 0; attempt < wanted * 12 && built < wanted; attempt++) {
    const at = pick()
    if (at === null) continue
    const spot: Spot = { at, u: axisAt(at, randomRange(rng, 0, Math.PI * 2)), width: randomRange(rng, ...style.width), depth: randomRange(rng, ...style.depth) }
    const ground = stands.fits(spot, style.roadMargin ?? 2, style.gap ?? 2, style.relief ?? 1.5)
    if (ground === null) continue
    const room = Math.min(...spotSamples(spot, stands.land.radius).map(highest)) - ground.high
    const height = Math.min(randomRange(rng, ...style.height), room - 1)
    if (height < style.height[0] * 0.7) continue
    stands.raise(style.kind, spot, ground, height, rng())
    built++
  }
  return built
}

/** A way out in the ring between two reaches of a middle, picked evenly over it. */
export function pointAround(rng: Rng, center: Vec3, inner: number, outer: number, radius: number): Vec3 {
  const frame = spotFrame(center, axisAt(center, 0), radius)
  const r = Math.sqrt(randomRange(rng, inner * inner, outer * outer))
  const angle = randomRange(rng, 0, Math.PI * 2)
  return fromFrame(frame, cos(angle) * r, sin(angle) * r)
}

/** Trees of a size scattered over a reach where `grows` says they may, as many as fit of those wanted. */
export function plantWithin(stands: Stands, rng: Rng, center: Vec3, reach: number, wanted: number, kind: WorldTree['kind'], height: [number, number], crown: [number, number], grows: (p: Vec3) => boolean = () => true): void {
  let planted = 0
  for (let attempt = 0; attempt < wanted * 6 && planted < wanted; attempt++) {
    const p = pointWithin(rng, center, reach, stands.land.radius)
    if (!grows(p)) continue
    if (stands.plant(p, kind, randomRange(rng, ...height), randomRange(rng, ...crown), rng())) planted++
  }
}

/**
 * Trees of a size scattered over the whole world where `grows` says they
 * may, each keeping this many times its crown's reach clear about it: two
 * for crowns that never touch, less for a canopy that closes overhead.
 */
export function plantAll(stands: Stands, rng: Rng, wanted: number, kind: WorldTree['kind'], height: [number, number], crown: [number, number], grows: (p: Vec3) => boolean = () => true, spacing = 2): void {
  let planted = 0
  const p = { x: 0, y: 0, z: 0 }
  for (let attempt = 0; attempt < wanted * 4 && planted < wanted; attempt++) {
    randomDirection(rng, p)
    if (!grows(p)) continue
    const radius = randomRange(rng, ...crown)
    if (stands.plant({ ...p }, kind, randomRange(rng, ...height), radius, rng(), radius * spacing)) planted++
  }
}

/** A spot within a reach of a middle with a run through it clear and level enough for a portal; or nothing after every try. */
function portalSpot(stands: Stands, rng: Rng, center: Vec3, reach: number, relief = 2): Spot | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const at = pointWithin(rng, center, reach, stands.land.radius)
    const run = portalRun(at, axisAt(at, randomRange(rng, 0, Math.PI)))
    if (stands.fits(run, 3, 2, relief) === null) continue
    stands.placed.add(run)
    return run
  }
  return null
}

/**
 * A portal somewhere within a reach of a middle where it has a clear run;
 * or, where nowhere has, right on the middle, whatever runs through it:
 * every world has a way out.
 */
export function portalIn(stands: Stands, rng: Rng, center: Vec3, reach: number): WorldPortal {
  const run = portalSpot(stands, rng, center, reach) ?? portalRun(center, axisAt(center, randomRange(rng, 0, Math.PI)))
  stands.placed.add(run)
  return portalOn(stands.land, run)
}

/** A portal standing on the ground on a spot, its ring across the spot's first axis. */
export function portalOn(land: Land, spot: Spot): WorldPortal {
  return { at: lift(spot.at, land.radius, sphereHeight(land.ground, spot.at)), turn: turnOf(spot.at, spot.u), radius: PORTAL_RADIUS }
}

/** A world's own dice, by its seed and what they are thrown for. */
export function diceFor(seed: number, salt: number): Rng {
  return createRng((seed ^ salt) >>> 0)
}
