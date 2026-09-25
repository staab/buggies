import { beforeAll, describe, expect, it } from 'vitest'

import { DISTRICT_CITY, DISTRICT_COUNTRY, DISTRICT_SUBURB } from './districts.ts'
import { insidePolygon, interchangeZones } from './interchanges.ts'
import { STREET_SPACING, STREET_WIDTH } from './roads.ts'
import { generateTerrain } from './generate.ts'
import { orientedTriangle, signedDistanceToTriangle, triangleInradius } from './mountain.ts'
import { smoothstep } from './noise.ts'
import { HOUSE_KINDS, RAISED_KINDS, WATER_KINDS, type BuildingKind } from './types.ts'

/** How little some kinds rise above the ground and still stand on it. */
const LOW_KINDS: Partial<Record<BuildingKind, number>> = { stone: 0.8, firepit: 0.3, tent: 1.5, caravan: 2, post: 3, sign: 3, wall: 0.5, board: 2 }
import { sampleHeight } from './heightfield.ts'
import type { Building, Road, TerrainMap } from './types.ts'

let map: TerrainMap

function districtAt(x: number, z: number): number {
  const { width, cellSize } = map.heightfield
  return map.districtOf[Math.floor(z / cellSize) * width + Math.floor(x / cellSize)]!
}

/** The district a point of an island lies in. */
function districtOf(island: TerrainMap, x: number, z: number): number {
  const { width, cellSize } = island.heightfield
  return island.districtOf[Math.floor(z / cellSize) * width + Math.floor(x / cellSize)]!
}

/** The corners of a footprint, its centre and the middle of each side. */
function samples(building: Building): { x: number; z: number }[] {
  const cos = Math.cos(building.yaw)
  const sin = Math.sin(building.yaw)
  const points: { x: number; z: number }[] = []
  for (const su of [-1, 0, 1]) {
    for (const sv of [-1, 0, 1]) {
      const u = (su * building.width) / 2
      const v = (sv * building.depth) / 2
      points.push({ x: building.x + u * cos + v * sin, z: building.z - u * sin + v * cos })
    }
  }
  return points
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax
  const vz = bz - az
  const lengthSq = vx * vx + vz * vz || 1
  const t = Math.min(Math.max(((px - ax) * vx + (pz - az) * vz) / lengthSq, 0), 1)
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
}

/** The nearest any road's carriageway comes to a point, as a fraction of its half width: under 1 is on the road. */
function roadCrowding(roads: Road[], x: number, z: number): number {
  let nearest = Infinity
  for (const road of roads) {
    const count = road.closed ? road.points.length : road.points.length - 1
    for (let i = 0; i < count; i++) {
      const a = road.points[i]!
      const b = road.points[(i + 1) % road.points.length]!
      if (Math.min(a.x, b.x) - 4 * road.width > x || Math.max(a.x, b.x) + 4 * road.width < x) continue
      if (Math.min(a.z, b.z) - 4 * road.width > z || Math.max(a.z, b.z) + 4 * road.width < z) continue
      nearest = Math.min(nearest, distanceToSegment(x, z, a.x, a.z, b.x, b.z) / (road.width / 2))
    }
  }
  return nearest
}

/** Whether two footprints overlap in plan, by the separating axis test. */
function overlap(a: Building, b: Building): boolean {
  const cornersOf = (building: Building): { x: number; z: number }[] =>
    samples(building).filter((_, k) => k === 0 || k === 2 || k === 6 || k === 8)
  const axes: { x: number; z: number }[] = []
  for (const building of [a, b]) {
    axes.push({ x: Math.cos(building.yaw), z: -Math.sin(building.yaw) })
    axes.push({ x: Math.sin(building.yaw), z: Math.cos(building.yaw) })
  }
  const cornersA = cornersOf(a)
  const cornersB = cornersOf(b)
  for (const axis of axes) {
    const project = (corners: { x: number; z: number }[]): [number, number] => {
      let low = Infinity
      let high = -Infinity
      for (const corner of corners) {
        const value = corner.x * axis.x + corner.z * axis.z
        low = Math.min(low, value)
        high = Math.max(high, value)
      }
      return [low, high]
    }
    const [lowA, highA] = project(cornersA)
    const [lowB, highB] = project(cornersB)
    if (highA <= lowB || highB <= lowA) return false
  }
  return true
}

