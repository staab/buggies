import { beforeAll, describe, expect, it } from 'vitest'

import { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB } from './districts.ts'
import { generateTerrain } from './generate.ts'
import { sampleHeight } from './heightfield.ts'
import type { Building, Road, TerrainMap } from './types.ts'

let map: TerrainMap

function districtAt(x: number, z: number): number {
  const { width, cellSize } = map.heightfield
  return map.districtOf[Math.floor(z / cellSize) * width + Math.floor(x / cellSize)]!
}

/** The corners of a footprint, its centre and the middle of each side. */
function samples(building: Building): { x: number; z: number }[] {
  const cos = Math.cos(building.yaw)
  const sin = Math.sin(building.yaw)
  const points: { x: number; z: number }[] = []
  for (const su of [-1, 0, 1]) {
    for (const sv of [-1, 0, 1]) {
      const u = (su * building.width) / 2
      const v = (sv * building.depth) / 2
      points.push({ x: building.x + u * cos + v * sin, z: building.z - u * sin + v * cos })
    }
  }
  return points
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax
  const vz = bz - az
  const lengthSq = vx * vx + vz * vz || 1
  const t = Math.min(Math.max(((px - ax) * vx + (pz - az) * vz) / lengthSq, 0), 1)
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
}

/** The nearest any road's carriageway comes to a point, as a fraction of its half width: under 1 is on the road. */
function roadCrowding(roads: Road[], x: number, z: number): number {
  let nearest = Infinity
  for (const road of roads) {
    const count = road.closed ? road.points.length : road.points.length - 1
    for (let i = 0; i < count; i++) {
      const a = road.points[i]!
      const b = road.points[(i + 1) % road.points.length]!
      if (Math.min(a.x, b.x) - 4 * road.width > x || Math.max(a.x, b.x) + 4 * road.width < x) continue
      if (Math.min(a.z, b.z) - 4 * road.width > z || Math.max(a.z, b.z) + 4 * road.width < z) continue
      nearest = Math.min(nearest, distanceToSegment(x, z, a.x, a.z, b.x, b.z) / (road.width / 2))
    }
  }
  return nearest
}

/** Whether two footprints overlap in plan, by the separating axis test. */
function overlap(a: Building, b: Building): boolean {
  const cornersOf = (building: Building): { x: number; z: number }[] =>
    samples(building).filter((_, k) => k === 0 || k === 2 || k === 6 || k === 8)
  const axes: { x: number; z: number }[] = []
  for (const building of [a, b]) {
    axes.push({ x: Math.cos(building.yaw), z: -Math.sin(building.yaw) })
    axes.push({ x: Math.sin(building.yaw), z: Math.cos(building.yaw) })
  }
  const cornersA = cornersOf(a)
  const cornersB = cornersOf(b)
  for (const axis of axes) {
    const project = (corners: { x: number; z: number }[]): [number, number] => {
      let low = Infinity
      let high = -Infinity
      for (const corner of corners) {
        const value = corner.x * axis.x + corner.z * axis.z
        low = Math.min(low, value)
        high = Math.max(high, value)
      }
      return [low, high]
    }
    const [lowA, highA] = project(cornersA)
    const [lowB, highB] = project(cornersB)
    if (highA <= lowB || highB <= lowA) return false
  }
  return true
}

