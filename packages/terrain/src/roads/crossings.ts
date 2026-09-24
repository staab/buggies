import * as exact from '@buggies/physics'
import type { District, Heightfield, Road } from '../types.ts'
import {
  CROSS_REACH,
  CROSS_RELIEF,
  CROSS_WIDTH,
  INTERCHANGE_CLEAR,
  INTERCHANGE_SEARCH,
  INTERCHANGE_SPACING,
  MAX_ROAD_GRADE,
  RAMP_ALONG,
  RAMP_DROP,
  RAMP_DROP_HEADROOM,
  RAMP_MOUTH_GROUND,
  RAMP_PLATEAU,
  RAMP_REACH,
  RAMP_SEGMENTS,
  RAMP_TURN_RADIUS,
  RAMP_WIDTH,
  ROAD_BRIDGE,
  ROAD_SKIRT,
  ROAD_SURFACE,
  ROAD_WIDTH,
  SAMPLE_STEP,
  TUNNEL_DEPTH,
  UNDERPASS_CLEARANCE,
} from './constants.ts'
import {
  type Vec2,
  convexHull,
  cumulativeLengths,
  frameAt,
  indexAtDistance,
  smoothstep,
} from './geometry.ts'
import { limitOpenGrade } from './grades.ts'
import { sampleTerrain } from './sampling.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

/**
 * Interchanges: where the highway can be crossed on dry ground, and the ramps
 * and cross roads built there.
 */

/**
 * Nearest sample to `index` that `permits` and whose crossing sits on dry land
 * clear of water, or `-1` if none is found within `maxOffset`. Interchanges
 * need solid ground under them, so this nudges a candidate off a river or
 * coastline rather than dropping it — and past ground already spoken for,
 * rather than giving up on the first site that happens to be taken.
 */
function findDryCrossing(
  field: Heightfield,
  seaLevel: number,
  samples: Vec2[],
  wet: Uint8Array,
  wetAt: (x: number, z: number) => boolean,
  deck: Float32Array,
  cum: Float32Array,
  total: number,
  index: number,
  maxOffset: number,
  permits: (c: number) => boolean,
  strict = true,
): number {
  const count = samples.length
  for (let offset = 0; offset <= maxOffset; offset++) {
    for (const c of [(index + offset) % count, (index - offset + count) % count]) {
      if (!permits(c)) continue
      if (wet[c]) continue
      // The ramps leave the deck RAMP_ALONG either side, and run level beside
      // it for a while after: the highway must be on the ground along each
      // mouth, not on a bridge, for the ramp to have a shoulder to leave onto.
      // A city that has no such site is still given its exit, and its ramps
      // may come out with nothing beside the deck at the mouth.
      const step = total / count
      const mouthFrom = Math.floor((RAMP_ALONG - RAMP_MOUTH_GROUND) / step)
      const mouthTo = Math.ceil((RAMP_ALONG + RAMP_WIDTH) / step)
      let bridged = false
      for (let k = mouthFrom; k <= mouthTo && !bridged; k++) {
        if (wet[(c + k) % count] || wet[(c - k + count) % count]) bridged = true
      }
      if (bridged && strict) continue
      const frame = frameAt(samples, c)
      const centre = sampleTerrain(field, frame.x, frame.z)
      if (centre <= seaLevel) continue
      const left = sampleTerrain(field, frame.x - frame.nx * CROSS_REACH, frame.z - frame.nz * CROSS_REACH)
      const right = sampleTerrain(field, frame.x + frame.nx * CROSS_REACH, frame.z + frame.nz * CROSS_REACH)
      if (left <= seaLevel || right <= seaLevel) continue
      // The cross road is the ground, so its ends and the ramps' landings
      // cannot stand in a river or a lake any more than in the sea.
      if (
        [-CROSS_REACH, -RAMP_REACH, RAMP_REACH, CROSS_REACH].some((offsetAcross) =>
          wetAt(frame.x + frame.nx * offsetAcross, frame.z + frame.nz * offsetAcross),
        )
      ) {
        continue
      }
      // Keep the crossing fairly level, or the ramps have to descend a valley.
      const nearLeft = sampleTerrain(field, frame.x - frame.nx * RAMP_REACH, frame.z - frame.nz * RAMP_REACH)
      const nearRight = sampleTerrain(field, frame.x + frame.nx * RAMP_REACH, frame.z + frame.nz * RAMP_REACH)
      const high = Math.max(centre, nearLeft, nearRight, left, right)
      const low = Math.min(centre, nearLeft, nearRight, left, right)
      if (high - low > CROSS_RELIEF) continue
      // The deck rides where the grade limit puts it, not where the ground is,
      // so a site in a dip can sit far too high for the ramps to reach the
      // cross road however level the ground across it looks. Judge the drop the
      // ramps would really have to make, against the deck raised just enough to
      // clear the underpass, which is what the finished highway does here.
      if (centre - deck[c]! > TUNNEL_DEPTH) continue
      const cross = crossRoad(field, samples, c)
      const roof = Math.max(deck[c]!, cross.heights[cross.centerIndex]! + UNDERPASS_CLEARANCE)
      const landing = Math.min(
        sampleOpen(cross.heights, -RAMP_REACH),
        sampleOpen(cross.heights, RAMP_REACH),
      )
      // The ramps leave the deck RAMP_ALONG either side of the crossing, where
      // the highway can stand higher than at the crossing itself: judge the
      // drop from the higher of the deck there and the raised deck's descent.
      // A city that has no site good enough is still given its exit, judged
      // at the crossing alone, and its ramps come out steeper for it.
      const attachDeck = strict
        ? Math.max(
            roof - MAX_ROAD_GRADE * RAMP_ALONG,
            deck[indexAtDistance(cum, (cum[c]! - RAMP_ALONG + total) % total)]!,
            deck[indexAtDistance(cum, (cum[c]! + RAMP_ALONG) % total)]!,
          )
        : roof
      if (attachDeck + ROAD_SURFACE - landing > RAMP_DROP - RAMP_DROP_HEADROOM) continue
      return c
    }
  }
  return -1
}

