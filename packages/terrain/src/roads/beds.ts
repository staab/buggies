import * as exact from '@buggies/physics'
import type { Heightfield, Road, RoadPoint } from '../types.ts'
import {
  BRIDGE_SHOULDER_DROP,
  CUT_CLEARANCE,
  CUT_SLOPE,
  MAX_ARTERIAL_GRADE,
  MAX_RAMP_CURVATURE,
  MAX_RAMP_GRADE,
  MAX_ROAD_CURVATURE,
  MAX_ROAD_GRADE,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SKIRT,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  SETTLE_PASSES,
  SURFACE_SHOULDER,
} from './constants.ts'
import { smoothstep } from './geometry.ts'
import { limitVerticalCurvature } from './grades.ts'
import { sampleTerrain } from './sampling.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { hypot } = exact

/**
 * Surface roads on the terrain: how they sit on it, how the ground is cut and
 * stamped to carry them, and how they are settled to a drivable grade.
 */

/**
 * Roads that are the ground, shaped to them and painted on, rather than built
 * over it: everything but the highway, which rides its own embankment.
 */
export function isSurfaceRoad(road: Road): boolean {
  return road.kind !== 'highway'
}

/** How far above a road's recorded centreline its drivable surface sits. */
export function roadLift(road: Road): number {
  return isSurfaceRoad(road) ? 0 : ROAD_SURFACE
}

/**
 * Cut the ground down under every built road that is not a tunnel so rising
 * terrain never pokes through the ribbon, just as river channels are carved
 * so the water is not covered. The bed is interpolated along each segment,
 * so a road that climbs or falls is followed exactly. Only cuts are made,
 * never fills, so embankments keep their profile and a bridge over water is
 * left alone; a bridge whose bank rises to its deck is cut through the bank.
 */
export function carveRoadBeds(
  field: Heightfield,
  roads: Road[],
  keep: Uint8Array,
  carved: (structure: number) => boolean = (structure) => structure !== ROAD_TUNNEL,
  wallHeld: (x: number, z: number) => boolean = () => false,
): void {
  const { width, depth, cellSize, heights } = field
  // Within one road only the nearest stretch cuts a cell: where a deck
  // falls away from a shore, the stretch beyond would otherwise reach back
  // and cut the shore down to its own lower start.
  const nearest = new Float32Array(width * depth).fill(Infinity)
  const cut = new Float32Array(width * depth)
  const touched: number[] = []
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const flat = road.width / 2 + cellSize
    const reach = flat + cellSize * 5
    // At a surface road's shore the ground is the road up to the deck's
    // first plank, and is only let fall away from under the deck over the
    // next cells, so the wheels are not dropped into a gap the width of a
    // cell before they reach it. A built road is deck end to end and has no
    // shore.
    const shores = isSurfaceRoad(road) ? shoresOf(road) : []
    const clearanceAt = (x: number, z: number): number => {
      let past = Infinity
      for (const shore of shores) {
        const sx = x - shore.x
        const sz = z - shore.z
        if (sx * sx + sz * sz > 4 * flat * flat) continue
        past = Math.min(past, sx * shore.dx + sz * shore.dz)
      }
      return CUT_CLEARANCE * smoothstep(0, 2 * cellSize, past)
    }

    for (let i = 0; i < segmentCount; i++) {
      if (!carved(road.structure[i]!)) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const vx = b.x - a.x
      const vz = b.z - a.z
      const lengthSq = vx * vx + vz * vz || 1

      const minCol = Math.max(Math.floor((Math.min(a.x, b.x) - reach) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((Math.max(a.x, b.x) + reach) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((Math.min(a.z, b.z) - reach) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((Math.max(a.z, b.z) + reach) / cellSize), depth - 1)

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const x = col * cellSize
          const z = row * cellSize
          const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
          const distance = hypot(x - (a.x + vx * t), z - (a.z + vz * t))
          if (distance > reach) continue
          const cell = row * width + col
          if (keep[cell] === 1 || distance >= nearest[cell]!) continue
          if (nearest[cell] === Infinity) touched.push(cell)
          nearest[cell] = distance
          const bed = a.y + (b.y - a.y) * t
          // The cut's wall rises again beyond the flat, except where it is
          // held back: beside a ramp's lane running out from under the
          // deck, a wall would stand proud of the deck the lane leaves.
          const wall = wallHeld(x, z) ? 0 : Math.max(0, distance - flat) * CUT_SLOPE
          cut[cell] = bed - clearanceAt(x, z) + wall
        }
      }
    }
    for (const cell of touched) {
      if (heights[cell]! > cut[cell]!) heights[cell] = cut[cell]!
      nearest[cell] = Infinity
    }
    touched.length = 0
  }
}

