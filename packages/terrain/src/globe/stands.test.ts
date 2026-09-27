import { beforeAll, describe, expect, it } from 'vitest'

import { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB } from '../sphere-districts.ts'
import { HOUSE_KINDS, RAISED_KINDS, WATER_KINDS, type BuildingKind } from '../types.ts'
import type { World, WorldBuilding } from '../world.ts'
import { STREET_SPACING, STREET_WIDTH } from '../roads/constants.ts'
import { unit } from './lines.ts'
import { interchangeRings, insideRing, ringCap } from './placing.ts'
import { generatePlanet } from './planet.ts'
import { apart, axes, districtAt, footprintSamples, groundAt, heightOf, planeAt, roadCrowding } from './test-kit.ts'

/** How little some kinds rise above the ground and still stand on it. */
const LOW_KINDS: Partial<Record<BuildingKind, number>> = { stone: 0.8, firepit: 0.3, tent: 1.5, camper: 2, post: 3, sign: 3, site: 2.5, fountain: 1, statue: 2.4 }

let world: World

const of = (kind: BuildingKind): WorldBuilding[] => world.buildings.filter((building) => building.kind === kind)
const top = (building: WorldBuilding): number => heightOf(world, building.at) + building.height
const nearestCity = (p: { x: number; y: number; z: number }): World['districts'][number] =>
  world.districts.reduce((best, city) => (apart(world, city.center, p) < apart(world, best.center, p) ? city : best))