describe('buildings and trees', () => {
  beforeAll(() => {
    map = generateTerrain(1)
  }, 60_000)

  it('fill the city blocks with buildings of many heights, tallest in the middle', () => {
    const blocks = map.buildings.filter((building) => building.kind === 'block')
    expect(blocks.length).toBeGreaterThan(200)
    for (const building of blocks) expect(districtAt(building.x, building.z)).toBe(DISTRICT_CITY)
    const heights = blocks.map((building) => building.top - building.bottom)
    expect(new Set(heights.map((height) => Math.round(height))).size).toBeGreaterThan(10)
    expect(Math.max(...heights)).toBeGreaterThan(30)
    expect(Math.min(...heights)).toBeGreaterThan(5)
    // The heart of a city rises above its edge.
    const rise = (building: Building): number => {
      const district = map.districts.reduce((best, candidate) =>
        Math.hypot(candidate.cx - building.x, candidate.cz - building.z) <
        Math.hypot(best.cx - building.x, best.cz - building.z)
          ? candidate
          : best,
      )
      return Math.hypot(district.cx - building.x, district.cz - building.z) / district.radius
    }
    const inner = blocks.filter((building) => rise(building) < 0.35)
    const outer = blocks.filter((building) => rise(building) > 0.7)
    expect(inner.length).toBeGreaterThan(10)
    expect(outer.length).toBeGreaterThan(10)
    const mean = (list: Building[]): number =>
      list.reduce((sum, building) => sum + building.top - building.bottom, 0) / list.length
    expect(mean(inner)).toBeGreaterThan(mean(outer) + 5)
  })

  it('line the arterials with houses through the suburbs and trees through the country', () => {
    const houses = map.buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
    // In all three styles.
    expect(new Set(houses.map((house) => house.kind))).toEqual(new Set(HOUSE_KINDS))
    const suburban = houses.filter((house) => districtAt(house.x, house.z) === DISTRICT_SUBURB)
    const rural = houses.filter((house) => districtAt(house.x, house.z) === DISTRICT_COUNTRY)
    expect(suburban.length).toBeGreaterThan(50)
    expect(rural.length).toBeGreaterThan(5)
    expect(suburban.length + rural.length).toBe(houses.length)
    // Houses stand beside an arterial: near one, and nearer than to any road's half width.
    const arterials = map.roads.filter((road) => road.kind === 'arterial' || road.kind === 'cross')
    for (const house of houses) {
      const crowding = roadCrowding(arterials, house.x, house.z)
      expect(crowding).toBeGreaterThan(1)
      expect(crowding).toBeLessThan(8)
    }
    // And the country stretches of the arterials are lined with trees: walk
    // them, and most places along them have one close by.
    const trees = map.trees.filter((tree) => tree.kind === 'tree')
    let stretches = 0
    let lined = 0
    for (const road of arterials) {
      for (let i = 0; i + 1 < road.points.length; i += 8) {
        const point = road.points[i]!
        if (districtAt(point.x, point.z) !== DISTRICT_COUNTRY || road.structure[i] !== 0) continue
        stretches++
        if (trees.some((tree) => Math.hypot(tree.x - point.x, tree.z - point.z) < road.width / 2 + 16)) lined++
      }
    }
    expect(stretches).toBeGreaterThan(20)
    expect(lined).toBeGreaterThan(stretches * 0.7)
  })

  it('wood the open country and the foothills, and leave the heights bare', () => {
    const trees = map.trees.filter((tree) => tree.kind === 'tree')
    const shrubs = map.trees.filter((tree) => tree.kind === 'shrub')
    const farFromRoads = (standing: { x: number; z: number }): boolean =>
      roadCrowding(map.roads, standing.x, standing.z) > 8 || roadCrowding(map.roads, standing.x, standing.z) === Infinity
    const wildTrees = trees.filter((tree) => districtAt(tree.x, tree.z) === DISTRICT_COUNTRY && farFromRoads(tree))
    const wildShrubs = shrubs.filter((shrub) => districtAt(shrub.x, shrub.z) === DISTRICT_COUNTRY && farFromRoads(shrub))
    expect(wildTrees.length).toBeGreaterThan(500)
    expect(wildShrubs.length).toBeGreaterThan(500)

    // The foothills are planted: the ground round each mountain that has
    // begun to rise but is nowhere near the crest.
    const peak = Math.max(...map.mountains.map((mountain) => mountain.height))
    const foot = (standing: { x: number; z: number }): number =>
      map.mountains.reduce((best, mountain) => {
        const fromCentre = Math.hypot(
          (mountain.ax + mountain.bx + mountain.cx) / 3 - standing.x,
          (mountain.az + mountain.bz + mountain.cz) / 3 - standing.z,
        )
        return Math.min(best, fromCentre)
      }, Infinity)
    const climbing = trees.filter(
      (tree) => sampleHeight(map.heightfield, tree.x, tree.z) > map.seaLevel + peak * 0.12 && foot(tree) < 400,
    )
    expect(climbing.length).toBeGreaterThan(100)
    // But nothing stands on the bare upper slopes.
    let highest = -Infinity
    for (const height of map.heightfield.heights) highest = Math.max(highest, height)
    for (const tree of trees) {
      expect(sampleHeight(map.heightfield, tree.x, tree.z)).toBeLessThan(map.seaLevel + 0.66 * (highest - map.seaLevel))
    }
  })

  it('plant the parks between the city blocks and the gardens round the houses', () => {
    const parks = map.trees.filter((tree) => districtAt(tree.x, tree.z) === DISTRICT_CITY)
    const gardens = map.trees.filter((tree) => districtAt(tree.x, tree.z) === DISTRICT_SUBURB)
    expect(parks.filter((tree) => tree.kind === 'tree').length).toBeGreaterThan(30)
    expect(parks.filter((tree) => tree.kind === 'shrub').length).toBeGreaterThan(30)
    expect(gardens.filter((tree) => tree.kind === 'tree').length).toBeGreaterThan(30)
    expect(gardens.filter((tree) => tree.kind === 'shrub').length).toBeGreaterThan(30)
    // Most houses have a shrub or two out front.
    const houses = map.buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
    const shrubs = map.trees.filter((tree) => tree.kind === 'shrub')
    const planted = houses.filter((house) =>
      shrubs.some((shrub) => Math.hypot(house.x - shrub.x, house.z - shrub.z) < 12),
    )
    expect(planted.length).toBeGreaterThan(houses.length * 0.7)
  })

  it('dam a river at a gorge: one wall from bank to bank, the river under it, its crest over the water and level with the banks', () => {
    let dams = 0
    for (const seed of [1, 3]) {
      const island = seed === 1 ? map : generateTerrain(seed)
      const walls = island.buildings.filter((building) => building.kind === 'dam')
      expect(walls.length).toBeLessThanOrEqual(1)
      for (const wall of walls) {
        dams++
        const { heightfield } = island
        const cos = Math.cos(wall.yaw)
        const sin = Math.sin(wall.yaw)
        // A river runs under it, well below its crest.
        const river = island.rivers
          .flatMap((r) => r.points)
          .reduce((best, point) =>
            Math.hypot(point.x - wall.x, point.z - wall.z) < Math.hypot(best.x - wall.x, best.z - wall.z) ? point : best,
          )
        expect(Math.hypot(river.x - wall.x, river.z - wall.z)).toBeLessThan(wall.width / 2)
        expect(wall.top).toBeGreaterThan(river.y + 8)
        // Both ends stand in the banks, at about the crest's height.
        for (const su of [-1, 1]) {
          const x = wall.x + (su * wall.width * cos) / 2
          const z = wall.z - (su * wall.width * sin) / 2
          expect(sampleHeight(heightfield, x, z)).toBeGreaterThan(wall.top - 4)
        }
        // And the wall's foot is on the riverbed, under the water.
        expect(wall.bottom).toBeLessThan(river.y)
      }
    }
    expect(dams).toBeGreaterThanOrEqual(1)
  }, 120_000)

  it('run a chair lift up a mountainside: two stations, and pylons on one line between them, spaced and climbing', () => {
    let lifts = 0
    for (const seed of [1, 2, 3]) {
      const island = seed === 1 ? map : generateTerrain(seed)
      const stations = island.buildings.filter((building) => building.kind === 'station')
      const pylons = island.buildings.filter((building) => building.kind === 'pylon')
      expect(stations.length === 0 || stations.length === 2).toBe(true)
      if (stations.length === 0) {
        expect(pylons).toHaveLength(0)
        continue
      }
      lifts++
      const [a, b] = stations as [Building, Building]
      const bottom = a.top < b.top ? a : b
      const top = a.top < b.top ? b : a
      const length = Math.hypot(top.x - bottom.x, top.z - bottom.z)
      const dx = (top.x - bottom.x) / length
      const dz = (top.z - bottom.z) / length
      expect(pylons.length).toBeGreaterThanOrEqual(2)
      // On the line, evenly spaced, each higher than the last, and all on a mountain.
      const ordered = [...pylons].sort((p, q) => p.tone - q.tone)
      let lastAlong = 0
      let lastTop = bottom.top
      for (const pylon of ordered) {
        const along = (pylon.x - bottom.x) * dx + (pylon.z - bottom.z) * dz
        const off = Math.abs((pylon.x - bottom.x) * dz - (pylon.z - bottom.z) * dx)
        expect(off).toBeLessThan(0.5)
        expect(along - lastAlong).toBeCloseTo(40, 0)
        expect(pylon.top).toBeGreaterThan(lastTop)
        expect(pylon.top - pylon.bottom).toBeGreaterThan(13)
        expect(island.mountains.some((mountain) => signedDistanceToTriangle(pylon.x, pylon.z, orientedTriangle(mountain)) >= -mountain.skirt)).toBe(true)
        lastAlong = along
        lastTop = pylon.top
      }
      expect(top.top).toBeGreaterThan(lastTop)
      // Steep enough to be a lift, and not a cliff.
      const grade = (top.top - bottom.top) / length
      expect(grade).toBeGreaterThan(0.2)
      expect(grade).toBeLessThan(1.1)
    }
    expect(lifts).toBeGreaterThanOrEqual(1)
  }, 120_000)

  it('park at a viewpoint at the top of a mountain road: a level lot the road runs into, with a wall on the valley side and a board', () => {
    let viewpoints = 0
    for (const seed of [1, 2, 3, 4]) {
      const island = seed === 1 ? map : generateTerrain(seed)
      const lots = island.fields.filter((field) => field.kind === 'carpark' && districtOf(island, field.x, field.z) === DISTRICT_COUNTRY)
      const walls = island.buildings.filter((building) => building.kind === 'wall')
      const boards = island.buildings.filter((building) => building.kind === 'board')
      expect(lots.length).toBeLessThanOrEqual(1)
      expect(walls.length).toBe(lots.length)
      expect(boards.length).toBe(lots.length)
      for (const lot of lots) {
        viewpoints++
        const sin = Math.sin(lot.yaw)
        const cos = Math.cos(lot.yaw)
        // In the lot's own frame: u along its width, v across its depth toward the valley.
        const frame = (x: number, z: number): { u: number; v: number } => ({
          u: (x - lot.x) * cos - (z - lot.z) * sin,
          v: (x - lot.x) * sin + (z - lot.z) * cos,
        })
        // The mountain road ends inside the lot.
        const climb = island.roads.find((road) => road.kind === 'climb')
        expect(climb).toBeDefined()
        const end = frame(climb!.points.at(-1)!.x, climb!.points.at(-1)!.z)
        expect(Math.abs(end.u)).toBeLessThan(lot.width / 2)
        expect(Math.abs(end.v)).toBeLessThan(lot.depth / 2)
        // The lot is level, and the road's end sits on it.
        const at = (u: number, v: number): number => sampleHeight(island.heightfield, lot.x + u * cos + v * sin, lot.z - u * sin + v * cos)
        const corners = [at(0, 0), at(-14, -9), at(14, -9), at(-14, 9), at(14, 9)]
        expect(Math.max(...corners) - Math.min(...corners)).toBeLessThan(0.6)
        expect(Math.abs(climb!.points.at(-1)!.y - at(end.u, end.v))).toBeLessThan(0.5)
        // The wall along the valley side, low, with the ground falling away beyond it.
        const wall = walls[0]!
        const edge = { x: lot.x + (sin * lot.depth) / 2, z: lot.z + (cos * lot.depth) / 2 }
        expect(Math.hypot(wall.x - edge.x, wall.z - edge.z)).toBeLessThan(1)
        expect(wall.top - wall.bottom).toBeLessThan(4)
        expect(at(0, lot.depth / 2 + 16)).toBeLessThan(at(0, 0) - 2)
        // The board stands within the lot, near the wall.
        const board = frame(boards[0]!.x, boards[0]!.z)
        expect(Math.abs(board.u)).toBeLessThan(lot.width / 2)
        expect(board.v).toBeGreaterThan(lot.depth / 2 - 4)
        expect(board.v).toBeLessThan(lot.depth / 2)
      }
    }
    expect(viewpoints).toBeGreaterThanOrEqual(3)
  }, 240_000)

  it('scatter boulders and scree on the bare high ground, off the roads and out of the water, the boulders big and the scree small', () => {
    const { heightfield, seaLevel, mountains, roads } = map
    const boulders = map.rocks.filter((rock) => rock.kind === 'boulder')
    const scree = map.rocks.filter((rock) => rock.kind === 'scree')
    expect(boulders.length).toBeGreaterThan(30)
    expect(scree.length).toBeGreaterThan(300)
    let highest = -Infinity
    for (const height of heightfield.heights) highest = Math.max(highest, height)
    const treeline = seaLevel + 0.65 * (highest - seaLevel)
    const shapes = mountains.map((mountain) => {
      const triangle = orientedTriangle(mountain)
      return { triangle, inradius: Math.max(triangleInradius(triangle), 1e-3), skirt: mountain.skirt }
    })
    const rise = (x: number, z: number): number =>
      Math.max(0, ...shapes.map((shape) => smoothstep(-shape.skirt, shape.inradius, signedDistanceToTriangle(x, z, shape.triangle))))
    const slope = (x: number, z: number): number => {
      const step = heightfield.cellSize
      const dx = sampleHeight(heightfield, x + step, z) - sampleHeight(heightfield, x - step, z)
      const dz = sampleHeight(heightfield, x, z + step) - sampleHeight(heightfield, x, z - step)
      return Math.hypot(dx, dz) / (2 * step)
    }
    for (const rock of map.rocks) {
      const ground = sampleHeight(heightfield, rock.x, rock.z)
      // On bare ground: above the treeline, on a mountain's upper part, or on ground too steep to grow on.
      expect(ground >= treeline || rise(rock.x, rock.z) >= 0.6 || slope(rock.x, rock.z) > 0.6).toBe(true)
      expect(ground).toBeGreaterThan(seaLevel + 0.5)
      expect(roadCrowding(roads, rock.x, rock.z)).toBeGreaterThan(1)
      expect([DISTRICT_COUNTRY, DISTRICT_SUBURB]).toContain(districtOf(map, rock.x, rock.z))
      // Standing a little into the ground, and about as tall as it is wide.
      expect(rock.bottom).toBeLessThan(ground)
      expect(rock.bottom + rock.size).toBeGreaterThan(ground)
      if (rock.kind === 'boulder') {
        expect(rock.size).toBeGreaterThanOrEqual(2)
        expect(rock.size).toBeLessThanOrEqual(5)
      } else {
        expect(rock.size).toBeGreaterThanOrEqual(0.5)
        expect(rock.size).toBeLessThanOrEqual(1.5)
        expect(slope(rock.x, rock.z)).toBeGreaterThan(0.3)
      }
    }
    // No boulder stands on another, or on anything built.
    for (const rock of boulders) {
      for (const other of boulders) {
        if (other !== rock) expect(Math.hypot(other.x - rock.x, other.z - rock.z)).toBeGreaterThan((rock.size + other.size) / 2 - 1e-6)
      }
      for (const building of map.buildings) {
        expect(Math.hypot(building.x - rock.x, building.z - rock.z)).toBeGreaterThan(rock.size / 2 - 1e-6)
      }
    }
  })

  it('moor a few boats off the shore, in deep enough water, with the shore in sight but not close, and apart', () => {
    const boats = map.buildings.filter((building) => building.kind === 'boat')
    expect(boats.length).toBeGreaterThanOrEqual(3)
    expect(boats.length).toBeLessThanOrEqual(8)
    const { seaLevel, heightfield } = map
    const landWithin = (x: number, z: number, reach: number): boolean => {
      for (let k = 0; k < 16; k++) {
        const angle = (k * Math.PI * 2) / 16
        if (sampleHeight(heightfield, x + Math.cos(angle) * reach, z + Math.sin(angle) * reach) >= seaLevel) return true
      }
      return false
    }
    for (const boat of boats) {
      expect(sampleHeight(heightfield, boat.x, boat.z)).toBeLessThan(seaLevel - 1.9)
      expect(landWithin(boat.x, boat.z, 25)).toBe(false)
      expect(landWithin(boat.x, boat.z, 120)).toBe(true)
      // Afloat: its keel under the water and its deck above.
      expect(boat.bottom).toBeLessThan(seaLevel)
      expect(boat.top).toBeGreaterThan(seaLevel)
      for (const other of boats) {
        if (other !== boat) expect(Math.hypot(other.x - boat.x, other.z - boat.z)).toBeGreaterThanOrEqual(45)
      }
    }
  })

  it('raise one observatory at most, on a mountain top, on about half the islands', () => {
    let domes = 0
    for (let seed = 1; seed <= 8; seed++) {
      const island = generateTerrain(seed, { size: 257 })
      const observatories = island.buildings.filter((building) => building.kind === 'observatory')
      expect(observatories.length).toBeLessThanOrEqual(1)
      domes += observatories.length
      for (const observatory of observatories) {
        // Inside a mountain's own triangle, on its highest ground.
        const triangles = island.mountains.map(orientedTriangle)
        const home = triangles.find((triangle) => signedDistanceToTriangle(observatory.x, observatory.z, triangle) >= 0)
        expect(home).toBeDefined()
        const here = sampleHeight(island.heightfield, observatory.x, observatory.z)
        let highest = -Infinity
        const { cellSize, width, depth, heights } = island.heightfield
        for (let row = 0; row < depth; row++) {
          for (let col = 0; col < width; col++) {
            if (signedDistanceToTriangle(col * cellSize, row * cellSize, home!) < 0) continue
            highest = Math.max(highest, heights[row * width + col]!)
          }
        }
        expect(here).toBeGreaterThan(highest - 0.5)
        expect(observatory.width).toBe(observatory.depth)
      }
    }
    expect(domes).toBeGreaterThan(0)
    expect(domes).toBeLessThan(8)
  }, 60_000)

  it('farm the open country: hedged fields in rows on ground flat enough to plough, a barn and a silo off the end', () => {
    const fields = map.fields.filter((field) => field.kind === 'crop')
    expect(fields.length).toBeGreaterThanOrEqual(4)
    const roadPoints = map.roads.flatMap((road) => road.points)
    for (const field of fields) {
      expect(districtAt(field.x, field.z)).toBe(DISTRICT_COUNTRY)
      const cos = Math.cos(field.yaw)
      const sin = Math.sin(field.yaw)
      // No road runs through it.
      const inside = roadPoints.some((point) => {
        const dx = point.x - field.x
        const dz = point.z - field.z
        return Math.abs(dx * cos - dz * sin) < field.width / 2 && Math.abs(dx * sin + dz * cos) < field.depth / 2
      })
      expect(inside).toBe(false)
      // And it is hedged: shrubs near its edges.
      const hedge = map.trees.filter(
        (tree) => tree.kind === 'shrub' && Math.hypot(tree.x - field.x, tree.z - field.z) < Math.hypot(field.width, field.depth) / 2 + 3,
      )
      expect(hedge.length).toBeGreaterThan(10)
    }
    const barns = map.buildings.filter((building) => building.kind === 'barn')
    const silos = map.buildings.filter((building) => building.kind === 'silo')
    expect(barns.length).toBeGreaterThanOrEqual(1)
    expect(silos.length).toBeGreaterThanOrEqual(1)
    for (const barn of barns) {
      expect(fields.some((field) => Math.hypot(field.x - barn.x, field.z - barn.z) < 80)).toBe(true)
      // One farm to a place: no two barns near each other.
      for (const other of barns) {
        if (other !== barn) expect(Math.hypot(other.x - barn.x, other.z - barn.z)).toBeGreaterThan(60)
      }
    }
    for (const silo of silos) {
      expect(barns.some((barn) => Math.hypot(barn.x - silo.x, barn.z - silo.z) < 25)).toBe(true)
      expect(silo.width).toBe(silo.depth)
    }
  })

  it('plant orchards: fruit trees in rows, hedged, in the country', () => {
    const fruit = map.trees.filter((tree) => tree.kind === 'fruit')
    expect(fruit.length).toBeGreaterThan(20)
    let inRows = 0
    for (const tree of fruit) {
      expect(districtAt(tree.x, tree.z)).toBe(DISTRICT_COUNTRY)
      // In rows: nearly every one has another within a row's reach, and none is nearer than the spacing allows.
      const near = fruit.filter((other) => other !== tree && Math.hypot(other.x - tree.x, other.z - tree.z) < 8)
      if (near.length > 0) inRows++
      for (const other of near) expect(Math.hypot(other.x - tree.x, other.z - tree.z)).toBeGreaterThan(5.5)
      expect(tree.height).toBeLessThan(5)
    }
    expect(inRows).toBeGreaterThan(fruit.length * 0.9)
  })

  it('raise a church where a village is thick enough, its tower beside the nave, and none too near another', () => {
    const churches = map.buildings.filter((building) => building.kind === 'church')
    const steeples = map.buildings.filter((building) => building.kind === 'steeple')
    expect(churches.length).toBeGreaterThanOrEqual(1)
    expect(steeples).toHaveLength(churches.length)
    const houses = map.buildings.filter((building) => HOUSE_KINDS.includes(building.kind))
    for (const church of churches) {
      const village = houses.filter((house) => Math.hypot(house.x - church.x, house.z - church.z) < 120)
      expect(village.length).toBeGreaterThanOrEqual(5)
      expect(steeples.some((steeple) => Math.hypot(steeple.x - church.x, steeple.z - church.z) < 20)).toBe(true)
      for (const other of churches) {
        if (other !== church) expect(Math.hypot(other.x - church.x, other.z - church.z)).toBeGreaterThan(600)
      }
    }
  })

  it('stand a water tower at the edge of each suburb, one at most', () => {
    const towers = map.buildings.filter((building) => building.kind === 'watertower')
    expect(towers.length).toBeGreaterThanOrEqual(1)
    expect(towers.length).toBeLessThanOrEqual(map.districts.length)
    for (const tower of towers) {
      expect(districtAt(tower.x, tower.z)).toBe(DISTRICT_SUBURB)
      expect(tower.top - tower.bottom).toBeGreaterThan(20)
      for (const other of towers) {
        if (other !== tower) expect(Math.hypot(other.x - tower.x, other.z - tower.z)).toBeGreaterThan(300)
      }
    }
  })

  it('run a filling station every so far along the suburb roads: shop, canopy on posts, and a sign on a paved lot', () => {
    const canopies = map.buildings.filter((building) => building.kind === 'canopy')
    const shops = map.buildings.filter((building) => building.kind === 'shop')
    const posts = map.buildings.filter((building) => building.kind === 'post')
    const signs = map.buildings.filter((building) => building.kind === 'sign')
    const aprons = map.fields.filter((field) => field.kind === 'asphalt')
    expect(canopies.length).toBeGreaterThanOrEqual(1)
    expect(shops).toHaveLength(canopies.length)
    expect(signs).toHaveLength(canopies.length)
    expect(posts).toHaveLength(canopies.length * 4)
    expect(aprons).toHaveLength(canopies.length)
    for (const canopy of canopies) {
      // In the air over the ground, on a paved lot in the suburbs, beside a main road.
      expect(canopy.bottom).toBeGreaterThan(sampleHeight(map.heightfield, canopy.x, canopy.z) + 4)
      expect(aprons.some((apron) => Math.hypot(apron.x - canopy.x, apron.z - canopy.z) < 5)).toBe(true)
      expect(districtAt(canopy.x, canopy.z)).toBe(DISTRICT_SUBURB)
      const main = map.roads.filter((road) => road.kind !== 'street')
      expect(roadCrowding(main, canopy.x, canopy.z)).toBeLessThan(8)
      for (const other of canopies) {
        if (other !== canopy) expect(Math.hypot(other.x - canopy.x, other.z - canopy.z)).toBeGreaterThan(600)
      }
    }
  })

  it('pitch camps in the country near a road: tents round a fire, caravans by, trees round the rim', () => {
    const firepits = map.buildings.filter((building) => building.kind === 'firepit')
    const tents = map.buildings.filter((building) => building.kind === 'tent')
    const caravans = map.buildings.filter((building) => building.kind === 'caravan')
    expect(firepits.length).toBeGreaterThanOrEqual(1)
    expect(firepits.length).toBeLessThanOrEqual(3)
    const main = map.roads.filter((road) => road.kind !== 'street')
    for (const fire of firepits) {
      expect(districtAt(fire.x, fire.z)).toBe(DISTRICT_COUNTRY)
      for (const other of firepits) {
        if (other !== fire) expect(Math.hypot(other.x - fire.x, other.z - fire.z)).toBeGreaterThan(100)
      }
      const ring = tents.filter((tent) => Math.hypot(tent.x - fire.x, tent.z - fire.z) < 15)
      expect(ring.length).toBeGreaterThanOrEqual(4)
      expect(caravans.some((caravan) => Math.hypot(caravan.x - fire.x, caravan.z - fire.z) < 20)).toBe(true)
      const nearest = Math.min(...main.flatMap((road) => road.points.map((point) => Math.hypot(point.x - fire.x, point.z - fire.z))))
      expect(nearest).toBeGreaterThan(25)
      expect(nearest).toBeLessThan(65)
      const rim = map.trees.filter(
        (tree) => tree.kind === 'tree' && Math.abs(Math.hypot(tree.x - fire.x, tree.z - fire.z) - 19) < 2,
      )
      expect(rim.length).toBeGreaterThan(8)
    }
  })

  it('raise one wind farm: a line of turbines the same distance apart, all facing the same way', () => {
    const turbines = map.buildings.filter((building) => building.kind === 'turbine')
    expect(turbines.length).toBeGreaterThanOrEqual(4)
    expect(turbines.length).toBeLessThanOrEqual(7)
    const first = turbines[0]!
    const last = turbines[turbines.length - 1]!
    const span = Math.hypot(last.x - first.x, last.z - first.z)
    const dx = (last.x - first.x) / span
    const dz = (last.z - first.z) / span
    const along = turbines.map((turbine) => (turbine.x - first.x) * dx + (turbine.z - first.z) * dz).sort((a, b) => a - b)
    for (const [i, at] of along.entries()) {
      if (i > 0) expect(at - along[i - 1]!).toBeCloseTo(48, 0)
    }
    for (const turbine of turbines) {
      const off = Math.abs((turbine.x - first.x) * dz - (turbine.z - first.z) * dx)
      expect(off).toBeLessThan(0.01)
      expect(turbine.yaw).toBe(first.yaw)
      expect(turbine.top - turbine.bottom).toBeGreaterThan(40)
    }
  })

  it('ring the open ground with standing stones, each turned to face the altar in the middle', () => {
    const all = map.buildings.filter((building) => building.kind === 'stone')
    // The altar lies in the middle; the rest stand round it.
    expect(all).toHaveLength(13)
    const altar = all.reduce((lowest, stone) => (stone.top - stone.bottom < lowest.top - lowest.bottom ? stone : lowest))
    const stones = all.filter((stone) => stone !== altar)
    const centre = { x: altar.x, z: altar.z }
    for (const stone of stones) {
      const rx = stone.x - centre.x
      const rz = stone.z - centre.z
      const radius = Math.hypot(rx, rz)
      expect(Math.abs(radius - 14)).toBeLessThan(1.5)
      expect(stone.top - stone.bottom).toBeGreaterThan(6)
      // Its broad side, along its own X, runs across the line to the middle.
      const across = (Math.cos(stone.yaw) * rx - Math.sin(stone.yaw) * rz) / radius
      expect(Math.abs(across)).toBeLessThan(0.3)
      expect(districtAt(stone.x, stone.z)).toBe(DISTRICT_COUNTRY)
    }
    // Some neighbours carry a lintel: laid between the two, resting on both, which stand the same height.
    const lintels = map.buildings.filter((building) => building.kind === 'lintel')
    expect(lintels.length).toBeGreaterThan(0)
    expect(lintels.length).toBeLessThan(stones.length)
    for (const lintel of lintels) {
      const under = [...stones].sort(
        (a, b) => Math.hypot(a.x - lintel.x, a.z - lintel.z) - Math.hypot(b.x - lintel.x, b.z - lintel.z),
      )
      const [left, right] = under
      expect(left).toBeDefined()
      expect(right).toBeDefined()
      expect(left!.top).toBeCloseTo(right!.top, 1)
      expect(lintel.bottom).toBeCloseTo(left!.top - 0.15, 3)
      expect(Math.hypot((left!.x + right!.x) / 2 - lintel.x, (left!.z + right!.z) / 2 - lintel.z)).toBeLessThan(0.01)
      expect(lintel.width).toBeGreaterThan(Math.hypot(left!.x - right!.x, left!.z - right!.z))
    }
  })

  it('light a headland: one lighthouse at most, on a shore with the sea about it', () => {
    const lighthouses = map.buildings.filter((building) => building.kind === 'lighthouse')
    expect(lighthouses).toHaveLength(1)
    const { seaLevel, heightfield } = map
    for (const lighthouse of lighthouses) {
      const shore = sampleHeight(heightfield, lighthouse.x, lighthouse.z)
      expect(shore).toBeGreaterThan(seaLevel + 1)
      expect(shore).toBeLessThan(seaLevel + 15)
      let sea = 0
      for (let k = 0; k < 16; k++) {
        const angle = (k * Math.PI * 2) / 16
        if (sampleHeight(heightfield, lighthouse.x + Math.cos(angle) * 30, lighthouse.z + Math.sin(angle) * 30) < seaLevel) sea++
      }
      expect(sea / 16).toBeGreaterThanOrEqual(0.45)
      for (const other of lighthouses) {
        if (other !== lighthouse) expect(Math.hypot(other.x - lighthouse.x, other.z - lighthouse.z)).toBeGreaterThan(400)
      }
    }
  })

  it('keep every building and tree off every road and out of the water', () => {
    for (const building of map.buildings) {
      // A boat floats on the sea, and a dam stands across a river, on purpose.
      if (WATER_KINDS.includes(building.kind)) continue
      for (const point of samples(building)) {
        expect(roadCrowding(map.roads, point.x, point.z)).toBeGreaterThan(1)
        expect(sampleHeight(map.heightfield, point.x, point.z)).toBeGreaterThan(map.seaLevel)
      }
      // Standing on the ground, not floating above it or lost in it. A stone may lie low, as the altar
      // does, and so may a fire pit or a tent; a lintel rests on stones and a canopy on posts, not the ground.
      if (RAISED_KINDS.includes(building.kind)) continue
      expect(building.bottom).toBeLessThan(sampleHeight(map.heightfield, building.x, building.z))
      const least = LOW_KINDS[building.kind] ?? 3
      expect(building.top).toBeGreaterThan(sampleHeight(map.heightfield, building.x, building.z) + least)
    }
    for (const tree of map.trees) {
      expect(roadCrowding(map.roads, tree.x, tree.z)).toBeGreaterThan(1)
      expect(tree.bottom).toBeCloseTo(sampleHeight(map.heightfield, tree.x, tree.z), 3)
    }
  })

  it('never stand two buildings in the same place', () => {
    const buildings = map.buildings
    for (let i = 0; i < buildings.length; i++) {
      const a = buildings[i]!
      const reachA = Math.hypot(a.width, a.depth) / 2
      if (RAISED_KINDS.includes(a.kind)) continue
      for (let j = i + 1; j < buildings.length; j++) {
        const b = buildings[j]!
        // A lintel lies across two stones, and a canopy over its posts, on purpose.
        if (RAISED_KINDS.includes(b.kind)) continue
        if (Math.hypot(a.x - b.x, a.z - b.z) > reachA + Math.hypot(b.width, b.depth) / 2) continue
        expect(overlap(a, b)).toBe(false)
      }
    }
  })
})