/**
 * Interchange crossings around the highway loop: one serving each city, then
 * periodic ones along the country between them.
 *
 * Cities are served first and from as near their centre as the ground allows,
 * so a city gets its exit before the spacing rule has any say. The periodic pass
 * then skips any candidate standing on a city, which is what holds a city to one
 * and never two. A city whose highway frontage is too steep or too broken to
 * carry a crossing at all goes without: no site there could be driven.
 */
export function interchangeCenters(
  field: Heightfield,
  seaLevel: number,
  samples: Vec2[],
  wet: Uint8Array,
  wetAt: (x: number, z: number) => boolean,
  cum: Float32Array,
  total: number,
  districts: District[],
  deck: Float32Array,
): number[] {
  const count = samples.length
  const step = total / count
  const search = Math.max(1, Math.round(INTERCHANGE_SEARCH / step))
  const minGap = Math.round((INTERCHANGE_SPACING * 0.6) / step)
  const centers: number[] = []

  /** Shortest way round the loop from `c` to the nearest crossing already placed. */
  const gapTo = (c: number): number => {
    let gap = Infinity
    for (const other of centers) {
      const apart = Math.abs(other - c)
      gap = Math.min(gap, Math.min(apart, count - apart))
    }
    return gap
  }

  /** The city a crossing at `c` belongs to: whichever centre is nearest it. */
  const nearestCity = (c: number): District | null => {
    let best: District | null = null
    let nearest = Infinity
    for (const district of districts) {
      const distance = hypot(samples[c]!.x - district.cx, samples[c]!.z - district.cz)
      if (distance < nearest) {
        nearest = distance
        best = district
      }
    }
    return best
  }

  /**
   * True when a crossing at `c` stands clear of every city, and of the
   * ground beyond each where its own exit may have been pushed out to by
   * the search, so no city ends up with a second exit at its edge.
   */
  const rural = (c: number): boolean =>
    districts.every(
      (district) =>
        hypot(samples[c]!.x - district.cx, samples[c]!.z - district.cz) >
        district.radius + district.suburbWidth + INTERCHANGE_SEARCH,
    )

  const touching = Math.max(1, Math.round(INTERCHANGE_CLEAR / step))
  for (const district of districts) {
    let seed = 0
    let nearest = Infinity
    for (let i = 0; i < count; i++) {
      const distance = hypot(samples[i]!.x - district.cx, samples[i]!.z - district.cz)
      if (distance < nearest) {
        nearest = distance
        seed = i
      }
    }
    // Search out as far as the city reaches, then a little further, rather than
    // give up on a city whose own ground will not take a crossing. Ground
    // nearer to another city is that city's to use: without that, a neighbour
    // standing on better land takes the exits and this city is left with none.
    const reach = Math.round((district.radius + district.suburbWidth) / step) + search
    const permits = (candidate: number): boolean =>
      nearestCity(candidate) === district && gapTo(candidate) >= touching
    let c = findDryCrossing(field, seaLevel, samples, wet, wetAt, deck, cum, total, seed, reach, permits)
    if (c < 0) {
      c = findDryCrossing(field, seaLevel, samples, wet, wetAt, deck, cum, total, seed, reach, permits, false)
    }
    if (c >= 0) centers.push(c)
  }

  for (let distance = 0; distance < total; distance += INTERCHANGE_SPACING) {
    const index = indexAtDistance(cum, distance)
    // Every city is served by now, so a periodic exit belongs only in the
    // country between them; one landing on a city would give it a second.
    // A candidate near the end of the loop can slide onto the first one across
    // the wrap, so keep a minimum cyclic gap between crossings.
    const c = findDryCrossing(
      field,
      seaLevel,
      samples,
      wet,
      wetAt,
      deck,
      cum,
      total,
      index,
      search,
      (candidate) => rural(candidate) && gapTo(candidate) >= minGap,
    )
    if (c >= 0) centers.push(c)
  }
  return centers
}