/**
 * The cells a surface road's carriageway lies over. The highway's bed must
 * not be cut into them where it passes close, as it does where a ramp leaves
 * it: that ground is a road, and a cut across it is a trench across a road.
 */
/**
 * Every cell under a built road's carriageway, whatever it is built as. The
 * deck is what is driven there, and the ground under it stays cut clear of
 * it: a surface road's shoulder may not fill it back up to the deck.
 */
function builtRoadCells(field: Heightfield, roads: Road[]): Uint8Array {
  const { width, depth, cellSize } = field
  const cells = new Uint8Array(width * depth)
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const half = road.width / 2
    for (let i = 0; i < segmentCount; i++) {
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const vx = b.x - a.x
      const vz = b.z - a.z
      const lengthSq = vx * vx + vz * vz || 1
      const minCol = Math.max(Math.floor((Math.min(a.x, b.x) - half) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((Math.max(a.x, b.x) + half) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((Math.min(a.z, b.z) - half) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((Math.max(a.z, b.z) + half) / cellSize), depth - 1)
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const x = col * cellSize
          const z = row * cellSize
          const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
          if (hypot(x - (a.x + vx * t), z - (a.z + vz * t)) <= half) cells[row * width + col] = 1
        }
      }
    }
  }
  return cells
}

/** Where a road's at-grade run meets a bridge, and which way the deck leaves it. */
interface Shore {
  x: number
  z: number
  dx: number
  dz: number
}

function shoresOf(road: Road): Shore[] {
  const count = road.points.length
  const segmentCount = road.closed ? count : count - 1
  const shores: Shore[] = []
  const structureAt = (i: number): number | undefined =>
    road.closed ? road.structure[((i % segmentCount) + segmentCount) % segmentCount] : road.structure[i]
  for (let i = 0; i < segmentCount; i++) {
    if (road.structure[i] !== ROAD_BRIDGE) continue
    const a = road.points[i]!
    const b = road.points[(i + 1) % count]!
    const length = hypot(b.x - a.x, b.z - a.z) || 1
    const dx = (b.x - a.x) / length
    const dz = (b.z - a.z) / length
    if (structureAt(i - 1) === ROAD_GRADE) shores.push({ x: a.x, z: a.z, dx, dz })
    if (structureAt(i + 1) === ROAD_GRADE) shores.push({ x: b.x, z: b.z, dx: -dx, dz: -dz })
  }
  return shores
}

/**
 * Every cell under a surface road's at-grade carriageway. A run ends square
 * at the shore where it meets a bridge: the ground past it is under the
 * deck, and is cut clear of that rather than kept as road, however the
 * run's last segments' own ends round out over it.
 */
export function surfaceRoadCells(field: Heightfield, roads: Road[]): Uint8Array {
  const { width, depth, cellSize } = field
  const cells = new Uint8Array(width * depth)
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const flat = road.width / 2 + cellSize
    const shores = shoresOf(road)
    const pastAShore = (x: number, z: number): boolean => {
      for (const shore of shores) {
        const sx = x - shore.x
        const sz = z - shore.z
        if (sx * sx + sz * sz > 4 * flat * flat) continue
        if (sx * shore.dx + sz * shore.dz > 0) return true
      }
      return false
    }
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const vx = b.x - a.x
      const vz = b.z - a.z
      const lengthSq = vx * vx + vz * vz || 1
      const minCol = Math.max(Math.floor((Math.min(a.x, b.x) - flat) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((Math.max(a.x, b.x) + flat) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((Math.min(a.z, b.z) - flat) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((Math.max(a.z, b.z) + flat) / cellSize), depth - 1)
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const x = col * cellSize
          const z = row * cellSize
          const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
          if (hypot(x - (a.x + vx * t), z - (a.z + vz * t)) > flat) continue
          if (shores.length > 0 && pastAShore(x, z)) continue
          cells[row * width + col] = 1
        }
      }
    }
  }
  return cells
}

