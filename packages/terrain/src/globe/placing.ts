/**
 * Placing things on a planet. Whatever stands on the ground stands on a
 * spot: a rectangle about a way out, turned about the way up there, its
 * width along its own first axis and its depth along its second. Each spot
 * is laid out in a frame of its own, touching the planet at its middle, and
 * every question asked of it (is a road too near, does it meet anything
 * placed, is the ground under it wet or too uneven) is asked there, of
 * whatever is near it brought into that frame.
 */

import * as exact from '@buggies/physics'
import { quatFromBasis, type Quat, type Vec3 } from '@buggies/physics'

import { footprintsOverlap, segmentBoxDistance } from './footprints.ts'
import { ROAD_SKIRT } from '../roads/constants.ts'
import { RAIL_THICKNESS } from './rails.ts'
import { RIVER_BANK_LAP } from './water.ts'
import { TUNNEL_CLEARANCE } from './tunnels.ts'
import { ROAD_TUNNEL } from '../roads/constants.ts'
import { gridPlace, groundIndex, sphereHeight, type GridPlace, type SphereGround } from '../sphere.ts'
import { tangentFrame } from '../sphere-heights.ts'
import { DRY } from '../world.ts'
import type { WorldRiver, WorldRoad } from '../world.ts'
import { fromFrame, toFrame, type Frame } from './frame.ts'
import { angleBetween, unit } from './lines.ts'
import type { GlobeRailRun } from './rails.ts'
import { SegmentIndex } from './segments.ts'

const { atan2, cos, sin } = exact

/** A rectangle on the ground: its middle, the way its width runs, of unit length along the ground, and its size. */
export interface Spot {
  readonly at: Vec3
  readonly u: Vec3
  readonly width: number
  readonly depth: number
}

/** A spot's second axis, the way its depth runs: its first crossed with the way up. */
export function secondAxis(at: Vec3, u: Vec3): Vec3 {
  return { x: u.y * at.z - u.z * at.y, y: u.z * at.x - u.x * at.z, z: u.x * at.y - u.y * at.x }
}

/** The frame a spot is laid out in: across it along its first axis, and down it along its second. */
export function spotFrame(at: Vec3, u: Vec3, radius: number): Frame {
  const east = carryAxis(u, at)
  const v = secondAxis(at, east)
  return { middle: at, east, north: { x: -v.x, y: -v.y, z: -v.z }, radius }
}

/** The way a spot's first axis runs when turned by `yaw` from its planet's east toward its north. */
export function axisAt(at: Vec3, yaw: number): Vec3 {
  const { east, north } = tangentFrame(at)
  const c = cos(yaw)
  const s = sin(yaw)
  // Turned from east toward north, as a yaw turns x away from a map's z.
  return unit({ x: east.x * c + north.x * s, y: east.y * c + north.y * s, z: east.z * c + north.z * s })
}

/** The first axis of a thing standing at one way out, carried to another nearby, still along the ground. */
export function carryAxis(u: Vec3, to: Vec3): Vec3 {
  const rise = u.x * to.x + u.y * to.y + u.z * to.z
  return unit({ x: u.x - to.x * rise, y: u.y - to.y * rise, z: u.z - to.z * rise })
}

/** The turn of a thing standing at a way out with its x along `u`, its y up and its z along its second axis. */
export function turnOf(at: Vec3, u: Vec3): Quat {
  const x = carryAxis(u, at)
  const v = secondAxis(at, x)
  return quatFromBasis(x.x, x.y, x.z, at.x, at.y, at.z, v.x, v.y, v.z)
}

/** The ways out through a spot's corners and middle. */
export function spotSamples(spot: Spot, radius: number): Vec3[] {
  const frame = spotFrame(spot.at, spot.u, radius)
  const out: Vec3[] = [spot.at]
  for (const [su, sv] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    out.push(fromFrame(frame, (su * spot.width) / 2, (sv * spot.depth) / 2))
  }
  return out
}

/** Where another spot lies in one spot's frame, as a flat footprint there. */
function flatIn(frame: Frame, other: Spot): { x: number; z: number; yaw: number; width: number; depth: number } {
  const { x, z } = toFrame(frame, other.at)
  const v = secondAxis(frame.middle, frame.east)
  const ux = other.u.x * frame.east.x + other.u.y * frame.east.y + other.u.z * frame.east.z
  const uz = other.u.x * v.x + other.u.y * v.y + other.u.z * v.z
  // A yaw turns x toward -z.
  return { x, z, yaw: atan2(-uz, ux), width: other.width, depth: other.depth }
}