/** Linearly interpolate an open road's profile at a signed offset from its centre. */
export function sampleOpen(heights: Float32Array, offset: number): number {
  const steps = heights.length - 1
  const position = ((offset + CROSS_REACH) / (2 * CROSS_REACH)) * steps
  const index = Math.min(Math.max(Math.floor(position), 0), steps)
  const next = Math.min(index + 1, steps)
  const fraction = Math.min(Math.max(position - index, 0), 1)
  return heights[index]! * (1 - fraction) + heights[next]! * fraction
}

/** A cross road across an interchange, with its smoothed ground profile. */
interface CrossRoad {
  points: Vec2[]
  heights: Float32Array
  /** Sample at the crossing, where the highway passes overhead. */
  centerIndex: number
}

/** Cross road straight across a crossing, following the ground. */
export function crossRoad(field: Heightfield, samples: Vec2[], c: number): CrossRoad {
  const frame = frameAt(samples, c)
  const n = { x: frame.nx, z: frame.nz }
  const steps = Math.max(2, Math.round((CROSS_REACH * 2) / SAMPLE_STEP))
  const points: Vec2[] = []
  const heights = new Float32Array(steps + 1)
  for (let k = 0; k <= steps; k++) {
    const t = -CROSS_REACH + (2 * CROSS_REACH * k) / steps
    const x = frame.x + n.x * t
    const z = frame.z + n.z * t
    points.push({ x, z })
    heights[k] = sampleTerrain(field, x, z)
  }
  limitOpenGrade(heights, points, MAX_ROAD_GRADE)
  return { points, heights, centerIndex: Math.round(steps / 2) }
}

/**
 * Simplified diamond interchanges at the chosen crossings. At each, a cross
 * road passes beneath the highway through an underpass, and four one-lane ramps
 * connect the highway deck down to it, one per quadrant. The highway is drawn
 * as bridge deck across the crossing so the cross road shows through
 * underneath; ramps are added after the cross road so they render on top.
 *
 * Alongside the roads this returns each interchange's footprint: the hull of
 * its four ramps, which is the diamond they enclose together with the highway
 * and the cross road. Nothing else may be built inside it.
 */
/**
 * A ramp's line in plan, from its mouth beside the deck to where it meets
 * the cross road: level and straight along the deck for the plateau, one
 * arc of `RAMP_TURN_RADIUS` turning out by whatever angle then lets a
 * straight run end exactly on the merge point. Laid out in the mouth's own
 * frame: `along` runs down the deck toward the crossing, `out` away from
 * it. `null` where no such line reaches the merge, for a deck that bends
 * too much between the two.
 */