/**
 * Shape the ground to every surface road. Across the carriageway the ground is
 * the road's own profile, cut or filled to reach it; the shoulders blend back
 * to the land beside it. Roads only compete with each other within their
 * carriageways: where two cross, their profiles are averaged over the
 * overlap, so a crossing is one level rather than a step from one deck to
 * another, but a road's shoulder never reshapes the road beside it. Bridges
 * are left alone: there is water under them, and a deck is built over it.
 * Cells in `keepOff` are never touched: the ground under a built road stays
 * as it was cut.
 */
function stampRoadBeds(field: Heightfield, roads: Road[], keepOff: Uint8Array, built: Road[]): void {
  const { width, depth, cellSize, heights } = field
  const original = Float32Array.from(heights)
  const roadWeightSum = new Float32Array(width * depth)
  const bedSum = new Float32Array(width * depth)
  const landWeightMax = new Float32Array(width * depth)
  // Within one road only its nearest stretch counts, or a tight bend would
  // blend the height of the road coming in with the road going out.
  const nearest = new Float32Array(width * depth).fill(Infinity)
  const nearestBed = new Float32Array(width * depth)
  const touched: number[] = []

  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const half = road.width / 2
    const flat = half + cellSize
    const reach = flat + SURFACE_SHOULDER
    const mouth = mouthOf(road, built)

    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const vx = b.x - a.x
      const vz = b.z - a.z
      const lengthSq = vx * vx + vz * vz || 1

      const minCol = Math.max(Math.floor((Math.min(a.x, b.x) - reach) / cellSize), 0)
      const maxCol = Math.min(Math.ceil((Math.max(a.x, b.x) + reach) / cellSize), width - 1)
      const minRow = Math.max(Math.floor((Math.min(a.z, b.z) - reach) / cellSize), 0)
      const maxRow = Math.min(Math.ceil((Math.max(a.z, b.z) + reach) / cellSize), depth - 1)

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const x = col * cellSize
          const z = row * cellSize
          // Behind a ramp's mouth only its first stretch has any say, and
          // its bed there carries the mouth's grade on behind it.
          const behind = mouth === null ? 0 : pastMouth(mouth, x, z)
          if (behind < 0 && i > 0) continue
          const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
          const distance = hypot(x - (a.x + vx * t), z - (a.z + vz * t))
          if (distance > reach) continue
          const cell = row * width + col
          if (distance >= nearest[cell]!) continue
          if (nearest[cell] === Infinity) touched.push(cell)
          nearest[cell] = distance
          nearestBed[cell] = behind < 0 && mouth !== null ? a.y + mouth.grade * behind : a.y + (b.y - a.y) * t
        }
      }
    }

    for (const cell of touched) {
      const distance = nearest[cell]!
      // A road's say over the ground beside it fades out over the shoulder;
      // its say against another road ends at its own carriageway. The small
      // share kept beyond that only decides whose profile a lone shoulder
      // takes, never a contest with a carriageway.
      const land = 1 - smoothstep(flat, reach, distance)
      const contest = 1 - smoothstep(half, flat + cellSize, distance) + land * 0.01
      roadWeightSum[cell] = roadWeightSum[cell]! + contest
      bedSum[cell] = bedSum[cell]! + contest * nearestBed[cell]!
      if (land > landWeightMax[cell]!) landWeightMax[cell] = land
      nearest[cell] = Infinity
    }
    touched.length = 0
  }

  for (let cell = 0; cell < heights.length; cell++) {
    const weight = landWeightMax[cell]!
    if (weight <= 0 || keepOff[cell]) continue
    const bed = bedSum[cell]! / roadWeightSum[cell]!
    heights[cell] = original[cell]! + (bed - original[cell]!) * weight
  }
}