describe('ramps', () => {
  beforeAll(() => {
    map ??= generateTerrain(1)
  }, 60_000)

  it('stand on the road shoulders, running along the road, at a grade to fly off', () => {
    expect(map.ramps.length).toBeGreaterThan(10)
    for (const ramp of map.ramps) {
      expect((ramp.top - ramp.bottom) / ramp.length).toBeCloseTo(0.25, 1)
      expect(Math.abs(sampleHeight(map.heightfield, ramp.x, ramp.z) - ramp.bottom)).toBeLessThan(0.01)
      // Beside a road, off its carriageway but within a car's width of it,
      // and pointing along it.
      const middle = { x: ramp.x + (ramp.dx * ramp.length) / 2, z: ramp.z + (ramp.dz * ramp.length) / 2 }
      let nearest = Infinity
      let alongRoad = 0
      for (const road of map.roads) {
        if (road.kind !== 'arterial' && road.kind !== 'cross') continue
        for (let i = 0; i + 1 < road.points.length; i++) {
          const a = road.points[i]!
          const b = road.points[i + 1]!
          const distance = distanceToSegment(middle.x, middle.z, a.x, a.z, b.x, b.z) - road.width / 2
          if (distance < nearest) {
            nearest = distance
            const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
            alongRoad = Math.abs((ramp.dx * (b.x - a.x) + ramp.dz * (b.z - a.z)) / length)
          }
        }
      }
      expect(nearest).toBeGreaterThan(0)
      expect(nearest).toBeLessThan(ramp.width + 1)
      expect(alongRoad).toBeGreaterThan(0.95)
      expect(roadCrowding(map.roads, ramp.x, ramp.z)).toBeGreaterThan(1)
    }
  })
})

