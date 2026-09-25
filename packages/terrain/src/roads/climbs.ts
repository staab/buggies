import * as exact from '@buggies/physics'
import { orientedTriangle, signedDistanceToTriangle } from '../mountain.ts'
import type { Heightfield, Lot, Mountain, Road, RoadPoint } from '../types.ts'
import {
  ARTERIAL_BRIDGE_CLEARANCE,
  CLIMB_DIP,
  CLIMB_END,
  CLIMB_FORD,
  CLIMB_GRADE,
  CLIMB_HAIRPIN,
  CLIMB_LOOK,
  CLIMB_LOT,
  CLIMB_MOST_HAIRPINS,
  CLIMB_MOST_LENGTH,
  CLIMB_ROAD_KEEP,
  CLIMB_SELF_KEEP,
  CLIMB_START,
  CLIMB_STEEPEST,
  CLIMB_STEER,
  CLIMB_STEP,
  CLIMB_STRAIGHT,
  CLIMB_TURNS,
  CLIMB_WIDTH,
  CLIMBS_MOST,
  MAX_CLIMB_GRADE,
  ROAD_BRIDGE,
  ROAD_GRADE,
} from './constants.ts'
import { smoothstep } from './geometry.ts'
import { sampleTerrain } from './sampling.ts'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { cos: cosine, hypot, sin: sine } = exact

/**
 * Mountain roads: a winding climb from the nearest arterial up a
 * mountainside, as high as the mountain lets it, ending on a shoulder
 * gentle enough to park on. The road traverses the slope at its grade,
 * winding round the mountain as the contours take it, and where something
 * bars the way (water, another road, its own lower turns) it turns back on
 * itself in a hairpin where one will fit: half a loop bulging on ahead and
 * coming back the other way a road's spacing further up the slope, drawn
 * out as far as lets the road climb the difference at its grade. Gentler
 * ground is climbed straight up, and a stream is crossed straight over on
 * a short bridge. One climb per island at most, on the highest mountain an
 * arterial comes near.
 */

interface Spot {
  x: number
  z: number
}

interface Peak extends Spot {
  y: number
}

type Surface = (x: number, z: number) => { wet: boolean; level: number }

/** How far a point is from the nearest point of any of these roads. */
function nearestRoad(roads: Road[], x: number, z: number): number {
  let best = Infinity
  for (const road of roads) {
    for (const point of road.points) best = Math.min(best, hypot(point.x - x, point.z - z))
  }
  return best
}

/** The highest cell within a mountain's triangle, and how high it is. */
function peakOf(field: Heightfield, mountain: Mountain): Peak | null {
  const { width, depth, cellSize, heights } = field
  const triangle = orientedTriangle(mountain)
  const xs = [triangle.ax, triangle.bx, triangle.cx]
  const zs = [triangle.az, triangle.bz, triangle.cz]
  const colFrom = Math.max(Math.floor(Math.min(...xs) / cellSize), 0)
  const colTo = Math.min(Math.ceil(Math.max(...xs) / cellSize), width - 1)
  const rowFrom = Math.max(Math.floor(Math.min(...zs) / cellSize), 0)
  const rowTo = Math.min(Math.ceil(Math.max(...zs) / cellSize), depth - 1)
  let best: Peak | null = null
  for (let row = rowFrom; row <= rowTo; row++) {
    for (let col = colFrom; col <= colTo; col++) {
      const x = col * cellSize
      const z = row * cellSize
      if (signedDistanceToTriangle(x, z, triangle) < 0) continue
      const y = heights[row * width + col]!
      if (best === null || y > best.y) best = { x, z, y }
    }
  }
  return best
}

/** The lie of the ground at a spot, read across this much of it: which way is up, and how steeply. */
function slopeAt(field: Heightfield, x: number, z: number, across = CLIMB_LOOK): { ux: number; uz: number; steep: number } {
  const gx = (sampleTerrain(field, x + across, z) - sampleTerrain(field, x - across, z)) / (2 * across)
  const gz = (sampleTerrain(field, x, z + across) - sampleTerrain(field, x, z - across)) / (2 * across)
  const steep = hypot(gx, gz)
  return steep > 0 ? { ux: gx / steep, uz: gz / steep, steep } : { ux: 0, uz: 0, steep }
}

