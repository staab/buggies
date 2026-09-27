import { uprightRotation, v3, vdistance, vlength, type Vec3 } from '@buggies/physics'
import { ROAD_GRADE, ROAD_TUNNEL, atHeight, upOf, type World, type WorldRoad } from '@buggies/terrain'
import type { VehicleSpawn } from '@buggies/vehicle'

/** Nose to tail along the road, with room to pull out, and side to side, two abreast. */
const SPAWN_SPACING = 9
const SPAWN_ABREAST = 5

/** How far along a road to look for the next point when facing a vehicle. */
const FACING_REACH = 3

/** A sample of a road: the point, and where along the road it is. */
export interface RoadSpot {
  road: WorldRoad
  index: number
  point: Vec3
}


/** A spawn at a point, standing upright there and facing along this way. */
export function spawnHere(position: Vec3, forward: Vec3): VehicleSpawn {
  const up = upOf(position)
  return { position: v3(position.x, position.y, position.z), up, rotation: uprightRotation(up, forward) }
}

/** A road's point, wrapped around a loop or held at an end. */
function pointOf(road: WorldRoad, i: number): Vec3 {
  const count = road.points.length
  return road.points[road.closed ? ((i % count) + count) % count : Math.min(Math.max(i, 0), count - 1)]!
}

function spawnAt(spot: RoadSpot): VehicleSpawn {
  const { road, index, point } = spot
  const ahead = pointOf(road, index + FACING_REACH)
  return spawnHere(point, v3(ahead.x - point.x, ahead.y - point.y, ahead.z - point.z))
}

/** A spawn at a spot, facing whichever way along the road is nearer to `forward`. */
export function spawnFacing(spot: RoadSpot, forward: Vec3): VehicleSpawn {
  const { road, index, point } = spot
  const ahead = pointOf(road, index + FACING_REACH)
  const behind = pointOf(road, index - FACING_REACH)
  let way = v3(ahead.x - point.x, ahead.y - point.y, ahead.z - point.z)
  if (way.x * forward.x + way.y * forward.y + way.z * forward.z < 0) way = v3(point.x - behind.x, point.y - behind.y, point.z - behind.z)
  if (vlength(way) < 1e-6) return spawnAt(spot)
  return spawnHere(point, way)
}

/** The road point nearest a position, on any road that is not a tunnel. */
export function nearestRoadSpotTo(planet: World, at: Vec3): RoadSpot | null {
  let best: RoadSpot | null = null
  let bestDistance = Infinity
  for (const road of planet.roads) {
    const segmentCount = road.closed ? road.points.length : road.points.length - 1
    for (const [i, point] of road.points.entries()) {
      if (i >= segmentCount) break
      if (road.structure[i] === ROAD_TUNNEL) continue
      const distance = vdistance(point, at)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = { road, index: i, point }
    }
  }
  return best
}

/**
 * The road point nearest the middle of the first city, at grade: on the
 * highway for preference, which loops and so never runs out ahead of a car
 * setting off, and on any road only where there is no highway to be had.
 */
function nearestGradeSpot(planet: World): RoadSpot | null {
  const highways = planet.roads.filter((road) => road.kind === 'highway')
  return nearestGradeSpotOn(planet, highways) ?? nearestGradeSpotOn(planet, planet.roads)
}

function nearestGradeSpotOn(planet: World, roads: readonly WorldRoad[]): RoadSpot | null {
  const target = atHeight(planet, planet.districts[0]?.center ?? { x: 0, y: 0, z: 1 }, 0)
  let best: RoadSpot | null = null
  let bestDistance = Infinity
  for (const road of roads) {
    const segmentCount = road.closed ? road.points.length : road.points.length - 1
    for (const [i, point] of road.points.entries()) {
      if (i >= segmentCount) break
      if (road.structure[i] !== ROAD_GRADE) continue
      const distance = vdistance(point, target)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = { road, index: i, point }
    }
  }
  return best
}

/**
 * Points along a road from a starting index, one every `spacing` meters,
 * walking in one direction until the road ends or leaves the ground. Road
 * points can be centimeters apart, so distance is measured, not counted.
 */
