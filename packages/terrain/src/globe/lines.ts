/**
 * Lines on a planet: runs of ways out from its middle, a road's or a
 * river's course along the ground before it is given its heights.
 */

import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

const { atan2, cos, sin } = exact

/** A way out from the planet's middle, of unit length. */
export function unit(point: Vec3): Vec3 {
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1
  return { x: point.x / length, y: point.y / length, z: point.z / length }
}

/** The angle between two ways out from the planet's middle. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const cx = a.y * b.z - a.z * b.y
  const cy = a.z * b.x - a.x * b.z
  const cz = a.x * b.y - a.y * b.x
  return atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), a.x * b.x + a.y * b.y + a.z * b.z)
}

/** The way out part of the way round the great circle from one way out to another. */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const angle = angleBetween(a, b)
  if (angle < 1e-9) return { ...a }
  const s = sin(angle)
  const wa = sin((1 - t) * angle) / s
  const wb = sin(t * angle) / s
  return unit({ x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb })
}

/** How far along the ground each point of a line is from the next, on a planet this big, round to the first from the last where it is closed. */
export function runs(line: readonly Vec3[], radius: number, closed: boolean): Float64Array {
  const count = line.length
  const out = new Float64Array(count)
  for (let i = 0; i < (closed ? count : count - 1); i++) out[i] = angleBetween(line[i]!, line[(i + 1) % count]!) * radius
  return out
}

/** A line walked at even steps of this many meters along the ground, its first point kept, and its last where it is open. */
export function resample(line: readonly Vec3[], step: number, radius: number, closed: boolean): Vec3[] {
  const count = line.length
  if (count < 2) return line.map((point) => ({ ...point }))
  const pieces = closed ? count : count - 1
  const lengths = runs(line, radius, closed)
  let total = 0
  for (let i = 0; i < pieces; i++) total += lengths[i]!
  const steps = Math.max(closed ? 3 : 1, Math.round(total / step))
  const spacing = total / steps
  const out: Vec3[] = []
  let piece = 0
  let start = 0
  for (let k = 0; k < (closed ? steps : steps + 1); k++) {
    const distance = Math.min(k * spacing, total)
    while (piece < pieces - 1 && start + lengths[piece]! < distance) {
      start += lengths[piece]!
      piece++
    }
    const t = lengths[piece]! > 0 ? Math.min(Math.max((distance - start) / lengths[piece]!, 0), 1) : 0
    out.push(slerp(line[piece]!, line[(piece + 1) % count]!, t))
  }
  return out
}

/**
 * A line eased toward the run of its neighbors this many times over, every
 * point but an open line's ends drawn part of the way to the middle of the
 * two beside it, and brought back out onto the sphere: a route cell by cell
 * turned into one that bends gradually.
 */
export function smooth(line: readonly Vec3[], passes: number, closed: boolean, share = 0.5): Vec3[] {
  let current = line.map((point) => ({ ...point }))
  const count = current.length
  for (let pass = 0; pass < passes; pass++) {
    const next = current.map((point) => ({ ...point }))
    for (let i = closed ? 0 : 1; i < (closed ? count : count - 1); i++) {
      const prev = current[(i - 1 + count) % count]!
      const after = current[(i + 1) % count]!
      const point = current[i]!
      next[i] = unit({
        x: point.x + ((prev.x + after.x) / 2 - point.x) * share,
        y: point.y + ((prev.y + after.y) / 2 - point.y) * share,
        z: point.z + ((prev.z + after.z) / 2 - point.z) * share,
      })
    }
    current = next
  }
  return current
}

/** Which way a line runs at a point, along the ground: from the point before to the one after, of unit length. */
export function tangentAt(line: readonly Vec3[], i: number, closed: boolean): Vec3 {
  const count = line.length
  const before = line[closed ? (i - 1 + count) % count : Math.max(i - 1, 0)]!
  const after = line[closed ? (i + 1) % count : Math.min(i + 1, count - 1)]!
  const point = unit(line[i]!)
  const dx = after.x - before.x
  const dy = after.y - before.y
  const dz = after.z - before.z
  const rise = dx * point.x + dy * point.y + dz * point.z
  return unit({ x: dx - point.x * rise, y: dy - point.y * rise, z: dz - point.z * rise })
}

/** The way across a line to its right at a point: the way it runs crossed with the way up. */
export function rightAt(line: readonly Vec3[], i: number, closed: boolean): Vec3 {
  const t = tangentAt(line, i, closed)
  const up = unit(line[i]!)
  return unit({ x: t.y * up.z - t.z * up.y, y: t.z * up.x - t.x * up.z, z: t.x * up.y - t.y * up.x })
}

/** A point this far from another along the ground, in this way along it, on a planet this big. */
export function along(from: Vec3, way: Vec3, distance: number, radius: number): Vec3 {
  const angle = distance / radius
  const c = cos(angle)
  const s = sin(angle)
  const start = unit(from)
  return unit({ x: start.x * c + way.x * s, y: start.y * c + way.y * s, z: start.z * c + way.z * s })
}

/** A way out this high over the planet's radius, as a point. */
export function lift(direction: Vec3, radius: number, height: number): Vec3 {
  const r = radius + height
  return { x: direction.x * r, y: direction.y * r, z: direction.z * r }
}

/** How sharply a line turns at a point: the angle between its steps in and out, over their mean length, on a planet this big. */
export function turnAt(line: readonly Vec3[], i: number, radius: number, closed: boolean): number {
  const count = line.length
  if (!closed && (i === 0 || i === count - 1)) return 0
  const a = line[(i - 1 + count) % count]!
  const b = line[i]!
  const c = line[(i + 1) % count]!
  const inX = b.x - a.x
  const inY = b.y - a.y
  const inZ = b.z - a.z
  const outX = c.x - b.x
  const outY = c.y - b.y
  const outZ = c.z - b.z
  const run = ((Math.sqrt(inX * inX + inY * inY + inZ * inZ) + Math.sqrt(outX * outX + outY * outY + outZ * outZ)) / 2) * radius
  return run > 0 ? angleBetween({ x: inX, y: inY, z: inZ }, { x: outX, y: outY, z: outZ }) / run : 0
}

/**
 * Ease a line only where it turns tighter than this radius: each such
 * point, and its neighbors a few either way, drawn toward the run of
 * theirs, over and over until no turn is left that tight, or `most` rounds.
 */
export function easeTurns(line: readonly Vec3[], least: number, radius: number, closed: boolean, most = 1000): Vec3[] {
  let current = line.map((point) => ({ ...point }))
  const count = current.length
  const reach = 8
  for (let round = 0; round < most; round++) {
    const tight: number[] = []
    for (let i = 0; i < count; i++) if (turnAt(current, i, radius, closed) > 1 / least) tight.push(i)
    if (tight.length === 0) break
    const touched = new Set<number>()
    for (const i of tight) {
      for (let k = -reach; k <= reach; k++) {
        const j = closed ? (i + k + count) % count : i + k
        if (j < (closed ? 0 : 1) || j > (closed ? count - 1 : count - 2)) continue
        touched.add(j)
      }
    }
    const next = current.map((point) => ({ ...point }))
    for (const i of touched) {
      const prev = current[(i - 1 + count) % count]!
      const after = current[(i + 1) % count]!
      const point = current[i]!
      next[i] = unit({ x: point.x + ((prev.x + after.x) / 2 - point.x) * 0.5, y: point.y + ((prev.y + after.y) / 2 - point.y) * 0.5, z: point.z + ((prev.z + after.z) / 2 - point.z) * 0.5 })
    }
    current = next
  }
  return current
}
