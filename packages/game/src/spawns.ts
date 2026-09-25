import * as exact from '@buggies/physics'
import { ROAD_GRADE, ROAD_TUNNEL, roadLift, type Road, type RoadPoint, type TerrainMap } from '@buggies/terrain'
import type { VehicleSpawn } from '@buggies/vehicle'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2, hypot } = exact

/** Nose to tail along the road, with room to pull out. */
const SPAWN_SPACING = 9

/** How far along a road to look for the next point when facing a vehicle. */
const FACING_REACH = 3

/** A sample of a road: the point, and where along the road it is. */
export interface RoadSpot {
  road: Road
  index: number
  point: RoadPoint
}

function spawnAt(spot: RoadSpot): VehicleSpawn {
  const { road, index, point } = spot
  const count = road.points.length
  const ahead = road.points[Math.min(index + FACING_REACH, count - 1)] ?? point
  return {
    position: { x: point.x, y: point.y + roadLift(road), z: point.z },
    // A chassis faces its own -Z, so a yaw of zero looks down -Z too.
    yaw: atan2(-(ahead.x - point.x), -(ahead.z - point.z)),
  }
}

/** A spawn at a spot, facing whichever way along the road is nearer to `forward`. */
export function spawnFacing(spot: RoadSpot, forward: { x: number; z: number }): VehicleSpawn {
  const { road, index, point } = spot
  const count = road.points.length
  // Wrapped around a loop or held at an end, so always one of the road's points.
  const at = (i: number): RoadPoint =>
    road.points[road.closed ? ((i % count) + count) % count : Math.min(Math.max(i, 0), count - 1)]!
  const ahead = at(index + FACING_REACH)
  const behind = at(index - FACING_REACH)
  let dx = ahead.x - point.x
  let dz = ahead.z - point.z
  if (dx * forward.x + dz * forward.z < 0) {
    dx = point.x - behind.x
    dz = point.z - behind.z
  }
  if (hypot(dx, dz) < 1e-6) return spawnAt(spot)
  return {
    position: { x: point.x, y: point.y + roadLift(road), z: point.z },
    yaw: atan2(-dx, -dz),
  }
}

/** The road point nearest a position, on any road that is not a tunnel. */
export function nearestRoadSpotTo(map: TerrainMap, x: number, z: number): RoadSpot | null {
  let best: RoadSpot | null = null
  let bestDistance = Infinity
  for (const road of map.roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (const [i, point] of road.points.entries()) {
      if (i >= segmentCount) break
      if (road.structure[i] === ROAD_TUNNEL) continue
      const distance = hypot(point.x - x, point.z - z)
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
function nearestGradeSpot(map: TerrainMap): RoadSpot | null {
  const highways = map.roads.filter((road) => road.kind === 'highway')
  return nearestGradeSpotOn(map, highways) ?? nearestGradeSpotOn(map, map.roads)
}

function nearestGradeSpotOn(map: TerrainMap, roads: Road[]): RoadSpot | null {
  const worldSize = map.size * map.cellSize
  const district = map.districts[0]
  const targetX = district?.cx ?? worldSize / 2
  const targetZ = district?.cz ?? worldSize / 2

  let best: RoadSpot | null = null
  let bestDistance = Infinity
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (const [i, point] of road.points.entries()) {
      if (i >= segmentCount) break
      if (road.structure[i] !== ROAD_GRADE) continue
      const distance = hypot(point.x - targetX, point.z - targetZ)
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
    traveled += hypot(ahead.x - point.x, ahead.z - point.z)
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
export function findSpawns(map: TerrainMap, count: number): VehicleSpawn[] {
  const first = nearestGradeSpot(map)
  if (first === null) {
    const worldSize = map.size * map.cellSize
    const middle = { x: worldSize / 2, y: 0, z: worldSize / 2 }
    return Array.from({ length: count }, (_, i) => ({
      position: { ...middle, z: middle.z + i * SPAWN_SPACING },
      yaw: 0,
    }))
  }

  // Behind the first spot for preference, so the front car is the one nearest
  // the city; ahead of it when the road behind runs out.
  const spots = [first, ...spotsAlong(first, SPAWN_SPACING, -1, count - 1)]
  spots.push(...spotsAlong(first, SPAWN_SPACING, 1, count - spots.length))
  // A road too short for the field stacks the rest on its last spot rather
  // than leaving seats with nowhere to be.
  while (spots.length < count) spots.push(spots.at(-1) ?? first)
  return spots.map(spawnAt)
}
