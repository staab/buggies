/**
 * A planet's map, laid out on its flat chart, carried onto the planet: every
 * point through Mercator's projection, every footprint stood upright where
 * it is and scaled as the chart is there.
 */

import { chartFrame, chartToWorld, createChartFrame, qmultiply, quatFromBasis, quatFromYaw, worldToChart, type Planet, type Vec3 } from '@buggies/physics'

import { DISTRICT_COUNTRY } from './districts.ts'
import { sampleHeight } from './heightfield.ts'
import type { SphereMountain } from './sphere-heights.ts'
import type { SphereGround } from './sphere.ts'
import { groundDirections } from './sphere-water.ts'
import type { TerrainMap } from './types.ts'
import { DRY, buildWaterLevels, waterLevelAt } from './water.ts'
import type { Stand, World, WorldLake, WorldLot } from './world.ts'

/** The world a planet's chart map comes to, on the ground it was read off, with the mountains it was raised with. */
export function worldOfChart(map: TerrainMap, ground: SphereGround, planet: Planet, mountains: readonly SphereMountain[]): World {
  const frame = createChartFrame()
  const point = (x: number, height: number, z: number): Vec3 => chartToWorld(planet, x, height, z, { x: 0, y: 0, z: 0 })
  /** How much the chart is scaled at a point of it. */
  const scaleAt = (x: number, z: number): number => chartFrame(planet, x, z, frame).scale
  const stand = (x: number, height: number, z: number, yaw: number): Stand & { scale: number } => {
    chartFrame(planet, x, z, frame)
    const { east, up, south } = frame
    const standing = quatFromBasis(east.x, east.y, east.z, up.x, up.y, up.z, south.x, south.y, south.z)
    return { at: point(x, height, z), turn: qmultiply(standing, quatFromYaw(yaw)), scale: frame.scale }
  }
  const groundAt = (x: number, z: number): number => sampleHeight(map.heightfield, x, z)

  // What each of the ground's grid points is on the chart: its cell, and the chart's scale there; -1 past the chart.
  const directions = groundDirections(ground)
  const count = ground.heights.length
  const cellOf = new Int32Array(count).fill(-1)
  const scaleOf = new Float32Array(count)
  const { width, depth, cellSize } = map.heightfield
  const onChart = { x: 0, y: 0, z: 0 }
  const onSphere = { x: 0, y: 0, z: 0 }
  for (let at = 0; at < count; at++) {
    onSphere.x = directions[at * 3]! * planet.radius
    onSphere.y = directions[at * 3 + 1]! * planet.radius
    onSphere.z = directions[at * 3 + 2]! * planet.radius
    worldToChart(planet, onSphere, onChart)
    scaleOf[at] = Math.sqrt(Math.max(1 - directions[at * 3 + 1]! ** 2, 0))
    const col = Math.round(onChart.x / cellSize)
    const row = Math.round(onChart.z / cellSize)
    if (row < 0 || row >= depth) continue
    cellOf[at] = row * width + ((col % width) + width) % width
  }

  const levels = buildWaterLevels(map)
  const water = new Float32Array(count)
  const districtOf = new Uint8Array(count)
  for (let at = 0; at < count; at++) {
    const cell = cellOf[at]!
    if (cell < 0) {
      water[at] = ground.heights[at]! <= map.seaLevel ? map.seaLevel : DRY
      districtOf[at] = DISTRICT_COUNTRY
      continue
    }
    const level = waterLevelAt(map.heightfield, levels, (cell % width) * cellSize, Math.floor(cell / width) * cellSize)
    water[at] = level === DRY ? DRY : level * scaleOf[at]!
    districtOf[at] = map.districtOf[cell]!
  }

  const lakeOf = new Map<number, number>()
  for (const [id, lake] of map.lakes.entries()) for (const cell of lake.cells) lakeOf.set(cell, id)
  const lakePoints: number[][] = map.lakes.map(() => [])
  for (let at = 0; at < count; at++) {
    const id = cellOf[at]! < 0 ? undefined : lakeOf.get(cellOf[at]!)
    if (id !== undefined) lakePoints[id]!.push(at)
  }
  const lakes: WorldLake[] = map.lakes.map((lake, id) => {
    const points = lakePoints[id]!
    const scale = points.length === 0 ? 1 : points.reduce((sum, at) => sum + scaleOf[at]!, 0) / points.length
    return { id: lake.id, level: lake.level * scale, points }
  })

  const lot = (chart: NonNullable<TerrainMap['roads'][number]['lot']>): WorldLot => {
    const { at, turn, scale } = stand(chart.x, chart.y, chart.z, chart.yaw)
    return { at, turn, width: chart.width * scale, depth: chart.depth * scale }
  }

  return {
    radius: planet.radius,
    seaLevel: map.seaLevel,
    ground,
    water,
    districtOf,
    mountains,
    rivers: map.rivers.map((river) => ({
      id: river.id,
      points: river.points.map((p) => ({ at: point(p.x, p.y, p.z), width: p.width * scaleAt(p.x, p.z) })),
    })),
    lakes,
    districts: map.districts.map((district) => {
      const scale = scaleAt(district.cx, district.cz)
      const center = point(district.cx, 0, district.cz)
      const length = Math.hypot(center.x, center.y, center.z)
      return {
        id: district.id,
        center: { x: center.x / length, y: center.y / length, z: center.z / length },
        radius: district.radius * scale,
        suburbWidth: district.suburbWidth * scale,
        area: district.area,
        island: district.island,
      }
    }),
    roads: map.roads.map((road) => ({
      id: road.id,
      kind: road.kind,
      closed: road.closed,
      points: road.points.map((p) => point(p.x, p.y, p.z)),
      widths: Float32Array.from(road.points, (p) => road.width * scaleAt(p.x, p.z)),
      structure: road.structure,
      ...(road.lot === undefined ? {} : { lot: lot(road.lot) }),
    })),
    buildings: map.buildings.map((building) => {
      const { at, turn, scale } = stand(building.x, building.bottom, building.z, building.yaw)
      return {
        kind: building.kind,
        at,
        turn,
        width: building.width * scale,
        depth: building.depth * scale,
        height: (building.top - building.bottom) * scale,
        tone: building.tone,
      }
    }),
    trees: map.trees.map((tree) => {
      const scale = scaleAt(tree.x, tree.z)
      return { kind: tree.kind, at: point(tree.x, tree.bottom, tree.z), height: tree.height * scale, radius: tree.radius * scale, tone: tree.tone }
    }),
    rocks: map.rocks.map((rock) => {
      const { at, turn, scale } = stand(rock.x, rock.bottom, rock.z, rock.yaw)
      return { kind: rock.kind, at, turn, size: rock.size * scale, tone: rock.tone }
    }),
    props: map.props.map((prop) => {
      const { at, turn } = stand(prop.x, prop.bottom, prop.z, prop.yaw)
      return { kind: prop.kind, at, turn }
    }),
    ramps: map.ramps.map((ramp) => {
      // Climbing along its own z: the way it climbs on the chart, as a yaw from the chart's z toward its x.
      const { at, turn, scale } = stand(ramp.x, ramp.bottom, ramp.z, Math.atan2(ramp.dx, ramp.dz))
      return {
        at,
        turn,
        width: ramp.width * scale,
        length: ramp.length * scale,
        rise: (ramp.top - ramp.bottom) * scale,
        ...(ramp.straight === true ? { straight: true as const } : {}),
      }
    }),
    sidewalks: map.sidewalks.map((sidewalk) => {
      const { at, turn, scale } = stand(sidewalk.x, groundAt(sidewalk.x, sidewalk.z), sidewalk.z, sidewalk.yaw)
      return { at, turn, half: sidewalk.half * scale, band: sidewalk.band * scale, sides: sidewalk.sides }
    }),
    fields: map.fields.map((field) => {
      const { at, turn, scale } = stand(field.x, groundAt(field.x, field.z), field.z, field.yaw)
      return { kind: field.kind, at, turn, width: field.width * scale, depth: field.depth * scale, tone: field.tone }
    }),
  }
}
