import { describe, expect, it } from 'vitest'

import { computeFlowRouting, findLakes, flatHeightfield } from './index.ts'
import { generateTerrain } from './generate.ts'
import type { Heightfield } from './types.ts'

describe('generateTerrain', () => {
  it('is deterministic for a given seed', () => {
    const a = generateTerrain(1234)
    const b = generateTerrain(1234)
    const c = generateTerrain(4321)

    expect(a.heightfield.heights).toEqual(b.heightfield.heights)
    expect(a.ridges).toEqual(b.ridges)
    expect(a.rivers).toEqual(b.rivers)
    expect(a.heightfield.heights).not.toEqual(c.heightfield.heights)
  })

  it('produces an island: sea at the edges, land in the middle', () => {
    const { heightfield, seaLevel, size, ridges } = generateTerrain(7)
    const { heights } = heightfield
    const edge = heights[0]!
    const center = heights[Math.floor(size / 2) * size + Math.floor(size / 2)]!

    expect(edge).toBeLessThan(seaLevel)
    expect(center).toBeGreaterThan(seaLevel)
    expect(ridges.length).toBe(2)
  })

  it('builds two elongated ridges that always intersect on land', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const map = generateTerrain(seed, { size: 385 })
      expect(map.ridges).toHaveLength(2)

      const [first, second] = map.ridges
      // Both crests cross at the shared massif centre.
      expect(first!.x).toBeCloseTo(second!.x)
      expect(first!.z).toBeCloseTo(second!.z)

      for (const ridge of map.ridges) {
        // Skinny and long rather than round peaks.
        expect(ridge.length).toBeGreaterThan(ridge.width * 3)
      }

      const centerCol = Math.round(map.ridges[0]!.x / map.cellSize)
      const centerRow = Math.round(map.ridges[0]!.z / map.cellSize)
      const crossing = map.heightfield.heights[centerRow * map.size + centerCol]!
      expect(crossing).toBeGreaterThan(map.seaLevel)
    }
  })

  it('runs one or two rivers from the mountains down to the sea', () => {
    const map = generateTerrain(2024)
    expect(map.rivers.length).toBeGreaterThanOrEqual(1)
    expect(map.rivers.length).toBeLessThanOrEqual(2)

    for (const river of map.rivers) {
      const first = river.points[0]!
      const last = river.points.at(-1)!
      expect(first.y).toBeGreaterThan(map.seaLevel)
      expect(last.y).toBeLessThanOrEqual(map.seaLevel + 1e-3)
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
