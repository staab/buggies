/**
 * Mercury: all underground. Huge caverns hollowed out of solid rock, and
 * round tunnels between them, rising and falling as they go; there is no
 * sky, no road and no sea. Its pull is weak, but a car holds to whatever
 * its wheels are on, so it can run up a tunnel's wall and over its roof.
 */

import { randomInt, randomRange } from '@buggies/physics'

import { DISTRICT_CITY } from '../sphere-districts.ts'
import type { World, WorldPortal } from '../world.ts'
import { resample } from '../globe/lines.ts'
import { eachPointNear } from '../globe/placing.ts'
import { bareWorld } from './bare.ts'
import { hollowOut, type Hollow } from './hollows.ts'
import { worldId } from './kinds.ts'
import { Stands, diceFor, districtOfPlace, groundOfSize, landOf, linkPlaces, pointWithin, portalIn, scatterPlaces } from './kit.ts'

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
/** The stalagmites, how many a cavern has, how big. */
const STALAGMITES = 14

/** Make a planet's Mercury, from the planet's seed. */
export function generateMercury(seed: number): World {
  const rng = diceFor(seed, MERCURY_SALT)
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
  // Each tunnel enters its caverns at their floors' height and swells up or down between, its middle a tunnel's height off the floor.
  const tunnels: Hollow[] = linkPlaces(
    caverns.map((cavern) => cavern.center),
    EXTRA_TUNNELS,
  ).map(([a, b]) => {
    const line = resample([caverns[a]!.center, caverns[b]!.center], 10, radius, false)
    const swell = randomRange(rng, -TUNNEL_SWELL, TUNNEL_SWELL)
    const last = Math.max(line.length - 1, 1)
    const middle = line.map((_, i) => {
      const t = i / last
      return middles[a]! + (middles[b]! - middles[a]!) * t + swell * 4 * t * (1 - t) + TUNNEL.below
    })
    return { kind: 'bore', line, middle, reach: TUNNEL.reach, above: TUNNEL.above, below: TUNNEL.below, squareness: 2 }
  })
  const roof = hollowOut(land, [...halls, ...tunnels], true)
  const districtOf = new Uint8Array(ground.heights.length)
  for (const cavern of caverns) eachPointNear(land, cavern.center, cavern.reach, (at) => (districtOf[at] = DISTRICT_CITY))

  const stands = new Stands(land, [])
  const portals: WorldPortal[] = caverns.map((cavern) => portalIn(stands, rng, cavern.center, cavern.reach * 0.25))
  for (const cavern of caverns) {
    for (let k = 0; k < STALAGMITES; k++) stands.rock(pointWithin(rng, cavern.center, cavern.reach * 0.75, radius), 'boulder', randomRange(rng, 1.5, 4.5), rng)
    for (let k = 0; k < STALAGMITES * 3; k++) stands.rock(pointWithin(rng, cavern.center, cavern.reach * 0.85, radius), 'scree', randomRange(rng, 0.5, 1.4), rng)
  }

  return bareWorld({
    seed: worldId(seed, 'mercury'),
    kind: 'mercury',
    radius,
    seaLevel: NO_SEA,
    ground,
    roof,
    districtOf,
    districts: caverns.map((cavern, id) => districtOfPlace(id, cavern.center, cavern.reach)),
    rocks: stands.rocks,
    portals,
  })
}
