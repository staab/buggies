/**
 * The portals: rings sunk halfway into a planet's open country that a car
 * drives through to its moon, and the one on the moon that takes it back.
 * Each stands on level, dry ground with a clear run up to it and away from
 * it both ways, well apart from the others.
 */

import { randomInt, randomRange, type Rng, type Vec3 } from '@buggies/physics'

import type { WorldPortal } from '../world.ts'
import { lift } from './lines.ts'
import { axisAt, groundUnder, heightAt, turnOf, type Spot } from './placing.ts'
import { farFromKind, noteStood, type Site } from './site.ts'

/** How far a portal's ring reaches from its middle, which is sunk to the ground: an arch as high as this, and twice as wide. */
export const PORTAL_RADIUS = 12
/** How many portals a planet has. */
const PORTALS = { least: 3, most: 5 } as const
/** How long the clear run is through a portal, both ways together, and how much the ground may rise and fall along it. */
const PORTAL_RUN = 50
const PORTAL_RELIEF = 2
/** Portals keep at least this far from each other, and are tried this many times. */
const PORTALS_APART = 300
const PORTAL_TRIES = 400
/** How far a portal's run keeps off the roads. */
const PORTAL_ROAD_MARGIN = 3

/** The spot a portal's run takes: as wide as its ring and a little more, and the run long. */
export function portalRun(at: Vec3, u: Vec3): Spot {
  return { at, u, width: PORTAL_RADIUS * 2 + 4, depth: PORTAL_RUN }
}

/** A portal standing at a way out, its ring across `u`, on the ground there. */
export function portalAt(site: Site, at: Vec3, u: Vec3): WorldPortal {
  return { at: lift(at, site.radius, heightAt(site.land, at)), turn: turnOf(at, u), radius: PORTAL_RADIUS }
}

/**
 * Stand a planet's portals in its open country: where the run through each
 * is dry, level and clear of the roads and of everything placed so far.
 */
export function raisePortals(site: Site, spotOf: () => Vec3 | null, rng: Rng): WorldPortal[] {
  const portals: WorldPortal[] = []
  const wanted = randomInt(rng, PORTALS.least, PORTALS.most)
  for (let attempt = 0; attempt < PORTAL_TRIES && portals.length < wanted; attempt++) {
    const at = spotOf()
    if (at === null) continue
    const u = axisAt(at, randomRange(rng, 0, Math.PI))
    if (!farFromKind(site, 'portal', at, PORTALS_APART)) continue
    const run = portalRun(at, u)
    if (!site.clear(run, PORTAL_ROAD_MARGIN) || site.placed.meets(run, 0)) continue
    const ground = groundUnder(site.land, site.wet, run)
    if (ground.wet || ground.high - ground.low > PORTAL_RELIEF) continue
    site.placed.add(run)
    noteStood(site, 'portal', at)
    portals.push(portalAt(site, at, u))
  }
  return portals
}