function rampPlan(mouth: Vec2, along: Vec2, out: Vec2, merge: Vec2): Vec2[] | null {
  const reachAlong = (merge.x - mouth.x) * along.x + (merge.z - mouth.z) * along.z
  const reachOut = (merge.x - mouth.x) * out.x + (merge.z - mouth.z) * out.z
  const run = reachAlong - RAMP_PLATEAU
  if (run <= 0 || reachOut <= 0) return null
  const radius = RAMP_TURN_RADIUS
  // The turn that lets the straight run land on the merge: with `s` its
  // length, s·sin = out − R(1 − cos) and s·cos = run − R·sin, so the angle
  // is where the two agree. It rises with the angle, so bisection finds it.
  const off = (angle: number): number =>
    (reachOut - radius * (1 - Math.cos(angle))) * Math.cos(angle) - (run - radius * Math.sin(angle)) * Math.sin(angle)
  let low = 0
  let high = Math.PI / 2
  if (off(low) <= 0 || off(high) >= 0) return null
  for (let step = 0; step < 40; step++) {
    const mid = (low + high) / 2
    if (off(mid) > 0) low = mid
    else high = mid
  }
  const turn = (low + high) / 2
  const arc = radius * turn
  const straight = (run - radius * Math.sin(turn)) / Math.cos(turn)
  if (straight < 0) return null
  const total = RAMP_PLATEAU + arc + straight
  const points: Vec2[] = []
  for (let k = 0; k <= RAMP_SEGMENTS; k++) {
    const s = (total * k) / RAMP_SEGMENTS
    let x: number
    let y: number
    if (s <= RAMP_PLATEAU) {
      x = s
      y = 0
    } else if (s <= RAMP_PLATEAU + arc) {
      const swept = (s - RAMP_PLATEAU) / radius
      x = RAMP_PLATEAU + radius * Math.sin(swept)
      y = radius * (1 - Math.cos(swept))
    } else {
      const t = s - RAMP_PLATEAU - arc
      x = RAMP_PLATEAU + radius * Math.sin(turn) + t * Math.cos(turn)
      y = radius * (1 - Math.cos(turn)) + t * Math.sin(turn)
    }
    points.push({ x: mouth.x + along.x * x + out.x * y, z: mouth.z + along.z * x + out.z * y })
  }
  points[RAMP_SEGMENTS] = { x: merge.x, z: merge.z }
  return points
}

/**
 * The older line for a ramp, where the plan above finds none: an S-curve
 * from the deck to the cross road, leaving along the deck and arriving
 * square to the cross road.
 */
function rampSweep(mouth: Vec2, leave: Vec2, merge: Vec2, arrive: Vec2): Vec2[] {
  const reach = hypot(merge.x - mouth.x, merge.z - mouth.z)
  const handle = reach * 0.45
  const p1x = mouth.x + leave.x * handle
  const p1z = mouth.z + leave.z * handle
  const p2x = merge.x - arrive.x * handle
  const p2z = merge.z - arrive.z * handle
  const points: Vec2[] = []
  for (let k = 0; k <= RAMP_SEGMENTS; k++) {
    const t = k / RAMP_SEGMENTS
    const u = 1 - t
    points.push({
      x: u * u * u * mouth.x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * merge.x,
      z: u * u * u * mouth.z + 3 * u * u * t * p1z + 3 * u * t * t * p2z + t * t * t * merge.z,
    })
  }
  return points
}

