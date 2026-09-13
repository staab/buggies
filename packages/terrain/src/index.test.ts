import { describe, expect, it } from 'vitest'

import {
  ARTERIAL_BRIDGE_GRADE,
  ARTERIAL_WIDTH,
  CROSS_WIDTH,
  DISTRICT_CITY,
  DISTRICT_COUNTRY,
  DISTRICT_SUBURB,
  MAX_ARTERIAL_GRADE,
  MAX_RAMP_GRADE,
  MAX_ROAD_GRADE,
  RAMP_WIDTH,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_TUNNEL,
  WORLD_SCALE,
  computeFlowRouting,
  findLakes,
  flatHeightfield,
  generateDistricts,
  generateRoads,
  heightAt,
  orientedTriangle,
  triangleCentroid,
  triangleInradius,
} from './index.ts'
import { generateTerrain } from './generate.ts'
import type { District, Heightfield, River, Road, RoadPoint } from './types.ts'

describe('generateTerrain', () => {
  it(
    'is deterministic for a given seed',
    () => {
      const a = generateTerrain(1234)
      const b = generateTerrain(1234)
      const c = generateTerrain(4321)

      expect(a.heightfield.heights).toEqual(b.heightfield.heights)
      expect(a.mountains).toEqual(b.mountains)
      expect(a.rivers).toEqual(b.rivers)
      expect(a.districts).toEqual(b.districts)
      expect(a.districtOf).toEqual(b.districtOf)
      expect(a.roads).toEqual(b.roads)
      expect(a.roads[0]?.structure).toEqual(b.roads[0]?.structure)
      expect(a.heightfield.heights).not.toEqual(c.heightfield.heights)
    },
    20_000,
  )

  it('produces an island: sea at the edges, land in the middle', () => {
    const { heightfield, seaLevel, size, mountains } = generateTerrain(7)
    const { heights } = heightfield
    const edge = heights[0]!
    const center = heights[Math.floor(size / 2) * size + Math.floor(size / 2)]!

    expect(edge).toBeLessThan(seaLevel)
    expect(center).toBeGreaterThan(seaLevel)
    expect(mountains).toHaveLength(3)
  })

  it('builds three triangular mountains loosely clustered together', () => {
    const spread = 80
    for (let seed = 1; seed <= 8; seed++) {
      const map = generateTerrain(seed, { size: 385, mountainSpread: spread })
      expect(map.mountains).toHaveLength(3)

      const centers = map.mountains.map((mountain) => {
        const triangle = orientedTriangle(mountain)
        // Every mountain is a real triangle, not a degenerate line.
        expect(triangleInradius(triangle)).toBeGreaterThan(0)
        return triangleCentroid(triangle)
      })

      // "Intersect" is loose: they just have to sit close to each other.
      for (let i = 0; i < centers.length; i++) {
        for (let j = i + 1; j < centers.length; j++) {
          const distance = Math.hypot(centers[i]!.x - centers[j]!.x, centers[i]!.z - centers[j]!.z)
          expect(distance).toBeLessThanOrEqual(spread * 2 * WORLD_SCALE + 1e-6)
        }
      }
    }
  })

  it('runs one or two rivers from the mountains down to the sea', () => {
    const map = generateTerrain(2024)
    expect(map.rivers.length).toBeGreaterThanOrEqual(1)
    expect(map.rivers.length).toBeLessThanOrEqual(2)

    let maxHeight = -Infinity
    for (const height of map.heightfield.heights) maxHeight = Math.max(maxHeight, height)

    for (const river of map.rivers) {
      const first = river.points[0]!
      const last = river.points.at(-1)!
      expect(first.y).toBeGreaterThan(map.seaLevel)
      // Springs begin partway down, not on the summit.
      expect(first.y).toBeLessThan(maxHeight - 5)
      expect(last.y).toBeLessThanOrEqual(map.seaLevel + 1e-3)
      // Headwaters are thread-thin and widen as the river descends.
      expect(first.width).toBeLessThan(WORLD_SCALE)
      expect(last.width).toBeGreaterThan(first.width)

      for (let i = 1; i < river.points.length; i++) {
        expect(river.points[i]!.y).toBeLessThanOrEqual(river.points[i - 1]!.y + 1e-3)
      }
    }
  })

  it('only keeps substantial lakes that a river actually runs through', () => {
    for (let seed = 1; seed <= 16; seed++) {
      const map = generateTerrain(seed, { size: 385 })
      const riverCells = new Set<number>()
      for (const river of map.rivers) {
        for (const point of river.points) {
          const col = Math.min(Math.max(Math.floor(point.x / map.cellSize), 0), map.size - 1)
          const row = Math.min(Math.max(Math.floor(point.z / map.cellSize), 0), map.size - 1)
          riverCells.add(row * map.size + col)
        }
      }

      for (const lake of map.lakes) {
        expect(lake.cells.length).toBeGreaterThanOrEqual(12)
        expect(lake.cells.some((cell) => riverCells.has(cell))).toBe(true)
      }
    }
  })

  it('carves a channel so the river bed always sits below the water surface', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const map = generateTerrain(seed, { size: 385 })
      for (const river of map.rivers) {
        for (const point of river.points) {
          const col = Math.round(point.x / map.cellSize)
          const row = Math.round(point.z / map.cellSize)
          const bed = map.heightfield.heights[row * map.size + col]!
          expect(bed).toBeLessThanOrEqual(point.y + 1e-3)
        }
      }
    }
  })
})

