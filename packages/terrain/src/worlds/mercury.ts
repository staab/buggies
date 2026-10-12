/**
 * Mercury: all underground. Huge caverns hollowed out of solid rock, and
 * round tunnels between them, rising and falling as they go, each a
 * smooth tube out of a cavern's wall into another's, flat across where it
 * comes out onto the cavern's floor, and none crossing another; there is no sky, no road and no sea. Its pull
 * is weak, but a car holds to whatever its wheels are on, so it can run up
 * a tunnel's wall and over its roof.
 */

import { createRng, randomInt, randomRange, type Vec3 } from '@buggies/physics'

import { smoothstep } from '../noise.ts'
import { DISTRICT_CITY } from '../sphere-districts.ts'
import type { World, WorldPortal } from '../world.ts'
import { angleBetween, resample } from '../globe/lines.ts'
import { nearestOn, piecesGap } from '../globe/segments.ts'
import { bareWorld } from './bare.ts'
import { groundOfSize, landOf } from './ground.ts'
import { hollowOut, profile, roofNear, type Hollow } from './hollows.ts'
import { worldId } from './kinds.ts'
import { districtOfPlace, linkPlaces, markDistricts, pointIn, scatterPlaces, toward, type Link } from './places.ts'
import { Stands, furnish, portalIn, type FurnitureStyle } from './stands.ts'
import { tubeMesh, type Tube } from './tubes.ts'

const MERCURY_SALT = 0x6e3c
/** How big Mercury is, as a share of its planet; its grid kept as fine as the planet's is across the planet, for the tunnels' round walls. */
const MERCURY_SIZE = 0.7
const MERCURY_CELLS = 320
/** Far under anything: it has no sea. */
const NO_SEA = -1000
/** The caverns: how many, how far each reaches, how high its roof and how deep its floor, and how far apart two stand past their reaches. */
const CAVERNS = { min: 8, max: 11 } as const
const CAVERN_REACH = { min: 60, max: 110 } as const
const CAVERN_ABOVE = { min: 32, max: 50 } as const
const CAVERN_BELOW = 9
const CAVERNS_APART = 70
/** How far a cavern's middle stands over or under the rest. */
const CAVERN_RISE = 18
/** How many tunnels past the fewest that join every cavern. */
const EXTRA_TUNNELS = 4
/** A tunnel: round, this far from its middle to its wall and to its roof and floor, and how far its middle rises and falls between its ends. */
const TUNNEL = { reach: 13, above: 11, below: 11 } as const
const TUNNEL_SWELL = 9
/** How far out along a tunnel's line its points are laid, for its tube to bend smoothly. */
const TUNNEL_STEP = 2.5
/**
 * How far past its tube a tunnel's floor and roof are cut, across it and
 * over it: out of the way of the tube, which is what is driven on. Its
 * floor is cut as deep as the tube's, and lies on the tube's along its middle.
 */
const TUNNEL_MARGIN = 3
/** Where a tunnel comes out into a cavern: this share of the way out from its middle, where the cavern's floor is rising to its wall. */
const MOUTH = 0.86
/** How much rock is left between two tunnels at the least, past where each is cut. */
const TUNNEL_GAP = 6
/** How far into a tunnel from its mouth its floor goes from flat across to round. */
const FLARE = 14

/** A cubic from one value to another, leaving the first and coming to the second at the slopes given, over 0 to 1. */
function hermite(from: number, to: number, leaving: number, arriving: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * leaving + (-2 * t3 + 3 * t2) * to + (t3 - t2) * arriving
}
/** The stalagmites, how many a cavern has, how big. */
const STALAGMITES = 14

/** Glowing crystals, how many a cavern has and how big. */
const CRYSTALS: FurnitureStyle = { kind: 'crystal', count: 18, width: [1.4, 3], depth: [1.4, 3], height: [3, 8], relief: 2.5, gap: 1 }

