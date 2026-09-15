import {
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  flatHeightfield,
  generateTerrain,
  sampleHeight,
  type Heightfield,
  type TerrainMap,
} from '@buggies/terrain'
import * as RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'

import { addHeightfield, addTerrain } from './terrain.ts'
import { createPhysicsWorld, initPhysics } from './world.ts'

/** Deliberately not square, and sloping along one axis only, so a transposed
 * heightfield or a swapped scale cannot pass unnoticed. */
function ramped(width: number, depth: number, cellSize: number): Heightfield {
  const field = flatHeightfield(width, depth, cellSize)
  for (let row = 0; row < depth; row++) {
    for (let col = 0; col < width; col++) {
      field.heights[row * width + col] = col * cellSize * 0.1 + Math.sin(row * 0.3) * 2
    }
  }
  return field
}

/** Height of whatever is under a point, found the way a wheel finds it. */
function castDown(world: RAPIER.World, x: number, z: number, from = 400): number | null {
  const ray = new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 })
  const hit = world.castRay(ray, from * 2, true)
  return hit === null ? null : from - hit.timeOfImpact
}

describe('terrain colliders', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  it('stands the ground where the heightfield says it is', () => {
    const field = ramped(64, 48, 4)
    const world = createPhysicsWorld()
    addHeightfield(world, field)
    world.step()

    // Rays land where wheels land, which is never exactly on a cell boundary.
    // A ray that is exactly on one can slip between the two triangles that
    // share it and hit nothing; off the boundary, by any amount, it hits.
    let worst = 0
    let samples = 0
    for (let z = 10.3; z < (48 - 1) * 4 - 10; z += 11) {
      for (let x = 10.7; x < (64 - 1) * 4 - 10; x += 13) {
        const found = castDown(world, x, z)
        expect(found).not.toBeNull()
        worst = Math.max(worst, Math.abs(found! - sampleHeight(field, x, z)))
        samples++
      }
    }
    expect(samples).toBeGreaterThan(100)
    // Rapier triangulates each cell, so a bilinear read differs by the sag
    // across a diagonal, and no more than that.
    expect(worst).toBeLessThan(1)
  })

  it('finds ground under any position a wheel could actually be at', () => {
    const field = ramped(80, 40, 4)
    const world = createPhysicsWorld()
    addHeightfield(world, field)
    world.step()

    let misses = 0
    for (let i = 0; i < 4000; i++) {
      const x = 1 + Math.random() * ((80 - 1) * 4 - 2)
      const z = 1 + Math.random() * ((40 - 1) * 4 - 2)
      if (castDown(world, x, z) === null) misses++
    }
    expect(misses).toBe(0)
  })

  it('places a full-size island without taking too long about it', () => {
    const field = flatHeightfield(1025, 1025, 3)
    for (let i = 0; i < field.heights.length; i++) field.heights[i] = (i % 97) * 0.2
    const world = createPhysicsWorld()

    const started = Date.now()
    addHeightfield(world, field)
    world.step()
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(castDown(world, 1500, 1500)).not.toBeNull()
  })

  describe('on a generated island', () => {
    let map: TerrainMap
    let world: RAPIER.World

    beforeAll(() => {
      // One full-size island for both: roads and bridges are what it is for,
      // and a small map has too few of either to say anything.
      map = generateTerrain(3)
      world = createPhysicsWorld()
      addTerrain(world, map)
      world.step()
    }, 120_000)

    it('stands roads at the height they are drawn, not the bed cut under them', () => {
      let total = 0
      let below = 0
      for (const road of map.roads) {
        const count = road.points.length
        const segments = road.closed ? count : count - 1
        for (let i = 0; i < segments; i++) {
          if (road.structure[i] !== ROAD_GRADE) continue
          const a = road.points[i]!
          const b = road.points[(i + 1) % count]!
          const deck = (a.y + b.y) / 2 + ROAD_SURFACE
          total++
          const found = castDown(world, (a.x + b.x) / 2, (a.z + b.z) / 2, deck + 3)
          // Reading higher than its own deck is a junction: another
          // carriageway crossing above this one, which is meant to be there.
          // Reading lower is a hole, and a hole is a vehicle in a ditch.
          if (found === null || found < deck - 0.1) below++
        }
      }
      expect(total).toBeGreaterThan(1000)
      expect(below).toBe(0)
    })

    it('runs a floor through every tunnel, with room above it to drive', () => {
      let spans = 0
      let floored = 0
      let tight = 0
      for (const road of map.roads) {
        const count = road.points.length
        const segments = road.closed ? count : count - 1
        for (let i = 0; i < segments; i++) {
          if (road.structure[i] !== ROAD_TUNNEL) continue
          const a = road.points[i]!
          const b = road.points[(i + 1) % count]!
          const x = (a.x + b.x) / 2
          const z = (a.z + b.z) / 2
          const deck = (a.y + b.y) / 2 + ROAD_SURFACE
          spans++

          // From inside the bore, looking down: the road has to be there, or
          // a vehicle reaching the portal drops into the hill.
          const found = castDown(world, x, z, deck + 1)
          if (found !== null && Math.abs(found - deck) < 0.3) floored++

          // And looking up: nothing of the hill may hang into the bore.
          const up = new RAPIER.Ray({ x, y: deck + 0.1, z }, { x: 0, y: 1, z: 0 })
          const roof = world.castRay(up, 3, true)
          if (roof !== null) tight++
        }
      }
      expect(spans).toBeGreaterThan(20)
      expect(floored).toBe(spans)
      expect(tight).toBe(0)
    })

    it('carries a bridge over the gap it spans', () => {
      let spans = 0
      let carried = 0
      for (const road of map.roads) {
        const count = road.points.length
        const segments = road.closed ? count : count - 1
        for (let i = 0; i < segments; i++) {
          if (road.structure[i] !== ROAD_BRIDGE) continue
          const a = road.points[i]!
          const b = road.points[(i + 1) % count]!
          const x = (a.x + b.x) / 2
          const z = (a.z + b.z) / 2
          const deck = (a.y + b.y) / 2 + ROAD_SURFACE
          // Only spans that actually clear something: a deck sitting on the
          // ground proves nothing about whether it holds anything up.
          if (deck - sampleHeight(map.heightfield, x, z) < 1) continue
          spans++
          const found = castDown(world, x, z, deck + 3)
          if (found !== null && Math.abs(found - deck) < 0.3) carried++
        }
      }
      expect(spans).toBeGreaterThan(20)
      expect(carried / spans).toBeGreaterThan(0.95)
    })
  })
})
