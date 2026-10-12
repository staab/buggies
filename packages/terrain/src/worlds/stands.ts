/**
 * What stands on a world past the planet, and how it is placed: each piece
 * on a spot clear of the roads and of what stands already, on ground even
 * enough, none taller than any roof over it allows. Buildings, furniture,
 * trees and rocks, and the portals out.
 */

import { randomRange, type Rng, type Vec3 } from '@buggies/physics'

import { sphereHeight } from '../sphere.ts'
import type { BuildingKind } from '../types.ts'
import type { WorldBuilding, WorldPortal, WorldRoad, WorldRock, WorldTree } from '../world.ts'
import { angleBetween, lift, unit } from '../globe/lines.ts'
import { axisAt, Placed, roadClearance, spotSamples, turnOf, type Clearance, type Land, type Spot } from '../globe/placing.ts'
import { PORTAL_RADIUS, portalRun } from '../globe/portals.ts'
import { pointIn, type Place } from './places.ts'

/** Least and most of something, picked between at random. */
export type Span = readonly [number, number]

/** A kind of building, and how big one is across, along and up. */
export interface Piece {
  readonly kind: BuildingKind
  readonly width: Span
  readonly depth: Span
  readonly height: Span
}

/** How a piece keeps its distance: off the roads, from everything placed, and how uneven the ground under it may be. */
export interface Spacing {
  readonly roadMargin?: number
  readonly gap?: number
  readonly relief?: number
}

/** Furniture: so many pieces of one kind. */
export interface FurnitureStyle extends Piece, Spacing {
  readonly count: number
}

/** A settlement: so many buildings, of kinds picked by their odds. */
export interface SettlementStyle extends Spacing {
  readonly kinds: readonly (Piece & { readonly odds: number })[]
  readonly count: number
}

/** Trees, or shrubs or kelp: so many, how tall and how wide their crowns, and how many times its crown's reach each keeps clear about it, two for crowns that never touch, less for a canopy that closes overhead. */
export interface TreeStyle {
  readonly kind: WorldTree['kind']
  readonly count: number
  readonly height: Span
  readonly crown: Span
  readonly spacing?: number
}

/** How tall a piece may stand over its foot, by the way out under it: under a roof, up to the roof less a little. */
export type Headroom = (p: Vec3) => number

const UNROOFED: Headroom = () => Infinity
/** How deep a building's foot is buried under its lowest ground; how much of its height it may lose to a roof and still stand. */
const BURY = 0.6
const SHORTEST = 0.7
/** How many tries a piece gets, for each of those wanted. */
const TRIES = 12

/** What stands on a world, as it is placed: kept off its roads and off what is already placed. */
export class Stands {
  readonly placed: Placed
  readonly clear: Clearance
  readonly buildings: WorldBuilding[] = []
  readonly trees: WorldTree[] = []
  readonly rocks: WorldRock[] = []

  constructor(
    readonly land: Land,
    roads: readonly WorldRoad[],
  ) {
    this.placed = new Placed(land.radius)
    this.clear = roadClearance(roads, land.radius, 0)
  }

