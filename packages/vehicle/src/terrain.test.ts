import { FIXED_TIMESTEP, createRng, qrotate, uprightRotation, v3, vdot, vsub, type Quat, type Vec3 } from '@buggies/physics'
import {
  CURB_HEIGHT,
  PLANET_TERRAIN,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_TUNNEL,
  flatHeightfield,
  generateTerrain,
  sampleHeight,
  sphereHeight,
  type Heightfield,
  type World,
} from '@buggies/terrain'
import * as RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEUTRAL_INPUT, type VehicleInput } from './input.ts'
import { addHeightfield, addTerrain } from './terrain.ts'
import { createVehicleTuning } from './tuning.ts'
import { stepVehicle } from './vehicle.ts'
import { createVehicle } from './vehicleBody.ts'
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

    // The same positions every run: a ray straight down a seam of the grid can slip through, and a test should not hang on chance.
    const rng = createRng(1)
    let misses = 0
    for (let i = 0; i < 4000; i++) {
      const x = 1 + rng() * ((80 - 1) * 4 - 2)
      const z = 1 + rng() * ((40 - 1) * 4 - 2)
      if (castDown(world, x, z) === null) misses++
    }
    expect(misses).toBe(0)
  })

})

/** The way up at a point: away from the planet's middle. */
function upOf(point: Vec3): Vec3 {
  const length = Math.hypot(point.x, point.y, point.z)
  return { x: point.x / length, y: point.y / length, z: point.z / length }
}

/** How high a point is over the planet's radius. */
function heightOf(planet: World, point: Vec3): number {
  return Math.hypot(point.x, point.y, point.z) - planet.radius
}

/** A point's way along a turn's axis, this far. */
function along(at: Vec3, turn: Quat, x: number, y: number, z: number): Vec3 {
  const offset = qrotate(v3(), turn, { x, y, z })
  return { x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z }
}

/** Height over the planet's radius of whatever is under a point, found looking down from `from` over the radius, the way a wheel finds it. */
function castDownAt(world: RAPIER.World, planet: World, point: Vec3, from: number): number | null {
  const up = upOf(point)
  const r = planet.radius + from
  const ray = new RAPIER.Ray({ x: up.x * r, y: up.y * r, z: up.z * r }, { x: -up.x, y: -up.y, z: -up.z })
  const hit = world.castRay(ray, from + 100, true)
  return hit === null ? null : from - hit.timeOfImpact
}

