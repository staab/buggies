import { describe, expect, it } from 'vitest'

import {
  DISTRICT_CITY,
  DISTRICT_COUNTRY,
  DISTRICT_SUBURB,
  MAX_ROAD_GRADE,
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
import type { District, Heightfield, River, Road } from './types.ts'

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

  it('refuses to build on a uniformly steep island', () => {
    const size = 101
    const field = flatHeightfield(size, size, 1, 0)
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) field.heights[row * size + col] = col * 0.2
    }

    const { districts, districtOf } = generateDistricts(field, 1, 0, new Set())

    expect(districts).toHaveLength(0)
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
  })

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
    const roads = generateRoads(field, 0, districts, [], [])

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
        if (distance < 30) field.heights[row * size + col] = 5 + 60 * (1 - distance / 30)
      }
    }
    const districts = [city(0, 30, 100), city(1, 170, 100), city(2, 100, 170)]
    const road = generateRoads(field, 0, districts, [], [])[0]!

    let tunnels = 0
    for (let i = 0; i < road.points.length; i++) {
      if (road.structure[i] !== ROAD_TUNNEL) continue
      tunnels++
      const a = road.points[i]!
      const b = road.points[(i + 1) % road.points.length]!
      const groundA = field.heights[Math.round(a.z) * size + Math.round(a.x)]!
      const groundB = field.heights[Math.round(b.z) * size + Math.round(b.x)]!
      // At least one end is buried below ground; that is what makes it a tunnel.
      expect(Math.max(groundA - a.y, groundB - b.y)).toBeGreaterThan(0)
    }
    expect(tunnels).toBeGreaterThan(0)
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
      // An at-grade deck is never buried, and mostly rides well clear.
      expect(ground - point.y).toBeLessThanOrEqual(2)
      if (point.y - ground > 1) elevated++
    }

    expect(grade).toBeGreaterThan(0)
    expect(elevated).toBeGreaterThan(grade / 2)
  })

  it('gives every map with a city a closed highway within the grade limit', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const map = generateTerrain(seed, { size: 513 })
      if (map.districts.length === 0) continue

      expect(map.roads.length).toBeGreaterThanOrEqual(1)
      for (const road of map.roads) {
        expect(road.closed).toBe(true)
        expect(road.structure).toHaveLength(road.points.length)
        expect(steepestGrade(road)).toBeLessThanOrEqual(MAX_ROAD_GRADE + 1e-3)
        for (const district of map.districts) {
          expect(nearestRoadDistance(road, district.cx, district.cz)).toBeLessThan(100 * WORLD_SCALE)
        }
      }
    }
  }, 20_000)
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