  /** The lowest and highest ground under a spot clear of the roads and of everything placed, if it is no more uneven than `relief`. */
  fits(spot: Spot, { roadMargin = 2, gap = 2, relief = 1.5 }: Spacing): { low: number; high: number } | null {
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
  raise(kind: BuildingKind, spot: Spot, ground: { low: number; high: number }, height: number, tone: number): void {
    this.placed.add(spot)
    this.buildings.push({
      kind,
      at: lift(spot.at, this.land.radius, ground.low - BURY),
      turn: turnOf(spot.at, spot.u),
      width: spot.width,
      depth: spot.depth,
      height: ground.high - ground.low + BURY + height,
      tone,
    })
  }

  /** A piece of a size picked at random, at a way out, turned along `u`, if it fits there and its headroom lets it stand tall enough. */
  stand(piece: Piece, spacing: Spacing, at: Vec3, u: Vec3, rng: Rng, headroom: Headroom): boolean {
    const spot: Spot = { at, u, width: randomRange(rng, ...piece.width), depth: randomRange(rng, ...piece.depth) }
    const ground = this.fits(spot, spacing)
    if (ground === null) return false
    const room = Math.min(...spotSamples(spot, this.land.radius).map(headroom)) - ground.high
    const height = Math.min(randomRange(rng, ...piece.height), room - 1)
    if (height < piece.height[0] * SHORTEST) return false
    this.raise(piece.kind, spot, ground, height, rng())
    return true
  }

  /** A tree at a way out, its crown kept clear of everything placed and the roads, if there is room. */
  plant(p: Vec3, kind: WorldTree['kind'], height: number, radius: number, tone: number, footing: number): boolean {
    const spot: Spot = { at: p, u: axisAt(p, 0), width: footing, depth: footing }
    if (!this.clear(spot, 0) || this.placed.meets(spot, 0)) return false
    // A shrub or a strand of kelp is driven through, and only keeps clear of the roads.
    if (kind === 'tree' || kind === 'fruit') this.placed.add(spot)
    this.trees.push({ kind, at: lift(p, this.land.radius, sphereHeight(this.land.ground, p)), height, radius, tone })
    return true
  }

  /** A rock at a way out, sunk a little into the ground, if there is room: a boulder keeps clear of what stands, as it is something to hit. */
  rock(p: Vec3, kind: WorldRock['kind'], size: number, rng: Rng): boolean {
    const spot: Spot = { at: p, u: axisAt(p, randomRange(rng, 0, Math.PI)), width: size, depth: size }
    if (!this.clear(spot, 1) || (kind === 'boulder' && this.placed.meets(spot, 0.5))) return false
    if (kind === 'boulder') this.placed.add(spot)
    this.rocks.push({ kind, at: lift(p, this.land.radius, sphereHeight(this.land.ground, p) - size * 0.2), turn: turnOf(p, spot.u), size, tone: rng() })
    return true
  }
}

/** Some of a count of things, each tried at the ways out `pick` gives until it takes or the tries run out: how many took. */
function placeSome(count: number, pick: () => Vec3 | null, place: (at: Vec3) => boolean): number {
  let placed = 0
  for (let attempt = 0; attempt < count * TRIES && placed < count; attempt++) {
    const at = pick()
    if (at !== null && place(at)) placed++
  }
  return placed
}

/** Furniture, a piece at each way out `pick` gives that it fits at, turned any way. Answers how many stand. */
export function furnish(stands: Stands, rng: Rng, pick: () => Vec3 | null, style: FurnitureStyle, headroom = UNROOFED): number {
  return placeSome(style.count, pick, (at) => stands.stand(style, style, at, axisAt(at, randomRange(rng, 0, Math.PI * 2)), rng, headroom))
}

/** A settlement's buildings scattered over a place, each of a kind picked by its odds, turned to face the middle as streets would set it. */
export function buildSettlement(stands: Stands, rng: Rng, place: Place, style: SettlementStyle, headroom = UNROOFED): void {
  const total = style.kinds.reduce((sum, kind) => sum + kind.odds, 0)
  const { center } = place
  placeSome(
    style.count,
    () => pointIn(rng, center, place.reach, stands.land.radius),
    (at) => {
      let pick = rng() * total
      const piece = style.kinds.find((kind) => (pick -= kind.odds) < 0) ?? style.kinds[0]!
      const u = angleBetween(at, center) < 1e-6 ? axisAt(at, 0) : unit({ x: center.x - at.x, y: center.y - at.y, z: center.z - at.z })
      return stands.stand(piece, style, at, u, rng, headroom)
    },
  )
}

/** Trees of a style, at the ways out `pick` gives, where they have room. */
export function plantTrees(stands: Stands, rng: Rng, pick: () => Vec3 | null, style: TreeStyle): void {
  placeSome(style.count, pick, (at) => {
    const radius = randomRange(rng, ...style.crown)
    return stands.plant(at, style.kind, randomRange(rng, ...style.height), radius, rng(), radius * (style.spacing ?? 2))
  })
}

/**
 * A portal somewhere within a reach of a middle where it has a clear,
 * level run; or, where nowhere has, right on the middle, whatever runs
 * through it: every world has a way out.
 */
export function portalIn(stands: Stands, rng: Rng, center: Vec3, reach: number): WorldPortal {
  const runAt = (at: Vec3): Spot => portalRun(at, axisAt(at, randomRange(rng, 0, Math.PI)))
  let run: Spot | null = null
  for (let attempt = 0; attempt < 200 && run === null; attempt++) {
    const tried = runAt(pointIn(rng, center, reach, stands.land.radius))
    if (stands.fits(tried, { roadMargin: 3, gap: 2, relief: 2 }) !== null) run = tried
  }
  run ??= runAt(center)
  stands.placed.add(run)
  return { at: lift(run.at, stands.land.radius, sphereHeight(stands.land.ground, run.at)), turn: turnOf(run.at, run.u), radius: PORTAL_RADIUS }
}