export function buildInterchanges(
  samples: Vec2[],
  profile: Float32Array,
  crossings: { index: number; cross: CrossRoad }[],
  bridgeSteps: number,
  structure: Uint8Array,
  nextId: number,
): { roads: Road[]; footprints: Vec2[][] } {
  const count = samples.length
  const cum = cumulativeLengths(samples)
  const total =
    cum[count - 1]! +
    hypot(samples[0]!.x - samples[count - 1]!.x, samples[0]!.z - samples[count - 1]!.z)
  const roads: Road[] = []
  const footprints: Vec2[][] = []
  let id = nextId

  for (const { index: c, cross } of crossings) {
    const frame = frameAt(samples, c)
    const n = { x: frame.nx, z: frame.nz }
    const arms: Vec2[] = []

    for (let j = -bridgeSteps; j <= bridgeSteps; j++) {
      structure[(c + j + count) % count] = ROAD_BRIDGE
    }

    const crossPoints = cross.points
    const crossHeights = cross.heights

    roads.push({
      id: id++,
      kind: 'cross',
      closed: false,
      width: CROSS_WIDTH,
      points: crossPoints.map((point, k) => ({ x: point.x, y: crossHeights[k]!, z: point.z })),
      structure: new Uint8Array(Math.max(0, crossPoints.length - 1)),
    })

    // Four ramps, one per diamond arm. Each leaves the highway edge heading
    // with traffic toward the crossing, sweeps out and down, and arrives at the
    // cross road at a right angle. The two arms on a side mirror each other and
    // land at the same corner.
    for (const sn of [1, -1]) {
      const mergeOffset = sn * RAMP_REACH
      const centerX = frame.x + n.x * mergeOffset
      const centerZ = frame.z + n.z * mergeOffset
      // Stop at the near edge of the cross road, not its centreline, so the
      // ramp does not pave over the far carriageway.
      const mergeY = sampleOpen(crossHeights, mergeOffset)
      for (const sd of [1, -1]) {
        const edgeOffset = sd * (CROSS_WIDTH / 2)
        const mergeX = centerX + frame.dx * edgeOffset
        const mergeZ = centerZ + frame.dz * edgeOffset
        const attach = indexAtDistance(cum, (cum[c]! + sd * RAMP_ALONG + total) % total)
        const start = frameAt(samples, attach)
        // The ramp's carriageway begins at the foot of the deck's skirt, not
        // under it: a car on a ramp built over the skirt rides the skirt's
        // slope instead of the ramp and drops off its edge as they part.
        const startOffset = ROAD_WIDTH / 2 + ROAD_SKIRT + RAMP_WIDTH / 2
        const startX = start.x + start.nx * sn * startOffset
        const startZ = start.z + start.nz * sn * startOffset
        const startY = profile[attach]!

        // The ramp runs beside the deck for its plateau, turns out through one
        // arc, and runs straight to the cross road from there: as gentle as
        // the diagonal allows, where a curve swinging out and back square to
        // the cross road has to be steeper than the diagonal in its middle.
        // The ramp is the ground: it leaves the highway's own surface, which
        // rides ROAD_SURFACE above its centreline, and lands on the cross road.
        const points = rampPlan(
          { x: startX, z: startZ },
          { x: -sd * start.dx, z: -sd * start.dz },
          { x: sn * start.nx, z: sn * start.nz },
          { x: mergeX, z: mergeZ },
        ) ?? rampSweep({ x: startX, z: startZ }, { x: -sd * start.dx, z: -sd * start.dz }, { x: mergeX, z: mergeZ }, { x: -sd * frame.dx, z: -sd * frame.dz })
        const along = cumulativeLengths(points)
        const rampLength = along[RAMP_SEGMENTS]!
        // The deck's surface `distance` further along the highway toward the
        // crossing, read off the profile between samples.
        const deckAlong = (distance: number): number => {
          const at = (cum[attach]! - sd * distance + total * 2) % total
          let i = 0
          while (i + 1 < count && cum[i + 1]! <= at) i++
          const next = (i + 1) % count
          const span = (next === 0 ? total : cum[next]!) - cum[i]!
          const t = span > 0 ? Math.min(Math.max((at - cum[i]!) / span, 0), 1) : 0
          return profile[i]! + (profile[next]! - profile[i]!) * t + ROAD_SURFACE
        }
        const heights = new Float32Array(RAMP_SEGMENTS + 1)
        const shelf = deckAlong(RAMP_PLATEAU)
        for (let k = 0; k <= RAMP_SEGMENTS; k++) {
          const distance = along[k]!
          heights[k] =
            distance < RAMP_PLATEAU
              ? deckAlong(distance)
              : shelf + (mergeY - shelf) * smoothstep(RAMP_PLATEAU, rampLength, distance)
        }

        roads.push({
          id: id++,
          kind: 'ramp',
          closed: false,
          width: RAMP_WIDTH,
          points: points.map((point, k) => ({ x: point.x, y: heights[k]!, z: point.z })),
          structure: new Uint8Array(Math.max(0, points.length - 1)),
        })
        arms.push(...points)
      }
    }

    footprints.push(convexHull(arms))
  }

  return { roads, footprints }
}
