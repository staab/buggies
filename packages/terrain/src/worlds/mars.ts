/**
 * Mars: red and airless as a moon, its mountains twice a planet's, with
 * its cities under great glass bubbles, green inside with grass and trees.
 * A bubble is closed but for a few tunnels out through its foot, one for
 * each other city, and out of each a road runs over the red ground to the
 * tunnel facing it in that city's bubble, so every city has a road to every
 * other, and those are all the roads there are.
 */

import { randomInt, randomRange, type Vec3 } from '@buggies/physics'

import { MAX_ARTERIAL_GRADE } from '../roads/constants.ts'
import { DISTRICT_CITY } from '../sphere-districts.ts'
import { raiseSphereGround } from '../sphere-heights.ts'
import { sphereHeight } from '../sphere.ts'
import { randomDirection } from '../world-queries.ts'
import type { World, WorldPortal, WorldRoad } from '../world.ts'
import { angleBetween, resample } from '../globe/lines.ts'
import { axisAt, eachPointNear, nearestPoint } from '../globe/placing.ts'
import { createRanges } from '../globe/planet.ts'
import { bareWorld } from './bare.ts'
import { hollowOut, type Hollow } from './hollows.ts'
import { worldId } from './kinds.ts'
import {
  Stands,
  buildSettlement,
  diceFor,
  districtOfPlace,
  groundOfSize,
  landOf,
  levelGround,
  linkAll,
  meanHeight,
  plantWithin,
  portalIn,
  reliefOver,
  scatterPlaces,
  toward,
  type SettlementStyle,
} from './kit.ts'
import { navOf, roadAlong, routeLine, settleRoads } from './roads.ts'

const MARS_SALT = 0x3a75
/** How big Mars is, as a share of its planet, and how many times a planet's its mountains are. */
const MARS_SIZE = 0.85
const MOUNTAIN_SCALE = 2
const RANGES = { min: 3, max: 5 } as const
/** Far under anything: Mars has no sea. */
const NO_SEA = -1000

/** The bubbles: how many, how far each reaches, how high it rises as a share of that, and how far apart two stand past their reaches. */
const BUBBLES = { min: 3, max: 5 } as const
const BUBBLE_REACH = { min: 85, max: 115 } as const
const BUBBLE_RISE = 0.5
const BUBBLES_APART = 180
/** How uneven the ground a bubble stands on may be before it is levelled, and how far round it the levelling eases out. */
const BUBBLE_RELIEF = 30
const BUBBLE_BLEND = 45
/** A tunnel out of a bubble: how far it reaches either side of its road, how high, and how far it runs out past the bubble's foot. */
const TUNNEL = { reach: 9, rise: 8, out: 28, in: 20 } as const
/** The roads: how wide, how steep they climb, and how far from a bubble's middle each starts, off the square there. */
const ROAD_WIDTH = 10
const STEEPER = 0.14
const SQUARE = 16
/** How far from any bubble a road keeps outside it. */
const BUBBLE_BERTH = 18

const CITY: SettlementStyle = {
  kinds: [
    { kind: 'block', odds: 3, width: [10, 18], depth: [10, 18], height: [10, 34] },
    { kind: 'house', odds: 2, width: [7, 10], depth: [7, 10], height: [4, 6] },
    { kind: 'villa', odds: 1, width: [9, 13], depth: [8, 11], height: [5, 7] },
  ],
  count: 34,
  gap: 3,
  roadMargin: 2,
  relief: 2,
}

