import { DISTRICT_CITY, DISTRICT_SUBURB, type WorldKind } from '@buggies/terrain'
import * as THREE from 'three'

/** A point on a ramp of colors, and the color there. */
export interface ColorStop {
  t: number
  color: THREE.Color
}

/** A ramp of colors: always at least the one to start from. */
export type Stops = [ColorStop, ...ColorStop[]]

/** The color this far along a ramp, 0 to 1, into `out`. */
export function sampleRamp(t: number, stops: Stops, out: THREE.Color): THREE.Color {
  let lo = stops[0]
  if (t <= lo.t) return out.copy(lo.color)
  for (const hi of stops) {
    if (t <= hi.t) {
      const span = hi.t - lo.t || 1
      return out.copy(lo.color).lerp(hi.color, (t - lo.t) / span)
    }
    lo = hi
  }
  return out.copy(lo.color)
}

/** The sky by day, at sunset and sunrise, and by night. */
export interface Skies {
  readonly day: THREE.Color
  readonly dusk: THREE.Color
  readonly night: THREE.Color
}

/**
 * How a kind of world looks: its ground by height, how its cities and
 * villages tint it, its sky and the haze over the distance, its sea and
 * clouds if it has them, the roof over whatever it closes in, the light it
 * has of its own wherever the sun is, and what its floating platforms are
 * made of underneath.
 */
export interface WorldLook {
  /** The ground from its lowest to its highest; from the sea up where it has one. */
  readonly land: Stops
  /** The sea floor, from the shallows to the deeps. */
  readonly seabed: readonly [THREE.Color, THREE.Color]
  /** What a city's ground and a village's are drawn toward, and how far. */
  readonly city: { color: THREE.Color; share: number }
  readonly suburb: { color: THREE.Color; share: number }
  readonly skies: Skies
  /** How near the haze starts and how far it closes in, as shares of the way round the world. */
  readonly fog: { near: number; far: number }
  readonly sea: { color: THREE.Color; opacity: number } | null
  readonly clouds: THREE.Color | null
  /** The roof over what the world closes in: glass to see out of, or rock. */
  readonly roof: { color: THREE.Color; opacity: number; rock: boolean } | null
  /** Light of its own, lit wherever the sun is. */
  readonly glow: { color: THREE.Color; intensity: number } | null
  readonly underside: THREE.Color
}

const color = (hex: string): THREE.Color => new THREE.Color(hex)
const stops = (...pairs: [number, string][]): Stops => pairs.map(([t, hex]) => ({ t, color: color(hex) })) as Stops

const BLUE_SKIES: Skies = { day: color('#a9cbe6'), dusk: color('#e3b4a6'), night: color('#000000') }
const SPACE: Skies = { day: color('#000000'), dusk: color('#000000'), night: color('#000000') }
const PLANET_SEABED = [color('#4a7f86'), color('#1c3a4a')] as const
const ROCK = color('#5d5650')

const PLANET: WorldLook = {
  land: stops([0, '#c8b98a'], [0.06, '#6f8f3f'], [0.32, '#4f7a34'], [0.6, '#7d7367'], [0.82, '#9d9d9d'], [1, '#f4f6f8']),
  seabed: PLANET_SEABED,
  city: { color: color('#8c8f93'), share: 0.35 },
  suburb: { color: color('#a3a271'), share: 0.35 },
  skies: BLUE_SKIES,
  fog: { near: 0.65, far: 2.34 },
  sea: { color: color('#2f6f9f'), opacity: 0.75 },
  clouds: color('#ffffff'),
  roof: null,
  glow: null,
  underside: ROCK,
}

