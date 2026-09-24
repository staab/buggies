import { beforeAll, describe, expect, it } from 'vitest'

import { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB } from './districts.ts'
import { insidePolygon, interchangeZones } from './interchanges.ts'
import { STREET_SPACING, STREET_WIDTH } from './roads.ts'
import { generateTerrain } from './generate.ts'
import { orientedTriangle, signedDistanceToTriangle } from './mountain.ts'
import { HOUSE_KINDS } from './types.ts'
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
    const houses = map.buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
    // In all three styles.
    expect(new Set(houses.map((house) => house.kind))).toEqual(new Set(HOUSE_KINDS))
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
    const houses = map.buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
    const shrubs = map.trees.filter((tree) => tree.kind === 'shrub')
    const planted = houses.filter((house) =>
      shrubs.some((shrub) => Math.hypot(house.x - shrub.x, house.z - shrub.z) < 12),
    )
    expect(planted.length).toBeGreaterThan(houses.length * 0.7)
  })

  it('raise one observatory at most, on a mountain top, on about half the islands', () => {
    let domes = 0
    for (let seed = 1; seed <= 8; seed++) {
      const island = generateTerrain(seed, { size: 257 })
      const observatories = island.buildings.filter((building) => building.kind === 'observatory')
      expect(observatories.length).toBeLessThanOrEqual(1)
      domes += observatories.length
      for (const observatory of observatories) {
        // Inside a mountain's own triangle, on its highest ground.
        const triangles = island.mountains.map(orientedTriangle)
        const home = triangles.find((triangle) => signedDistanceToTriangle(observatory.x, observatory.z, triangle) >= 0)
        expect(home).toBeDefined()
        const here = sampleHeight(island.heightfield, observatory.x, observatory.z)
        let highest = -Infinity
        const { cellSize, width, depth, heights } = island.heightfield
        for (let row = 0; row < depth; row++) {
          for (let col = 0; col < width; col++) {
            if (signedDistanceToTriangle(col * cellSize, row * cellSize, home!) < 0) continue
            highest = Math.max(highest, heights[row * width + col]!)
          }
        }
        expect(here).toBeGreaterThan(highest - 0.5)
        expect(observatory.width).toBe(observatory.depth)
      }
    }
    expect(domes).toBeGreaterThan(0)
    expect(domes).toBeLessThan(8)
  }, 60_000)

  it('farm the open country: hedged fields in rows on ground flat enough to plough, a barn and a silo off the end', () => {
    const { fields } = map
    expect(fields.length).toBeGreaterThanOrEqual(4)
    const roadPoints = map.roads.flatMap((road) => road.points)
    for (const field of fields) {
      expect(districtAt(field.x, field.z)).toBe(DISTRICT_COUNTRY)
      const cos = Math.cos(field.yaw)
      const sin = Math.sin(field.yaw)
      // No road runs through it.
      const inside = roadPoints.some((point) => {
        const dx = point.x - field.x
        const dz = point.z - field.z
        return Math.abs(dx * cos - dz * sin) < field.width / 2 && Math.abs(dx * sin + dz * cos) < field.depth / 2
      })
      expect(inside).toBe(false)
      // And it is hedged: shrubs near its edges.
      const hedge = map.trees.filter(
        (tree) => tree.kind === 'shrub' && Math.hypot(tree.x - field.x, tree.z - field.z) < Math.hypot(field.width, field.depth) / 2 + 3,
      )
      expect(hedge.length).toBeGreaterThan(10)
    }
    const barns = map.buildings.filter((building) => building.kind === 'barn')
    const silos = map.buildings.filter((building) => building.kind === 'silo')
    expect(barns.length).toBeGreaterThanOrEqual(1)
    expect(silos.length).toBeGreaterThanOrEqual(1)
    for (const barn of barns) {
      expect(fields.some((field) => Math.hypot(field.x - barn.x, field.z - barn.z) < 80)).toBe(true)
    }
    for (const silo of silos) {
      expect(barns.some((barn) => Math.hypot(barn.x - silo.x, barn.z - silo.z) < 25)).toBe(true)
      expect(silo.width).toBe(silo.depth)
    }
  })

  it('raise one wind farm: a line of turbines the same distance apart, all facing the same way', () => {
    const turbines = map.buildings.filter((building) => building.kind === 'turbine')
    expect(turbines.length).toBeGreaterThanOrEqual(4)
    expect(turbines.length).toBeLessThanOrEqual(7)
    const first = turbines[0]!
    const last = turbines[turbines.length - 1]!
    const span = Math.hypot(last.x - first.x, last.z - first.z)
    const dx = (last.x - first.x) / span
    const dz = (last.z - first.z) / span
    const along = turbines.map((turbine) => (turbine.x - first.x) * dx + (turbine.z - first.z) * dz).sort((a, b) => a - b)
    for (const [i, at] of along.entries()) {
      if (i > 0) expect(at - along[i - 1]!).toBeCloseTo(48, 0)
    }
    for (const turbine of turbines) {
      const off = Math.abs((turbine.x - first.x) * dz - (turbine.z - first.z) * dx)
      expect(off).toBeLessThan(0.01)
      expect(turbine.yaw).toBe(first.yaw)
      expect(turbine.top - turbine.bottom).toBeGreaterThan(40)
    }
  })

  it('ring the open ground with standing stones, each turned to face the altar in the middle', () => {
    const all = map.buildings.filter((building) => building.kind === 'stone')
    // The altar lies in the middle; the rest stand round it.
    expect(all).toHaveLength(13)
    const altar = all.reduce((lowest, stone) => (stone.top - stone.bottom < lowest.top - lowest.bottom ? stone : lowest))
    const stones = all.filter((stone) => stone !== altar)
    const centre = { x: altar.x, z: altar.z }
    for (const stone of stones) {
      const rx = stone.x - centre.x
      const rz = stone.z - centre.z
      const radius = Math.hypot(rx, rz)
      expect(Math.abs(radius - 14)).toBeLessThan(1.5)
      expect(stone.top - stone.bottom).toBeGreaterThan(6)
      // Its broad side, along its own X, runs across the line to the middle.
      const across = (Math.cos(stone.yaw) * rx - Math.sin(stone.yaw) * rz) / radius
      expect(Math.abs(across)).toBeLessThan(0.3)
      expect(districtAt(stone.x, stone.z)).toBe(DISTRICT_COUNTRY)
    }
    // Some neighbours carry a lintel: laid between the two, resting on both, which stand the same height.
    const lintels = map.buildings.filter((building) => building.kind === 'lintel')
    expect(lintels.length).toBeGreaterThan(0)
    expect(lintels.length).toBeLessThan(stones.length)
    for (const lintel of lintels) {
      const under = [...stones].sort(
        (a, b) => Math.hypot(a.x - lintel.x, a.z - lintel.z) - Math.hypot(b.x - lintel.x, b.z - lintel.z),
      )
      const [left, right] = under
      expect(left).toBeDefined()
      expect(right).toBeDefined()
      expect(left!.top).toBeCloseTo(right!.top, 1)
      expect(lintel.bottom).toBeCloseTo(left!.top - 0.15, 3)
      expect(Math.hypot((left!.x + right!.x) / 2 - lintel.x, (left!.z + right!.z) / 2 - lintel.z)).toBeLessThan(0.01)
      expect(lintel.width).toBeGreaterThan(Math.hypot(left!.x - right!.x, left!.z - right!.z))
    }
  })

  it('light a headland: one lighthouse at most, on a shore with the sea about it', () => {
    const lighthouses = map.buildings.filter((building) => building.kind === 'lighthouse')
    expect(lighthouses).toHaveLength(1)
    const { seaLevel, heightfield } = map
    for (const lighthouse of lighthouses) {
      const shore = sampleHeight(heightfield, lighthouse.x, lighthouse.z)
      expect(shore).toBeGreaterThan(seaLevel + 1)
      expect(shore).toBeLessThan(seaLevel + 15)
      let sea = 0
      for (let k = 0; k < 16; k++) {
        const angle = (k * Math.PI * 2) / 16
        if (sampleHeight(heightfield, lighthouse.x + Math.cos(angle) * 30, lighthouse.z + Math.sin(angle) * 30) < seaLevel) sea++
      }
      expect(sea / 16).toBeGreaterThanOrEqual(0.45)
      for (const other of lighthouses) {
        if (other !== lighthouse) expect(Math.hypot(other.x - lighthouse.x, other.z - lighthouse.z)).toBeGreaterThan(400)
      }
    }
  })

  it('keep every building and tree off every road and out of the water', () => {
    for (const building of map.buildings) {
      for (const point of samples(building)) {
        expect(roadCrowding(map.roads, point.x, point.z)).toBeGreaterThan(1)
        expect(sampleHeight(map.heightfield, point.x, point.z)).toBeGreaterThan(map.seaLevel)
      }
      // Standing on the ground, not floating above it or lost in it. A stone may lie low, as the altar
      // does, and a lintel rests on two stones, not the ground.
      if (building.kind === 'lintel') continue
      expect(building.bottom).toBeLessThan(sampleHeight(map.heightfield, building.x, building.z))
      const least = building.kind === 'stone' ? 0.8 : 3
      expect(building.top).toBeGreaterThan(sampleHeight(map.heightfield, building.x, building.z) + least)
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
      if (a.kind === 'lintel') continue
      for (let j = i + 1; j < buildings.length; j++) {
        const b = buildings[j]!
        // A lintel lies across two stones on purpose.
        if (b.kind === 'lintel') continue
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

  it('stand on the road shoulders, running along the road, at a grade to fly off', () => {
    expect(map.ramps.length).toBeGreaterThan(10)
    for (const ramp of map.ramps) {
      expect((ramp.top - ramp.bottom) / ramp.length).toBeCloseTo(0.25, 1)
      expect(Math.abs(sampleHeight(map.heightfield, ramp.x, ramp.z) - ramp.bottom)).toBeLessThan(0.01)
      // Beside a road, off its carriageway but within a car's width of it,
      // and pointing along it.
      const middle = { x: ramp.x + (ramp.dx * ramp.length) / 2, z: ramp.z + (ramp.dz * ramp.length) / 2 }
      let nearest = Infinity
      let alongRoad = 0
      for (const road of map.roads) {
        if (road.kind !== 'arterial' && road.kind !== 'cross') continue
        for (let i = 0; i + 1 < road.points.length; i++) {
          const a = road.points[i]!
          const b = road.points[i + 1]!
          const distance = distanceToSegment(middle.x, middle.z, a.x, a.z, b.x, b.z) - road.width / 2
          if (distance < nearest) {
            nearest = distance
            const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
            alongRoad = Math.abs((ramp.dx * (b.x - a.x) + ramp.dz * (b.z - a.z)) / length)
          }
        }
      }
      expect(nearest).toBeGreaterThan(0)
      expect(nearest).toBeLessThan(ramp.width + 1)
      expect(alongRoad).toBeGreaterThan(0.95)
      expect(roadCrowding(map.roads, ramp.x, ramp.z)).toBeGreaterThan(1)
    }
  })
})

describe('sidewalks', () => {
  beforeAll(() => {
    map ??= generateTerrain(1)
  }, 60_000)

  it('ring every city block, a block wide less the street', () => {
    expect(map.sidewalks.length).toBeGreaterThan(20)
    for (const walk of map.sidewalks) {
      expect(districtAt(walk.x, walk.z)).toBe(DISTRICT_CITY)
      expect(walk.half).toBeCloseTo(STREET_SPACING / 2 - STREET_WIDTH / 2, 6)
      expect(walk.band).toBeGreaterThan(1)
    }
  })
})

describe('interchanges', () => {
  beforeAll(() => {
    map ??= generateTerrain(1)
  }, 60_000)

  it('have no building, sidewalk or kicker on the ground their ramps enclose', () => {
    const zones = interchangeZones(map.roads)
    expect(zones.length).toBeGreaterThan(0)
    const inside = (x: number, z: number): boolean => zones.some((zone) => insidePolygon(zone, x, z))
    for (const building of map.buildings) {
      for (const point of samples(building)) expect(inside(point.x, point.z)).toBe(false)
    }
    for (const walk of map.sidewalks) {
      // The middle of every built side.
      const reach = walk.half - walk.band / 2
      const middles = [
        [0, reach],
        [-reach, 0],
        [0, -reach],
        [reach, 0],
      ]
      for (const [side, [u, v]] of middles.entries()) {
        if (!walk.sides[side]) continue
        const x = walk.x + u! * Math.cos(walk.yaw) - v! * Math.sin(walk.yaw)
        const z = walk.z + u! * Math.sin(walk.yaw) + v! * Math.cos(walk.yaw)
        expect(inside(x, z)).toBe(false)
      }
    }
    for (const ramp of map.ramps) expect(inside(ramp.x, ramp.z)).toBe(false)
  })
})
