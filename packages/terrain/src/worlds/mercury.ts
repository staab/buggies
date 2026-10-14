/**
 * Mercury: all underground. Huge caverns hollowed out of solid rock, and
 * round tunnels between them, rising and falling as they go, none
 * crossing another; there is no sky, no road and no sea. Each tunnel
 * leaves a cavern through a horn cut out of its wall, as tall and wide as
 * the cavern there and flush with its floor and its ceiling, that
 * narrows through the cavern's edge into the rock; there it becomes a
 * smooth tube, rounding as it goes.
 * Its pull is weak, but a car holds to whatever its wheels are on, so it
 * can run up a tunnel's wall and over its roof, and along a cavern's
 * ceiling into a tunnel's. Rock pillars stand from the caverns' floors to
 * their ceilings, crystals grow up giant, stalactites hang, fungus and
 * pools of lava glow, and mine carts stand where they were left.
 */

import { createRng, qrotate, randomInt, randomRange, v3, type Rng, type Vec3 } from '@buggies/physics'

import { smoothstep } from '../noise.ts'
import { sphereHeight } from '../sphere.ts'
import { DISTRICT_CITY } from '../sphere-districts.ts'
import type { World, WorldPortal } from '../world.ts'
import { along, angleBetween, resample, unit } from '../globe/lines.ts'
import { axisAt, carryAxis } from '../globe/placing.ts'
import { nearestOn, piecesGap } from '../globe/segments.ts'
import { bareWorld } from './bare.ts'
import { groundOfSize, landOf } from './ground.ts'
import { hollowOut, profile, roofNear, type Hollow } from './hollows.ts'
import { worldId } from './kinds.ts'
import { districtOfPlace, linkPlaces, markDistricts, pointIn, scatterPlaces, someOf, toward, type Link } from './places.ts'
import { Stands, furnish, portalIn, type FurnitureStyle } from './stands.ts'
import { tubeMesh, type Tube } from './tubes.ts'

const MERCURY_SALT = 0x6e3c
/** How big Mercury is, as a share of its planet; its grid kept as fine as the planet's is across the planet, for the tunnels' round walls. */
const MERCURY_SIZE = 0.7
const MERCURY_CELLS = 320
/** Far under anything: it has no sea. */
const NO_SEA = -1000
/** The caverns: how many, how far each reaches, how high its roof and how deep its floor, and how far apart two stand past their reaches. */
const CAVERNS = { min: 5, max: 7 } as const
const CAVERN_REACH = { min: 110, max: 160 } as const
const CAVERN_ABOVE = { min: 50, max: 80 } as const
const CAVERN_BELOW = 7
const CAVERNS_APART = 60
/** How far a cavern's middle stands over or under the rest. */
const CAVERN_RISE = 10
/** How many tunnels past the fewest that join every cavern. */
const EXTRA_TUNNELS = 4
/** How many of the caverns have a portal in them: a few, not every one. */
const PORTALS = { least: 2, most: 3 } as const
/** A tunnel: round, this far from its middle to its wall and to its roof and floor, and how far its middle rises and falls between its ends. */
const TUNNEL = { reach: 13, above: 11, below: 11 } as const
const TUNNEL_SWELL = 9
/** How far out along a tunnel's line its points are laid, for its tube to bend smoothly. */
const TUNNEL_STEP = 2.5
/**
 * How far past its tube a tunnel's floor and roof are cut across it: out
 * of the way of the tube, which is what is driven on, but too narrow for a
 * car to come in beside it. They are cut as deep and as high as the
 * tube's, and lie on its floor and its roof along its middle, so nothing
 * driven along a cavern's floor or ceiling can come in over the tube or
 * under it rather than into it.
 */
const TUNNEL_MARGIN = 1.5
/** Where a tunnel's horn opens into a cavern: this share of the way out from its middle, where its ceiling is still gentle. */
const MOUTH = 0.78
/** How much wider a horn is at its mouth than the tube it narrows to. */
const HORN = 1.5
/** How far past a cavern's edge into the rock a tunnel's tube begins: no tube stands out in a cavern. */
const INTO = 6
/** How much rock is left between two tunnels at the least, past where each is cut. */
const TUNNEL_GAP = 6
/** How far into its tube a tunnel goes from dished, as its horn is, to round, with room cut about it; and how round its dished floor is. */
const FLARE = 14
const DISHED = 0.4