describe("a planet's buildings and trees", () => {
  beforeAll(() => {
    world = generatePlanet(6)
  }, 120_000)

  it('fill the city blocks with buildings of many heights, tallest in the middle', () => {
    const blocks = of('block')
    expect(blocks.length).toBeGreaterThan(200)
    for (const block of blocks) expect(districtAt(world, block.at)).toBe(DISTRICT_CITY)
    const heights = blocks.map((block) => block.height)
    expect(new Set(heights.map(Math.round)).size).toBeGreaterThan(10)
    expect(Math.max(...heights)).toBeGreaterThan(30)
    const rise = (block: WorldBuilding): number => {
      const city = nearestCity(block.at)
      return apart(world, city.center, block.at) / city.radius
    }
    const inner = blocks.filter((block) => rise(block) < 0.35)
    const outer = blocks.filter((block) => rise(block) > 0.7)
    expect(inner.length).toBeGreaterThan(10)
    expect(outer.length).toBeGreaterThan(10)
    const mean = (list: WorldBuilding[]): number => list.reduce((sum, block) => sum + block.height, 0) / list.length
    expect(mean(inner)).toBeGreaterThan(mean(outer) + 5)
  })

  it('line the arterials with houses through the suburbs and trees through the country', () => {
    const houses = world.buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
    expect(new Set(houses.map((house) => house.kind))).toEqual(new Set(HOUSE_KINDS))
    const suburban = houses.filter((house) => districtAt(world, house.at) === DISTRICT_SUBURB)
    const rural = houses.filter((house) => districtAt(world, house.at) === DISTRICT_COUNTRY)
    expect(suburban.length).toBeGreaterThan(50)
    expect(rural.length).toBeGreaterThan(5)
    expect(suburban.length + rural.length).toBe(houses.length)
    const main = world.roads.filter((road) => road.kind === 'arterial' || road.kind === 'cross' || road.kind === 'highway')
    for (const house of houses) {
      const crowding = roadCrowding(world, main, house.at)
      expect(crowding).toBeGreaterThan(1)
      expect(crowding).toBeLessThan(8)
    }
    // The country stretches of the arterials are lined with trees.
    const trees = world.trees.filter((tree) => tree.kind === 'tree')
    let stretches = 0
    let lined = 0
    for (const road of world.roads.filter((candidate) => candidate.kind === 'arterial')) {
      for (let i = 0; i + 1 < road.points.length; i += 8) {
        const point = road.points[i]!
        if (districtAt(world, point) !== DISTRICT_COUNTRY || road.structure[i] !== 0) continue
        stretches++
        if (trees.some((tree) => apart(world, tree.at, point) < road.widths[0]! / 2 + 16)) lined++
      }
    }
    expect(stretches).toBeGreaterThan(20)
    expect(lined).toBeGreaterThan(stretches * 0.6)
  })

  it('wood the open country and leave the heights bare', () => {
    const wild = world.trees.filter((tree) => districtAt(world, tree.at) === DISTRICT_COUNTRY && roadCrowding(world, world.roads, tree.at) > 8)
    expect(wild.filter((tree) => tree.kind === 'tree').length).toBeGreaterThan(500)
    expect(wild.filter((tree) => tree.kind === 'shrub').length).toBeGreaterThan(500)
    let highest = -Infinity
    for (const height of world.ground.heights) highest = Math.max(highest, height)
    // The wilds, well away from the roads, keep below the treeline.
    for (const tree of wild) expect(groundAt(world, tree.at)).toBeLessThan(world.seaLevel + 0.66 * (highest - world.seaLevel))
  })

  it('plant the parks between the city blocks and the gardens round the houses', () => {
    const parks = world.trees.filter((tree) => districtAt(world, tree.at) === DISTRICT_CITY)
    const gardens = world.trees.filter((tree) => districtAt(world, tree.at) === DISTRICT_SUBURB)
    expect(parks.filter((tree) => tree.kind === 'tree').length).toBeGreaterThan(30)
    expect(parks.filter((tree) => tree.kind === 'shrub').length).toBeGreaterThan(30)
    expect(gardens.filter((tree) => tree.kind === 'tree').length).toBeGreaterThan(30)
    expect(gardens.filter((tree) => tree.kind === 'shrub').length).toBeGreaterThan(30)
    const houses = world.buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
    const shrubs = world.trees.filter((tree) => tree.kind === 'shrub')
    const planted = houses.filter((house) => shrubs.some((shrub) => apart(world, house.at, shrub.at) < 12))
    expect(planted.length).toBeGreaterThan(houses.length * 0.65)
  })

  it('scatter boulders and scree on the bare ground, off the roads and out of the water, the boulders big and the scree small', () => {
    const boulders = world.rocks.filter((rock) => rock.kind === 'boulder')
    const scree = world.rocks.filter((rock) => rock.kind === 'scree')
    expect(boulders.length).toBeGreaterThan(20)
    expect(scree.length).toBeGreaterThan(100)
    for (const rock of world.rocks) {
      const ground = groundAt(world, rock.at)
      expect(ground).toBeGreaterThan(world.seaLevel + 0.5)
      expect(roadCrowding(world, world.roads, rock.at)).toBeGreaterThan(1)
      expect([DISTRICT_COUNTRY, DISTRICT_SUBURB]).toContain(districtAt(world, rock.at))
      // Standing a little into the ground.
      expect(heightOf(world, rock.at)).toBeLessThan(ground)
      expect(heightOf(world, rock.at) + rock.size).toBeGreaterThan(ground)
      if (rock.kind === 'boulder') expect(rock.size).toBeGreaterThanOrEqual(2)
      else expect(rock.size).toBeLessThanOrEqual(1.5)
    }
  })

  it('leave props about for a car to knock over: barrels by the filling stations, cones on the suburb roads and bales in the fields', () => {
    const kinds = new Map<string, number>()
    for (const prop of world.props) kinds.set(prop.kind, (kinds.get(prop.kind) ?? 0) + 1)
    expect(world.props.length).toBeGreaterThan(20)
    expect(world.props.length).toBeLessThanOrEqual(250)
    for (const kind of ['barrel', 'cone', 'bale']) expect(kinds.get(kind) ?? 0).toBeGreaterThan(0)
    const shops = of('shop')
    for (const prop of world.props) {
      expect(Math.abs(heightOf(world, prop.at) - groundAt(world, prop.at))).toBeLessThan(0.01)
      const crowding = roadCrowding(world, world.roads, prop.at)
      // Cones stand on the road's edge, as roadworks; everything else keeps off the roads.
      if (prop.kind === 'cone') expect(crowding).toBeLessThan(1.2)
      else expect(crowding).toBeGreaterThan(1)
      if (prop.kind === 'barrel') expect(shops.some((shop) => apart(world, shop.at, prop.at) < 12)).toBe(true)
      if (prop.kind === 'bale') expect(world.fields.some((field) => field.kind === 'crop' && apart(world, field.at, prop.at) < 60)).toBe(true)
    }
  })

  it('moor a few boats off the shore, afloat, and apart', () => {
    const boats = of('boat')
    expect(boats.length).toBeGreaterThanOrEqual(3)
    expect(boats.length).toBeLessThanOrEqual(8)
    for (const boat of boats) {
      expect(groundAt(world, boat.at)).toBeLessThan(world.seaLevel - 1.9)
      expect(heightOf(world, boat.at)).toBeLessThan(world.seaLevel)
      expect(top(boat)).toBeGreaterThan(world.seaLevel)
      for (const other of boats) if (other !== boat) expect(apart(world, other.at, boat.at)).toBeGreaterThanOrEqual(45)
    }
  })

  it('farm the open country: hedged fields in rows, off the mountains, a barn off the end, the farms well apart', () => {
    const crops = world.fields.filter((field) => field.kind === 'crop')
    expect(crops.length).toBeGreaterThanOrEqual(4)
    for (const field of crops) {
      expect(districtAt(world, field.at)).toBe(DISTRICT_COUNTRY)
      const hedge = world.trees.filter((tree) => tree.kind === 'shrub' && apart(world, tree.at, field.at) < Math.hypot(field.width, field.depth) / 2 + 3)
      expect(hedge.length).toBeGreaterThan(10)
    }
    const barns = of('barn')
    expect(barns.length).toBeGreaterThanOrEqual(1)
    for (const barn of barns) {
      expect(crops.some((field) => apart(world, field.at, barn.at) < 80)).toBe(true)
      for (const other of barns) if (other !== barn) expect(apart(world, other.at, barn.at)).toBeGreaterThan(150)
    }
    for (const silo of of('silo')) expect(barns.some((barn) => apart(world, barn.at, silo.at) < 25)).toBe(true)
  })

  it('raise a church where a village is thick enough, its tower beside the nave, and none too near another', () => {
    const churches = of('church')
    const steeples = of('steeple')
    expect(steeples).toHaveLength(churches.length)
    const houses = world.buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
    for (const church of churches) {
      expect(houses.filter((house) => apart(world, house.at, church.at) < 120).length).toBeGreaterThanOrEqual(5)
      expect(steeples.some((steeple) => apart(world, steeple.at, church.at) < 20)).toBe(true)
      for (const other of churches) if (other !== church) expect(apart(world, other.at, church.at)).toBeGreaterThan(600)
    }
  })

  it('stand a water tower at the edge of the suburbs, and run gas stations along the suburb roads', () => {
    const towers = of('watertower')
    expect(towers.length).toBeGreaterThanOrEqual(1)
    expect(towers.length).toBeLessThanOrEqual(world.districts.length)
    for (const tower of towers) expect(districtAt(world, tower.at)).toBe(DISTRICT_SUBURB)
    const canopies = of('canopy')
    expect(canopies.length).toBeGreaterThanOrEqual(1)
    expect(of('shop')).toHaveLength(canopies.length)
    expect(of('post')).toHaveLength(canopies.length * 4)
    for (const canopy of canopies) {
      // In the air over the ground, on a paved lot in the suburbs.
      expect(heightOf(world, canopy.at)).toBeGreaterThan(groundAt(world, canopy.at) + 4)
      expect(world.fields.some((field) => field.kind === 'asphalt' && apart(world, field.at, canopy.at) < 5)).toBe(true)
      expect(districtAt(world, canopy.at)).toBe(DISTRICT_SUBURB)
    }
  })

  it('raise one wind farm: turbines the same distance apart on one line, all facing the same way', () => {
    const turbines = of('turbine')
    expect(turbines.length).toBeGreaterThanOrEqual(4)
    expect(turbines.length).toBeLessThanOrEqual(7)
    const along = turbines.map((turbine) => apart(world, turbine.at, turbines[0]!.at)).sort((a, b) => a - b)
    for (const [i, at] of along.entries()) if (i > 0) expect(at - along[i - 1]!).toBeCloseTo(48, 0)
    // Facing one way: the first's way carried along the ground to each of the others.
    const facing = axes(turbines[0]!.turn).x
    for (const turbine of turbines) {
      const up = unit(turbine.at)
      const rise = facing.x * up.x + facing.y * up.y + facing.z * up.z
      const carried = unit({ x: facing.x - up.x * rise, y: facing.y - up.y * rise, z: facing.z - up.z * rise })
      const x = axes(turbine.turn).x
      expect(x.x * carried.x + x.y * carried.y + x.z * carried.z).toBeGreaterThan(0.99)
    }
  })

  it('ring the open ground with standing stones, each turned broadside to the altar in the middle', () => {
    const all = of('stone')
    expect(all).toHaveLength(13)
    const altar = all.reduce((lowest, stone) => (stone.height < lowest.height ? stone : lowest))
    const flat = planeAt(world, altar.at)
    for (const stone of all) {
      if (stone === altar) continue
      const { x, z } = flat(stone.at)
      const radius = Math.hypot(x, z)
      expect(Math.abs(radius - 14)).toBeLessThan(1.5)
      // Its broad side, its own x, runs across the line to the middle.
      const ax = flat({ x: stone.at.x + axes(stone.turn).x.x, y: stone.at.y + axes(stone.turn).x.y, z: stone.at.z + axes(stone.turn).x.z })
      const dx = ax.x - x
      const dz = ax.z - z
      expect(Math.abs((dx * x + dz * z) / (Math.hypot(dx, dz) * radius))).toBeLessThan(0.3)
    }
    expect(of('lintel').length).toBeGreaterThan(0)
  })

  it('light a headland: one lighthouse at most, on a shore with the sea about it', () => {
    const lighthouses = of('lighthouse')
    expect(lighthouses.length).toBeLessThanOrEqual(1)
    for (const lighthouse of lighthouses) {
      const shore = groundAt(world, lighthouse.at)
      expect(shore).toBeGreaterThan(world.seaLevel + 1)
      expect(shore).toBeLessThan(world.seaLevel + 15)
    }
  })

  it('keep every building and tree off every road and out of the water, standing on the ground', () => {
    for (const building of world.buildings) {
      if (WATER_KINDS.includes(building.kind)) continue
      for (const point of footprintSamples(world, building)) {
        expect(roadCrowding(world, world.roads, point)).toBeGreaterThan(1)
        expect(groundAt(world, point)).toBeGreaterThan(world.seaLevel)
      }
      if (RAISED_KINDS.includes(building.kind)) continue
      const ground = groundAt(world, building.at)
      expect(heightOf(world, building.at)).toBeLessThan(ground)
      expect(top(building)).toBeGreaterThan(ground + (LOW_KINDS[building.kind] ?? 3))
    }
    for (const tree of world.trees) {
      expect(roadCrowding(world, world.roads, tree.at)).toBeGreaterThan(1)
      expect(heightOf(world, tree.at)).toBeCloseTo(groundAt(world, tree.at), 3)
    }
  })
})