/** Where a climb leaves an arterial: the point, and the way square off the road there toward the peak. */
interface Start extends Spot {
  y: number
  awayX: number
  awayZ: number
}

/**
 * The line of a climb up one mountain from a start beside it, with the
 * road's height at each point: up to a little below the peak, or as far
 * as the road can go if that is high enough, or `null` where it is not.
 * The road leaves the arterial at a fair angle, then heads along the
 * slope to whichever side `side` says, and each hairpin sends it back the
 * other way. Along the slope the road climbs at its grade and steers to
 * stay on the ground: turned further up the slope where the ground has
 * fallen below it, and along the contour where the ground stands above,
 * as it does after a hairpin or the cutting at the junction, until the
 * two meet again.
 */
function traceClimb(
  field: Heightfield,
  seaLevel: number,
  surfaceAt: Surface,
  others: Road[],
  start: Start,
  side: number,
  peak: Peak,
): RoadPoint[] | null {
  const points: RoadPoint[] = [{ x: start.x, y: start.y, z: start.z }]
  // How far along the road each point lies.
  const along: number[] = [0]
  let x = start.x
  let z = start.z
  let y = start.y
  let dx = 0
  let dz = 0
  let length = 0
  let hairpins = 0
  // The last hairpin and the stretch just into it, which the road after is meant to be near for a while.
  let skip = { from: -1, to: -1 }
  const ground = (px: number, pz: number): number => sampleTerrain(field, px, pz)
  // The ground the road is to stand on: over water, a bridge deck clear of it.
  const bed = (px: number, pz: number): number => {
    const water = surfaceAt(px, pz)
    return water.wet ? Math.max(water.level + ARTERIAL_BRIDGE_CLEARANCE, ground(px, pz)) : ground(px, pz)
  }
  const dry = (px: number, pz: number): boolean => !surfaceAt(px, pz).wet
  // Above the sea, off its own earlier legs (all but the stretch just behind
  // it) and off every other road, once away from the one it leaves.
  const clear = (px: number, pz: number): boolean => {
    if (ground(px, pz) <= seaLevel || slopeAt(field, px, pz).steep > CLIMB_STEEPEST) return false
    const skipping = length < skip.to + CLIMB_SELF_KEEP.after
    for (let i = 0; i < points.length && along[i]! < length - CLIMB_SELF_KEEP.behind; i++) {
      if (skipping && along[i]! >= skip.from && along[i]! <= skip.to) continue
      if (hypot(points[i]!.x - px, points[i]!.z - pz) < CLIMB_SELF_KEEP.apart) return false
    }
    if (hypot(px - start.x, pz - start.z) < CLIMB_START.clear) return true
    return nearestRoad(others, px, pz) >= CLIMB_ROAD_KEEP
  }
  // A step to a spot, the road following the ground there as far as its grade allows.
  const step = (sx: number, sz: number): void => {
    const run = hypot(sx - x, sz - z)
    length += run
    x = sx
    z = sz
    const most = MAX_CLIMB_GRADE * run
    y = hypot(x - start.x, z - start.z) < CLIMB_START.level ? start.y : Math.min(Math.max(bed(x, z), y - most), y + most)
    points.push({ x, y, z })
    along.push(length)
  }
  // The hairpin loop from here that best brings the road back to the ground
  // a road's spacing further up, or `null` where none is clear: half an ellipse
  // carrying on along the slope the way the road is heading and curving
  // back up it, drawn out on ahead as far as the road needs to climb the
  // difference at its grade.
  const loopFrom = (): Spot[] | null => {
    const lie = slopeAt(field, x, z, CLIMB_HAIRPIN.up / 2)
    if (lie.steep === 0) return null
    // On along the slope the way the road was bound, and up it.
    const on = { x: -lie.uz * side, z: lie.ux * side }
    const upX = lie.ux
    const upZ = lie.uz
    const up = CLIMB_HAIRPIN.up
    let best: { loop: Spot[]; mismatch: number } | null = null
    for (const out of CLIMB_HAIRPIN.outs) {
      const loop: Spot[] = []
      let run = 0
      let clean = true
      for (let k = 1; k <= CLIMB_HAIRPIN.samples; k++) {
        const t = (k / CLIMB_HAIRPIN.samples) * Math.PI
        const ahead = out * sine(t)
        const rise = (up / 2) * (1 - cosine(t))
        const spot = { x: x + on.x * ahead + upX * rise, z: z + on.z * ahead + upZ * rise }
        if (!dry(spot.x, spot.z) || !clear(spot.x, spot.z)) {
          clean = false
          break
        }
        const last = loop.at(-1) ?? { x, z }
        run += hypot(spot.x - last.x, spot.z - last.z)
        loop.push(spot)
      }
      if (!clean) continue
      const end = loop.at(-1)!
      // How far above the road, climbing at its grade round the loop, the ground stands where the loop ends.
      const mismatch = ground(end.x, end.z) - (y + run * MAX_CLIMB_GRADE)
      if (Math.abs(mismatch) <= CLIMB_HAIRPIN.mismatch) return loop
      if (Math.abs(mismatch) <= CLIMB_HAIRPIN.misfit && (best === null || Math.abs(mismatch) < Math.abs(best.mismatch))) best = { loop, mismatch }
    }
    return best?.loop ?? null
  }
  // The far bank of a stream straight ahead, where it is near enough to bridge.
  const bankAhead = (): Spot | null => {
    if (dx === 0 && dz === 0) return null
    for (let k = 2; k <= CLIMB_FORD.steps; k++) {
      const spot = { x: x + dx * CLIMB_STEP * k, z: z + dz * CLIMB_STEP * k }
      if (!clear(spot.x, spot.z)) return null
      if (dry(spot.x, spot.z)) return spot
    }
    return null
  }
  const open = (px: number, pz: number): boolean => dry(px, pz) && clear(px, pz)
  while (length < CLIMB_MOST_LENGTH) {
    if (y >= peak.y - CLIMB_END.belowPeak) return points
    const lie = slopeAt(field, x, z)
    const gentle = lie.steep <= CLIMB_GRADE * CLIMB_STRAIGHT
    let nx: number
    let nz: number
    if (gentle) {
      // Gentle enough to head straight up, or for the peak where there is no up to speak of.
      if (lie.steep < CLIMB_GRADE / 3) {
        const reach = hypot(peak.x - x, peak.z - z) || 1
        nx = (peak.x - x) / reach
        nz = (peak.z - z) / reach
      } else {
        nx = lie.ux
        nz = lie.uz
      }
    } else {
      // Along the slope, turned up it as far as climbs at the road's grade,
      // and a little more or less to bring the road back to the ground where
      // it has parted from it: less, or a little down, where the ground stands above the road.
      const correction = (CLIMB_STEER * (y - ground(x, z))) / (lie.steep * CLIMB_STEP)
      const rise = Math.min(Math.max(CLIMB_GRADE / lie.steep + correction, CLIMB_DIP), 1)
      const along = Math.sqrt(1 - rise * rise)
      nx = -lie.uz * side * along + lie.ux * rise
      nz = lie.ux * side * along + lie.uz * rise
    }
    if (length < CLIMB_START.leave) {
      // Off the arterial at a fair angle, whichever way along it the leg is bound.
      const tx = -start.awayZ
      const tz = start.awayX
      const bound = nx * tx + nz * tz < 0 ? -1 : 1
      if (Math.abs(nx * tx + nz * tz) > CLIMB_START.cos) {
        nx = tx * bound * CLIMB_START.cos + start.awayX * CLIMB_START.sin
        nz = tz * bound * CLIMB_START.cos + start.awayZ * CLIMB_START.sin
      }
    }
    let next = { x: x + nx * CLIMB_STEP, z: z + nz * CLIMB_STEP }
    if (!dry(next.x, next.z) && clear(next.x, next.z)) {
      // A stream: straight over to the far bank, holding the heading, where it is near enough.
      const bank = bankAhead()
      if (bank !== null) {
        const count = Math.round(hypot(bank.x - x, bank.z - z) / CLIMB_STEP)
        for (let k = 1; k <= count; k++) step(x + dx * CLIMB_STEP, z + dz * CLIMB_STEP)
        continue
      }
    }
    if (gentle && !open(next.x, next.z)) {
      // Round whatever is in the way on the flat, turning as little as will do.
      for (const turn of CLIMB_TURNS) {
        const tx = nx * cosine(turn) - nz * sine(turn)
        const tz = nx * sine(turn) + nz * cosine(turn)
        const spot = { x: x + tx * CLIMB_STEP, z: z + tz * CLIMB_STEP }
        if (!open(spot.x, spot.z)) continue
        nx = tx
        nz = tz
        next = spot
        break
      }
    }
    // A road cannot double back on itself: where the way on would, it is barred too.
    const ahead = open(next.x, next.z) && nx * dx + nz * dz > -0.5
    if (!ahead) {
      const found = loopFrom()
      if (found === null || ++hairpins > CLIMB_MOST_HAIRPINS) return y - start.y >= CLIMB_END.rise ? points : null
      skip = { from: length - CLIMB_SELF_KEEP.into, to: 0 }
      for (const spot of found) step(spot.x, spot.z)
      skip.to = length
      side = -side
      dx = 0
      dz = 0
      continue
    }
    dx = nx
    dz = nz
    step(next.x, next.z)
  }
  return y - start.y >= CLIMB_END.rise ? points : null
}