/** Everything placed so far, filed by the cubes of space about it, so a spot is only ever tried against its neighbors. */
export class Placed {
  private readonly spots: Spot[] = []
  private readonly cubes = new Map<string, number[]>()
  private readonly cell = 32

  constructor(private readonly radius: number) {}

  private keys(at: Vec3, reach: number): string[] {
    const r = this.radius
    const c = this.cell
    const keys: string[] = []
    for (let x = Math.floor((at.x * r - reach) / c); x <= Math.floor((at.x * r + reach) / c); x++) {
      for (let y = Math.floor((at.y * r - reach) / c); y <= Math.floor((at.y * r + reach) / c); y++) {
        for (let z = Math.floor((at.z * r - reach) / c); z <= Math.floor((at.z * r + reach) / c); z++) keys.push(`${x},${y},${z}`)
      }
    }
    return keys
  }

  /** Whether a spot would stand on, or within `gap` of, anything placed. */
  meets(spot: Spot, gap: number): boolean {
    const frame = spotFrame(spot.at, spot.u, this.radius)
    const here = { x: 0, z: 0, yaw: 0, width: spot.width, depth: spot.depth }
    const reach = Math.sqrt(spot.width * spot.width + spot.depth * spot.depth) / 2 + gap
    const tried = new Set<number>()
    for (const key of this.keys(spot.at, reach)) {
      for (const index of this.cubes.get(key) ?? []) {
        if (tried.has(index)) continue
        tried.add(index)
        if (footprintsOverlap(here, flatIn(frame, this.spots[index]!), gap)) return true
      }
    }
    return false
  }

  add(spot: Spot): void {
    const index = this.spots.length
    this.spots.push(spot)
    for (const key of this.keys(spot.at, Math.sqrt(spot.width * spot.width + spot.depth * spot.depth) / 2)) {
      const held = this.cubes.get(key)
      if (held === undefined) this.cubes.set(key, [index])
      else held.push(index)
    }
  }
}

/** A test of whether a spot keeps `margin` clear of a set of roads, each claiming its own reach from its centerline. */
export type Clearance = (spot: Spot, margin: number) => boolean

/**
 * A test of whether a spot keeps `margin` clear of every road: its roadway,
 * and the embankment a built road carries down beside it. A city street
 * reaches `streetReach` from its centerline.
 */
export function roadClearance(roads: readonly WorldRoad[], radius: number, streetReach: number): Clearance {
  const index = new SegmentIndex<number>(radius)
  let reachMost = 0
  for (const road of roads) {
    const reach = road.kind === 'street' ? streetReach : road.widths[0]! / 2 + (road.kind === 'highway' ? ROAD_SKIRT : 0)
    reachMost = Math.max(reachMost, reach)
    const line = road.points.map(unit)
    const count = line.length
    for (let i = 0; i < (road.closed ? count : count - 1); i++) index.add(line[i]!, line[(i + 1) % count]!, reach)
  }
  return (spot, margin) => {
    const frame = spotFrame(spot.at, spot.u, radius)
    const half = Math.sqrt(spot.width * spot.width + spot.depth * spot.depth) / 2 + margin + reachMost
    for (const segment of index.around(spot.at, half)) {
      const a = toFrame(frame, segment.a)
      const b = toFrame(frame, segment.b)
      if (segmentBoxDistance(spot.width / 2, spot.depth / 2, a.x, a.z, b.x, b.z) < segment.data + margin) return false
    }
    return true
  }
}

/** Whether a point stands clear of every guardrail by this much. */
export function railClearance(runs: readonly GlobeRailRun[], radius: number): (p: Vec3, reach: number) => boolean {
  const index = new SegmentIndex<number>(radius)
  for (const run of runs) {
    const line = run.points.map(unit)
    for (let i = 0; i + 1 < line.length; i++) index.add(line[i]!, line[i + 1]!, 0)
  }
  return (p, reach) => index.near(p, reach + RAIL_THICKNESS).length === 0
}

