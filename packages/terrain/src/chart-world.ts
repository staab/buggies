/**
 * A planet's map, laid out on its flat chart, carried onto the planet: every
 * point through Mercator's projection, every footprint stood upright where
 * it is and scaled as the chart is there.
 */

import { chartFrame, chartToWorld, createChartFrame, worldToChart, type Planet } from '@buggies/physics'

import { deckMesh } from './decks.ts'
import type { GlobeStands } from './globe/buildings.ts'
import { interchangeRings } from './globe/placing.ts'
import { globeRailMesh, globeRailRuns } from './globe/rails.ts'
import { curbSolids, kickerSolids, parkPaths } from './globe/solids.ts'
import type { SphereDistricts } from './sphere-districts.ts'
import type { SphereMountain } from './sphere-heights.ts'
import type { SphereGround } from './sphere.ts'
import { groundDirections } from './sphere-water.ts'
import { TUNNEL_WALL, buildTunnelHoles, tunnelCutFloors, tunnelSegments, tunnelShellMesh } from './tunnels.ts'
import type { TerrainMap } from './types.ts'
import { DRY, buildWaterLevels, waterLevelAt } from './water.ts'
import type { World, WorldLake, WorldMesh, WorldRiver, WorldRoad } from './world.ts'

/**
 * How far under its road the floor of a bore is cut, matching the bed a graded
 * road is given. Cutting only to the road leaves the ground a few centimeters
 * proud of the deck wherever the tunnel climbs, and a few centimeters proud is
 * a lip across the road that a vehicle at speed hits as a step.
 */
const BORE_BED = 0.6

/** The world a planet's chart map comes to, on the ground it was read off, with the mountains it was raised with. */
export function worldOfChart(
  map: TerrainMap,
  ground: SphereGround,
  planet: Planet,
  mountains: readonly SphereMountain[],
  cities: SphereDistricts,
  roads: readonly WorldRoad[],
  water: Float32Array,
  stands: GlobeStands,
): World {
  const count = ground.heights.length
  const { cellSize } = map.heightfield
  const { cellOf, scaleOf } = chartCells(map, ground, planet)
  const onSphere = { x: 0, y: 0, z: 0 }

  /** Chart points, x, height and z each, carried onto the planet. */
  const bend = (positions: ArrayLike<number>): Float32Array => {
    const out = new Float32Array(positions.length)
    for (let i = 0; i < positions.length; i += 3) {
      chartToWorld(planet, positions[i]!, positions[i + 1]!, positions[i + 2]!, onSphere)
      out[i] = onSphere.x
      out[i + 1] = onSphere.y
      out[i + 2] = onSphere.z
    }
    return out
  }
  const mesh = (positions: ArrayLike<number>, indices: ArrayLike<number>): WorldMesh => ({ positions: bend(positions), indices: Uint32Array.from(indices) })

  // The ground where it is driven on: cut to below the road through every tunnel, and a cell's
  // diagonal beyond the bore either side, so no face of the hill leans in over the ledge.
  const cutMargin = cellSize * Math.SQRT2
  const bores = tunnelSegments(map.roads)
  const floors = tunnelCutFloors(map.heightfield, bores, cutMargin)
  const bored = Float32Array.from(ground.heights)
  // Where the drawn ground is left out for the bore to be seen into: the cells the bore takes.
  const boreHoles = buildTunnelHoles(map.heightfield, bores)
  const holes = new Uint8Array(count)
  for (let at = 0; at < count; at++) {
    const cell = cellOf[at]!
    if (cell < 0) continue
    const floor = floors[cell]!
    if (!Number.isNaN(floor)) bored[at] = Math.min(bored[at]!, (floor - BORE_BED) * scaleOf[at]!)
    holes[at] = boreHoles[cell]!
  }
  const shells = map.roads.flatMap((road) => {
    // As thick as a collider as it must be to roof over every face beside a cut cell: the extra is buried in the hill.
    const shell = tunnelShellMesh(road, Math.max(TUNNEL_WALL, 2 * cutMargin))
    return shell === null ? [] : [mesh(shell.positions, shell.indices)]
  })
  const decks = deckMesh(map.roads, map.heightfield)

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

  return {
    seed: map.seed,
    radius: planet.radius,
    seaLevel: map.seaLevel,
    ground,
    districtOf: cities.districtOf,
    bored,
    holes,
    water,
    mountains,
    rivers: riversOfChart(map, planet),
    lakes,
    districts: cities.districts,
    roads,
    ...stands,
    decks: { ...mesh(decks.positions, decks.indices), surfaces: Uint8Array.from(decks.surfaces) },
    paths: parkPaths(ground, interchangeRings(roads, planet.radius)),
    shells,
    rails: globeRailMesh(globeRailRuns(roads, planet.radius), planet.radius),
    curbs: curbSolids(ground, stands.sidewalks),
    kickers: kickerSolids(stands.ramps, planet.radius),
  }
}

/** What each of the ground's grid points is on the chart: its cell, or -1 past the chart, and the chart's scale there. */
export function chartCells(map: TerrainMap, ground: SphereGround, planet: Planet): { cellOf: Int32Array; scaleOf: Float32Array } {
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
    scaleOf[at] = Math.sqrt(Math.max(1 - directions[at * 3 + 1]! * directions[at * 3 + 1]!, 0))
    const col = Math.round(onChart.x / cellSize)
    const row = Math.round(onChart.z / cellSize)
    if (row < 0 || row >= depth) continue
    cellOf[at] = row * width + ((col % width) + width) % width
  }
  return { cellOf, scaleOf }
}

/** The water's surface over each of the ground's grid points, as the chart's rivers and lakes and the sea have it, or `DRY`. */
export function waterOfChart(map: TerrainMap, ground: SphereGround, planet: Planet): Float32Array {
  const { cellOf, scaleOf } = chartCells(map, ground, planet)
  const { width, cellSize } = map.heightfield
  const levels = buildWaterLevels(map)
  const water = new Float32Array(ground.heights.length)
  for (let at = 0; at < water.length; at++) {
    const cell = cellOf[at]!
    if (cell < 0) {
      water[at] = ground.heights[at]! <= map.seaLevel ? map.seaLevel : DRY
      continue
    }
    const level = waterLevelAt(map.heightfield, levels, (cell % width) * cellSize, Math.floor(cell / width) * cellSize)
    water[at] = level === DRY ? DRY : level * scaleOf[at]!
  }
  return water
}

/** The chart's rivers carried onto the planet: the middle of each one's surface, and how wide it runs there. */
export function riversOfChart(map: TerrainMap, planet: Planet): WorldRiver[] {
  const frame = createChartFrame()
  return map.rivers.map((river) => ({
    id: river.id,
    points: river.points.map((p) => ({ at: chartToWorld(planet, p.x, p.y, p.z, { x: 0, y: 0, z: 0 }), width: p.width * chartFrame(planet, p.x, p.z, frame).scale })),
  }))
}