/**
 * Where a climb up to this peak may leave the arterials: their at-grade
 * points nearest the peak, well below it, a few of them apart from one
 * another, each with the way off the road toward the peak.
 */
function startsFor(field: Heightfield, arterials: Road[], peak: Peak): Start[] {
  const candidates: { start: Start; distance: number }[] = []
  for (const road of arterials) {
    const { points, structure } = road
    for (let i = 1; i < points.length - 1; i++) {
      if (structure[i - 1] !== ROAD_GRADE || structure[i] !== ROAD_GRADE) continue
      const point = points[i]!
      const distance = hypot(point.x - peak.x, point.z - peak.z)
      if (distance >= CLIMB_START.reach || point.y >= peak.y - CLIMB_START.below) continue
      const before = points[i - 1]!
      const after = points[i + 1]!
      const run = hypot(after.x - before.x, after.z - before.z) || 1
      // Square off the road, on the peak's side of it.
      let awayX = -(after.z - before.z) / run
      let awayZ = (after.x - before.x) / run
      if (awayX * (peak.x - point.x) + awayZ * (peak.z - point.z) < 0) {
        awayX = -awayX
        awayZ = -awayZ
      }
      // A start at a gentle foot is worth one nearer the peak: the road leaves the arterial in a cutting otherwise.
      const bank = sampleTerrain(field, point.x + awayX * CLIMB_START.leave, point.z + awayZ * CLIMB_START.leave) - point.y
      candidates.push({ start: { x: point.x, y: point.y, z: point.z, awayX, awayZ }, distance: distance + Math.max(bank, 0) * CLIMB_START.bankCost })
    }
  }
  candidates.sort((a, b) => a.distance - b.distance)
  const starts: Start[] = []
  for (const { start } of candidates) {
    if (starts.length >= CLIMB_START.tries) break
    if (starts.every((other) => hypot(other.x - start.x, other.z - start.z) >= CLIMB_START.apart)) starts.push(start)
  }
  return starts
}