/**
 * The ground an interchange's ramps enclose: the ramps near one another
 * gathered together, and the hull round each gathering, on the plane
 * touching the planet at its middle.
 */
export function interchangeRings(roads: readonly WorldRoad[], radius: number, reach = 90): Vec3[][] {
  const ramps = roads.filter((road) => road.kind === 'ramp').map((road) => road.points.map(unit))
  const group = ramps.map((_, i) => i)
  const find = (i: number): number => {
    while (group[i] !== i) i = group[i] = group[group[i]!]!
    return i
  }
  for (let i = 0; i < ramps.length; i++) {
    for (let j = i + 1; j < ramps.length; j++) {
      if (find(i) === find(j)) continue
      const near = ramps[i]!.some((a) => ramps[j]!.some((b) => angleBetween(a, b) * radius <= reach))
      if (near) group[find(i)] = find(j)
    }
  }
  const members = new Map<number, Vec3[]>()
  for (const [i, ramp] of ramps.entries()) members.set(find(i), [...(members.get(find(i)) ?? []), ...ramp])
  return [...members.values()].flatMap((points) => {
    const middle = unit(points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y, z: sum.z + p.z }), { x: 0, y: 0, z: 0 }))
    const frame = spotFrame(middle, tangentFrame(middle).east, radius)
    const flat = points.map((p) => toFrame(frame, p))
    const hull = convexHull(flat)
    return hull.length >= 3 ? [hull.map((p) => fromFrame(frame, p.x, p.z))] : []
  })
}

function convexHull(points: { x: number; z: number }[]): { x: number; z: number }[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  if (sorted.length < 3) return sorted
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
  const chain = (list: { x: number; z: number }[]): { x: number; z: number }[] => {
    const out: { x: number; z: number }[] = []
    for (const point of list) {
      while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, point) <= 0) out.pop()
      out.push(point)
    }
    return out
  }
  const lower = chain(sorted)
  const upper = chain([...sorted].reverse())
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

const caps = new WeakMap<readonly Vec3[], { middle: Vec3; reach: number }>()

/** The cap of ground a ring lies within: its middle, and how far along the ground its furthest point is from that. */
export function ringCap(ring: readonly Vec3[], radius: number): { middle: Vec3; reach: number } {
  const known = caps.get(ring)
  if (known !== undefined) return known
  const middle = unit(ring.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y, z: sum.z + p.z }), { x: 0, y: 0, z: 0 }))
  let reach = 0
  for (const p of ring) reach = Math.max(reach, angleBetween(middle, p) * radius)
  const cap = { middle, reach }
  caps.set(ring, cap)
  return cap
}

