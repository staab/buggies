import { describe, expect, it } from 'vitest'

import {
  ARTERIAL_BRIDGE_GRADE,
  ARTERIAL_WIDTH,
  CROSS_WIDTH,
  DISTRICT_CITY,
  DISTRICT_COUNTRY,
  DISTRICT_SUBURB,
  INTERCHANGE_SEARCH,
  MAX_ARTERIAL_GRADE,
  MAX_RAMP_GRADE,
  MAX_ROAD_GRADE,
  RAMP_WIDTH,
  RIVER_BANK_LAP,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_TUNNEL,
  ROAD_WIDTH,
  STREET_WIDTH,
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

  function pointToSegment(
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): number {
    const vx = bx - ax
    const vz = bz - az
    const lengthSq = vx * vx + vz * vz || 1
    const t = Math.min(Math.max(((px - ax) * vx + (pz - az) * vz) / lengthSq, 0), 1)
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
  }

  /** Convex hull of a point cloud, by monotone chain. */
  function hull(points: RoadPoint[]): RoadPoint[] {
    const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z)
    const turn = (o: RoadPoint, a: RoadPoint, b: RoadPoint): number =>
      (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
    const half = (source: RoadPoint[]): RoadPoint[] => {
      const chain: RoadPoint[] = []
      for (const point of source) {
        while (chain.length >= 2 && turn(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) {
          chain.pop()
        }
        chain.push(point)
      }
      chain.pop()
      return chain
    }
    return [...half(sorted), ...half(sorted.reverse())]
  }

  function inPolygon(x: number, z: number, polygon: RoadPoint[]): boolean {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!
      const b = polygon[j]!
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
    }
    return inside
  }

  /** True when two carriageways cross or come within half a carriageway. */
  function meets(a: Road, b: Road): boolean {
    const tolerance = (a.width + b.width) / 2
    const segmentCount = (road: Road): number =>
      road.closed ? road.points.length : road.points.length - 1
    for (let i = 0; i < segmentCount(a); i++) {
      const p = a.points[i]!
      const q = a.points[(i + 1) % a.points.length]!
      for (let j = 0; j < segmentCount(b); j++) {
        const r = b.points[j]!
        const s = b.points[(j + 1) % b.points.length]!
        const d1 = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
        const d2 = (q.x - p.x) * (s.z - p.z) - (q.z - p.z) * (s.x - p.x)
        const d3 = (s.x - r.x) * (p.z - r.z) - (s.z - r.z) * (p.x - r.x)
        const d4 = (s.x - r.x) * (q.z - r.z) - (s.z - r.z) * (q.x - r.x)
        if (d1 * d2 < 0 && d3 * d4 < 0) return true
        const gap = Math.min(
          pointToSegment(p.x, p.z, r.x, r.z, s.x, s.z),
          pointToSegment(q.x, q.z, r.x, r.z, s.x, s.z),
          pointToSegment(r.x, r.z, p.x, p.z, q.x, q.z),
          pointToSegment(s.x, s.z, p.x, p.z, q.x, q.z),
        )
        if (gap <= tolerance) return true
      }
    }
    return false
  }

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

  /**
   * A surface road is the ground, read at the ground's own resolution, and at
   * a crossing the ground is shared with another road: its grade is held to
   * the limit as built, but what is finally driven can ripple a little over it
   * and, at an interchange corner where a cross road, its ramps, two arterials
   * and a street all meet within a few metres, a fair bit more over a metre or
   * two. Where two roads cross at an angle on different grades the ground is a
   * blend of both, and each road inherits a little of the other's slope there.
   * Grade is read over stretches of at least a metre, and what is over the
   * limit is weighed by length.
   */
  function expectSurfaceGrades(roads: Road[], limitFor: (road: Road, segment: number) => number): void {
    let length = 0
    let over = 0
    let steepest = 0
    for (const road of roads) {
      const { points } = road
      let from = 0
      for (let i = 1; i < points.length; i++) {
        const a = points[from]!
        const b = points[i]!
        const run = Math.hypot(b.x - a.x, b.z - a.z)
        if (run < 1 && i + 1 < points.length) continue
        if (run < 1e-6) continue
        const grade = Math.abs(b.y - a.y) / run
        length += run
        if (grade > limitFor(road, from) + 0.03) over += run
        steepest = Math.max(steepest, grade - limitFor(road, from))
        from = i
      }
    }
    expect(length).toBeGreaterThan(0)
    expect(over / length).toBeLessThan(0.06)
    expect(steepest).toBeLessThanOrEqual(0.15)
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
    }
    expectSurfaceGrades(access, (road) => (road.width === RAMP_WIDTH ? MAX_RAMP_GRADE : MAX_ROAD_GRADE))

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
      const grown = map.roads.filter((road) => !road.closed && road.kind === 'arterial')
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
        // Arterials never tunnel; they climb over or around a mountain.
        for (const structure of road.structure) expect(structure).not.toBe(ROAD_TUNNEL)
      }
      expectSurfaceGrades(grown, (road, segment) =>
        road.structure[segment] === ROAD_BRIDGE ? ARTERIAL_BRIDGE_GRADE : MAX_ARTERIAL_GRADE,
      )
    }
    expect(arterials).toBeGreaterThan(0)
  }, 20_000)

  it('keeps arterials off the highway except at an interchange', () => {
    const map = generateTerrain(1)
    const highway = map.roads.find((road) => road.closed)!
    const crossRoads = map.roads.filter((road) => !road.closed && road.width === CROSS_WIDTH)
    const centres = crossRoads.map((road) => road.points[Math.floor(road.points.length / 2)]!)
    const arterials = map.roads.filter((road) => !road.closed && road.kind === 'arterial')
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
    const arterials = map.roads.filter((road) => !road.closed && road.kind === 'arterial')
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
        if (other === road || other.kind === 'street') continue
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
    let nodes = 0
    let aligned = 0
    for (let seed = 1; seed <= 3; seed++) {
      const map = generateTerrain(seed)
      const ends: { road: Road; start: boolean }[] = []
      for (const road of map.roads) {
        if (road.closed || road.points.length < 2 || road.kind === 'street') continue
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
    }
    expect(nodes).toBeGreaterThan(0)
    expect(aligned / nodes).toBeGreaterThan(0.6)
  }, 20_000)

  it('fills each city with a grade-limited street grid', () => {
    const map = generateTerrain(1)
    const streets = map.roads.filter((road) => !road.closed && road.kind === 'street')
    expect(streets.length).toBeGreaterThan(0)
    for (const road of streets) {
      expect(road.points.length).toBeGreaterThan(1)
      expect(road.structure).toHaveLength(road.points.length - 1)
    }
    expectSurfaceGrades(streets, () => MAX_ROAD_GRADE)
  }, 20_000)

  it('keeps city streets a road\'s width clear of highways and ramps', () => {
    const map = generateTerrain(1)
    const streets = map.roads.filter((road) => road.kind === 'street')
    const fast = map.roads.filter((road) => road.width === ROAD_WIDTH || road.width === RAMP_WIDTH)
    expect(streets.length).toBeGreaterThan(0)
    expect(fast.length).toBeGreaterThan(0)

    let narrowest = Infinity
    for (const street of streets) {
      for (const point of street.points) {
        for (const road of fast) {
          const segmentCount = road.closed ? road.points.length : road.points.length - 1
          for (let i = 0; i < segmentCount; i++) {
            const a = road.points[i]!
            const b = road.points[(i + 1) % road.points.length]!
            const gap = pointToSegment(point.x, point.z, a.x, a.z, b.x, b.z)
            narrowest = Math.min(narrowest, gap - (road.width + STREET_WIDTH) / 2)
          }
        }
      }
    }
    // Edge to edge, a street stays a highway's width away from the fast roads.
    expect(narrowest).toBeGreaterThanOrEqual(ROAD_WIDTH - 1e-3)
  }, 20_000)

  it('leaves the pocket between an interchange\'s ramps and highway empty', () => {
    // Seed 4 puts an interchange well inside a city, so its grid has to dodge one.
    const map = generateTerrain(4)
    const streets = map.roads.filter((road) => road.kind === 'street')
    const crossRoads = map.roads.filter((road) => road.width === CROSS_WIDTH)
    const ramps = map.roads.filter((road) => road.width === RAMP_WIDTH)
    expect(crossRoads.length).toBeGreaterThan(0)

    let checked = 0
    for (const crossRoad of crossRoads) {
      // The four ramps of this interchange are the ones landing on its cross road.
      const arms = ramps.filter((ramp) => {
        const tip = ramp.points[ramp.points.length - 1]!
        return crossRoad.points.some((point) => Math.hypot(point.x - tip.x, point.z - tip.z) < 10)
      })
      if (arms.length < 3) continue
      checked++
      // The hull of the ramps is the diamond they enclose with the highway.
      const footprint = hull(arms.flatMap((ramp) => ramp.points))
      for (const street of streets) {
        for (const point of street.points) {
          expect(inPolygon(point.x, point.z, footprint)).toBe(false)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  }, 20_000)

  it('never lets a city street smear along an arterial', () => {
    // Meeting shallower than 45 degrees, two overlapping ribbons read as one
    // smeared road rather than a junction, so the street gives way there.
    const shallow = Math.cos(Math.PI / 4)
    const overlap = (ARTERIAL_WIDTH + STREET_WIDTH) / 2
    for (const seed of [1, 5]) {
      const map = generateTerrain(seed)
      const streets = map.roads.filter((road) => road.kind === 'street')
      const arterials = map.roads.filter((road) => road.kind === 'arterial')
      expect(streets.length).toBeGreaterThan(0)
      expect(arterials.length).toBeGreaterThan(0)

      let closest = Infinity
      for (const street of streets) {
        for (let i = 0; i + 1 < street.points.length; i++) {
          const p = street.points[i]!
          const q = street.points[i + 1]!
          const length = Math.hypot(q.x - p.x, q.z - p.z) || 1
          const sx = (q.x - p.x) / length
          const sz = (q.z - p.z) / length
          for (const arterial of arterials) {
            for (let j = 0; j + 1 < arterial.points.length; j++) {
              const a = arterial.points[j]!
              const b = arterial.points[j + 1]!
              const run = Math.hypot(b.x - a.x, b.z - a.z) || 1
              if (Math.abs(((b.x - a.x) * sx + (b.z - a.z) * sz) / run) <= shallow) continue
              if (Math.min(p.x, q.x) - overlap > Math.max(a.x, b.x)) continue
              if (Math.min(a.x, b.x) - overlap > Math.max(p.x, q.x)) continue
              if (Math.min(p.z, q.z) - overlap > Math.max(a.z, b.z)) continue
              if (Math.min(a.z, b.z) - overlap > Math.max(p.z, q.z)) continue
              // Two disjoint segments are closest at an endpoint of one of them.
              closest = Math.min(
                closest,
                pointToSegment(p.x, p.z, a.x, a.z, b.x, b.z),
                pointToSegment(q.x, q.z, a.x, a.z, b.x, b.z),
                pointToSegment(a.x, a.z, p.x, p.z, q.x, q.z),
                pointToSegment(b.x, b.z, p.x, p.z, q.x, q.z),
              )
            }
          }
        }
      }
      // Where a street does run shallowly beside an arterial it stops at the
      // point their carriageways would start to overlap, and no nearer.
      expect(closest).toBeGreaterThanOrEqual(overlap - 1e-6)
    }
  }, 30_000)

  it('seats every river in the channel cut for it', () => {
    // The ribbon is flat and only as wide as the river, so the land has to come
    // up to meet its edges; where it does not, the water hangs with daylight
    // under it and reads as floating above the ground.
    const hanging: number[] = []
    const wetted: number[] = []
    for (const seed of [1, 2, 3]) {
      const map = generateTerrain(seed)
      expect(map.rivers.length).toBeGreaterThan(0)
      const { width, depth, cellSize, heights } = map.heightfield
      // Bilinear, because the ground is drawn as an interpolated mesh: what the
      // water has to clear is the surface between the samples, not the samples.
      const groundAt = (x: number, z: number): number => {
        const gx = Math.min(Math.max(x / cellSize, 0), width - 1)
        const gz = Math.min(Math.max(z / cellSize, 0), depth - 1)
        const col = Math.floor(gx)
        const row = Math.floor(gz)
        const col1 = Math.min(col + 1, width - 1)
        const row1 = Math.min(row + 1, depth - 1)
        const tx = gx - col
        const tz = gz - row
        const top = heights[row * width + col]! * (1 - tx) + heights[row * width + col1]! * tx
        const bottom = heights[row1 * width + col]! * (1 - tx) + heights[row1 * width + col1]! * tx
        return top * (1 - tz) + bottom * tz
      }

      for (const river of map.rivers) {
        for (let i = 0; i < river.points.length; i++) {
          const point = river.points[i]!
          const prev = river.points[Math.max(0, i - 1)]!
          const next = river.points[Math.min(river.points.length - 1, i + 1)]!
          let dx = next.x - prev.x
          let dz = next.z - prev.z
          const length = Math.hypot(dx, dz) || 1
          dx /= length
          dz /= length
          // The edge that is drawn, which is wider than the river itself.
          const half = (point.width / 2) * (1 + RIVER_BANK_LAP)
          for (const side of [1, -1]) {
            hanging.push(point.y - groundAt(point.x - dz * half * side, point.z + dx * half * side))
          }
          // The ribbon still has to read as a river, not a thread in a trench.
          let wet = 0
          const steps = 21
          for (let k = 0; k < steps; k++) {
            const offset = -half + (2 * half * k) / (steps - 1)
            if (groundAt(point.x - dz * offset, point.z + dx * offset) < point.y) wet++
          }
          wetted.push(wet / steps)
        }
      }
    }

    // Most edges are buried in a bank, and the water still covers most of its bed.
    // Some hang: the water is only let a little way off the traced surface, and
    // following every dip in the ground would step the banks into a staircase.
    const hangs = hanging.filter((gap) => gap > 0).length / hanging.length
    expect(hangs).toBeLessThan(0.35)
    const covered = wetted.reduce((sum, part) => sum + part, 0) / wetted.length
    expect(covered).toBeGreaterThan(0.6)
  }, 30_000)

  it('holds rivers and lakes to one water level where they meet', () => {
    for (const seed of [2, 3, 4, 6]) {
      const map = generateTerrain(seed)
      if (map.lakes.length === 0) continue
      const { width, depth, cellSize } = map.heightfield
      const surface: { x: number; z: number; level: number }[] = []
      for (const lake of map.lakes) {
        for (const cell of lake.cells) {
          surface.push({
            x: ((cell % width) + 0.5) * cellSize,
            z: (Math.floor(cell / width) + 0.5) * cellSize,
            level: lake.level,
          })
        }
      }
      expect(surface.length).toBeGreaterThan(0)
      expect(depth).toBeGreaterThan(0)

      for (const river of map.rivers) {
        for (const point of river.points) {
          for (const flooded of surface) {
            if (Math.hypot(flooded.x - point.x, flooded.z - point.z) > point.width / 2 + 12) continue
            // A river crossing a lake, or running up to its shore, is that lake:
            // it may run out of it downstream but never stand below its surface.
            expect(point.y).toBeGreaterThanOrEqual(flooded.level - 1e-6)
            break
          }
        }
      }
    }
  }, 30_000)

  it('never lets a river surface stand over a road deck', () => {
    for (const seed of [1, 2, 3]) {
      const map = generateTerrain(seed)
      for (const road of map.roads) {
        for (const point of road.points) {
          for (const river of map.rivers) {
            for (const sample of river.points) {
              if (Math.hypot(sample.x - point.x, sample.z - point.z) > sample.width / 2) continue
              expect(point.y).toBeGreaterThanOrEqual(sample.y)
            }
          }
        }
      }
    }
  }, 30_000)

  it('never lets an arterial run onto the highway', () => {
    // An arterial reaches the highway network through an interchange's cross
    // road, so its carriageway has no business lapping the carriageway itself.
    for (const seed of [1, 4, 6]) {
      const map = generateTerrain(seed)
      const highway = map.roads.find((road) => road.closed && road.width === ROAD_WIDTH)!
      const arterials = map.roads.filter((road) => road.kind === 'arterial')
      expect(arterials.length).toBeGreaterThan(0)
      const clear = (ARTERIAL_WIDTH + ROAD_WIDTH) / 2

      let closest = Infinity
      for (const arterial of arterials) {
        for (let i = 0; i + 1 < arterial.points.length; i++) {
          const p = arterial.points[i]!
          const q = arterial.points[i + 1]!
          for (let j = 0; j < highway.points.length; j++) {
            const r = highway.points[j]!
            const s = highway.points[(j + 1) % highway.points.length]!
            closest = Math.min(
              closest,
              pointToSegment(p.x, p.z, r.x, r.z, s.x, s.z),
              pointToSegment(q.x, q.z, r.x, r.z, s.x, s.z),
              pointToSegment(r.x, r.z, p.x, p.z, q.x, q.z),
              pointToSegment(s.x, s.z, p.x, p.z, q.x, q.z),
            )
          }
        }
      }
      expect(closest).toBeGreaterThanOrEqual(clear)
    }
  }, 30_000)

  it('parts arterials at a junction wide enough to read as a fork', () => {
    // Two arterials leaving one node within a sliver of each other run side by
    // side instead of parting, and their carriageways smear into one blob.
    for (const seed of [1, 2, 5]) {
      const map = generateTerrain(seed)
      const arterials = map.roads.filter(
        (road) => road.kind === 'arterial' && road.points.length >= 2,
      )
      expect(arterials.length).toBeGreaterThan(0)

      const heading = (road: Road, fromStart: boolean): { x: number; z: number } => {
        const a = fromStart ? road.points[0]! : road.points[road.points.length - 1]!
        const b = fromStart ? road.points[1]! : road.points[road.points.length - 2]!
        const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
        return { x: (b.x - a.x) / length, z: (b.z - a.z) / length }
      }
      const ends = arterials.flatMap((road) => [
        { road, start: true },
        { road, start: false },
      ])
      let sharpest = 180
      for (let i = 0; i < ends.length; i++) {
        const a = ends[i]!
        const at = a.start ? a.road.points[0]! : a.road.points[a.road.points.length - 1]!
        for (let j = i + 1; j < ends.length; j++) {
          const b = ends[j]!
          const to = b.start ? b.road.points[0]! : b.road.points[b.road.points.length - 1]!
          if (Math.hypot(to.x - at.x, to.z - at.z) >= 2) continue
          const da = heading(a.road, a.start)
          const db = heading(b.road, b.start)
          const dot = Math.min(Math.max(da.x * db.x + da.z * db.z, -1), 1)
          sharpest = Math.min(sharpest, (Math.acos(dot) * 180) / Math.PI)
        }
      }
      expect(sharpest).toBeGreaterThanOrEqual(45)
    }
  }, 30_000)

  it('carries arterials at the level of the streets they cross', () => {
    // Arterial heights come off a coarse routing grid and are then smoothed
    // along with the path, which used to leave the road sailing over dips
    // instead of dropping through them. Taking the height from the ground under
    // the finished path is what brings it back down to meet the grid.
    const steps: number[] = []
    for (const seed of [1, 2, 3]) {
      const map = generateTerrain(seed)
      const arterials = map.roads.filter((road) => road.kind === 'arterial')
      const streets = map.roads.filter((road) => road.kind === 'street')
      expect(arterials.length).toBeGreaterThan(0)
      expect(streets.length).toBeGreaterThan(0)

      for (const arterial of arterials) {
        for (let i = 0; i + 1 < arterial.points.length; i++) {
          const p = arterial.points[i]!
          const q = arterial.points[i + 1]!
          for (const street of streets) {
            for (let j = 0; j + 1 < street.points.length; j++) {
              const r = street.points[j]!
              const s = street.points[j + 1]!
              const d1 = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
              const d2 = (q.x - p.x) * (s.z - p.z) - (q.z - p.z) * (s.x - p.x)
              const d3 = (s.x - r.x) * (p.z - r.z) - (s.z - r.z) * (p.x - r.x)
              const d4 = (s.x - r.x) * (q.z - r.z) - (s.z - r.z) * (q.x - r.x)
              if (!(d1 * d2 < 0 && d3 * d4 < 0)) continue
              // Height of each road where they cross, interpolated along both.
              const t = d3 / (d3 - d4)
              const u = d1 / (d1 - d2)
              steps.push(Math.abs(p.y + (q.y - p.y) * t - (r.y + (s.y - r.y) * u)))
            }
          }
        }
      }
    }

    expect(steps.length).toBeGreaterThan(20)
    const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length
    steps.sort((a, b) => a - b)
    const p90 = steps[Math.floor(steps.length * 0.9)]!
    // What is left is mostly an arterial climbing to meet a raised interchange,
    // which is a real change in level rather than a mismatch.
    expect(mean).toBeLessThan(0.9)
    expect(p90).toBeLessThan(2)
  }, 30_000)

  it('leaves no city street on its own: each reaches a bigger road, or belongs to a grid', () => {
    const map = generateTerrain(1)
    const streets = map.roads.filter((road) => road.kind === 'street')
    expect(streets.length).toBeGreaterThan(0)

    const parent = streets.map((_, index) => index)
    const find = (index: number): number => {
      while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!
      return index
    }
    for (let i = 0; i < streets.length; i++) {
      for (let j = i + 1; j < streets.length; j++) {
        if (meets(streets[i]!, streets[j]!)) parent[find(i)] = find(j)
      }
    }
    const reached = new Set<number>()
    for (let i = 0; i < streets.length; i++) {
      for (const road of map.roads) {
        if (road.kind === 'street') continue
        if (meets(streets[i]!, road)) {
          reached.add(find(i))
          break
        }
      }
    }
    // A street is either drivable, some chain of streets leading it to a
    // bigger road, or one of a grid that stands on its own: a city's streets
    // are laid whether or not an arterial happens to come by.
    const sizes = new Map<number, number>()
    for (let i = 0; i < streets.length; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1)
    for (let i = 0; i < streets.length; i++) {
      expect(reached.has(find(i)) || (sizes.get(find(i)) ?? 0) >= 2).toBe(true)
    }
    // And some of them are drivable: this island's arterials come by one city of its three.
    const drivable = streets.filter((_, i) => reached.has(find(i))).length
    expect(drivable).toBeGreaterThan(0)
  }, 20_000)

  it('gives every city its own interchange and never a second', () => {
    /** The interchange underpasses, each charged to the city centre nearest it. */
    const perCity = (seed: number): number[] => {
      const map = generateTerrain(seed)
      const counts = map.districts.map(() => 0)
      for (const crossRoad of map.roads.filter((road) => road.width === CROSS_WIDTH)) {
        const under = crossRoad.points[Math.floor(crossRoad.points.length / 2)]!
        let best = -1
        let nearest = Infinity
        map.districts.forEach((district, index) => {
          const distance = Math.hypot(under.x - district.cx, under.z - district.cz)
          if (distance < nearest) {
            nearest = distance
            best = index
          }
        })
        // Cities can overlap, so an interchange belongs to the one it is on and
        // nearest to, never to both. A city's exit may stand a little beyond
        // its suburbs, as far as the search for a site reaches.
        const owner = map.districts[best]!
        if (nearest <= owner.radius + owner.suburbWidth + INTERCHANGE_SEARCH) counts[best]!++
      }
      return counts
    }

    for (const seed of [1, 2, 3, 4, 5]) {
      // A city's exit is placed before the spacing rule has any say, and only on
      // ground nearer to it than to any other city, so each of these gets one.
      expect(perCity(seed)).toEqual(generateTerrain(seed).districts.map(() => 1))
    }
    for (const seed of [14, 20, 27]) {
      // Some highway frontage is too uneven to carry an interchange at all, so a
      // city can go without; what must never happen is a city getting two.
      for (const count of perCity(seed)) expect(count).toBeLessThanOrEqual(1)
    }
  }, 60_000)

  it('gives every road its own id', () => {
    for (const seed of [1, 2, 3]) {
      const ids = generateTerrain(seed).roads.map((road) => road.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  }, 20_000)

  it('rounds arterial corners instead of leaving sharp bends', () => {
    const map = generateTerrain(1)
    const arterials = map.roads.filter((road) => !road.closed && road.kind === 'arterial')
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
    // Surface roads are resampled a cell apart once built, so the turn between
    // two samples is what a fillet turns over three metres; a road still
    // turning harder than that after smoothing is pruned as a hairpin.
    expect(sharpest).toBeLessThan(40)
  }, 20_000)

  it('leaves no arterial dead ends', () => {
    const map = generateTerrain(1)
    const arterials = map.roads.filter((road) => !road.closed && road.kind === 'arterial')
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