describe('sidewalks', () => {
  beforeAll(() => {
    map ??= generateTerrain(1)
  }, 60_000)

  it('ring the built city blocks, a block wide less the street, each side along a street inside the city', () => {
    expect(map.sidewalks.length).toBeGreaterThan(20)
    const blocks = map.buildings.filter((building) => building.kind === 'block')
    const carparks = map.fields.filter((field) => field.kind === 'carpark')
    const streets = map.roads.filter((road) => road.kind === 'street')
    /** Whether a street's centreline passes within a lane of the point. */
    const onStreet = (x: number, z: number): boolean =>
      streets.some((street) => {
        const a = street.points[0]!
        const b = street.points[street.points.length - 1]!
        const dx = b.x - a.x
        const dz = b.z - a.z
        const t = Math.min(Math.max(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0), 1)
        return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) <= street.width / 2 + 1
      })
    let laidSides = 0
    for (const walk of map.sidewalks) {
      expect(districtAt(walk.x, walk.z)).toBe(DISTRICT_CITY)
      expect(walk.half).toBeCloseTo(STREET_SPACING / 2 - STREET_WIDTH / 2, 6)
      expect(walk.band).toBeGreaterThan(1)
      // Something is built on the block it rings.
      const near = (thing: { x: number; z: number }): boolean => Math.hypot(thing.x - walk.x, thing.z - walk.z) < walk.half + 2
      expect(blocks.some(near) || carparks.some(near)).toBe(true)
      // And each laid side lies in the city, with a street running the whole side long.
      const cos = Math.cos(walk.yaw)
      const sin = Math.sin(walk.yaw)
      const mid = walk.half - walk.band / 2
      const street = STREET_SPACING / 2
      for (const [k, laid] of walk.sides.entries()) {
        if (!laid) continue
        laidSides++
        const u = k === 1 ? -mid : k === 3 ? mid : 0
        const v = k === 0 ? mid : k === 2 ? -mid : 0
        expect(districtAt(walk.x + u * cos - v * sin, walk.z + u * sin + v * cos)).toBe(DISTRICT_CITY)
        for (const t of [-(walk.half - 1), 0, walk.half - 1]) {
          const su = k === 0 || k === 2 ? t : k === 1 ? -street : street
          const sv = k === 1 || k === 3 ? t : k === 0 ? street : -street
          expect(onStreet(walk.x + su * cos - sv * sin, walk.z + su * sin + sv * cos)).toBe(true)
        }
      }
    }
    expect(laidSides).toBeGreaterThan(40)
  })

  it('mark out car parks on some of the open lots, and plant street trees along the sidewalks', () => {
    // A car park is in the city, but for a viewpoint's at the top of a mountain road.
    const carparks = map.fields.filter((field) => field.kind === 'carpark' && districtAt(field.x, field.z) !== DISTRICT_COUNTRY)
    expect(carparks.length).toBeGreaterThanOrEqual(1)
    for (const lot of carparks) expect(districtAt(lot.x, lot.z)).toBe(DISTRICT_CITY)
    let onSidewalks = 0
    for (const tree of map.trees) {
      if (tree.kind !== 'tree' || districtAt(tree.x, tree.z) !== DISTRICT_CITY) continue
      for (const walk of map.sidewalks) {
        const dx = tree.x - walk.x
        const dz = tree.z - walk.z
        if (Math.hypot(dx, dz) > walk.half + 1) continue
        const cos = Math.cos(walk.yaw)
        const sin = Math.sin(walk.yaw)
        const u = dx * cos + dz * sin
        const v = -dx * sin + dz * cos
        if (Math.abs(Math.max(Math.abs(u), Math.abs(v)) - (walk.half - walk.band / 2)) < 0.5) {
          onSidewalks++
          break
        }
      }
    }
    expect(onSidewalks).toBeGreaterThan(30)
  })
})

describe('interchanges', () => {
  beforeAll(() => {
    map ??= generateTerrain(1)
  }, 60_000)

  it('have no building, sidewalk or kicker on the ground their ramps enclose', () => {
    const zones = interchangeZones(map.roads)
    expect(zones.length).toBeGreaterThan(0)
    const inside = (x: number, z: number): boolean => zones.some((zone) => insidePolygon(zone, x, z))
    for (const building of map.buildings) {
      for (const point of samples(building)) expect(inside(point.x, point.z)).toBe(false)
    }
    for (const walk of map.sidewalks) {
      // The middle of every built side.
      const reach = walk.half - walk.band / 2
      const middles = [
        [0, reach],
        [-reach, 0],
        [0, -reach],
        [reach, 0],
      ]
      for (const [side, [u, v]] of middles.entries()) {
        if (!walk.sides[side]) continue
        const x = walk.x + u! * Math.cos(walk.yaw) - v! * Math.sin(walk.yaw)
        const z = walk.z + u! * Math.sin(walk.yaw) + v! * Math.cos(walk.yaw)
        expect(inside(x, z)).toBe(false)
      }
    }
    for (const ramp of map.ramps) expect(inside(ramp.x, ramp.z)).toBe(false)
  })
})
