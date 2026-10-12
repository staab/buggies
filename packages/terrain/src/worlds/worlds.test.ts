import { describe, expect, it } from 'vitest'

import { ROAD_BRIDGE, ROAD_GRADE, ROAD_WIDTH } from '../roads/constants.ts'
import { DISTRICT_CITY } from '../sphere-districts.ts'
import { sphereHeight } from '../sphere.ts'
import { onLand, roofOver, surfaceUnder, upOf, waterUnder } from '../world-queries.ts'
import { DRY, type World } from '../world.ts'
import { angleBetween, unit } from '../globe/lines.ts'
import { nearestPoint } from '../globe/placing.ts'
import { TUNNEL_CLEARANCE } from '../globe/tunnels.ts'
import { fingerprint } from '../fingerprint.ts'
import { generateWorld } from './index.ts'
import { ROOM_LEAST, roofedAt, roomAt, sealedAt } from './hollows.ts'
import { WORLD_KINDS, WORLD_TRAITS, isMoon, moonOf, planetSeedOf, worldId, worldKindOf } from './kinds.ts'

const SEED = 7

/** Each world of the planet, made once for every test that asks. */
const made = new Map<string, World>()
function world(kind: (typeof WORLD_KINDS)[number]): World {
  const known = made.get(kind)
  if (known !== undefined) return known
  const fresh = generateWorld(worldId(SEED, kind))
  made.set(kind, fresh)
  return fresh
}

/** The highest the ground stands over the radius. */
function highest(map: World): number {
  return map.ground.heights.reduce((most, height) => Math.max(most, height), -Infinity)
}

/** Whether a portal stands where a car can drive up to it: on ground with room over it, and the ring under any roof there. */
function portalsReachable(map: World): void {
  expect(map.portals.length).toBeGreaterThan(0)
  for (const portal of map.portals) {
    const up = upOf(portal.at)
    expect(onLand(map, up)).toBe(true)
    expect(roofOver(map, portal.at)).toBeGreaterThan(sphereHeight(map.ground, up) + portal.radius)
  }
}