/**
 * The lot a climb ends in, or `null` where there is no view, it would be
 * wet, or the road's own lower turns lie under it: its width along the
 * way the road arrives, its depth down the slope toward the view, the road
 * running in along its uphill side, and its level that of the road where
 * it enters.
 */
function lotAtEnd(field: Heightfield, surfaceAt: Surface, line: RoadPoint[]): Lot | null {
  const end = line.at(-1)!
  const back = line[Math.max(line.length - 5, 0)]!
  const run = hypot(end.x - back.x, end.z - back.z)
  if (run === 0) return null
  const tx = (end.x - back.x) / run
  const tz = (end.z - back.z) / run
  // The valley is whichever side of the road the ground has fallen away on, out beyond the lot.
  const left = sampleTerrain(field, end.x - tz * CLIMB_LOT.look, end.z + tx * CLIMB_LOT.look)
  const right = sampleTerrain(field, end.x + tz * CLIMB_LOT.look, end.z - tx * CLIMB_LOT.look)
  if (Math.min(left, right) > end.y - CLIMB_LOT.drop) return null
  const downhill = left < right ? 1 : -1
  const ux = tx * downhill
  const uz = tz * downhill
  const vx = -uz
  const vz = ux
  const x = end.x + vx * (CLIMB_LOT.depth / 2 - CLIMB_LOT.roadIn)
  const z = end.z + vz * (CLIMB_LOT.depth / 2 - CLIMB_LOT.roadIn)
  // Dry throughout, and out to where the ground is blended back.
  const reachU = CLIMB_LOT.width / 2 + CLIMB_LOT.blend
  const reachV = CLIMB_LOT.depth / 2 + CLIMB_LOT.blend
  for (let u = -reachU; u <= reachU; u += CLIMB_STEP / 2) {
    for (let v = -reachV; v <= reachV; v += CLIMB_STEP / 2) {
      if (surfaceAt(x + ux * u + vx * v, z + uz * u + vz * v).wet) return null
    }
  }
  // Only the road's last stretch, running in, may lie within the lot or the ground blended back to it.
  let along = 0
  for (let i = line.length - 1; i > 0; i--) {
    along += hypot(line[i]!.x - line[i - 1]!.x, line[i]!.z - line[i - 1]!.z)
    if (along <= CLIMB_LOT.approach) continue
    const point = line[i - 1]!
    const u = (point.x - x) * ux + (point.z - z) * uz
    const v = (point.x - x) * vx + (point.z - z) * vz
    if (Math.abs(u) < reachU && Math.abs(v) < reachV) return null
  }
  // Level from where the road enters the lot.
  let entry = line.length - 1
  along = 0
  while (entry > 0 && along < CLIMB_LOT.roadAlong) {
    along += hypot(line[entry]!.x - line[entry - 1]!.x, line[entry]!.z - line[entry - 1]!.z)
    entry--
  }
  return { x, y: line[entry]!.y, z, yaw: exact.atan2(-uz, ux), width: CLIMB_LOT.width, depth: CLIMB_LOT.depth }
}