/** Make a planet's Mercury, from the planet's seed. */
export function generateMercury(seed: number): World {
  const rng = createRng((seed ^ MERCURY_SALT) >>> 0)
  const ground = groundOfSize(MERCURY_SIZE, MERCURY_CELLS)
  const { radius } = ground
  const land = landOf(ground, NO_SEA)

  const caverns = scatterPlaces(
    rng,
    radius,
    randomInt(rng, CAVERNS.min, CAVERNS.max),
    (a, b) => a + b + CAVERNS_APART,
    () => randomRange(rng, CAVERN_REACH.min, CAVERN_REACH.max),
  )
  const middles = caverns.map(() => randomRange(rng, -CAVERN_RISE, CAVERN_RISE))
  const halls: Hollow[] = caverns.map((cavern, k) => ({
    kind: 'bore',
    line: [cavern.center],
    middle: [middles[k]! + CAVERN_BELOW],
    reach: cavern.reach,
    above: randomRange(rng, CAVERN_ABOVE.min, CAVERN_ABOVE.max),
    below: CAVERN_BELOW,
    squareness: 2,
  }))
  // Each tunnel comes out of the wall of each of its caverns, its floor on the cavern's floor there and climbing as that does,
  // flat across at its mouth and rounding as it goes in, and swells up or down between.
  const mouthFloor = (k: number): number => middles[k]! + CAVERN_BELOW * (1 - profile(MOUTH, 2))
  // How steeply a cavern's floor climbs to its wall at a mouth: a bowl's slope there, outward.
  const mouthSlope = (k: number): number => (CAVERN_BELOW * MOUTH) / Math.sqrt(1 - MOUTH * MOUTH) / caverns[k]!.reach
  const mouthOf = (a: number, b: number): Vec3 => toward(caverns[a]!.center, caverns[b]!.center, caverns[a]!.reach * MOUTH, radius)
  // No tunnel crosses another, runs through a third cavern, or leaves a cavern beside another: each is a tube on its own.
  const apart = (TUNNEL.reach + TUNNEL_MARGIN) * 2 + TUNNEL_GAP
  const fits = ([a, b]: Link, chosen: readonly Link[]): boolean => {
    const from = mouthOf(a, b)
    const to = mouthOf(b, a)
    for (const [k, cavern] of caverns.entries()) {
      if (k === a || k === b) continue
      if (nearestOn(cavern.center, from, to, radius).distance < cavern.reach + TUNNEL.reach + TUNNEL_MARGIN + TUNNEL_GAP) return false
    }
    for (const [c, d] of chosen) {
      const shared = [a, b].find((end) => end === c || end === d)
      if (shared === undefined) {
        if (piecesGap(from, to, mouthOf(c, d), mouthOf(d, c), radius) < apart) return false
        continue
      }
      // Out of the same cavern: their mouths far enough apart round its wall.
      const other = shared === c ? d : c
      const mine = shared === a ? b : a
      if (angleBetween(mouthOf(shared, mine), mouthOf(shared, other)) * radius < apart) return false
    }
    return true
  }
  const tubes: Tube[] = linkPlaces(
    caverns.map((cavern) => cavern.center),
    EXTRA_TUNNELS,
    fits,
  ).map(([a, b]) => {
    const from = mouthOf(a, b)
    const to = mouthOf(b, a)
    const line = resample([from, to], TUNNEL_STEP, radius, false)
    const length = angleBetween(from, to) * radius
    const swell = randomRange(rng, -TUNNEL_SWELL, TUNNEL_SWELL)
    const last = Math.max(line.length - 1, 1)
    const middle = line.map((_, i) => {
      const t = i / last
      // From one mouth's floor to the other's, leaving each at the slope its cavern's floor climbs at there.
      const floor = hermite(mouthFloor(a), mouthFloor(b), mouthSlope(a) * length, -mouthSlope(b) * length, t)
      return floor + swell * 16 * t * t * (1 - t) * (1 - t) + TUNNEL.below
    })
    const round = line.map((_, i) => smoothstep(0, FLARE, Math.min(i, last - i) * (length / last)))
    return { line, middle, round, ...TUNNEL }
  })
  const tunnels: Hollow[] = tubes.map((tube) => ({
    kind: 'bore',
    line: tube.line,
    middle: tube.middle,
    reach: tube.reach + TUNNEL_MARGIN,
    above: tube.above + TUNNEL_MARGIN,
    below: tube.below,
    round: tube.round,
    squareness: 2,
    open: [true, true],
  }))
  const roof = hollowOut(land, [...halls, ...tunnels], true)
  const districtOf = markDistricts(land, caverns, DISTRICT_CITY)

  const stands = new Stands(land, [])
  const roofOver = (p: Vec3): number => roofNear(ground, roof, p)
  const portals: WorldPortal[] = caverns.map((cavern) => portalIn(stands, rng, cavern.center, cavern.reach * 0.25))
  for (const cavern of caverns) {
    for (let k = 0; k < STALAGMITES; k++) stands.rock(pointIn(rng, cavern.center, cavern.reach * 0.75, radius), 'boulder', randomRange(rng, 1.5, 4.5), rng)
    for (let k = 0; k < STALAGMITES * 3; k++) stands.rock(pointIn(rng, cavern.center, cavern.reach * 0.85, radius), 'scree', randomRange(rng, 0.5, 1.4), rng)
    // Crystals glowing in clusters across its floor.
    furnish(stands, rng, () => pointIn(rng, cavern.center, cavern.reach * 0.8, radius), CRYSTALS, roofOver)
  }

  return bareWorld({
    seed: worldId(seed, 'mercury'),
    kind: 'mercury',
    radius,
    seaLevel: NO_SEA,
    ground,
    roof,
    districtOf,
    districts: caverns.map((cavern, id) => districtOfPlace(id, cavern)),
    rocks: stands.rocks,
    buildings: stands.buildings,
    tubes: tubes.map((tube) => tubeMesh(tube, radius)),
    portals,
  })
}