describe('buildings and trees', () => {
  beforeAll(() => {
    map = generateTerrain(1)
  }, 60_000)

  it('fill the city blocks with buildings of many heights, tallest in the middle', () => {
    const blocks = map.buildings.filter((building) => building.kind === 'block')
    expect(blocks.length).toBeGreaterThan(200)
    for (const building of blocks) expect(districtAt(building.x, building.z)).toBe(DISTRICT_CITY)
    const heights = blocks.map((building) => building.top - building.bottom)
    expect(new Set(heights.map((height) => Math.round(height))).size).toBeGreaterThan(10)
    expect(Math.max(...heights)).toBeGreaterThan(30)
    expect(Math.min(...heights)).toBeGreaterThan(5)
    // The heart of a city rises above its edge.
    const rise = (building: Building): number => {
      const district = map.districts.reduce((best, candidate) =>
        Math.hypot(candidate.cx - building.x, candidate.cz - building.z) <
        Math.hypot(best.cx - building.x, best.cz - building.z)
          ? candidate
          : best,
      )
      return Math.hypot(district.cx - building.x, district.cz - building.z) / district.radius
    }
    const inner = blocks.filter((building) => rise(building) < 0.35)
    const outer = blocks.filter((building) => rise(building) > 0.7)
    expect(inner.length).toBeGreaterThan(10)
    expect(outer.length).toBeGreaterThan(10)
    const mean = (list: Building[]): number =>
      list.reduce((sum, building) => sum + building.top - building.bottom, 0) / list.length
    expect(mean(inner)).toBeGreaterThan(mean(outer) + 5)
  })

  it('line the arterials with houses through the suburbs and trees through the country', () => {
    const houses = map.buildings.filter((building) => building.kind === 'house')
    const suburban = houses.filter((house) => districtAt(house.x, house.z) === DISTRICT_SUBURB)
    const rural = houses.filter((house) => districtAt(house.x, house.z) === DISTRICT_COUNTRY)
    expect(suburban.length).toBeGreaterThan(50)
    expect(rural.length).toBeGreaterThan(5)
    expect(suburban.length + rural.length).toBe(houses.length)
    // Houses stand beside an arterial: near one, and nearer than to any road's half width.
    const arterials = map.roads.filter((road) => road.kind === 'arterial' || road.kind === 'cross')
    for (const house of houses) {
      const crowding = roadCrowding(arterials, house.x, house.z)
      expect(crowding).toBeGreaterThan(1)
      expect(crowding).toBeLessThan(8)
    }
    // And the country stretches of the arterials are lined with trees: walk
    // them, and most places along them have one close by.
    const trees = map.trees.filter((tree) => tree.kind === 'tree')
    let stretches = 0
    let lined = 0
    for (const road of arterials) {
      for (let i = 0; i + 1 < road.points.length; i += 8) {
        const point = road.points[i]!
        if (districtAt(point.x, point.z) !== DISTRICT_COUNTRY || road.structure[i] !== 0) continue
        stretches++
        if (trees.some((tree) => Math.hypot(tree.x - point.x, tree.z - point.z) < road.width / 2 + 16)) lined++
      }
    }
    expect(stretches).toBeGreaterThan(20)
    expect(lined).toBeGreaterThan(stretches * 0.7)
  })

  it('wood the open country and the foothills, and leave the heights bare', () => {
    const trees = map.trees.filter((tree) => tree.kind === 'tree')
    const shrubs = map.trees.filter((tree) => tree.kind === 'shrub')
    const farFromRoads = (standing: { x: number; z: number }): boolean =>
      roadCrowding(map.roads, standing.x, standing.z) > 8 || roadCrowding(map.roads, standing.x, standing.z) === Infinity
    const wildTrees = trees.filter((tree) => districtAt(tree.x, tree.z) === DISTRICT_COUNTRY && farFromRoads(tree))
    const wildShrubs = shrubs.filter((shrub) => districtAt(shrub.x, shrub.z) === DISTRICT_COUNTRY && farFromRoads(shrub))
    expect(wildTrees.length).toBeGreaterThan(500)
    expect(wildShrubs.length).toBeGreaterThan(500)

    // The foothills are planted: the ground round each mountain that has
    // begun to rise but is nowhere near the crest.
    const peak = Math.max(...map.mountains.map((mountain) => mountain.height))
    const foot = (standing: { x: number; z: number }): number =>
      map.mountains.reduce((best, mountain) => {
        const fromCentre = Math.hypot(
          (mountain.ax + mountain.bx + mountain.cx) / 3 - standing.x,
          (mountain.az + mountain.bz + mountain.cz) / 3 - standing.z,
        )
        return Math.min(best, fromCentre)
      }, Infinity)
    const climbing = trees.filter(
      (tree) => sampleHeight(map.heightfield, tree.x, tree.z) > map.seaLevel + peak * 0.12 && foot(tree) < 400,
    )
    expect(climbing.length).toBeGreaterThan(100)
    // But nothing stands on the bare upper slopes.
    let highest = -Infinity
    for (const height of map.heightfield.heights) highest = Math.max(highest, height)
    for (const tree of trees) {
      expect(sampleHeight(map.heightfield, tree.x, tree.z)).toBeLessThan(map.seaLevel + 0.66 * (highest - map.seaLevel))
    }
  })

  it('plant the parks between the city blocks and the gardens round the houses', () => {
    const parks = map.trees.filter((tree) => districtAt(tree.x, tree.z) === DISTRICT_CITY)
    const gardens = map.trees.filter((tree) => districtAt(tree.x, tree.z) === DISTRICT_SUBURB)
    expect(parks.filter((tree) => tree.kind === 'tree').length).toBeGreaterThan(30)
    expect(parks.filter((tree) => tree.kind === 'shrub').length).toBeGreaterThan(30)
    expect(gardens.filter((tree) => tree.kind === 'tree').length).toBeGreaterThan(30)
    expect(gardens.filter((tree) => tree.kind === 'shrub').length).toBeGreaterThan(30)
    // Most houses have a shrub or two out front.
    const houses = map.buildings.filter((building) => building.kind === 'house')
    const shrubs = map.trees.filter((tree) => tree.kind === 'shrub')
    const planted = houses.filter((house) =>
      shrubs.some((shrub) => Math.hypot(house.x - shrub.x, house.z - shrub.z) < 12),
    )
    expect(planted.length).toBeGreaterThan(houses.length * 0.7)
  })

  it('keep every building and tree off every road and out of the water', () => {
    for (const building of map.buildings) {
      for (const point of samples(building)) {
        expect(roadCrowding(map.roads, point.x, point.z)).toBeGreaterThan(1)
        expect(sampleHeight(map.heightfield, point.x, point.z)).toBeGreaterThan(map.seaLevel)
      }
      // Standing on the ground, not floating above it or lost in it.
      expect(building.bottom).toBeLessThan(sampleHeight(map.heightfield, building.x, building.z))
      expect(building.top).toBeGreaterThan(sampleHeight(map.heightfield, building.x, building.z) + 3)
    }
    for (const tree of map.trees) {
      expect(roadCrowding(map.roads, tree.x, tree.z)).toBeGreaterThan(1)
      expect(tree.bottom).toBeCloseTo(sampleHeight(map.heightfield, tree.x, tree.z), 3)
    }
  })

  it('never stand two buildings in the same place', () => {
    const buildings = map.buildings
    for (let i = 0; i < buildings.length; i++) {
      const a = buildings[i]!
      const reachA = Math.hypot(a.width, a.depth) / 2
      for (let j = i + 1; j < buildings.length; j++) {
        const b = buildings[j]!
        if (Math.hypot(a.x - b.x, a.z - b.z) > reachA + Math.hypot(b.width, b.depth) / 2) continue
        expect(overlap(a, b)).toBe(false)
      }
    }
  })
})

