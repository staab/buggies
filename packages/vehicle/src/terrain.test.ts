import {
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_TUNNEL,
  flatHeightfield,
  KERB_HEIGHT,
  RAMP_FACETS,
  generateTerrain,
  rampFacets,
  rampRise,
  roadLift,
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
          const deck = (a.y + b.y) / 2 + roadLift(road)
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
          const deck = (a.y + b.y) / 2 + roadLift(road)
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

    it('stands every building on the map as a solid to drive into, and every tree as a trunk', () => {
      expect(map.buildings.length).toBeGreaterThan(100)
      let roofed = 0
      for (const building of map.buildings) {
        const found = castDown(world, building.x, building.z, building.top + 5)
        if (found === null) continue
        // A standing stone may carry a lintel, a post a canopy and a site a crane, whose top is what is met above it.
        const carried = (building.kind === 'stone' || building.kind === 'post' || building.kind === 'site') && found > building.top
        if (Math.abs(found - building.top) < 0.01 || carried) roofed++
      }
      expect(roofed).toBe(map.buildings.length)
      const trees = map.trees.filter((tree) => tree.kind === 'tree')
      const shrubs = map.trees.filter((tree) => tree.kind === 'shrub')
      expect(trees.length).toBeGreaterThan(50)
      expect(shrubs.length).toBeGreaterThan(50)
      let trunks = 0
      for (const tree of trees) {
        const found = castDown(world, tree.x, tree.z, tree.bottom + tree.height + 5)
        if (found !== null && Math.abs(found - tree.bottom - tree.height) < 0.01) trunks++
      }
      expect(trunks).toBe(trees.length)
      // A shrub is nothing to hit: the ray passes down through it to the
      // ground, which the collider's triangles can put a little off the
      // drawn ground's bilinear reading but never up at the shrub's top.
      let open = 0
      for (const shrub of shrubs) {
        const found = castDown(world, shrub.x, shrub.z, shrub.bottom + shrub.height + 5)
        if (found !== null && found < shrub.bottom + shrub.height - 0.1) open++
      }
      expect(open).toBe(shrubs.length)
    })

    it('stands every boulder as a solid its size, and passes through the scree', () => {
      const boulders = map.rocks.filter((rock) => rock.kind === 'boulder')
      const scree = map.rocks.filter((rock) => rock.kind === 'scree')
      expect(boulders.length).toBeGreaterThan(20)
      expect(scree.length).toBeGreaterThan(50)
      let topped = 0
      for (const rock of boulders) {
        const found = castDown(world, rock.x, rock.z, rock.bottom + rock.size + 5)
        if (found !== null && Math.abs(found - rock.bottom - rock.size) < 0.01) topped++
      }
      expect(topped).toBe(boulders.length)
      // A scree stone is nothing to hit: the ray passes down through it to
      // the ground. On the cliffs scree lies on, the collider's triangles
      // can put the ground well off the drawn ground's bilinear reading,
      // even above a small stone's top, but never exactly at it.
      let open = 0
      let stopped = 0
      for (const rock of scree) {
        const from = rock.bottom + rock.size + 5
        const ray = new RAPIER.Ray({ x: rock.x, y: from, z: rock.z }, { x: 0, y: -1, z: 0 })
        const hit = world.castRay(ray, from * 2, true)
        if (hit === null) continue
        const found = from - hit.timeOfImpact
        if (found < rock.bottom + rock.size - 0.1) open++
        // Whatever the ray meets, it is never a solid the size of the stone: the ground, a road or a wall.
        if (hit.collider.shape.type === RAPIER.ShapeType.Cuboid && Math.abs(found - rock.bottom - rock.size) < 0.01) stopped++
      }
      expect(stopped).toBe(0)
      expect(open).toBeGreaterThan(scree.length * 0.98)
    })

    it('stands a solid kicker under every ramp, curving from its foot up to its lip', () => {
      expect(map.ramps.length).toBeGreaterThan(0)
      let sound = 0
      for (const ramp of map.ramps) {
        let facetsFound = 0
        for (const facet of rampFacets(ramp)) {
          const along = Math.min(Math.max(facet.along, 0.3), ramp.length - 0.3)
          const found = castDown(world, ramp.x + ramp.dx * along, ramp.z + ramp.dz * along, ramp.top + 5)
          if (found !== null && Math.abs(found - (ramp.bottom + rampRise(ramp, along))) < 0.08) facetsFound++
        }
        if (facetsFound === RAMP_FACETS + 1) sound++
      }
      expect(sound).toBe(map.ramps.length)
    })

    it('raises a kerb round every city block that the wheels find', () => {
      expect(map.sidewalks.length).toBeGreaterThan(0)
      let kerbed = 0
      for (const walk of map.sidewalks) {
        // The middle of one built side's slab, just in from the kerb, short
        // of the buildings standing on the slab further in. Sides go round
        // from the one at +v.
        const side = walk.sides.findIndex((built) => built)
        const reach = walk.half - 0.3
        const [u, v] = (
          [
            [0, reach],
            [-reach, 0],
            [0, -reach],
            [reach, 0],
          ] as [number, number][]
        )[side]!
        const x = walk.x + u * Math.cos(walk.yaw) - v * Math.sin(walk.yaw)
        const z = walk.z + u * Math.sin(walk.yaw) + v * Math.cos(walk.yaw)
        const ground = sampleHeight(map.heightfield, x, z)
        // From just over the kerb, under any deck that crosses the city above it.
        const found = castDown(world, x, z, ground + 1)
        if (found !== null && found > ground + KERB_HEIGHT - 0.05 && found < ground + KERB_HEIGHT + 0.6) kerbed++
      }
      expect(kerbed).toBe(map.sidewalks.length)
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
          const deck = (a.y + b.y) / 2 + roadLift(road)
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