function spotsAlong(from: RoadSpot, spacing: number, step: 1 | -1, wanted: number): RoadSpot[] {
  const { road } = from
  const segmentCount = road.closed ? road.points.length : road.points.length - 1
  const spots: RoadSpot[] = []
  let traveled = 0
  let index = from.index
  let point = from.point
  while (spots.length < wanted) {
    const next = index + step
    if (next < 0 || next >= segmentCount) break
    if (road.structure[Math.min(index, next)] !== ROAD_GRADE) break
    const ahead = road.points[next]
    if (ahead === undefined) break
    traveled += vdistance(ahead, point)
    index = next
    point = ahead
    if (traveled < spacing) continue
    spots.push({ road, index, point })
    traveled = 0
  }
  return spots
}

/**
 * Somewhere worth starting, for each of `count` vehicles: on a road, at
 * grade, as near the middle of the first city as one runs, lined up one
 * behind the other. Cities are where the map is densest, so that is the most
 * interesting place to be dropped.
 */
export function findSpawns(planet: World, count: number): VehicleSpawn[] {
  const first = nearestGradeSpot(planet)
  if (first === null) {
    // No road at all: side by side on the ground over the middle of the first city.
    const middle = planet.districts[0]?.center ?? { x: 0, y: 0, z: 1 }
    return Array.from({ length: count }, () => spawnHere(atHeight(planet, middle, planet.seaLevel + 1), { x: 1, y: 0, z: 0 }))
  }

  // Two abreast, staggered a half length apart, behind the first spot for
  // preference, so the front car is the one nearest the city; ahead of it
  // when the road behind runs out.
  const half = SPAWN_SPACING / 2
  const behind = spotsAlong(first, half, -1, count - 1)
  const ahead = spotsAlong(first, half, 1, count - 1 - behind.length)
  const lined = [
    spawnAside(first, 0),
    ...behind.map((spot, i) => spawnAside(spot, i + 1)),
    ...ahead.map((spot, i) => spawnAside(spot, i + 1)),
  ]
  // A road too short for the field seats the rest on the nearest road spots clear of everyone.
  if (lined.length < count) lined.push(...clearSpots(planet, first, lined, count - lined.length))
  while (lined.length < count) lined.push(lined.at(-1) ?? spawnAt(first))
  return lined
}

/** A spawn at a spot, in the lane its place in the line puts it in: the right for even places, the left for odd. */
function spawnAside(spot: RoadSpot, place: number): VehicleSpawn {
  const spawn = spawnAt(spot)
  const { road, index, point } = spot
  const next = road.points[Math.min(index + 1, road.points.length - 1)]!
  const prev = road.points[Math.max(index - 1, 0)]!
  const up = spawn.up
  // Across the road: its run crossed with the way up.
  const tx = next.x - prev.x
  const ty = next.y - prev.y
  const tz = next.z - prev.z
  const ax = ty * up.z - tz * up.y
  const ay = tz * up.x - tx * up.z
  const az = tx * up.y - ty * up.x
  const length = Math.sqrt(ax * ax + ay * ay + az * az) || 1
  const aside = Math.min((road.widths[index] ?? SPAWN_ABREAST) / 4, SPAWN_ABREAST / 2) * (place % 2 === 0 ? 1 : -1)
  return { ...spawn, position: v3(point.x + (ax / length) * aside, point.y + (ay / length) * aside, point.z + (az / length) * aside) }
}

/** Spots at grade on any road, nearest the first, each a spawn's length clear of the others and of those already had. */
function clearSpots(planet: World, first: RoadSpot, had: VehicleSpawn[], wanted: number): VehicleSpawn[] {
  const candidates: { spot: RoadSpot; distance: number }[] = []
  for (const road of planet.roads) {
    const segmentCount = road.closed ? road.points.length : road.points.length - 1
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const point = road.points[i]!
      candidates.push({ spot: { road, index: i, point }, distance: vdistance(point, first.point) })
    }
  }
  candidates.sort((a, b) => a.distance - b.distance)
  const forward = forwardOf(had[0])
  const found: VehicleSpawn[] = []
  const taken = [...had]
  for (const { spot } of candidates) {
    if (found.length >= wanted) break
    if (taken.some(({ position }) => vdistance(position, spot.point) < SPAWN_SPACING)) continue
    const spawn = spawnFacing(spot, forward)
    found.push(spawn)
    taken.push(spawn)
  }
  return found
}

/** The way a spawn faces: its turn's -z, as a car faces its own -z. */
export function forwardOf(spawn: VehicleSpawn | undefined): Vec3 {
  if (spawn === undefined) return v3(0, 0, -1)
  const { x, y, z, w } = spawn.rotation
  return v3(-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y)))
}
