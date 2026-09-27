import { describe, expect, it } from 'vitest'

import { createSphereGround, gridDirection, groundIndex } from './sphere.ts'
import { findSphereLakes, groundDirections, groundNeighbors, routeSphereFlow } from './sphere-water.ts'

describe("water on a planet's own ground", () => {
  it('finds eight neighbors round every grid point, the ones off a face on the next, each close by', () => {
    const ground = createSphereGround(16, 100)
    const neighbors = groundNeighbors(ground)
    const directions = groundDirections(ground)
    const a = { x: 0, y: 0, z: 0 }
    for (let at = 0; at < ground.heights.length; at++) {
      let found = 0
      for (let k = 0; k < 8; k++) {
        const next = neighbors[at * 8 + k]!
        if (next < 0) continue
        found++
        a.x = directions[at * 3]! - directions[next * 3]!
        a.y = directions[at * 3 + 1]! - directions[next * 3 + 1]!
        a.z = directions[at * 3 + 2]! - directions[next * 3 + 2]!
        // No more than a diagonal step, a quarter turn cut into sixteen cells.
        expect(Math.hypot(a.x, a.y, a.z)).toBeLessThan(0.2)
      }
      // A cube's corner has only seven round it, the grid points on its edges meeting there.
      expect(found).toBeGreaterThanOrEqual(6)
    }
  })

  it('runs every grid point on land down to the sea, across the faces, and fills a basin into a lake', () => {
    const ground = createSphereGround(24, 100)
    const direction = { x: 0, y: 0, z: 0 }
    // A ring of land round the north pole, higher than a hollow inside it, and the sea everywhere else.
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j <= 24; j++) {
        for (let i = 0; i <= 24; i++) {
          const { y } = gridDirection(24, face, i, j, direction)
          ground.heights[groundIndex(ground, face, i, j)] = y > 0.97 ? 2 : y > 0.8 ? 5 : -10
        }
      }
    }
    const neighbors = groundNeighbors(ground)
    const routing = routeSphereFlow(ground, neighbors, 0)
    for (let at = 0; at < ground.heights.length; at++) {
      if (ground.heights[at]! <= 0) {
        expect(routing.flow[at]).toBe(-1)
        continue
      }
      let steps = 0
      let point = at
      while (ground.heights[point]! > 0) {
        expect(routing.filled[routing.flow[point]!]!).toBeLessThanOrEqual(routing.filled[point]!)
        point = routing.flow[point]!
        steps++
        expect(steps).toBeLessThan(200)
      }
    }
    const lakes = findSphereLakes(ground, neighbors, routing, 0)
    expect(lakes.length).toBe(1)
    expect(lakes[0]!.level).toBe(5)
  })
})
