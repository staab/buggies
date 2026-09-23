import * as exact from '@buggies/physics'
import type { Vec2 } from './geometry.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

/**
 * Keeping a road drivable: grade and curvature limits applied along a run of
 * points.
 */

/**
 * Relax a height profile until no segment exceeds `maxGrade`, while staying as
 * close to the target as possible. Peaks are cut and dips filled symmetrically,
 * which is what carves a gradual line through a mountain instead of climbing
 * straight over it.
 */
export function limitGrade(heights: Float32Array, points: Vec2[], maxGrade: number): void {
  const count = heights.length
  const maxDelta = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    maxDelta[i] = maxGrade * hypot(points[next]!.x - points[i]!.x, points[next]!.z - points[i]!.z)
  }

  const cap = count * 50 + 50
  for (let iteration = 0; iteration < cap; iteration++) {
    let moved = false
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count
      const diff = heights[next]! - heights[i]!
      const excess = Math.abs(diff) - maxDelta[i]!
      if (excess <= 1e-6) continue

      const direction = diff > 0 ? 1 : -1
      heights[i] = heights[i]! + (direction * excess) / 2
      heights[next] = heights[next]! - (direction * excess) / 2
      moved = true
    }
    if (!moved) break
  }
}

/**
 * Ease every crest and sag along a profile until the grade changes no
 * faster than `maxCurvature` per metre. Each sample is nudged toward the
 * line between its neighbours, half the way to the limit at a time, until
 * every bend is within it. An open road keeps its ends where they are, since
 * they meet other roads there; a closed one bends all the way round.
 */
export function limitVerticalCurvature(
  heights: Float32Array,
  points: Vec2[],
  maxCurvature: number,
  closed: boolean,
): void {
  const count = heights.length
  if (count < 3) return
  const lengths = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    lengths[i] = Math.max(hypot(points[next]!.x - points[i]!.x, points[next]!.z - points[i]!.z), 1e-3)
  }
  const first = closed ? 0 : 1
  const last = closed ? count - 1 : count - 2
  const cap = count * 20 + 50
  for (let iteration = 0; iteration < cap; iteration++) {
    let worst = 0
    for (let i = first; i <= last; i++) {
      const prev = (i - 1 + count) % count
      const next = (i + 1) % count
      const before = lengths[prev]!
      const after = lengths[i]!
      const gradeIn = (heights[i]! - heights[prev]!) / before
      const gradeOut = (heights[next]! - heights[i]!) / after
      const over = (before + after) / 2
      const curvature = (gradeOut - gradeIn) / over
      const excess = Math.abs(curvature) - maxCurvature
      if (excess <= 1e-7) continue
      worst = Math.max(worst, excess)
      // Raising this sample by d lowers the curvature by d(1/before + 1/after)/over.
      const move = (Math.sign(curvature) * excess * over) / (1 / before + 1 / after)
      heights[i] = heights[i]! + move / 2
    }
    if (worst <= 1e-6) break
  }
}

/** Relax an open profile until no segment exceeds `maxGrade`. */
export function limitOpenGrade(heights: Float32Array, points: Vec2[], maxGrade: number): void {
  const count = heights.length
  for (let pass = 0; pass < count * 20; pass++) {
    let moved = false
    for (let i = 0; i + 1 < count; i++) {
      const run = hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z)
      const diff = heights[i + 1]! - heights[i]!
      const excess = Math.abs(diff) - maxGrade * run
      if (excess <= 1e-6) continue
      const direction = diff > 0 ? 1 : -1
      heights[i] = heights[i]! + (direction * excess) / 2
      heights[i + 1] = heights[i + 1]! - (direction * excess) / 2
      moved = true
    }
    if (!moved) break
  }
}

/**
 * Enforce a grade limit in one pass from each end and average the two feasible
 * profiles. That is O(n) rather than relaxation, and averaging keeps the result
 * close to the original heights (and so to both road ends).
 */
export function limitSweepGrade(heights: Float32Array, points: Vec2[], maxGrade: number): void {
  const count = heights.length
  if (count < 2) return
  const forward = Float32Array.from(heights)
  const backward = Float32Array.from(heights)
  for (let i = 1; i < count; i++) {
    const maxDelta = maxGrade * hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z)
    const high = forward[i - 1]! + maxDelta
    const low = forward[i - 1]! - maxDelta
    if (forward[i]! > high) forward[i] = high
    else if (forward[i]! < low) forward[i] = low
  }
  for (let i = count - 2; i >= 0; i--) {
    const maxDelta = maxGrade * hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z)
    const high = backward[i + 1]! + maxDelta
    const low = backward[i + 1]! - maxDelta
    if (backward[i]! > high) backward[i] = high
    else if (backward[i]! < low) backward[i] = low
  }
  for (let i = 0; i < count; i++) heights[i] = (forward[i]! + backward[i]!) / 2
}