describe('ramps', () => {
  beforeAll(() => {
    map ??= generateTerrain(1)
  }, 60_000)

  it('lead from the road shoulder up onto the roof of a few flat-topped houses', () => {
    expect(map.ramps.length).toBeGreaterThan(3)
    const flat = map.buildings.filter((building) => building.kind === 'house' && building.roof === 'flat')
    expect(flat.length).toBe(map.ramps.length)
    for (const ramp of map.ramps) {
      // A grade a car can take flat out, and the foot on the ground, off the road.
      const grade = (ramp.top - ramp.bottom) / ramp.length
      expect(grade).toBeGreaterThan(0.2)
      expect(grade).toBeLessThan(0.7)
      expect(Math.abs(sampleHeight(map.heightfield, ramp.x, ramp.z) - ramp.bottom)).toBeLessThan(0.01)
      expect(roadCrowding(map.roads, ramp.x, ramp.z)).toBeGreaterThan(1)
      // The top edge meets a flat-topped house at its roof.
      const tx = ramp.x + ramp.dx * ramp.length
      const tz = ramp.z + ramp.dz * ramp.length
      const house = flat.find(
        (candidate) =>
          Math.abs(candidate.top - ramp.top) < 1e-6 &&
          Math.hypot(candidate.x - tx, candidate.z - tz) < candidate.depth / 2 + 1,
      )
      expect(house).toBeDefined()
    }
  })
})