/** A ramp's mouth: where it starts, the way it leaves, and the grade it leaves at. */
interface Mouth {
  x: number
  z: number
  ux: number
  uz: number
  /** The rise per metre over the ramp's first stretch, which is the deck's own grade there. */
  grade: number
}

/**
 * A ramp's mouth, or `null` for any other road. The mouth lies under the
 * highway's deck, so the ground behind it is shaped by the ramp's first
 * stretch alone, carrying the deck's own grade on: a level cap there, or
 * the shoulder of the ramp further along, would stand out of a deck
 * falling away behind the mouth. The grade is the deck's, read off the
 * highway at the point nearest the mouth, since the ramp's own first
 * stretch is eased over the crest where its descent begins and does not
 * climb as the deck does.
 */
function mouthOf(road: Road, built: Road[]): Mouth | null {
  if (road.kind !== 'ramp' || road.points.length < 2) return null
  const first = road.points[0]!
  const second = road.points[1]!
  const length = hypot(second.x - first.x, second.z - first.z) || 1
  const ux = (second.x - first.x) / length
  const uz = (second.z - first.z) / length
  let grade = 0
  let best = Infinity
  for (const deck of built) {
    if (deck.kind !== 'highway') continue
    const count = deck.points.length
    for (let i = 0; i < count; i++) {
      const point = deck.points[i]!
      const distance = hypot(point.x - first.x, point.z - first.z)
      if (distance >= best) continue
      best = distance
      const prev = deck.points[deck.closed ? (i - 1 + count) % count : Math.max(i - 1, 0)]!
      const next = deck.points[deck.closed ? (i + 1) % count : Math.min(i + 1, count - 1)]!
      const run = hypot(next.x - prev.x, next.z - prev.z) || 1
      // The deck's rise per metre, taken along the way the ramp leaves.
      grade = ((next.y - prev.y) / run) * (((next.x - prev.x) * ux + (next.z - prev.z) * uz) / run)
    }
  }
  return { x: first.x, z: first.z, ux, uz, grade }
}

/** How far behind a ramp's mouth a point lies along the way the ramp leaves it, negative behind. */
function pastMouth(mouth: Mouth, x: number, z: number): number {
  return (x - mouth.x) * mouth.ux + (z - mouth.z) * mouth.uz
}

/**
 * Lay a surface road's samples out evenly, no further apart than the ground's
 * own cells. Streets and arterials are sampled far more coarsely than that,
 * and fillets far more finely; once the road is the ground, its grade is the
 * ground's grade, and that is only worth reading at the ground's resolution.
 * A new segment takes the structure of the old one its middle lies in.
 */
function resampleSurfaceRoad(road: Road, spacing: number): void {
  const { points, structure } = road
  if (road.closed || points.length < 2) return
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cumulative.push(cumulative[i - 1]! + hypot(b.x - a.x, b.z - a.z))
  }
  const total = cumulative[cumulative.length - 1]!
  const steps = Math.max(1, Math.ceil(total / spacing))

  const at = (distance: number): { point: RoadPoint; segment: number } => {
    let i = 1
    while (i < cumulative.length - 1 && cumulative[i]! < distance) i++
    const a = points[i - 1]!
    const b = points[i]!
    const span = cumulative[i]! - cumulative[i - 1]! || 1
    const t = Math.min(Math.max((distance - cumulative[i - 1]!) / span, 0), 1)
    return {
      point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
      segment: i - 1,
    }
  }

  const resampled: RoadPoint[] = []
  const codes: number[] = []
  for (let k = 0; k <= steps; k++) {
    const distance = (total * k) / steps
    resampled.push(k === 0 ? points[0]! : k === steps ? points[points.length - 1]! : at(distance).point)
    if (k < steps) codes.push(structure[at((total * (k + 0.5)) / steps).segment]!)
  }
  road.points = resampled
  road.structure = Uint8Array.from(codes)
}

/**
 * Hold a run of samples to a grade. One sweep from each end holds every
 * sample within the limit of the one before it, and the profile kept is the
 * mean of the two: itself within the limit, and leaving either end where it
 * was unless the two are further apart than the run can join at that grade,
 * in which case each gives up half the difference rather than one all of it.
 */