/** Put a climb's last stretch, within its lot, at the lot's level, ahead of the road being bedded. */
function levelOnLot(climb: Road): void {
  const { lot, points } = climb
  if (lot === undefined) return
  const ux = cosine(lot.yaw)
  const uz = -sine(lot.yaw)
  for (const point of points) {
    const u = Math.abs((point.x - lot.x) * ux + (point.z - lot.z) * uz)
    const v = Math.abs((point.x - lot.x) * -uz + (point.z - lot.z) * ux)
    if (u < lot.width / 2 && v < lot.depth / 2) point.y = lot.y
  }
}

/** Put a bedded climb's points about its lot on the ground as it now is, the lot terraced in once more. */
export function seatAboutLot(field: Heightfield, climb: Road): void {
  const { lot, points } = climb
  if (lot === undefined) return
  const reach = hypot(lot.width, lot.depth) / 2 + CLIMB_LOT.blend + CLIMB_WIDTH
  for (const point of points) {
    if (hypot(point.x - lot.x, point.z - lot.z) < reach) point.y = sampleTerrain(field, point.x, point.z)
  }
}

/**
 * Level the ground under a lot to its height, blended back to the ground
 * around it over `blend` metres out from its edges, but for the ground
 * under the road running in, which is left as the road has shaped it.
 */