describe('the worlds a planet has', () => {
  it('number each kind over the seed, so every one is made from its planet', () => {
    for (const kind of WORLD_KINDS) {
      const id = worldId(12345, kind)
      expect(worldKindOf(id)).toBe(kind)
      expect(planetSeedOf(id)).toBe(12345)
    }
    expect(worldId(12345, 'planet')).toBe(12345)
    expect(isMoon(moonOf(9))).toBe(true)
    expect(isMoon(worldId(9, 'mars'))).toBe(false)
  })

  it('pull weakly on Mercury, and hold its cars to whatever they drive on there alone', () => {
    expect(WORLD_TRAITS.mercury.gravity).toBeLessThan(WORLD_TRAITS.planet.gravity)
    for (const kind of WORLD_KINDS) expect(WORLD_TRAITS[kind].cling > 0).toBe(kind === 'mercury')
  })

  it('make Mars red and open, its mountains twice a planet’s, its cities under bubbles with a road from each to every other', () => {
    const mars = world('mars')
    expect(mars.kind).toBe('mars')
    expect(mars.seed).toBe(worldId(SEED, 'mars'))
    // Twice a planet's: past where a planet's mountains are capped.
    expect(highest(mars)).toBeGreaterThan(100)
    const cities = mars.districts
    expect(cities.length).toBeGreaterThanOrEqual(3)
    expect(mars.roads).toHaveLength((cities.length * (cities.length - 1)) / 2)
    for (const road of mars.roads) expect(road.kind).toBe('arterial')
    for (const city of cities) {
      // Closed over by its bubble, its ground green, room under the bubble.
      const at = nearestPoint(mars.ground, city.center)
      expect(roofedAt(mars.roof, at)).toBe(true)
      expect(mars.districtOf[at]).toBe(DISTRICT_CITY)
      expect(mars.roof[at]! - mars.ground.heights[at]!).toBeGreaterThan(city.radius * 0.4)
      // A road runs out of it to every other city.
      const out = mars.roads.filter((road) => [road.points[0]!, road.points.at(-1)!].some((end) => angleBetween(unit(end), city.center) * mars.radius < city.radius))
      expect(out).toHaveLength(cities.length - 1)
      // Every building under the bubble stands clear of its roof.
      for (const building of mars.buildings) {
        if (angleBetween(unit(building.at), city.center) * mars.radius > city.radius) continue
        const top = Math.hypot(building.at.x, building.at.y, building.at.z) - mars.radius + building.height
        expect(top).toBeLessThan(roofOver(mars, building.at))
      }
    }
    // Each road leaves its bubble through a tunnel open at its far end: roofed at the bubble's foot, open well out from it.
    for (const road of mars.roads) {
      const city = cities.find((c) => angleBetween(unit(road.points[0]!), c.center) * mars.radius < c.radius)!
      const foot = road.points.find((p) => Math.abs(angleBetween(unit(p), city.center) * mars.radius - city.radius - 6) < 4)!
      expect(roofOver(mars, foot)).toBeLessThan(Infinity)
      const beyond = road.points.find((p) => angleBetween(unit(p), city.center) * mars.radius > city.radius + 60)!
      expect(roofOver(mars, beyond)).toBe(Infinity)
    }
    // No sea, and nothing roofed but the bubbles and their tunnels.
    expect(mars.water.every((level) => level === DRY)).toBe(true)
    portalsReachable(mars)
  }, 120_000)

  it('drown Neptune but for its stations and the wide, low tunnels between them, which are dry', () => {
    const neptune = world('neptune')
    expect(highest(neptune)).toBeLessThan(neptune.seaLevel)
    expect(neptune.districts.length).toBeGreaterThanOrEqual(3)
    for (let at = 0; at < neptune.water.length; at += 37) {
      if (roofedAt(neptune.roof, at)) expect(neptune.water[at]).toBe(DRY)
      else expect(neptune.water[at]).toBe(neptune.seaLevel)
    }
    // A road down every tunnel, dry and with room over it, three times as wide as a planet's tunnel and lower than it is wide.
    const planetBore = ROAD_WIDTH / 2 + TUNNEL_CLEARANCE
    for (const road of neptune.roads) {
      const middle = road.points[Math.floor(road.points.length / 2)]!
      const up = upOf(middle)
      expect(waterUnder(neptune, middle)).toBe(DRY)
      expect(onLand(neptune, up)).toBe(true)
      expect(surfaceUnder(neptune, up)).toBeLessThan(neptune.seaLevel)
      const floor = sphereHeight(neptune.ground, up)
      const height = roofOver(neptune, middle) - floor
      expect(height).toBeGreaterThan(ROOM_LEAST * 3)
      // Across the tunnel, at its middle: room out to three times a planet's bore, none past that.
      const next = road.points[Math.floor(road.points.length / 2) + 1]!
      const way = unit({ x: next.x - middle.x, y: next.y - middle.y, z: next.z - middle.z })
      const aside = unit({ x: up.y * way.z - up.z * way.y, y: up.z * way.x - up.x * way.z, z: up.x * way.y - up.y * way.x })
      const out = (meters: number): number => nearestPoint(neptune.ground, unit({ x: up.x + (aside.x * meters) / neptune.radius, y: up.y + (aside.y * meters) / neptune.radius, z: up.z + (aside.z * meters) / neptune.radius }))
      expect(roomAt(neptune.roof, neptune.ground.heights, out(planetBore * 2.5))).toBe(true)
      expect(roofedAt(neptune.roof, out(planetBore * 3 + 12))).toBe(false)
      expect(height).toBeLessThan(planetBore * 3)
    }
    portalsReachable(neptune)
  }, 120_000)

  it('float Jupiter’s cities on platforms over cloud, joined by highways with no rail, and other platforms joined to nothing', () => {
    const jupiter = world('jupiter')
    expect(jupiter.platforms.length).toBeGreaterThan(jupiter.districts.length)
    expect(jupiter.rails.indices.length).toBe(0)
    expect(jupiter.roads.length).toBeGreaterThanOrEqual(jupiter.districts.length - 1)
    for (const road of jupiter.roads) {
      expect(road.structure).toContain(ROAD_BRIDGE)
      expect(road.structure).toContain(ROAD_GRADE)
    }
    // Under the platforms, the cloud: no land there to land on.
    const heights = new Set(jupiter.platforms.map((platform) => Math.round(platform.height)))
    expect(heights.size).toBeGreaterThan(3)
    for (const platform of jupiter.platforms) {
      expect(platform.height).toBeGreaterThan(jupiter.seaLevel)
      expect(onLand(jupiter, platform.center)).toBe(true)
    }
    const loose = jupiter.platforms.slice(jupiter.districts.length)
    for (const platform of loose) {
      for (const road of jupiter.roads) for (const p of road.points) expect(angleBetween(unit(p), platform.center) * jupiter.radius).toBeGreaterThan(platform.radius)
    }
    expect(jupiter.decks.indices.length).toBeGreaterThan(0)
    portalsReachable(jupiter)
  }, 120_000)

  it('cover Venus in giant trees, with villages and no cities, and straight, wide, flat roads between them', () => {
    const venus = world('venus')
    expect(venus.districtOf.includes(DISTRICT_CITY)).toBe(false)
    const giants = venus.trees.filter((tree) => tree.kind === 'tree')
    expect(giants.length).toBeGreaterThan(1000)
    for (const tree of giants) expect(tree.height).toBeGreaterThan(25)
    for (const building of venus.buildings) expect(building.height).toBeLessThan(14)
    expect(venus.roads.length).toBeGreaterThanOrEqual(venus.districts.length - 1)
    for (const road of venus.roads) {
      expect(road.widths[0]).toBeGreaterThan(ROAD_WIDTH)
      const first = unit(road.points[0]!)
      const last = unit(road.points.at(-1)!)
      // Straight: every point on the great circle through its ends.
      const normal = unit({ x: first.y * last.z - first.z * last.y, y: first.z * last.x - first.x * last.z, z: first.x * last.y - first.y * last.x })
      for (const p of road.points) expect(Math.abs(unit(p).x * normal.x + unit(p).y * normal.y + unit(p).z * normal.z) * venus.radius).toBeLessThan(0.5)
      // Flat: gentle all along, and the ground stamped level with it.
      for (let i = 1; i < road.points.length; i++) {
        const rise = Math.hypot(road.points[i]!.x, road.points[i]!.y, road.points[i]!.z) - Math.hypot(road.points[i - 1]!.x, road.points[i - 1]!.y, road.points[i - 1]!.z)
        const run = angleBetween(unit(road.points[i]!), unit(road.points[i - 1]!)) * venus.radius
        expect(Math.abs(rise) / run).toBeLessThan(0.06)
      }
      // Out between the villages, where no other road meets it.
      const between = road.points.filter((p, i) => i % 7 === 3 && venus.districts.every((village) => angleBetween(unit(p), village.center) * venus.radius > village.radius + 30))
      for (const p of between) expect(Math.abs(sphereHeight(venus.ground, unit(p)) - (Math.hypot(p.x, p.y, p.z) - venus.radius))).toBeLessThan(0.5)
    }
    portalsReachable(venus)
  }, 120_000)

  it('hollow Mercury out of solid rock: caverns with round tunnels between them, and no road', () => {
    const mercury = world('mercury')
    expect(mercury.roads).toHaveLength(0)
    expect(mercury.roof.length).toBe(mercury.ground.heights.length)
    let open = 0
    let sealed = 0
    for (let at = 0; at < mercury.roof.length; at++) {
      expect(roofedAt(mercury.roof, at)).toBe(true)
      if (roomAt(mercury.roof, mercury.ground.heights, at)) open++
      if (sealedAt(mercury.roof, mercury.ground.heights, at)) sealed++
    }
    expect(open).toBeGreaterThan(mercury.roof.length * 0.05)
    expect(sealed).toBeGreaterThan(mercury.roof.length * 0.5)
    for (const cavern of mercury.districts) {
      const at = nearestPoint(mercury.ground, cavern.center)
      expect(mercury.roof[at]! - mercury.ground.heights[at]!).toBeGreaterThan(30)
    }
    portalsReachable(mercury)
  }, 120_000)

  it('furnish each world as fits it', () => {
    const kinds = (map: World): Set<string> => new Set([...map.buildings, ...map.trees, ...map.rocks, ...map.props].map((thing) => thing.kind))
    const furnished: Partial<Record<(typeof WORLD_KINDS)[number], string[]>> = {
      mars: ['solar', 'dish', 'silo', 'crate'],
      neptune: ['kelp', 'coral', 'barrel'],
      jupiter: ['beacon', 'turbine', 'watertower', 'flag'],
      venus: ['mushroom', 'pyramid', 'stone'],
      mercury: ['crystal', 'crate', 'barrel'],
    }
    for (const [kind, things] of Object.entries(furnished)) {
      const has = kinds(world(kind as (typeof WORLD_KINDS)[number]))
      for (const thing of things) expect(has, `${kind} has ${thing}`).toContain(thing)
    }
    // Kelp and coral grow out in the open sea, never inside where the cars are.
    const neptune = world('neptune')
    for (const thing of [...neptune.trees, ...neptune.rocks]) expect(roofOver(neptune, thing.at)).toBe(Infinity)
    // A crystal stands under its cavern's roof, a flag on a platform joined to nothing.
    const mercury = world('mercury')
    for (const crystal of mercury.buildings.filter((building) => building.kind === 'crystal')) {
      expect(Math.hypot(crystal.at.x, crystal.at.y, crystal.at.z) - mercury.radius + crystal.height).toBeLessThan(roofOver(mercury, crystal.at))
    }
    const jupiter = world('jupiter')
    const loose = jupiter.platforms.slice(jupiter.districts.length)
    for (const flag of jupiter.buildings.filter((building) => building.kind === 'flag')) {
      expect(loose.some((platform) => angleBetween(unit(flag.at), platform.center) * jupiter.radius < platform.radius)).toBe(true)
    }
  })

  it('make every world the same, bit for bit, from the same id', () => {
    for (const kind of ['neptune', 'mercury', 'jupiter'] as const) expect(fingerprint(generateWorld(worldId(SEED, kind)))).toBe(fingerprint(world(kind)))
  }, 120_000)
})