describe('districts', () => {
  function waterCells(map: ReturnType<typeof generateTerrain>): Set<number> {
    const cells = new Set<number>()
    const { width, depth, cellSize } = map.heightfield
    for (const river of map.rivers) {
      for (const point of river.points) {
        const col = Math.min(Math.max(Math.floor(point.x / cellSize), 0), width - 1)
        const row = Math.min(Math.max(Math.floor(point.z / cellSize), 0), depth - 1)
        cells.add(row * width + col)
      }
    }
    for (const lake of map.lakes) for (const cell of lake.cells) cells.add(cell)
    return cells
  }

  /** Greatest height change to an orthogonal neighbour, in world units. */
  function slopeAt(field: Heightfield, cell: number): number {
    const { width, depth, cellSize, heights } = field
    const row = (cell / width) | 0
    const col = cell - row * width
    const height = heights[cell]!
    let steepest = 0
    if (col > 0) steepest = Math.max(steepest, Math.abs(height - heights[cell - 1]!))
    if (col < width - 1) steepest = Math.max(steepest, Math.abs(height - heights[cell + 1]!))
    if (row > 0) steepest = Math.max(steepest, Math.abs(height - heights[cell - width]!))
    if (row < depth - 1) steepest = Math.max(steepest, Math.abs(height - heights[cell + width]!))
    return steepest / cellSize
  }

  it('marks flat ground as a city and leaves steep ground as country', () => {
    const size = 101
    const field = flatHeightfield(size, size, 1, 4)
    const { districts, districtOf } = generateDistricts(field, 1, 0, new Set())

    expect(districts.length).toBeGreaterThanOrEqual(1)
    let cityCells = 0
    for (let cell = 0; cell < size * size; cell++) {
      const kind = districtOf[cell]!
      expect([DISTRICT_COUNTRY, DISTRICT_SUBURB, DISTRICT_CITY]).toContain(kind)
      if (kind === DISTRICT_CITY) cityCells++
    }
    expect(cityCells).toBeGreaterThan(0)
  })

  it('still places its three cities on a uniformly steep island', () => {
    const size = 101
    const field = flatHeightfield(size, size, 1, 0)
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) field.heights[row * size + col] = col * 0.2
    }

    const { districts, districtOf } = generateDistricts(field, 1, 0, new Set())

    // There is no level ground here, but an island always gets its cities.
    expect(districts).toHaveLength(3)
    expect(districtOf.every((kind) => kind === DISTRICT_COUNTRY)).toBe(true)
  })

  it('builds only on a level shelf surrounded by slopes', () => {
    const size = 101
    const field = flatHeightfield(size, size, 1, 0)
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) field.heights[row * size + col] = col * 0.2
    }
    for (let row = 20; row <= 80; row++) {
      for (let col = 20; col <= 80; col++) field.heights[row * size + col] = 4
    }

    const { districts, districtOf } = generateDistricts(field, 1, 0, new Set())

    expect(districts.length).toBeGreaterThanOrEqual(1)
    for (let cell = 0; cell < size * size; cell++) {
      if (districtOf[cell] === DISTRICT_COUNTRY) continue
      expect(field.heights[cell]).toBeCloseTo(4, 5)
    }
  })

  it('is deterministic for a given seed', () => {
    const a = generateTerrain(99, { size: 513 })
    const b = generateTerrain(99, { size: 513 })
    expect(a.districts).toEqual(b.districts)
    expect(a.districtOf).toEqual(b.districtOf)
  })

  it('gives every island a city on level, dry ground', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const map = generateTerrain(seed, { size: 513 })
      expect(map.districts.length).toBeGreaterThanOrEqual(1)
      const water = waterCells(map)

      let districtCells = 0
      for (let cell = 0; cell < map.districtOf.length; cell++) {
        if (map.districtOf[cell] === DISTRICT_COUNTRY) continue
        districtCells++
        expect(map.heightfield.heights[cell]).toBeGreaterThan(map.seaLevel)
        expect(water.has(cell)).toBe(false)
      }
      expect(districtCells).toBeGreaterThan(0)

      for (let i = 0; i < map.districts.length; i++) {
        for (let j = i + 1; j < map.districts.length; j++) {
          const a = map.districts[i]!
          const b = map.districts[j]!
          expect(Math.hypot(a.cx - b.cx, a.cz - b.cz)).toBeGreaterThanOrEqual(110)
        }
      }
    }
  }, 20_000)

  it('keeps districts on ground flatter than the island as a whole', () => {
    const map = generateTerrain(2024, { size: 513 })
    const { heights } = map.heightfield

    let districtSlope = 0
    let districtCount = 0
    let landSlope = 0
    let landCount = 0
    for (let cell = 0; cell < heights.length; cell++) {
      if (heights[cell]! <= map.seaLevel) continue
      const slope = slopeAt(map.heightfield, cell)
      landSlope += slope
      landCount++
      if (map.districtOf[cell] === DISTRICT_COUNTRY) continue
      districtSlope += slope
      districtCount++
    }

    expect(districtCount).toBeGreaterThan(0)
    expect(districtSlope / districtCount).toBeLessThan(landSlope / landCount)
  })
})