function limitRunGrade(points: RoadPoint[], from: number, to: number, maxGrade: number): void {
  const forward = points.slice(from, to + 1).map((point) => point.y)
  const backward = forward.slice()
  const step = (i: number, j: number): number =>
    maxGrade * hypot(points[from + i]!.x - points[from + j]!.x, points[from + i]!.z - points[from + j]!.z)
  for (let i = 1; i < forward.length; i++) {
    const delta = step(i, i - 1)
    forward[i] = Math.min(Math.max(forward[i]!, forward[i - 1]! - delta), forward[i - 1]! + delta)
  }
  for (let i = backward.length - 2; i >= 0; i--) {
    const delta = step(i, i + 1)
    backward[i] = Math.min(Math.max(backward[i]!, backward[i + 1]! - delta), backward[i + 1]! + delta)
  }
  for (let i = 0; i < forward.length; i++) points[from + i]!.y = (forward[i]! + backward[i]!) / 2
}

/** The grade a surface road of this kind is held to. */
function surfaceGradeLimit(road: Road): number {
  if (road.kind === 'ramp') return MAX_RAMP_GRADE
  return road.kind === 'arterial' ? MAX_ARTERIAL_GRADE : MAX_ROAD_GRADE
}

/** The vertical curvature a surface road of this kind is held to. */
function surfaceCurvatureLimit(road: Road): number {
  return road.kind === 'ramp' ? MAX_RAMP_CURVATURE : MAX_ROAD_CURVATURE
}

/**
 * Hold a road to its grade limit from end to end, bridges included, and ease
 * the crests and sags of every at-grade run to its curvature limit. A deck
 * is left where it was built, but the road is held to it: an at-grade run
 * that settles into the ground a metre above or below the deck it leads
 * onto is brought back down to meet it, rather than stepping off the end.
 */
function limitSurfaceRoadGrade(road: Road): void {
  const { points, structure } = road
  limitRunGrade(points, 0, points.length - 1, surfaceGradeLimit(road))
  let start = 0
  for (let i = 0; i <= structure.length; i++) {
    const atGrade = i < structure.length && structure[i] === ROAD_GRADE
    if (atGrade) continue
    if (i > start) {
      const run = points.slice(start, i + 1)
      const heights = Float32Array.from(run.map((point) => point.y))
      limitVerticalCurvature(heights, run, surfaceCurvatureLimit(road), false)
      for (let k = 0; k < run.length; k++) run[k]!.y = heights[k]!
    }
    start = i + 1
  }
}

/**
 * Hold every bridge of a settled road up to the shores it leaves from. The
 * deck was set at routing, over ground the shores have since been shaped
 * away from, and a shore is the ground: the deck comes up to meet it, never
 * the other way round. Between its shores a deck is at least the straight
 * line from one to the other, so a river is crossed level rather than dipped
 * into and climbed out of, and from either shore it falls no faster than the
 * road's grade. A road's end counts as a shore: it is held where the road it
 * meets stands.
 */
function holdBridgeDecks(road: Road): void {
  const { points, structure } = road
  if (road.closed) return
  const grade = surfaceGradeLimit(road)
  const step = (i: number, j: number): number =>
    hypot(points[i]!.x - points[j]!.x, points[i]!.z - points[j]!.z)
  let start = 0
  for (let i = 0; i <= structure.length; i++) {
    if (i < structure.length && structure[i] === ROAD_BRIDGE) continue
    if (i > start) {
      const from = points[start]!
      const to = points[i]!
      const along = [0]
      for (let k = start + 1; k <= i; k++) along.push(along[along.length - 1]! + step(k - 1, k))
      const length = along[along.length - 1]! || 1
      for (let k = start + 1; k < i; k++) {
        const chord = from.y + (to.y - from.y) * (along[k - start]! / length)
        points[k]!.y = Math.max(points[k]!.y, chord)
      }
      for (let k = start + 1; k < i; k++) {
        points[k]!.y = Math.max(points[k]!.y, points[k - 1]!.y - grade * step(k - 1, k))
      }
      for (let k = i - 1; k > start; k--) {
        points[k]!.y = Math.max(points[k]!.y, points[k + 1]!.y - grade * step(k, k + 1))
      }
    }
    start = i + 1
  }
}