describe("a planet's cities", () => {
  beforeAll(() => {
    world ??= generatePlanet(6)
  }, 120_000)

  it('ring the built blocks with sidewalks, a block wide less the street, inside the city', () => {
    expect(world.sidewalks.length).toBeGreaterThan(20)
    let laid = 0
    for (const walk of world.sidewalks) {
      expect(districtAt(world, walk.at)).toBe(DISTRICT_CITY)
      // As deep as a block less its street; as wide as its streets are apart along its far side, which is a little less away from the grid's middle.
      expect(walk.halfDepth).toBeCloseTo(STREET_SPACING / 2 - STREET_WIDTH / 2, 6)
      expect(walk.halfWidth).toBeLessThanOrEqual(walk.halfDepth)
      expect(walk.halfWidth).toBeGreaterThan(walk.halfDepth - 3)
      laid += walk.sides.filter(Boolean).length
      // Something is built on the block it rings.
      const near = (thing: { at: { x: number; y: number; z: number } }): boolean => apart(world, thing.at, walk.at) < walk.halfDepth + 2
      expect(world.buildings.some(near) || world.fields.some(near)).toBe(true)
    }
    expect(laid).toBeGreaterThan(40)
  })

  it('pave a square with a fountain at the heart of a city, and raise a clock tower above every block near it', () => {
    // A square where the heart of a city has a level lot for one, the highway through it leaving room: one to a city at most.
    const fountains = of('fountain')
    expect(fountains.length).toBeLessThanOrEqual(world.districts.length)
    for (const fountain of fountains) {
      expect(world.fields.some((field) => field.kind === 'square' && apart(world, field.at, fountain.at) < 1)).toBe(true)
      const city = nearestCity(fountain.at)
      expect(apart(world, city.center, fountain.at)).toBeLessThan(city.radius * 0.5)
    }
    // A clock tower where a block big enough for one stands near the middle, and never more than one to a city.
    const towers = of('clocktower')
    expect(towers.length).toBeLessThanOrEqual(world.districts.length)
    for (const tower of towers) {
      for (const block of of('block')) if (apart(world, block.at, tower.at) <= 100) expect(top(tower)).toBeGreaterThanOrEqual(top(block) + 10)
    }
  })

  it('plant street trees along the sidewalks, and lay no building on the ground an interchange encloses', () => {
    const rings = interchangeRings(world.roads, world.radius)
    expect(rings.length).toBeGreaterThan(0)
    for (const building of world.buildings) {
      for (const point of footprintSamples(world, building)) {
        expect(rings.some((ring) => apart(world, ringCap(ring, world.radius).middle, point) <= ringCap(ring, world.radius).reach && insideRing(ring, unit(point), world.radius))).toBe(false)
      }
    }
    const cityTrees = world.trees.filter((tree) => tree.kind === 'tree' && districtAt(world, tree.at) === DISTRICT_CITY)
    expect(cityTrees.length).toBeGreaterThan(30)
  })
})

describe("a planet's kickers", () => {
  beforeAll(() => {
    world ??= generatePlanet(6)
  }, 120_000)

  it('stand on the road shoulders, running along the road, off the roadway', () => {
    const kickers = world.ramps.filter((ramp) => !ramp.straight)
    expect(kickers.length).toBeGreaterThan(10)
    const main = world.roads.filter((road) => road.kind === 'arterial' || road.kind === 'cross')
    for (const ramp of kickers) {
      expect(ramp.rise / ramp.length).toBeCloseTo(0.25, 1)
      expect(Math.abs(heightOf(world, ramp.at) - groundAt(world, ramp.at))).toBeLessThan(0.01)
      expect(roadCrowding(world, world.roads, ramp.at)).toBeGreaterThan(1)
      expect(roadCrowding(world, main, ramp.at)).toBeLessThan(3)
    }
  })
})