/** A cubic from one value to another, leaving the first and coming to the second at the slopes given, over 0 to 1. */
function hermite(from: number, to: number, leaving: number, arriving: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * leaving + (-2 * t3 + 3 * t2) * to + (t3 - t2) * arriving
}
/** The stalagmites, how many a cavern has, how big. */
const STALAGMITES = 24

/** Glowing crystals in clusters, how many a cavern has and how big; and giant ones, standing up through its air. */
const CRYSTALS: FurnitureStyle = { kind: 'crystal', count: 30, width: [1.4, 3], depth: [1.4, 3], height: [3, 8], relief: 2.5, gap: 1 }
const GIANT_CRYSTALS: FurnitureStyle = { kind: 'crystal', count: 4, width: [4, 8], depth: [4, 8], height: [14, 30], relief: 4, gap: 4 }
/** Pillars where a stalagmite grew up to meet its stalactite: how many to a cavern, how thick, and how far out from its middle they stand. */
const PILLARS = { count: [2, 4], width: [8, 16], out: 0.6 } as const
/** Clusters of glowing fungus about the floor, and pools of lava on its level middle. */
const FUNGUS: FurnitureStyle = { kind: 'fungus', count: 16, width: [2, 4], depth: [2, 4], height: [0.8, 1.8], relief: 1.5, gap: 0.5 }
const LAVA: FurnitureStyle = { kind: 'lava', count: 2, width: [8, 14], depth: [8, 14], height: [0.1, 0.1], relief: 0.6, gap: 3 }
/** Stalactites hanging from the roof: how many to a cavern, how thick, and how long, at most this share of the room under them. */
const STALACTITES = { count: 30, width: [1.5, 4], length: [4, 14], room: 0.35 } as const
/** A stretch of mine track a cavern, as long as this, the gauge of its rails, and a cart left on it this long, wide and high. */
const TRACK: FurnitureStyle = { kind: 'track', count: 1, width: [18, 30], depth: [1.8, 1.8], height: [0.3, 0.3], relief: 1.5, gap: 2 }
const CART = { length: 2.6, width: 1.7, height: 1.6 } as const

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
  const ceilings = caverns.map(() => randomRange(rng, CAVERN_ABOVE.min, CAVERN_ABOVE.max))
  const halls: Hollow[] = caverns.map((cavern, k) => ({
    kind: 'bore',
    line: [cavern.center],
    middle: [middles[k]! + CAVERN_BELOW],
    reach: cavern.reach,
    above: ceilings[k]!,
    below: CAVERN_BELOW,
    squareness: 2,
  }))
  // Each tunnel's horn opens out of each of its caverns, its floor the cavern's floor there and its roof the cavern's ceiling.
  // From there the tunnel climbs as the cavern's floor does, and swells up or down between; its roof eases down from the
  // ceiling, leaving it as steeply as it falls there, to the tube's own.
  // How steeply a cavern's floor climbs at a mouth, and its ceiling falls, outward: a bowl's slope there, and a dome's.
  const steepness = MOUTH / profile(MOUTH, 2)
  const mouthFloor = (k: number): number => middles[k]! + CAVERN_BELOW * (1 - profile(MOUTH, 2))
  const mouthSlope = (k: number): number => (CAVERN_BELOW * steepness) / caverns[k]!.reach
  // How high the ceiling is over the tunnel's middle at a mouth, and how fast it comes down toward that middle going out.
  const mouthTop = (k: number): number => (ceilings[k]! + CAVERN_BELOW) * profile(MOUTH, 2) - TUNNEL.below
  const mouthFall = (k: number): number => ((ceilings[k]! + CAVERN_BELOW) * steepness) / caverns[k]!.reach
  const mouthOf = (a: number, b: number): Vec3 => toward(caverns[a]!.center, caverns[b]!.center, caverns[a]!.reach * MOUTH, radius)
  // How far a tunnel's horn runs from its mouth before its tube begins: out past the cavern's edge, into the rock.
  const lead = (k: number): number => caverns[k]!.reach * (1 - MOUTH) + INTO
  // No tunnel crosses another, runs through a third cavern, or leaves a cavern beside another, its horn into another's: each is a tube on its own.
  const apart = Math.max(TUNNEL.reach * HORN, TUNNEL.reach + TUNNEL_MARGIN) * 2 + TUNNEL_GAP
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
  // Each tunnel cut from mouth to mouth, square and close about where its tube will be until well into it; and its tube.
  const tunnels: Hollow[] = []
  const tubes: Tube[] = []
  for (const [a, b] of linkPlaces(
    caverns.map((cavern) => cavern.center),
    EXTRA_TUNNELS,
    fits,
  )) {
    const from = mouthOf(a, b)
    const to = mouthOf(b, a)
    const line = resample([from, to], TUNNEL_STEP, radius, false)
    const length = angleBetween(from, to) * radius
    const swell = randomRange(rng, -TUNNEL_SWELL, TUNNEL_SWELL)
    const last = Math.max(line.length - 1, 1)
    const along = (i: number): number => (i * length) / last
    // Down each horn, straight on at the slope the cavern's floor climbs at its mouth, under the bowl it leaves; and between
    // where the tubes begin, from the one horn's floor to the other's, leaving and coming to each at that slope.
    const startA = lead(a)
    const startB = length - lead(b)
    const floorAt = (d: number): number => {
      if (d <= startA) return mouthFloor(a) + mouthSlope(a) * d
      if (d >= startB) return mouthFloor(b) + mouthSlope(b) * (length - d)
      const span = startB - startA
      const t = (d - startA) / span
      const floor = hermite(mouthFloor(a) + mouthSlope(a) * startA, mouthFloor(b) + mouthSlope(b) * lead(b), mouthSlope(a) * span, -mouthSlope(b) * span, t)
      return floor + swell * 16 * t * t * (1 - t) * (1 - t)
    }
    const middle = line.map((_, i) => floorAt(along(i)) + TUNNEL.below)
    // How far into its tube each point is, from whichever end is nearer: less than nothing in a horn, before the tube begins.
    const intoTube = line.map((_, i) => Math.min(along(i) - lead(a), along(last - i) - lead(b)))
    const round = intoTube.map((into) => DISHED + (1 - DISHED) * smoothstep(0, FLARE, into))
    // Down a horn from its mouth, its roof from the ceiling there to the tube's, and its reach from wide to the tube's.
    const horn = (i: number): { top: number; reach: number } => {
      const [k, out] = along(i) < length / 2 ? [a, along(i)] : [b, along(last - i)]
      if (out >= lead(k)) return { top: TUNNEL.above, reach: TUNNEL.reach + TUNNEL_MARGIN * smoothstep(0, FLARE, out - lead(k)) }
      const t = out / lead(k)
      return { top: hermite(mouthTop(k), TUNNEL.above, -mouthFall(k) * lead(k), 0, t), reach: TUNNEL.reach * (1 + (HORN - 1) * (1 - smoothstep(0, 1, t))) }
    }
    const horns = line.map((_, i) => horn(i))
    tunnels.push({
      kind: 'bore',
      line,
      middle,
      reach: horns.map((cut) => cut.reach),
      above: horns.map((cut) => cut.top),
      below: TUNNEL.below,
      round,
      squareness: 2,
      open: [true, true],
    })
    const first = intoTube.findIndex((into) => into >= 0)
    const end = last - [...intoTube].reverse().findIndex((into) => into >= 0)
    if (first < 0 || end <= first) continue
    const span = <T,>(values: readonly T[]): T[] => values.slice(first, end + 1)
    tubes.push({ line: span(line), middle: span(middle), round: span(round), reach: TUNNEL.reach, above: span(line).map(() => TUNNEL.above), below: TUNNEL.below })
  }
  const roof = hollowOut(land, [...halls, ...tunnels], true)
  const districtOf = markDistricts(land, caverns, DISTRICT_CITY)

  const stands = new Stands(land, [])
  const roofOver = (p: Vec3): number => roofNear(ground, roof, p)
  const gated = someOf(rng, caverns.length, randomInt(rng, PORTALS.least, PORTALS.most))
  const portals: WorldPortal[] = gated.map((k) => portalIn(stands, rng, caverns[k]!.center, caverns[k]!.reach * 0.25))
  for (const cavern of caverns) {
    const anywhere = (out: number) => (): Vec3 => pointIn(rng, cavern.center, cavern.reach * out, radius)
    // Pillars from floor to roof, and giant crystals, standing up through its air.
    for (let k = randomInt(rng, ...PILLARS.count); k > 0; k--) raisePillar(stands, rng, anywhere(PILLARS.out)(), roofOver)
    furnish(stands, rng, anywhere(0.6), GIANT_CRYSTALS, roofOver)
    for (let k = 0; k < STALAGMITES; k++) stands.rock(anywhere(0.75)(), 'boulder', randomRange(rng, 1.5, 4.5), rng)
    for (let k = 0; k < STALAGMITES * 3; k++) stands.rock(anywhere(0.85)(), 'scree', randomRange(rng, 0.5, 1.4), rng)
    // Crystals glowing in clusters across its floor, fungus glowing about it, lava pooled on its level middle, and a cart left on its track.
    furnish(stands, rng, anywhere(0.8), CRYSTALS, roofOver)
    furnish(stands, rng, anywhere(0.85), FUNGUS, roofOver)
    furnish(stands, rng, anywhere(0.3), LAVA, roofOver)
    layTrack(stands, rng, anywhere(0.55), roofOver)
    // Stalactites hanging from its roof.
    for (let k = 0; k < STALACTITES.count; k++) hangStalactite(stands, rng, anywhere(0.8)(), roofOver)
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

/** A pillar of rock from the floor at a way out up to the roof over it, as thick as it can be there; or none, if it will not fit. */
function raisePillar(stands: Stands, rng: Rng, at: Vec3, roofOver: (p: Vec3) => number): void {
  const width = randomRange(rng, ...PILLARS.width)
  const spot = { at, u: axisAt(at, randomRange(rng, 0, Math.PI)), width, depth: width }
  const ground = stands.fits(spot, { gap: 3, relief: 6 })
  if (ground === null) return
  stands.placed.add(spot)
  // Up into the roof a little, as it is down into the floor.
  stands.erect('pillar', at, spot.u, ground.low, width, width, roofOver(at) + 1 - ground.low, rng())
}

/** A stalactite hanging from the roof over a way out, no longer than a share of the room under it. */
function hangStalactite(stands: Stands, rng: Rng, at: Vec3, roofOver: (p: Vec3) => number): void {
  const roof = roofOver(at)
  const floor = sphereHeight(stands.land.ground, at)
  const length = Math.min(randomRange(rng, ...STALACTITES.length), (roof - floor) * STALACTITES.room)
  if (!(length > 1)) return
  const width = randomRange(rng, ...STALACTITES.width)
  // Its point at the bottom, its root up in the roof.
  stands.erect('stalactite', at, axisAt(at, randomRange(rng, 0, Math.PI)), roof - length, width, width, length + 1, rng())
}

/** A stretch of mine track on level floor, and a cart left standing on it somewhere along it. */
function layTrack(stands: Stands, rng: Rng, pick: () => Vec3, roofOver: (p: Vec3) => number): void {
  if (furnish(stands, rng, pick, TRACK, roofOver) === 0) return
  const track = stands.buildings.at(-1)!
  const middle = unit(track.at)
  const way = carryAxis(qrotate(v3(), track.turn, { x: 1, y: 0, z: 0 }), middle)
  const at = along(middle, way, randomRange(rng, -0.35, 0.35) * track.width, stands.land.radius)
  stands.erect('minecart', at, way, sphereHeight(stands.land.ground, at) + TRACK.height[0], CART.length, CART.width, CART.height, rng())
}