/**
 * Put every surface road's samples on the ground now shaped to them, so the
 * road as recorded is the road as driven: where two roads were averaged
 * across a crossing, both now say the height the ground actually has there.
 * A sample out on a bridge keeps its deck; a shore, or a road's end that is
 * on a bridge, is the ground it meets, and the deck is held up to it.
 */
function seatSurfaceRoads(field: Heightfield, roads: Road[]): void {
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (let i = 0; i < count; i++) {
      const before = i > 0 ? road.structure[i - 1] : road.closed ? road.structure[count - 1] : ROAD_GRADE
      const after = i < segmentCount ? road.structure[i] : ROAD_GRADE
      if (before === ROAD_BRIDGE && after === ROAD_BRIDGE) continue
      const point = road.points[i]!
      point.y = sampleTerrain(field, point.x, point.z)
    }
  }
}

/** Where across a deck's skirt the ground is read, as fractions of the skirt's width out from the deck's edge. */
const SKIRT_FOOT_SAMPLES = [0.25, 0.5, 0.75, 1] as const

/**
 * Where a deck's skirt meets the ground on one side: the highest the ground
 * stands anywhere across the skirt's width, and never above the deck. A
 * ramp's lane running out from under the deck is a ridge of ground level
 * with the deck, and a skirt run down to the ground at its foot alone
 * would cut through that ridge wherever the lane's edge lay within it.
 */
export function skirtFoot(
  field: Heightfield,
  x: number,
  z: number,
  nx: number,
  nz: number,
  half: number,
  deck: number,
): number {
  let foot = -Infinity
  for (const across of SKIRT_FOOT_SAMPLES) {
    const reach = half + ROAD_SKIRT * across
    foot = Math.max(foot, sampleTerrain(field, x + nx * reach, z + nz * reach))
  }
  return Math.min(foot, deck)
}

/**
 * Whether a built road's segment carries its shoulders down to the ground
 * beside it. An at-grade run always does. A bridge does only where the
 * ground alongside is nearly up to the deck, as it is where a ramp's mouth
 * has been built beside it: without the shoulder there, a car leaving the
 * deck drops into the bed cut beneath it.
 */
export function deckShouldered(road: Road, field: Heightfield, segment: number): boolean {
  const structure = road.structure[segment]
  if (structure === ROAD_GRADE) return true
  if (structure !== ROAD_BRIDGE) return false
  const count = road.points.length
  const lift = roadLift(road)
  for (const index of [segment, (segment + 1) % count]) {
    const point = road.points[index]!
    const prev = road.points[road.closed ? (index - 1 + count) % count : Math.max(index - 1, 0)]!
    const next = road.points[road.closed ? (index + 1) % count : Math.min(index + 1, count - 1)]!
    const dx = next.x - prev.x
    const dz = next.z - prev.z
    const length = hypot(dx, dz) || 1
    const nx = -dz / length
    const nz = dx / length
    const foot = road.width / 2 + ROAD_SKIRT
    for (const side of [1, -1]) {
      const ground = sampleTerrain(field, point.x + nx * side * foot, point.z + nz * side * foot)
      if (ground >= point.y + lift - BRIDGE_SHOULDER_DROP) return true
    }
  }
  return false
}

export function settleSurfaceRoads(field: Heightfield, roads: Road[], built: Road[]): void {
  for (const road of roads) resampleSurfaceRoad(road, field.cellSize)
  // The ground under a deck stays as it was cut, except where a surface road
  // runs under it: a cross road passing beneath an underpass is that road's
  // ground to shape, or the hill it cuts through is left standing across it.
  const keepOff = builtRoadCells(field, built)
  const carriageways = surfaceRoadCells(field, roads)
  for (let cell = 0; cell < keepOff.length; cell++) if (carriageways[cell]) keepOff[cell] = 0
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    stampRoadBeds(field, roads, keepOff, built)
    seatSurfaceRoads(field, roads)
    for (const road of roads) {
      holdBridgeDecks(road)
      limitSurfaceRoadGrade(road)
    }
  }
  stampRoadBeds(field, roads, keepOff, built)
  seatSurfaceRoads(field, roads)
  for (const road of roads) holdBridgeDecks(road)
}
