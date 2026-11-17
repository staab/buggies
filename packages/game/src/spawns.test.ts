import { createRng, vdistance, type Vec3 } from '@buggies/physics'
import { ROAD_TUNNEL, generateWorld, overSurface, randomDirection, upOf, worldId, type World, type WorldRoad } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { nearestRoadSpotTo } from './spawns.ts'

/** A world of roads to look about, and one of no roads at all. */
const WORLDS = [worldId(7, 'jupiter'), worldId(7, 'moon')]

const made = new Map<number, World>()
function worldOf(id: number): World {
  const known = made.get(id)
  if (known !== undefined) return known
  const fresh = generateWorld(id)
  made.set(id, fresh)
  return fresh
}

/**
 * The road point nearest a place, found by looking at every point of every
 * road in turn: what the search is measured against. Of two points as near, the
 * one first along the world's roads is the one.
 */
function scanned(world: World, at: Vec3): { road: WorldRoad; index: number } | null {
  let best: { road: WorldRoad; index: number } | null = null
  let nearest = Infinity
  for (const road of world.roads) {
    const segments = road.closed ? road.points.length : road.points.length - 1
    for (let index = 0; index < segments; index++) {
      if (road.structure[index] === ROAD_TUNNEL) continue
      const away = vdistance(road.points[index]!, at)
      if (away >= nearest) continue
      nearest = away
      best = { road, index }
    }
  }
  return best
}

/** Places spread over a world: its districts' middles, points on its roads, and points out at random over its ground and above it. */
function places(world: World): Vec3[] {
  const found: Vec3[] = []
  for (const district of world.districts) for (const rise of [0, 3]) found.push(overSurface(world, district.center, rise))
  for (const road of world.roads) for (let index = 0; index < road.points.length; index += 5) found.push(road.points[index]!)
  const rng = createRng(7)
  for (let draw = 0; draw < 300; draw++) {
    const direction = randomDirection(rng)
    for (const rise of [0, 2, 30, 200]) found.push(overSurface(world, upOf(direction), rise))
  }
  return found
}

describe('the road points of a world', () => {
  beforeAll(() => {
    for (const id of WORLDS) worldOf(id)
  }, 60_000)

  it('finds the nearest road point to any place, the same one a look at every point of every road finds', () => {
    for (const id of WORLDS) {
      const world = worldOf(id)
      const places_ = places(world)
      expect(places_.length).toBeGreaterThan(300)
      for (const at of places_) {
        const found = nearestRoadSpotTo(world, at)
        const wanted = scanned(world, at)
        expect(found === null ? null : { road: found.road, index: found.index }, `nearest road point to ${at.x.toFixed(0)},${at.y.toFixed(0)},${at.z.toFixed(0)} of ${world.kind}`).toEqual(wanted)
      }
    }
  })

  it('stands a place on a road on that road, and finds no road on a world that has none', () => {
    const world = worldOf(WORLDS[0]!)
    expect(world.roads.length).toBeGreaterThan(0)
    for (const road of world.roads) {
      const point = road.points[Math.floor(road.points.length / 2)]!
      const spot = nearestRoadSpotTo(world, point)
      expect(spot).not.toBeNull()
      expect(vdistance(spot!.point, point)).toBeLessThan(1e-6)
    }
    const bare = worldOf(WORLDS[1]!)
    expect(bare.roads).toHaveLength(0)
    expect(nearestRoadSpotTo(bare, overSurface(bare, bare.districts[0]?.center ?? { x: 0, y: 1, z: 0 }, 0))).toBeNull()
  })
})