describe('roads', () => {
  const city = (id: number, cx: number, cz: number): District => ({
    id,
    cx,
    cz,
    radius: 20,
    suburbWidth: 14,
    area: 100,
  })

  function steepestGrade(road: Road): number {
    const { points } = road
    const segmentCount = road.closed ? points.length : points.length - 1
    let steepest = 0
    for (let i = 0; i < segmentCount; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      const run = Math.hypot(b.x - a.x, b.z - a.z)
      if (run < 1e-6) continue
      steepest = Math.max(steepest, Math.abs(b.y - a.y) / run)
    }
    return steepest
  }

  function nearestRoadDistance(road: Road, x: number, z: number): number {
    let nearest = Infinity
    for (const point of road.points) nearest = Math.min(nearest, Math.hypot(point.x - x, point.z - z))
    return nearest
  }

  it('loops through every city with no dead ends', () => {
    const field = flatHeightfield(101, 101, 1, 5)
    const districts = [city(0, 25, 50), city(1, 75, 50), city(2, 50, 80)]
    const roads = generateRoads(field, 0, districts, [], []).filter((road) => road.closed)

    expect(roads).toHaveLength(1)
    const road = roads[0]!
    expect(road.closed).toBe(true)
    expect(road.points.length).toBeGreaterThan(16)
    expect(road.structure).toHaveLength(road.points.length)

    for (const district of districts) {
      expect(nearestRoadDistance(road, district.cx, district.cz)).toBeLessThan(1)
    }
  })

  it('keeps elevation changes gentle along the whole loop', () => {
    const field = flatHeightfield(101, 101, 1, 5)
    const districts = [city(0, 25, 50), city(1, 75, 50), city(2, 50, 80)]
    const road = generateRoads(field, 0, districts, [], [])[0]!

    expect(steepestGrade(road)).toBeLessThanOrEqual(MAX_ROAD_GRADE + 1e-3)
    for (const structure of road.structure) {
      expect([ROAD_GRADE, ROAD_BRIDGE, ROAD_TUNNEL]).toContain(structure)
    }
  })

  it('bridges a river crossing instead of fording it', () => {
    const field = flatHeightfield(201, 201, 1, 20)
    const points = []
    for (let z = 0; z <= 200; z += 4) points.push({ x: 100, y: 18, z, width: 6 })
    const river: River = { id: 0, points }
    const districts = [city(0, 60, 100), city(1, 140, 100)]
    const road = generateRoads(field, 0, districts, [river], [])[0]!

    const deck = road.points.filter((_, i) => road.structure[i] === ROAD_BRIDGE)
    expect(deck.length).toBeGreaterThan(0)
    // The deck clears the water rather than dipping to the river bed.
    for (const point of deck) expect(point.y).toBeGreaterThan(18)
  })

  it('tunnels beneath a mountain instead of climbing straight over it', () => {
    const size = 201
    const field = flatHeightfield(size, size, 1, 5)
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const distance = Math.hypot(col - 100, row - 100)
        if (distance < 60) field.heights[row * size + col] = 5 + 60 * (1 - distance / 60)
      }
    }
    const districts = [city(0, 30, 100), city(1, 170, 100), city(2, 100, 170)]
    const road = generateRoads(field, 0, districts, [], [])[0]!

    let tunnels = 0
    let buried = false
    for (let i = 0; i < road.points.length; i++) {
      if (road.structure[i] !== ROAD_TUNNEL) continue
      tunnels++
      const a = road.points[i]!
      const b = road.points[(i + 1) % road.points.length]!
      const groundA = field.heights[Math.round(a.z) * size + Math.round(a.x)]!
      const groundB = field.heights[Math.round(b.z) * size + Math.round(b.x)]!
      // Some part of the run stays below ground; that is what makes it a tunnel.
      // The portals may be cut down to meet the road, so not every sample is buried.
      if (Math.max(groundA - a.y, groundB - b.y) > 0) buried = true
    }
    expect(tunnels).toBeGreaterThan(0)
    expect(buried).toBe(true)
  })

  it('lifts the at-grade highway into an embankment above the ground', () => {
    const map = generateTerrain(1, { size: 513 })
    const road = map.roads[0]!
    const { heightfield } = map

    let grade = 0
    let elevated = 0
    for (let i = 0; i < road.points.length; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      grade++
      const point = road.points[i]!
      const ground = heightAt(
        heightfield,
        Math.floor(point.x / map.cellSize),
        Math.floor(point.z / map.cellSize),
      )
      // An at-grade deck is never buried. The corner-sampled ground can read a
      // little above the bilinear height the router used, so allow a couple of
      // units of slack on top of the tunnel threshold.
      expect(ground - point.y).toBeLessThanOrEqual(3)
      if (point.y - ground > 1) elevated++
    }

    expect(grade).toBeGreaterThan(0)
    expect(elevated).toBeGreaterThan(grade / 2)
  })

  it('gives every map with a city a closed highway within the grade limit', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const map = generateTerrain(seed, { size: 513 })
      if (map.districts.length === 0) continue

      const highways = map.roads.filter((road) => road.closed)
      expect(highways.length).toBeGreaterThanOrEqual(1)
      for (const road of highways) {
        expect(road.closed).toBe(true)
        expect(road.structure).toHaveLength(road.points.length)
        expect(steepestGrade(road)).toBeLessThanOrEqual(MAX_ROAD_GRADE + 1e-3)
        for (const district of map.districts) {
          expect(nearestRoadDistance(road, district.cx, district.cz)).toBeLessThan(100 * WORLD_SCALE)
        }
      }
    }
  }, 20_000)

  it('branches one-lane ramps and a cross road off the highway', () => {
    const map = generateTerrain(1)
    const highway = map.roads.find((road) => road.closed)!
    const access = map.roads.filter(
      (road) => !road.closed && (road.width === CROSS_WIDTH || road.width === RAMP_WIDTH),
    )

    expect(access.length).toBeGreaterThan(0)
    expect(highway.width).toBeGreaterThan(RAMP_WIDTH)
    for (const road of access) {
      expect(road.width).toBeLessThan(highway.width)
      expect(road.points.length).toBeGreaterThan(1)
      expect(road.structure).toHaveLength(road.points.length - 1)
      const limit = road.width === RAMP_WIDTH ? MAX_RAMP_GRADE : MAX_ROAD_GRADE
      expect(steepestGrade(road)).toBeLessThanOrEqual(limit + 1e-3)
    }

    // Interchanges come in quads: one cross road and four ramps each.
    expect(access.length % 5).toBe(0)
  })

  it('drives the cross road through an underpass beneath the highway', () => {
    const map = generateTerrain(1)
    const highway = map.roads.find((road) => road.closed)!
    const crossRoads = map.roads.filter((road) => !road.closed && road.width === CROSS_WIDTH)

    expect(crossRoads.length).toBeGreaterThan(0)
    for (const road of crossRoads) {
      const middle = road.points[Math.floor(road.points.length / 2)]!

      // The crossing sits beneath a bridge span of the highway, and the
      // highway there is drawn as bridge deck rather than an embankment.
      let nearest = Infinity
      let structure = ROAD_GRADE
      for (let i = 0; i < highway.points.length; i++) {
        const point = highway.points[i]!
        const distance = Math.hypot(point.x - middle.x, point.z - middle.z)
        if (distance < nearest) {
          nearest = distance
          structure = highway.structure[i]!
        }
      }
      expect(nearest).toBeLessThan(CROSS_WIDTH)
      expect(structure).toBe(ROAD_BRIDGE)
    }
  })

  it('cuts the ground so at-grade roads are never buried', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const map = generateTerrain(seed, { size: 513 })
      for (const road of map.roads) {
        const count = road.points.length
        const segmentCount = road.closed ? count : count - 1
        for (let i = 0; i < count; i++) {
          const atGrade = road.closed
            ? road.structure[i] === ROAD_GRADE || road.structure[(i - 1 + count) % count] === ROAD_GRADE
            : (i > 0 && road.structure[i - 1] === ROAD_GRADE) ||
              (i < segmentCount && road.structure[i] === ROAD_GRADE)
          if (!atGrade) continue
          const point = road.points[i]!
          const ground = heightAt(
            map.heightfield,
            Math.floor(point.x / map.cellSize),
            Math.floor(point.z / map.cellSize),
          )
          expect(ground - point.y).toBeLessThan(1)
        }
      }
    }
  }, 20_000)

  it('grows arterials from the cross roads that bridge but never tunnel', () => {
    let arterials = 0
    for (let seed = 1; seed <= 3; seed++) {
      const map = generateTerrain(seed)
      const crossRoads = map.roads.filter((road) => !road.closed && road.width === CROSS_WIDTH)
      const grown = map.roads.filter((road) => !road.closed && road.width === ARTERIAL_WIDTH)
      const starts = grown.flatMap((road) => [road.points[0]!, road.points[road.points.length - 1]!])
      arterials += grown.length

      // Arterials grow out of the cross road ends (some cross roads may be left
      // unconnected once dangling branches are pruned).
      const crossEnds = crossRoads.flatMap((road) => [road.points[0]!, road.points[road.points.length - 1]!])
      expect(
        crossEnds.some((end) => starts.some((start) => Math.hypot(start.x - end.x, start.z - end.z) < 1)),
      ).toBe(true)

      for (const road of grown) {
        expect(road.closed).toBe(false)
        expect(road.structure).toHaveLength(road.points.length - 1)

        for (let i = 0; i < road.points.length - 1; i++) {
          const a = road.points[i]!
          const b = road.points[i + 1]!
          const run = Math.hypot(b.x - a.x, b.z - a.z)
          const grade = run > 1e-6 ? Math.abs(b.y - a.y) / run : 0
          const structure = road.structure[i]!
          // Arterials never tunnel; they climb over or around a mountain.
          expect(structure).not.toBe(ROAD_TUNNEL)
          const limit = structure === ROAD_BRIDGE ? ARTERIAL_BRIDGE_GRADE : MAX_ARTERIAL_GRADE
          expect(grade).toBeLessThanOrEqual(limit + 1e-3)
        }
      }
    }
    expect(arterials).toBeGreaterThan(0)
  }, 20_000)

  it('keeps arterials off the highway except at an interchange', () => {
    const map = generateTerrain(1)
    const highway = map.roads.find((road) => road.closed)!
    const crossRoads = map.roads.filter((road) => !road.closed && road.width === CROSS_WIDTH)
    const centres = crossRoads.map((road) => road.points[Math.floor(road.points.length / 2)]!)
    const arterials = map.roads.filter((road) => !road.closed && road.width === ARTERIAL_WIDTH)
    expect(arterials.length).toBeGreaterThan(0)

    const straddles = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      cx: number,
      cz: number,
      dx: number,
      dz: number,
    ): boolean => {
      const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
      const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
      const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx)
      const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
      return d1 * d2 < 0 && d3 * d4 < 0
    }

    for (const road of arterials) {
      for (let i = 0; i + 1 < road.points.length; i++) {
        const a = road.points[i]!
        const b = road.points[i + 1]!
        for (let j = 0; j + 1 < highway.points.length; j++) {
          const h = highway.points[j]!
          const h2 = highway.points[j + 1]!
          if (!straddles(a.x, a.z, b.x, b.z, h.x, h.z, h2.x, h2.z)) continue
          const mx = (a.x + b.x + h.x + h2.x) / 4
          const mz = (a.z + b.z + h.z + h2.z) / 4
          const near = Math.min(...centres.map((centre) => Math.hypot(centre.x - mx, centre.z - mz)))
          // It may only cross where a cross road already passes underneath.
          expect(near).toBeLessThan(180)
        }
      }
    }
  }, 20_000)

  it('keeps arterials from crossing any other road', () => {
    const map = generateTerrain(1)
    const arterials = map.roads.filter((road) => !road.closed && road.width === ARTERIAL_WIDTH)
    expect(arterials.length).toBeGreaterThan(0)

    const straddles = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      cx: number,
      cz: number,
      dx: number,
      dz: number,
    ): boolean => {
      const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
      const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
      const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx)
      const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
      return d1 * d2 < 0 && d3 * d4 < 0
    }

    let crossings = 0
    for (const road of arterials) {
      for (const other of map.roads) {
        if (other === road) continue
        for (let p = 0; p + 1 < road.points.length; p++) {
          const p1 = road.points[p]!
          const p2 = road.points[p + 1]!
          for (let q = 0; q + 1 < other.points.length; q++) {
            const q1 = other.points[q]!
            const q2 = other.points[q + 1]!
            if (straddles(p1.x, p1.z, p2.x, p2.z, q1.x, q1.z, q2.x, q2.z)) crossings++
          }
        }
      }
    }
    expect(crossings).toBe(0)
  }, 20_000)

  it('meets other roads at a straight (180 degree) angle', () => {
    const map = generateTerrain(1)
    const ends: { road: Road; start: boolean }[] = []
    for (const road of map.roads) {
      if (road.closed || road.points.length < 2) continue
      ends.push({ road, start: true }, { road, start: false })
    }
    const direction = (road: Road, start: boolean): { x: number; z: number; px: number; pz: number } => {
      const points = road.points
      const a = start ? points[0]! : points[points.length - 1]!
      const b = start ? points[1]! : points[points.length - 2]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const length = Math.hypot(dx, dz) || 1
      return { x: dx / length, z: dz / length, px: a.x, pz: a.z }
    }

    let nodes = 0
    let aligned = 0
    const used = new Array<boolean>(ends.length).fill(false)
    for (let i = 0; i < ends.length; i++) {
      if (used[i]) continue
      const cluster = [i]
      used[i] = true
      const origin = direction(ends[i]!.road, ends[i]!.start)
      for (let j = i + 1; j < ends.length; j++) {
        if (used[j]) continue
        const point = direction(ends[j]!.road, ends[j]!.start)
        if (Math.hypot(point.px - origin.px, point.pz - origin.pz) < 1.5) {
          cluster.push(j)
          used[j] = true
        }
      }
      if (cluster.length < 2) continue
      nodes++
      const directions = cluster.map((k) => direction(ends[k]!.road, ends[k]!.start))
      let opposite = 0
      for (let a = 0; a < directions.length; a++) {
        for (let b = a + 1; b < directions.length; b++) {
          const dot = directions[a]!.x * directions[b]!.x + directions[a]!.z * directions[b]!.z
          opposite = Math.max(opposite, (Math.acos(Math.min(Math.max(dot, -1), 1)) * 180) / Math.PI)
        }
      }
      if (Math.abs(opposite - 180) < 10) aligned++
    }
    expect(nodes).toBeGreaterThan(0)
    expect(aligned / nodes).toBeGreaterThan(0.7)
  }, 20_000)

  it('rounds arterial corners instead of leaving sharp bends', () => {
    const map = generateTerrain(1)
    const arterials = map.roads.filter((road) => !road.closed && road.width === ARTERIAL_WIDTH)
    expect(arterials.length).toBeGreaterThan(0)

    let sharpest = 0
    for (const road of arterials) {
      for (let i = 1; i + 1 < road.points.length; i++) {
        const a = road.points[i - 1]!
        const b = road.points[i]!
        const c = road.points[i + 1]!
        const inX = b.x - a.x
        const inZ = b.z - a.z
        const outX = c.x - b.x
        const outZ = c.z - b.z
        const inLength = Math.hypot(inX, inZ)
        const outLength = Math.hypot(outX, outZ)
        if (inLength < 1e-6 || outLength < 1e-6) continue
        const dot = (inX * outX + inZ * outZ) / (inLength * outLength)
        sharpest = Math.max(sharpest, (Math.acos(Math.min(Math.max(dot, -1), 1)) * 180) / Math.PI)
      }
    }
    expect(sharpest).toBeLessThan(20)
  }, 20_000)

  it('leaves no arterial dead ends', () => {
    const map = generateTerrain(1)
    const arterials = map.roads.filter((road) => !road.closed && road.width === ARTERIAL_WIDTH)
    const ends = arterials.flatMap((road) => [road.points[0]!, road.points[road.points.length - 1]!])
    const distanceToSegment = (x: number, z: number, a: RoadPoint, b: RoadPoint): number => {
      const vx = b.x - a.x
      const vz = b.z - a.z
      const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1), 0), 1)
      return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t))
    }

    for (const road of arterials) {
      for (const end of [road.points[0]!, road.points[road.points.length - 1]!]) {
        if (ends.some((p) => p !== end && Math.hypot(p.x - end.x, p.z - end.z) < 2)) continue
        const meets = map.roads.some((other) => {
          if (other === road) return false
          for (let i = 0; i + 1 < other.points.length; i++) {
            if (distanceToSegment(end.x, end.z, other.points[i]!, other.points[i + 1]!) < 3) return true
          }
          return false
        })
        expect(meets).toBe(true)
      }
    }
  }, 20_000)

  it('meets the cross road perpendicularly, one ramp per diamond arm', () => {
    const map = generateTerrain(1)
    const crossRoads = map.roads.filter((road) => !road.closed && road.width === CROSS_WIDTH)
    const ramps = map.roads.filter((road) => !road.closed && road.width === RAMP_WIDTH)
    expect(ramps.length).toBe(crossRoads.length * 4)

    const distanceToSegment = (x: number, z: number, a: RoadPoint, b: RoadPoint): number => {
      const vx = b.x - a.x
      const vz = b.z - a.z
      const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1), 0), 1)
      return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t))
    }

    let arms = 0
    for (const cross of crossRoads) {
      const a = cross.points[0]!
      const b = cross.points[cross.points.length - 1]!
      const crossX = b.x - a.x
      const crossZ = b.z - a.z
      const crossLength = Math.hypot(crossX, crossZ) || 1

      for (const ramp of ramps) {
        const tip = ramp.points[ramp.points.length - 1]!
        const offset = distanceToSegment(tip.x, tip.z, a, b)
        if (offset > CROSS_WIDTH) continue
        // The tip touches the near edge, not the centreline of the cross road.
        expect(offset).toBeGreaterThan(CROSS_WIDTH * 0.25)
        const before = ramp.points[ramp.points.length - 2]!
        const heading = Math.atan2(tip.z - before.z, tip.x - before.x)
        const along = Math.atan2(crossZ, crossX)
        // Perpendicular to the cross road: the headings differ by a right angle.
        const dot = Math.cos(heading - along)
        expect(Math.abs(dot)).toBeLessThan(0.1)
        arms++
      }
    }
    expect(arms).toBe(crossRoads.length * 4)
  })
})

describe('findLakes', () => {
  it('fills a basin up to its spill level', () => {
    // Sea on the border, a plateau at height 5, and a single pit at the centre.
    const size = 9
    const field: Heightfield = flatHeightfield(size, size, 1, 5)
    for (let i = 0; i < size; i++) {
      field.heights[i] = 0
      field.heights[(size - 1) * size + i] = 0
      field.heights[i * size] = 0
      field.heights[i * size + size - 1] = 0
    }
    const pit = 4 * size + 4
    field.heights[pit] = 1

    const routing = computeFlowRouting(field, 0)
    const lakes = findLakes(field, routing, 0)

    expect(lakes).toHaveLength(1)
    expect(lakes[0]!.level).toBeCloseTo(5)
    expect(lakes[0]!.cells).toContain(pit)
  })
})
