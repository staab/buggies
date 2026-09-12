/** A deterministic stream of numbers in [0, 1). */
export type Rng = () => number

/**
 * mulberry32. Integer-only arithmetic, so a given seed produces the same
 * stream on every engine — which is what makes generation replayable.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}