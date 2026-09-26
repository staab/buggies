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
  const reach = Math.min(Math.max(along, 0), ramp.length)
  if (ramp.straight) return ((ramp.top - ramp.bottom) * reach) / ramp.length
  const radius = arcRadius(ramp)
  return radius - Math.sqrt(Math.max(radius * radius - reach * reach, 0))
}

/**
 * The corners of a ramp's facets, foot to lip: each is one straight piece of
 * the arc across the ramp's width, or the one piece of a straight ramp, and
 * the solid under each is convex, which a collider can be made of directly.
 */
export function rampFacets(ramp: Ramp): { along: number; height: number }[] {
  const facets: { along: number; height: number }[] = []
  const count = ramp.straight ? 1 : RAMP_FACETS
  for (let i = 0; i <= count; i++) {
    const along = (ramp.length * i) / count
    facets.push({ along, height: ramp.bottom + rampRise(ramp, along) })
  }
  return facets
}