describe('a planet as colliders', () => {
  let planet: World
  let world: RAPIER.World

  beforeAll(async () => {
    await initPhysics()
    // One whole planet for all of them: roads and bridges are what it is for.
    planet = generateTerrain(6, PLANET_TERRAIN).world!
    world = createPhysicsWorld()
    const started = Date.now()
    addTerrain(world, planet)
    world.step()
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 120_000)

  /** Each segment of a road of this structure: its two ends, and the road. */
  const segments = (structure: number): { a: Vec3; b: Vec3 }[] =>
    planet.roads.flatMap((road) => {
      const count = road.points.length
      return Array.from({ length: road.closed ? count : count - 1 }, (_, i) => i)
        .filter((i) => road.structure[i] === structure)
        .map((i) => ({ a: road.points[i]!, b: road.points[(i + 1) % count]! }))
    })
  const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })

  it('stands roads at the height they are drawn, not the bed cut under them', () => {
    const graded = segments(ROAD_GRADE)
    let below = 0
    for (const { a, b } of graded) {
      // Read at three places along the segment. Reading higher than its own deck is a junction:
      // another roadway crossing above this one. Reading lower is a hole, and a hole is a car in a ditch.
      const holed = [0.3, 0.5, 0.7].every((t) => {
        const deck = heightOf(planet, lerp(a, b, t))
        const found = castDownAt(world, planet, lerp(a, b, t), deck + 3)
        return found === null || found < deck - 0.1
      })
      if (holed) below++
    }
    expect(graded.length).toBeGreaterThan(1000)
    expect(below).toBe(0)
  })

  it('runs a floor through every tunnel, with room above it to drive', () => {
    const bores = segments(ROAD_TUNNEL)
    let floored = 0
    let tight = 0
    for (const { a, b } of bores) {
      const middle = lerp(a, b, 0.5)
      const deck = heightOf(planet, middle)
      // From inside the bore, looking down: the road has to be there, or a car reaching the portal drops into the hill.
      const found = castDownAt(world, planet, middle, deck + 1)
      if (found !== null && Math.abs(found - deck) < 0.3) floored++
      // And looking up: nothing of the hill may hang into the bore.
      const up = upOf(middle)
      const r = planet.radius + deck + 0.1
      if (world.castRay(new RAPIER.Ray({ x: up.x * r, y: up.y * r, z: up.z * r }, up), 3, true) !== null) tight++
    }
    expect(bores.length).toBeGreaterThan(20)
    expect(floored).toBe(bores.length)
    expect(tight).toBe(0)
  })

  it('carries a bridge over the gap it spans', () => {
    let spans = 0
    let carried = 0
    for (const { a, b } of segments(ROAD_BRIDGE)) {
      const middle = lerp(a, b, 0.5)
      const deck = heightOf(planet, middle)
      // Only spans that clear something: a deck sitting on the ground proves nothing about whether it holds anything up.
      if (deck - sphereHeight(planet.ground, upOf(middle)) < 1) continue
      spans++
      const found = castDownAt(world, planet, middle, deck + 3)
      if (found !== null && Math.abs(found - deck) < 0.3) carried++
    }
    expect(spans).toBeGreaterThan(20)
    expect(carried / spans).toBeGreaterThan(0.95)
  })

  it('stands every building as a solid to drive into, every tree as a trunk, and passes through the shrubs', () => {
    // A boat is a body of the game's, which moves it; the ground holds everything else.
    const standing = planet.buildings.filter((building) => building.kind !== 'boat')
    expect(standing.length).toBeGreaterThan(100)
    let roofed = 0
    for (const building of standing) {
      const top = heightOf(planet, building.at) + building.height
      const found = castDownAt(world, planet, building.at, top + 5)
      if (found === null) continue
      // A standing stone may carry a lintel, a post a canopy, a site a crane and a pyramid's tier the one above, whose top is what is met above it.
      const carried = (building.kind === 'stone' || building.kind === 'post' || building.kind === 'site' || building.kind === 'pyramid') && found > top
      if (Math.abs(found - top) < 0.02 || carried) roofed++
    }
    expect(roofed).toBe(standing.length)
    const trees = planet.trees.filter((tree) => tree.kind === 'tree')
    const shrubs = planet.trees.filter((tree) => tree.kind === 'shrub')
    expect(trees.length).toBeGreaterThan(50)
    expect(shrubs.length).toBeGreaterThan(50)
    let trunks = 0
    for (const tree of trees) {
      const top = heightOf(planet, tree.at) + tree.height
      const found = castDownAt(world, planet, tree.at, top + 0.5)
      if (found !== null && Math.abs(found - top) < 0.02) trunks++
    }
    // A tree standing under the edge of a raised highway is found from above as the deck over it.
    expect(trunks / trees.length).toBeGreaterThan(0.99)
    let open = 0
    for (const shrub of shrubs) {
      const top = heightOf(planet, shrub.at) + shrub.height
      const found = castDownAt(world, planet, shrub.at, top + 0.5)
      if (found !== null && found < top - 0.1) open++
    }
    expect(open).toBe(shrubs.length)
  })

  it('stands every boulder as a solid its size, and passes through the scree', () => {
    const boulders = planet.rocks.filter((rock) => rock.kind === 'boulder')
    const scree = planet.rocks.filter((rock) => rock.kind === 'scree')
    expect(boulders.length).toBeGreaterThan(20)
    expect(scree.length).toBeGreaterThan(50)
    let topped = 0
    for (const rock of boulders) {
      const top = heightOf(planet, along(rock.at, rock.turn, 0, rock.size, 0))
      const found = castDownAt(world, planet, rock.at, top + 5)
      if (found !== null && Math.abs(found - top) < 0.05) topped++
    }
    expect(topped).toBe(boulders.length)
    let stopped = 0
    for (const rock of scree) {
      const top = heightOf(planet, rock.at) + rock.size
      const found = castDownAt(world, planet, rock.at, top + 5)
      if (found !== null && Math.abs(found - top) < 0.01) stopped++
    }
    expect(stopped).toBeLessThan(scree.length * 0.02)
  })

  it('stands a solid kicker under every ramp, rising from its foot to its lip', () => {
    expect(planet.ramps.length).toBeGreaterThan(0)
    let sound = 0
    for (const ramp of planet.ramps) {
      const foot = heightOf(planet, ramp.at)
      const heights = [0.2, 0.5, 0.8].map((t) => castDownAt(world, planet, along(ramp.at, ramp.turn, 0, 0, ramp.length * t), foot + ramp.rise + 5))
      if (heights.every((h) => h !== null && h > foot - 0.1 && h < foot + ramp.rise + 0.1) && heights[0]! < heights[2]!) sound++
    }
    expect(sound).toBe(planet.ramps.length)
  })

  it('raises a curb around every city block that the wheels find', () => {
    expect(planet.sidewalks.length).toBeGreaterThan(0)
    let curbed = 0
    for (const walk of planet.sidewalks) {
      // The middle of one built side's slab, just in from the curb. Sides go round from the one at +z.
      const side = walk.sides.findIndex((built) => built)
      const reach = walk.half - 0.3
      const [u, v] = ([[0, reach], [-reach, 0], [0, -reach], [reach, 0]] as [number, number][])[side]!
      const point = along(walk.at, walk.turn, u, 0, v)
      const ground = sphereHeight(planet.ground, upOf(point))
      const found = castDownAt(world, planet, point, ground + 1)
      if (found !== null && found > ground + CURB_HEIGHT - 0.1 && found < ground + CURB_HEIGHT + 0.6) curbed++
    }
    expect(curbed).toBe(planet.sidewalks.length)
  })

  it('carries a car on its wheels along the highway, round the curve of the ground', () => {
    const tuning = createVehicleTuning('sportsCar')
    // A straight run of the highway at grade, as near the equator as it runs.
    const highway = planet.roads.find((road) => road.kind === 'highway')!
    let best = 0
    for (let i = 0; i + 12 < highway.points.length; i++) {
      if ([...Array(12).keys()].some((k) => highway.structure[i + k] !== ROAD_GRADE)) continue
      if (Math.abs(highway.points[i]!.y) < Math.abs(highway.points[best]!.y)) best = i
    }
    const position = highway.points[best]!
    const up = upOf(position)
    const vehicle = createVehicle(world, tuning, { position, up, rotation: uprightRotation(up, vsub(v3(), highway.points[best + 3]!, position)) })
    world.step()
    const step = (input: VehicleInput): void => {
      const now = upOf(vehicle.frame.position)
      vehicle.up.x = now.x
      vehicle.up.y = now.y
      vehicle.up.z = now.z
      stepVehicle(world, vehicle, tuning, input, FIXED_TIMESTEP)
      world.step()
    }
    /** How high the chassis is over the highway's surface nearest it. */
    const clearance = (): number => {
      const at = vehicle.frame.position
      let nearest = highway.points[0]!
      for (const point of highway.points) {
        if (Math.hypot(point.x - at.x, point.y - at.y, point.z - at.z) < Math.hypot(nearest.x - at.x, nearest.y - at.y, nearest.z - at.z)) nearest = point
      }
      return heightOf(planet, at) - heightOf(planet, nearest)
    }
    for (let i = 0; i < 120; i++) step(NEUTRAL_INPUT)
    expect(vdot(vehicle.frame.up, vehicle.up)).toBeGreaterThan(0.98)
    expect(vehicle.groundedCount).toBe(4)
    expect(clearance()).toBeGreaterThan(0)
    expect(clearance()).toBeLessThan(1.5)
    expect(vehicle.damage).toBe(0)
    const start = { ...vehicle.frame.position }
    for (let i = 0; i < 60 * 4; i++) step({ ...NEUTRAL_INPUT, throttle: 1 })
    // Well on along the ground, still on its wheels and on the ground: it followed the curve, not flown off it.
    expect(Math.hypot(vehicle.frame.position.x - start.x, vehicle.frame.position.y - start.y, vehicle.frame.position.z - start.z)).toBeGreaterThan(40)
    expect(vdot(vehicle.frame.up, vehicle.up)).toBeGreaterThan(0.9)
    expect(Math.abs(clearance())).toBeLessThan(1.5)
  }, 60_000)
})
