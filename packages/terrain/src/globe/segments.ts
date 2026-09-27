/**
 * Straight pieces of line on a planet, and the questions asked of them:
 * how far a point is from one, how near two come, whether two run the same
 * way, and which lie near a point. Every piece is the chord between two
 * ways out on the planet's radius; at a road's few meters a step, the chord
 * is the ground.
 */

import type { Vec3 } from '@buggies/physics'

/** A piece of line: its ends as ways out, on a planet this big, and what it belongs to. */
export interface Segment<T> {
  readonly a: Vec3
  readonly b: Vec3
  /** Of unit length, along the chord from `a` to `b`. */
  readonly way: Vec3
  readonly data: T
}

function sub(a: Vec3, b: Vec3, radius: number): Vec3 {
  return { x: (a.x - b.x) * radius, y: (a.y - b.y) * radius, z: (a.z - b.z) * radius }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/** The way from one way out to another along the chord between them, of unit length. */
export function chordWay(a: Vec3, b: Vec3): Vec3 {
  const x = b.x - a.x
  const y = b.y - a.y
  const z = b.z - a.z
  const length = Math.sqrt(x * x + y * y + z * z) || 1
  return { x: x / length, y: y / length, z: z / length }
}

/** How far along a piece, 0 to 1, a point lies nearest it, and how far from it, on a planet this big. */
export function nearestOn(p: Vec3, a: Vec3, b: Vec3, radius: number): { t: number; distance: number } {
  const v = sub(b, a, radius)
  const w = sub(p, a, radius)
  const t = Math.min(Math.max(dot(w, v) / (dot(v, v) || 1), 0), 1)
  const dx = w.x - v.x * t
  const dy = w.y - v.y * t
  const dz = w.z - v.z * t
  return { t, distance: Math.sqrt(dx * dx + dy * dy + dz * dz) }
}

/** How near two pieces come, on a planet this big. */
export function piecesGap(a: Vec3, b: Vec3, c: Vec3, d: Vec3, radius: number): number {
  const u = sub(b, a, radius)
  const v = sub(d, c, radius)
  const w = sub(a, c, radius)
  const uu = dot(u, u)
  const uv = dot(u, v)
  const vv = dot(v, v)
  const uw = dot(u, w)
  const vw = dot(v, w)
  const denominator = uu * vv - uv * uv
  let s = denominator > 1e-12 ? Math.min(Math.max((uv * vw - vv * uw) / denominator, 0), 1) : 0
  let t = vv > 1e-12 ? Math.min(Math.max((vw + uv * s) / vv, 0), 1) : 0
  s = uu > 1e-12 ? Math.min(Math.max((uv * t - uw) / uu, 0), 1) : 0
  t = vv > 1e-12 ? Math.min(Math.max((vw + uv * s) / vv, 0), 1) : 0
  const dx = w.x + u.x * s - v.x * t
  const dy = w.y + u.y * s - v.y * t
  const dz = w.z + u.z * s - v.z * t
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * The plane touching the planet at a way out, for asking a question of the
 * few meters about it: a point's place on it, across its first axis and
 * its second.
 */
export function onPlaneAt(at: Vec3, first: Vec3, radius: number): (p: Vec3) => { x: number; z: number } {
  const up = at
  const rise = dot(first, up)
  const ux = first.x - up.x * rise
  const uy = first.y - up.y * rise
  const uz = first.z - up.z * rise
  const length = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1
  const e = { x: ux / length, y: uy / length, z: uz / length }
  const n = { x: up.y * e.z - up.z * e.y, y: up.z * e.x - up.x * e.z, z: up.x * e.y - up.y * e.x }
  return (p) => {
    const d = sub(p, at, radius)
    return { x: dot(d, e), z: dot(d, n) }
  }
}

/** Pieces of line filed by the cubes of space they pass through, to be looked up near a point. */
export class SegmentIndex<T> {
  readonly segments: Segment<T>[] = []
  private readonly cubes = new Map<string, number[]>()

  constructor(
    private readonly radius: number,
    private readonly cell = 48,
  ) {}

  add(a: Vec3, b: Vec3, data: T): void {
    const index = this.segments.length
    this.segments.push({ a, b, way: chordWay(a, b), data })
    const r = this.radius
    const low = { x: Math.min(a.x, b.x) * r, y: Math.min(a.y, b.y) * r, z: Math.min(a.z, b.z) * r }
    const high = { x: Math.max(a.x, b.x) * r, y: Math.max(a.y, b.y) * r, z: Math.max(a.z, b.z) * r }
    const c = this.cell
    for (let x = Math.floor(low.x / c); x <= Math.floor(high.x / c); x++) {
      for (let y = Math.floor(low.y / c); y <= Math.floor(high.y / c); y++) {
        for (let z = Math.floor(low.z / c); z <= Math.floor(high.z / c); z++) {
          const key = `${x},${y},${z}`
          const held = this.cubes.get(key)
          if (held === undefined) this.cubes.set(key, [index])
          else held.push(index)
        }
      }
    }
  }

  /** Every piece that might come within `reach` of a point, in the order they were added, each once. */
  around(p: Vec3, reach: number): Segment<T>[] {
    const r = this.radius
    const found = new Set<number>()
    const c = this.cell
    for (let x = Math.floor((p.x * r - reach) / c); x <= Math.floor((p.x * r + reach) / c); x++) {
      for (let y = Math.floor((p.y * r - reach) / c); y <= Math.floor((p.y * r + reach) / c); y++) {
        for (let z = Math.floor((p.z * r - reach) / c); z <= Math.floor((p.z * r + reach) / c); z++) {
          for (const index of this.cubes.get(`${x},${y},${z}`) ?? []) found.add(index)
        }
      }
    }
    return [...found].sort((a, b) => a - b).map((index) => this.segments[index]!)
  }

  /** Every piece within `reach` of a point. */
  near(p: Vec3, reach: number): Segment<T>[] {
    return this.around(p, reach).filter((segment) => nearestOn(p, segment.a, segment.b, this.radius).distance <= reach)
  }
}