/** Make a planet's Mars, from the planet's seed. */
export function generateMars(seed: number): World {
  const rng = diceFor(seed, MARS_SALT)
  const ground = groundOfSize(MARS_SIZE)
  const { radius } = ground
  const land = landOf(ground, NO_SEA)
  const regions = Array.from({ length: 6 }, () => ({ center: randomDirection(rng), radius: 500 }))
  const mountains = createRanges(rng, randomInt(rng, RANGES.min, RANGES.max), regions, radius, MOUNTAIN_SCALE).flat()
  raiseSphereGround(ground, { seed: (seed ^ MARS_SALT) >>> 0, islands: [], mountains, oceanDepth: 0, largest: 900, allLand: true, mountainScale: MOUNTAIN_SCALE })

  // The bubbles, on ground fairly level to start with, and levelled under each.
  const bubbles = scatterPlaces(
    rng,
    radius,
    randomInt(rng, BUBBLES.min, BUBBLES.max),
    (a, b) => a + b + BUBBLES_APART,
    () => randomRange(rng, BUBBLE_REACH.min, BUBBLE_REACH.max),
    (center, reach) => reliefOver(land, center, reach + BUBBLE_BLEND) < BUBBLE_RELIEF,
    2000,
  )
  for (const bubble of bubbles) levelGround(land, bubble.center, bubble.reach + 4, BUBBLE_BLEND, meanHeight(land, bubble.center, bubble.reach))
  const inBubble = (p: Vec3, berth = 0): boolean => bubbles.some((bubble) => angleBetween(p, bubble.center) * radius < bubble.reach + berth)

  // A tunnel out of each bubble toward every other, and a road from each tunnel to the one it faces.
  const nav = navOf(land)
  const tunnels: Hollow[] = []
  const lines: Vec3[][] = []
  for (const [a, b] of linkAll(bubbles.length)) {
    const from = bubbles[a]!
    const to = bubbles[b]!
    const mouthA = toward(from.center, to.center, from.reach + TUNNEL.out, radius)
    const mouthB = toward(to.center, from.center, to.reach + TUNNEL.out, radius)
    const between = routeLine(nav, mouthA, mouthB, MAX_ARTERIAL_GRADE, (p) => inBubble(p, BUBBLE_BERTH)) ?? routeLine(nav, mouthA, mouthB, STEEPER, (p) => inBubble(p, BUBBLE_BERTH))
    if (between === null) continue
    const startA = toward(from.center, to.center, SQUARE, radius)
    const startB = toward(to.center, from.center, SQUARE, radius)
    lines.push(resample([startA, ...between, startB], 6, radius, false))
    for (const [bubble, mouth] of [[from, mouthA], [to, mouthB]] as const) {
      const inner = toward(bubble.center, mouth, bubble.reach - TUNNEL.in, radius)
      tunnels.push({ kind: 'shell', line: [inner, mouth], middle: [0, 0], reach: TUNNEL.reach, above: TUNNEL.rise, below: 0, squareness: 3, open: [false, true] })
    }
  }
  const roads: WorldRoad[] = settleRoads(
    land,
    lines.map((line, id) => roadAlong(id, 'arterial', line, ROAD_WIDTH, land, STEEPER)),
  )

  // The bubbles closed over their cities, and their tunnels over the roads out.
  const domes: Hollow[] = bubbles.map((bubble) => ({ kind: 'shell', line: [bubble.center], middle: [0], reach: bubble.reach, above: bubble.reach * BUBBLE_RISE, below: 0, squareness: 2 }))
  const roof = hollowOut(land, [...domes, ...tunnels], false)
  const districtOf = new Uint8Array(ground.heights.length)
  for (const bubble of bubbles) eachPointNear(land, bubble.center, bubble.reach, (at) => (districtOf[at] = DISTRICT_CITY))

  // Each city, under its bubble: its portal, its fountain in the square, its buildings and its trees.
  const stands = new Stands(land, roads)
  const portals: WorldPortal[] = []
  const roofOver = (p: Vec3): number => roof[nearestPoint(ground, p)]!
  for (const bubble of bubbles) portals.push(portalIn(stands, rng, bubble.center, bubble.reach * 0.55))
  for (const bubble of bubbles) {
    const square = { at: bubble.center, u: axisAt(bubble.center, 0), width: 8, depth: 8 }
    const footing = stands.fits(square, 0, 1, 2)
    if (footing !== null) stands.raise('fountain', square, footing, 1, rng())
    buildSettlement(stands, rng, bubble.center, bubble.reach * 0.82, CITY, (p) => roofOver(p) - 4)
    plantWithin(stands, rng, bubble.center, bubble.reach * 0.9, 60, 'tree', [6, 11], [1.8, 3.2], (p) => roofOver(p) - sphereHeight(ground, p) > 14)
    plantWithin(stands, rng, bubble.center, bubble.reach * 0.92, 80, 'shrub', [0.9, 2], [0.7, 1.6])
  }
  // Red boulders strewn over the open ground.
  for (let k = 0; k < 400; k++) {
    const p = randomDirection(rng)
    if (inBubble(p, 10)) continue
    stands.rock(p, rng() < 0.3 ? 'boulder' : 'scree', randomRange(rng, 0.6, 2.6), rng)
  }

  return bareWorld({
    seed: worldId(seed, 'mars'),
    kind: 'mars',
    radius,
    seaLevel: NO_SEA,
    ground,
    roof,
    districtOf,
    mountains,
    districts: bubbles.map((bubble, id) => districtOfPlace(id, bubble.center, bubble.reach)),
    roads,
    buildings: stands.buildings,
    trees: stands.trees,
    rocks: stands.rocks,
    portals,
  })
}
