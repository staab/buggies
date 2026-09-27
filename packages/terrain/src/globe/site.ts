/**
 * What everything standing on a planet's land is placed with: the land
 * itself, the roads kept clear of, what has been placed so far and where
 * each kind of thing stands, and the lists it all goes into.
 */

import { randomRange, type Rng, type Vec3 } from '@buggies/physics'

import type { BuildingKind, PropKind } from '../types.ts'
import type { WorldBuilding, WorldField, WorldRoad, WorldProp, WorldRamp, WorldRock, WorldSidewalk, WorldTree } from '../world.ts'
import { angleBetween, lift } from './lines.ts'
import {
  axisAt,
  groundUnder,
  heightAt,
  turnOf,
  type Clearance,
  type Land,
  type Placed,
  type Spot,
} from './placing.ts'
import { BURY, FRUIT_HEIGHT, FRUIT_RADIUS, PROPS_MOST, SHRUB_HEIGHT, SHRUB_RADIUS, TREE_HEIGHT, TREE_RADIUS } from './sizes.ts'

/** A building as it is raised: its spot, how high its foot and top stand over the planet's radius, and its tone. */
export interface Raised {
  kind: BuildingKind
  spot: Spot
  bottom: number
  top: number
  tone: number
}

/** Everything placed on a planet's land is placed with this. */
export interface Site {
  readonly land: Land
  readonly radius: number
  rng: Rng
  /** The dice the props throw, so that they move nothing else. */
  readonly propRng: Rng
  readonly roads: readonly WorldRoad[]
  /** Clear of every road by the old curb, and off the interchanges. */
  readonly clear: Clearance
  /** Clear of every road by the old curb alone. */
  readonly clearOfRoads: Clearance
  readonly wet: (p: Vec3) => boolean
  readonly offRails: (p: Vec3, reach: number) => boolean
  readonly placed: Placed
  readonly zones: readonly Vec3[][]
  readonly buildings: Raised[]
  readonly trees: WorldTree[]
  readonly rocks: WorldRock[]
  readonly props: WorldProp[]
  readonly ramps: WorldRamp[]
  readonly sidewalks: WorldSidewalk[]
  readonly fields: WorldField[]
  /** Where each kind of thing stands already, so the next of its kind keeps its distance. */
  readonly stood: Map<string, Vec3[]>
}

/** Plants a tree or a shrub at a way out, if nothing is in the way there. Answers whether it did. */
export type Planter = (p: Vec3, kind: WorldTree['kind']) => boolean

/**
 * A planter: a tree keeps its crown clear of every building and every other
 * crown, and off the roads and the rails; a shrub only has to find open
 * ground. `clear` is the clearance it keeps from the roads.
 */
export function planter(site: Site, clear: Clearance): Planter {
  return (p, kind) => {
    const { rng } = site
    const [radii, heights] = kind === 'tree' ? [TREE_RADIUS, TREE_HEIGHT] : kind === 'fruit' ? [FRUIT_RADIUS, FRUIT_HEIGHT] : [SHRUB_RADIUS, SHRUB_HEIGHT]
    const radius = randomRange(rng, radii.min, radii.max)
    const height = randomRange(rng, heights.min, heights.max)
    const tone = rng()
    if (site.wet(p)) return false
    // A tree keeps its whole crown to itself; an orchard's trees stand close in rows, and keep only the middle of theirs.
    const footing = kind === 'fruit' ? radius * 1.4 : radius * 2
    const spot: Spot = { at: p, u: axisAt(p, 0), width: footing, depth: footing }
    if (!clear(spot, 0) || site.placed.meets(spot, 0) || !site.offRails(p, footing / 2)) return false
    site.placed.add(spot)
    site.trees.push({ kind, at: lift(p, site.radius, heightAt(site.land, p)), height, radius, tone })
    return true
  }
}

/** Whether nothing of this kind stands within reach of a way out. */
export function farFromKind(site: Site, kind: string, p: Vec3, apart: number): boolean {
  return !(site.stood.get(kind) ?? []).some((other) => angleBetween(other, p) * site.radius < apart)
}

export function noteStood(site: Site, kind: string, p: Vec3): void {
  const list = site.stood.get(kind) ?? []
  list.push(p)
  site.stood.set(kind, list)
}

/** Whether a spot can stand: off the roads by the margin, on dry ground no more uneven than the relief, and clear of everything else. */
export function standsHere(site: Site, spot: Spot, roadMargin: number, relief: number, gap: number): { low: number; high: number } | null {
  if (!site.clear(spot, roadMargin)) return null
  const ground = groundUnder(site.land, site.wet, spot)
  if (ground.wet || ground.high - ground.low > relief) return null
  if (site.placed.meets(spot, gap)) return null
  return ground
}

/** A building on a spot, buried below the lowest ground under it and standing `height` over the highest. */
export function raise(site: Site, kind: BuildingKind, spot: Spot, ground: { low: number; high: number }, height: number, tone = site.rng()): Raised {
  const raised = { kind, spot, bottom: ground.low - BURY, top: ground.high + height, tone }
  site.buildings.push(raised)
  return raised
}

/** A round tower of a kind on the ground found for it, its spot taken. */
export function tower(site: Site, kind: BuildingKind, spot: Spot, ground: { low: number; high: number }, height: number): void {
  site.placed.add(spot)
  raise(site, kind, spot, ground, height)
}

/** A prop standing on the ground at a way out, turned with its x along `u`, while the planet has room for more. */
export function prop(site: Site, kind: PropKind, p: Vec3, u: Vec3): void {
  if (site.props.length >= PROPS_MOST || site.wet(p)) return
  site.props.push({ kind, at: lift(p, site.radius, heightAt(site.land, p)), turn: turnOf(p, u) })
}

/** A building as the world has it. */
export function worldBuilding(raised: Raised, radius: number): WorldBuilding {
  const { spot } = raised
  return {
    kind: raised.kind,
    at: lift(spot.at, radius, raised.bottom),
    turn: turnOf(spot.at, spot.u),
    width: spot.width,
    depth: spot.depth,
    height: raised.top - raised.bottom,
    tone: raised.tone,
  }
}

/** A flat thing laid on the ground, a field or a lot, as the world has it. */
export function worldField(site: Site, kind: WorldField['kind'], spot: Spot, tone: number): void {
  site.fields.push({ kind, at: lift(spot.at, site.radius, heightAt(site.land, spot.at)), turn: turnOf(spot.at, spot.u), width: spot.width, depth: spot.depth, tone })
}