/** Whether a point lies inside a ring of points about it, on the plane touching the planet at the ring's first. */
export function insideRing(ring: readonly Vec3[], p: Vec3, radius: number): boolean {
  const frame = spotFrame(ring[0]!, tangentFrame(ring[0]!).east, radius)
  const flat = ring.map((point) => toFrame(frame, point))
  const { x, z } = toFrame(frame, p)
  let inside = false
  for (let i = 0, j = flat.length - 1; i < flat.length; j = i++) {
    const a = flat[i]!
    const b = flat[j]!
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

/** Whether any of a spot lies inside any of these rings: its middle, its corners, or the middle of each side, which is enough for anything smaller than an interchange. */
export function meetsRings(rings: readonly Vec3[][], spot: Spot, radius: number): boolean {
  const size = Math.sqrt(spot.width * spot.width + spot.depth * spot.depth) / 2
  const near = rings.filter((ring) => {
    const { middle, reach } = ringCap(ring, radius)
    return angleBetween(middle, spot.at) * radius < reach + size
  })
  if (near.length === 0) return false
  const frame = spotFrame(spot.at, spot.u, radius)
  const samples: Vec3[] = []
  for (const su of [-1, 0, 1]) for (const sv of [-1, 0, 1]) samples.push(fromFrame(frame, (su * spot.width) / 2, (sv * spot.depth) / 2))
  return near.some((ring) => samples.some((p) => insideRing(ring, p, radius)))
}

/** What the ground of a planet is, for placing on: how high, how wet, and which district, at any way out. */
export interface Land {
  readonly ground: SphereGround
  readonly neighbors: Int32Array
  readonly directions: Float64Array
  readonly water: Float32Array
  readonly districtOf: Uint8Array
  readonly seaLevel: number
  readonly radius: number
}

const place: GridPlace = { face: 0, i: 0, j: 0 }

/** The grid point of the ground nearest a way out. */
export function nearestPoint(ground: SphereGround, p: Vec3): number {
  gridPlace(ground.n, p, place)
  return groundIndex(ground, place.face, Math.round(place.i), Math.round(place.j))
}

export function heightAt(land: Land, p: Vec3): number {
  return sphereHeight(land.ground, p)
}

export function districtAt(land: Land, p: Vec3): number {
  return land.districtOf[nearestPoint(land.ground, p)]!
}

/** How far over a tunnel's bore the ground about it keeps anything off, in meters. */
const TUNNEL_KEEP_OUT = 20

/**
 * Ground nothing can stand on: under the sea, a lake or a river out to its
 * banks, or over and around a tunnel.
 */
export function wetTest(land: Land, rivers: readonly WorldRiver[], roads: readonly WorldRoad[]): (p: Vec3) => boolean {
  const { radius } = land
  const banks = new SegmentIndex<number>(radius)
  for (const river of rivers) {
    for (let i = 0; i + 1 < river.points.length; i++) {
      const a = river.points[i]!
      const b = river.points[i + 1]!
      banks.add(unit(a.at), unit(b.at), (Math.max(a.width, b.width) / 2) * (1 + RIVER_BANK_LAP))
    }
  }
  const bores = new SegmentIndex<number>(radius)
  for (const road of roads) {
    const line = road.points.map(unit)
    const count = line.length
    for (let i = 0; i < (road.closed ? count : count - 1); i++) {
      if (road.structure[i] === ROAD_TUNNEL) bores.add(line[i]!, line[(i + 1) % count]!, road.widths[0]! / 2 + TUNNEL_CLEARANCE + TUNNEL_KEEP_OUT)
    }
  }
  return (p) => {
    if (land.water[nearestPoint(land.ground, p)] !== DRY) return true
    if (sphereHeight(land.ground, p) <= land.seaLevel + 0.5) return true
    if (banks.around(p, 40).some((segment) => nearestOnSegment(p, segment.a, segment.b, radius) <= segment.data)) return true
    return bores.around(p, 60).some((segment) => nearestOnSegment(p, segment.a, segment.b, radius) <= segment.data)
  }
}

function nearestOnSegment(p: Vec3, a: Vec3, b: Vec3, radius: number): number {
  const vx = (b.x - a.x) * radius
  const vy = (b.y - a.y) * radius
  const vz = (b.z - a.z) * radius
  const wx = (p.x - a.x) * radius
  const wy = (p.y - a.y) * radius
  const wz = (p.z - a.z) * radius
  const t = Math.min(Math.max((wx * vx + wy * vy + wz * vz) / (vx * vx + vy * vy + vz * vz || 1), 0), 1)
  const dx = wx - vx * t
  const dy = wy - vy * t
  const dz = wz - vz * t
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** The ground under a spot: its lowest and highest corner or middle, and whether any is wet. */
export function groundUnder(land: Land, wet: (p: Vec3) => boolean, spot: Spot): { low: number; high: number; wet: boolean } {
  let low = Infinity
  let high = -Infinity
  let anyWet = false
  for (const p of spotSamples(spot, land.radius)) {
    const height = sphereHeight(land.ground, p)
    low = Math.min(low, height)
    high = Math.max(high, height)
    if (wet(p)) anyWet = true
  }
  return { low, high, wet: anyWet }
}

/**
 * Every grid point of the ground within `reach` along it of a way out,
 * found by walking out from the nearest over the grid's neighbors.
 */
export function eachPointNear(land: Land, p: Vec3, reach: number, visit: (at: number, direction: Vec3) => void): void {
  const { ground, neighbors, directions, radius } = land
  const start = nearestPoint(ground, p)
  const seen = new Set([start])
  const stack = [start]
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    const direction = { x: directions[at * 3]!, y: directions[at * 3 + 1]!, z: directions[at * 3 + 2]! }
    if (angleBetween(direction, p) * radius > reach) continue
    visit(at, direction)
    for (let k = 0; k < 8; k++) {
      const next = neighbors[at * 8 + k]!
      if (next < 0 || seen.has(next)) continue
      seen.add(next)
      stack.push(next)
    }
  }
}
