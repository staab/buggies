import type { Ramp } from './types.ts'

/** How many flat facets the arc of a ramp is built from. */
export const RAMP_FACETS = 6

/**
 * The radius of a ramp's arc: the circle through the foot, tangent to the
 * ground there, that reaches the lip's height over the ramp's length.
 */
function arcRadius(ramp: Ramp): number {
  const rise = ramp.top - ramp.bottom
  return (ramp.length * ramp.length + rise * rise) / (2 * rise)
}

/** Height of a ramp's top above its foot, `along` meters from the foot. */
export function rampRise(ramp: Ramp, along: number): number {
  const radius = arcRadius(ramp)
  const reach = Math.min(Math.max(along, 0), ramp.length)
  return radius - Math.sqrt(Math.max(radius * radius - reach * reach, 0))
}

/**
 * The corners of a ramp's facets, foot to lip: each is one straight piece of
 * the arc across the ramp's width, and the solid under each is convex, which
 * a collider can be made of directly.
 */
export function rampFacets(ramp: Ramp): { along: number; height: number }[] {
  const facets: { along: number; height: number }[] = []
  for (let i = 0; i <= RAMP_FACETS; i++) {
    const along = (ramp.length * i) / RAMP_FACETS
    facets.push({ along, height: ramp.bottom + rampRise(ramp, along) })
  }
  return facets
}
