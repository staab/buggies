import * as exact from '@buggies/physics'
import type { Vec2 } from './geometry.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

/**
 * How far past its limit a rise may be left, in meters. The heights are held
 * in single precision, where halving the last few hundredths of a millimeter
 * of a rise can round back to where it was: asked for less, the relaxation
 * never settles, and runs to its cap.
 */
const GRADE_TOLERANCE = 1e-3

/**
 * Keeping a road drivable: grade and curvature limits applied along a run of
 * points.
 */

/** How far each point of a run is from the next, round to the first from the last where the run is closed. */
function runsOf(points: Vec2[], closed: boolean): Float64Array {
  const count = points.length
  const runs = new Float64Array(count)
  for (let i = 0; i < (closed ? count : count - 1); i++) {
    const next = (i + 1) % count
    runs[i] = hypot(points[next]!.x - points[i]!.x, points[next]!.z - points[i]!.z)
  }
  return runs
}

/** `limitGrade` along a closed run of points this far apart, each from the next, round to the first from the last. */
export function limitGradeAlong(heights: Float32Array, runs: Float64Array, maxGrade: number, floor?: Float32Array): void {
  const count = heights.length
  const maxDelta = new Float32Array(count)
  for (let i = 0; i < count; i++) maxDelta[i] = maxGrade * runs[i]!
  if (floor !== undefined) for (let i = 0; i < count; i++) heights[i] = Math.max(heights[i]!, floor[i]!)

  const cap = count * 50 + 50
  for (let iteration = 0; iteration < cap; iteration++) {
    let moved = false
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count
      const diff = heights[next]! - heights[i]!
      const excess = Math.abs(diff) - maxDelta[i]!
      if (excess <= GRADE_TOLERANCE) continue

      // The higher end comes down and the lower goes up, half each, unless the higher is held up by its floor.
      const high = diff > 0 ? next : i
      const low = diff > 0 ? i : next
      const lowest = floor === undefined ? -Infinity : floor[high]!
      const drop = Math.min(excess / 2, heights[high]! - lowest)
      heights[high] = heights[high]! - drop
      heights[low] = heights[low]! + (excess - drop)
      moved = true
    }
    if (!moved) break
  }
}

/** `limitVerticalCurvature` along a run of points this far apart, each from the next. */
export function limitVerticalCurvatureAlong(heights: Float32Array, runs: Float64Array, maxCurvature: number, closed: boolean): void {
  const count = heights.length
  if (count < 3) return
  const lengths = Float32Array.from(runs, (run) => Math.max(run, 1e-3))
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
  limitOpenGradeAlong(heights, runsOf(points, false), maxGrade)
}

/** `limitOpenGrade` along an open run of points this far apart, each from the next. */
export function limitOpenGradeAlong(heights: Float32Array, runs: Float64Array, maxGrade: number): void {
  const count = heights.length
  for (let pass = 0; pass < count * 20; pass++) {
    let moved = false
    for (let i = 0; i + 1 < count; i++) {
      const run = runs[i]!
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

/** `limitSweepGrade` along an open run of points this far apart, each from the next. */
export function limitSweepGradeAlong(heights: Float32Array, runs: Float64Array, maxGrade: number): void {
  const count = heights.length
  if (count < 2) return
  const forward = Float32Array.from(heights)
  const backward = Float32Array.from(heights)
  for (let i = 1; i < count; i++) {
    const maxDelta = maxGrade * runs[i - 1]!
    const high = forward[i - 1]! + maxDelta
    const low = forward[i - 1]! - maxDelta
    if (forward[i]! > high) forward[i] = high
    else if (forward[i]! < low) forward[i] = low
  }
  for (let i = count - 2; i >= 0; i--) {
    const maxDelta = maxGrade * runs[i]!
    const high = backward[i + 1]! + maxDelta
    const low = backward[i + 1]! - maxDelta
    if (backward[i]! > high) backward[i] = high
    else if (backward[i]! < low) backward[i] = low
  }
  for (let i = 0; i < count; i++) heights[i] = (forward[i]! + backward[i]!) / 2
}