export function terrace(field: Heightfield, lot: Lot, blend: number, road: RoadPoint[]): void {
  const { width, depth, cellSize, heights } = field
  const ux = cosine(lot.yaw)
  const uz = -sine(lot.yaw)
  const vx = -uz
  const vz = ux
  const reach = hypot(lot.width, lot.depth) / 2 + blend
  const corridor = CLIMB_WIDTH / 2 + cellSize
  const near = road.filter((point) => hypot(point.x - lot.x, point.z - lot.z) < reach + corridor)
  const colFrom = Math.max(Math.floor((lot.x - reach) / cellSize), 0)
  const colTo = Math.min(Math.ceil((lot.x + reach) / cellSize), width - 1)
  const rowFrom = Math.max(Math.floor((lot.z - reach) / cellSize), 0)
  const rowTo = Math.min(Math.ceil((lot.z + reach) / cellSize), depth - 1)
  for (let row = rowFrom; row <= rowTo; row++) {
    for (let col = colFrom; col <= colTo; col++) {
      const dx = col * cellSize - lot.x
      const dz = row * cellSize - lot.z
      const along = Math.abs(dx * ux + dz * uz) - lot.width / 2
      const across = Math.abs(dx * vx + dz * vz) - lot.depth / 2
      const out = Math.max(along, across, 0)
      if (out >= blend) continue
      if (out > 0 && near.some((point) => hypot(point.x - col * cellSize, point.z - row * cellSize) < corridor)) continue
      const cell = row * width + col
      const keep = smoothstep(0, blend, out)
      heights[cell] = lot.y * (1 - keep) + heights[cell]! * keep
    }
  }
}

/** A climb up the highest mountain an arterial comes near enough to, if the slope will take one. */
export function buildClimbs(
  field: Heightfield,
  seaLevel: number,
  mountains: Mountain[],
  roads: Road[],
  surfaceAt: Surface,
  nextId: number,
): Road[] {
  const climbs: Road[] = []
  const arterials = roads.filter((road) => road.kind === 'arterial')
  const peaks = mountains
    .map((mountain) => peakOf(field, mountain))
    .filter((peak): peak is Peak => peak !== null)
    .sort((a, b) => b.y - a.y)
  for (const peak of peaks) {
    if (climbs.length >= CLIMBS_MOST) break
    let line: RoadPoint[] | null = null
    let from: Start | null = null
    for (const start of startsFor(field, arterials, peak)) {
      // The first leg heads the way that leads away from the arterial, or failing that the other way.
      const lie = slopeAt(field, start.x, start.z)
      const away = -lie.uz * start.awayX + lie.ux * start.awayZ < 0 ? -1 : 1
      for (const side of [away, -away]) {
        line = traceClimb(field, seaLevel, surfaceAt, roads, start, side, peak)
        if (line !== null && line.length >= 3) break
        line = null
      }
      if (line !== null) {
        from = start
        break
      }
    }
    if (line === null || from === null) continue
    // Back to the highest point on a shoulder gentle enough to park on, clear of other roads, where the lot is dry.
    let lot: Lot | null = null
    for (let end = line.length - 1; end > 0 && line[end]!.y - from.y >= CLIMB_END.rise; end--) {
      const at = line[end]!
      const { steep } = slopeAt(field, at.x, at.z, CLIMB_END.across)
      if (steep < CLIMB_END.steepLeast || steep > CLIMB_END.steep) continue
      if (nearestRoad(roads, at.x, at.z) < CLIMB_END.roadKeep) continue
      lot = lotAtEnd(field, surfaceAt, line.slice(0, end + 1))
      if (lot !== null) {
        line = line.slice(0, end + 1)
        break
      }
    }
    if (lot === null) continue
    const structure = new Uint8Array(line.length - 1)
    for (let i = 0; i < structure.length; i++) {
      const wet = surfaceAt(line[i]!.x, line[i]!.z).wet || surfaceAt(line[i + 1]!.x, line[i + 1]!.z).wet
      structure[i] = wet ? ROAD_BRIDGE : ROAD_GRADE
    }
    const climb: Road = { id: nextId + climbs.length, kind: 'climb', closed: false, width: CLIMB_WIDTH, points: line, structure, lot }
    levelOnLot(climb)
    climbs.push(climb)
  }
  return climbs
}
