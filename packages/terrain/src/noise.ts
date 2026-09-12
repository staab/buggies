/**
 * Deterministic value noise. Everything is derived from an integer hash of the
 * lattice coordinates and the seed, so no engine-specific math (trig, etc.) is
 * involved and results are stable across platforms.
 */

function hash2(x: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967295
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Smooth value noise in [0, 1]. */
export function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const u = fade(x - x0)
  const v = fade(z - z0)
  const a = hash2(x0, z0, seed)
  const b = hash2(x0 + 1, z0, seed)
  const c = hash2(x0, z0 + 1, seed)
  const d = hash2(x0 + 1, z0 + 1, seed)
  return lerp(lerp(a, b, u), lerp(c, d, u), v)
}

/** Fractal Brownian motion in [0, 1]. Rolling, rounded terrain. */
export function fbm2D(x: number, z: number, seed: number, octaves = 5): number {
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let norm = 0
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * valueNoise2D(x * frequency, z * frequency, seed + octave * 1013)
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return sum / norm
}

/** Ridged noise in [0, 1]. Sharp crests for mountain flanks. */
export function ridged2D(x: number, z: number, seed: number, octaves = 5): number {
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let norm = 0
  for (let octave = 0; octave < octaves; octave++) {
    const n = 1 - Math.abs(valueNoise2D(x * frequency, z * frequency, seed + octave * 373) * 2 - 1)
    sum += amplitude * n * n
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return sum / norm
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