export const WORLD_LOOKS: Readonly<Record<WorldKind, WorldLook>> = {
  planet: PLANET,
  // Gray rock, darker down in its craters, paler up on its heights, under a black sky.
  moon: {
    ...PLANET,
    land: stops([0, '#58585c'], [0.45, '#8a8a8d'], [1, '#c9c8c4']),
    skies: SPACE,
    sea: null,
    clouds: null,
  },
  // Red rust over the open ground and up the mountains; green grass under the bubbles.
  mars: {
    ...PLANET,
    land: stops([0, '#6e2b17'], [0.3, '#9c4524'], [0.65, '#b8653a'], [1, '#e2b08a']),
    city: { color: color('#5d8f3a'), share: 0.9 },
    skies: { day: color('#d9a07a'), dusk: color('#7d8fb0'), night: color('#0b0705') },
    fog: { near: 0.5, far: 2 },
    sea: null,
    clouds: null,
    roof: { color: color('#cfe8ff'), opacity: 0.16, rock: false },
  },
  // Pale sand down the tunnels, the stations' floors paler still, under a deep blue sea.
  neptune: {
    ...PLANET,
    seabed: [color('#b9b096'), color('#7f7a69')],
    city: { color: color('#d7dde0'), share: 0.6 },
    skies: { day: color('#2c5f8a'), dusk: color('#24476a'), night: color('#040b14') },
    fog: { near: 0.08, far: 0.35 },
    sea: { color: color('#1d4f7a'), opacity: 0.6 },
    clouds: null,
    roof: { color: color('#9fd3ff'), opacity: 0.22, rock: false },
    glow: { color: color('#7fb6e0'), intensity: 0.9 },
  },
  // Grass and paving on the platforms, over a sea of amber cloud.
  jupiter: {
    ...PLANET,
    land: stops([0, '#b98a52'], [0.35, '#6f8f3f'], [0.7, '#5d7f3a'], [1, '#9aa07a']),
    seabed: [color('#c88a4d'), color('#8a4f2a')],
    skies: { day: color('#e8c79a'), dusk: color('#d48a62'), night: color('#140a06') },
    fog: { near: 0.4, far: 1.6 },
    sea: { color: color('#d99a5b'), opacity: 0.97 },
    clouds: color('#f3d7b0'),
    underside: color('#6b5546'),
  },
  // Deep jungle greens, the villages' ground trodden to earth, under yellow cloud.
  venus: {
    ...PLANET,
    land: stops([0, '#2f5a22'], [0.4, '#3d6e2a'], [0.75, '#4e7d2f'], [1, '#6c8a3a']),
    suburb: { color: color('#8a7149'), share: 0.75 },
    skies: { day: color('#d9c25a'), dusk: color('#c98d3a'), night: color('#120f04') },
    fog: { near: 0.12, far: 0.6 },
    sea: null,
    clouds: color('#e6cf55'),
  },
  // Dark rock, a little warmer in the caverns, lit by a glow of its own.
  mercury: {
    ...PLANET,
    land: stops([0, '#3b302a'], [0.5, '#5a4a3e'], [1, '#806a58']),
    city: { color: color('#6b5848'), share: 0.3 },
    skies: { day: color('#1c140f'), dusk: color('#1c140f'), night: color('#0c0806') },
    fog: { near: 0.12, far: 0.45 },
    sea: null,
    clouds: null,
    roof: { color: color('#4d4038'), opacity: 1, rock: true },
    glow: { color: color('#ffb27a'), intensity: 1.1 },
  },
}

/**
 * The ground's color at a height, in a world of this look: its sea floor
 * under its sea, its land's ramp from the sea up, or from its lowest where
 * it has no sea, drawn toward its cities' and villages' own.
 */
export function groundTone(
  look: WorldLook,
  height: number,
  min: number,
  max: number,
  seaLevel: number,
  district: number,
  out: THREE.Color,
): THREE.Color {
  if (height <= seaLevel) {
    const depth = (seaLevel - height) / Math.max(seaLevel - min, 1e-3)
    out.copy(look.seabed[0]).lerp(look.seabed[1], Math.min(1, depth))
  } else {
    const floor = Math.max(seaLevel, min)
    sampleRamp((height - floor) / Math.max(max - floor, 1e-3), look.land, out)
  }
  if (district === DISTRICT_CITY) out.lerp(look.city.color, look.city.share)
  else if (district === DISTRICT_SUBURB) out.lerp(look.suburb.color, look.suburb.share)
  return out
}
