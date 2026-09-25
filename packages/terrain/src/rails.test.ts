import { beforeAll, describe, expect, it } from 'vitest'

import { generateTerrain } from './generate.ts'
import { RAIL_BASE, RAIL_FLARE, RAIL_HEIGHT, RAIL_THICKNESS, railMesh, railRuns } from './rails.ts'
import { RAMP_WIDTH, ROAD_BRIDGE, ROAD_GRADE, ROAD_TUNNEL, isSurfaceRoad } from './roads.ts'
import type { Road, RoadPoint, TerrainMap } from './types.ts'

let map: TerrainMap

function nearestRunDistance(runs: ReturnType<typeof railRuns>, x: number, z: number): number {
  let nearest = Infinity
  for (const run of runs) {
    for (const point of run.points) nearest = Math.min(nearest, Math.hypot(point.x - x, point.z - z))
  }
  return nearest
}

function segmentMidpoints(road: Road, structure: number): { x: number; z: number }[] {
  const count = road.points.length
  const segmentCount = road.closed ? count : count - 1
  const middles: { x: number; z: number }[] = []
  for (let i = 0; i < segmentCount; i++) {
    if (road.structure[i] !== structure) continue
    const a = road.points[i]!
    const b = road.points[(i + 1) % count]!
    middles.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })
  }
  return middles
}

describe('guardrails', () => {
  beforeAll(() => {
    map = generateTerrain(1)
  }, 60_000)

  it('line the highway wherever it is in the open, and every bridge', () => {
    const runs = railRuns(map.roads)
    const highway = map.roads.find((road) => road.kind === 'highway')!
    const half = highway.width / 2
    let open = 0
    let railed = 0
    for (const middle of segmentMidpoints(highway, ROAD_GRADE)) {
      open++
      if (nearestRunDistance(runs, middle.x, middle.z) < half + 1) railed++
    }
    expect(open).toBeGreaterThan(100)
    // Only the ramps' mouths go without, each open along the lane's whole
    // way out from under the deck and a flare's length either side.
    expect(railed / open).toBeGreaterThan(0.8)

    for (const road of map.roads) {
      if (!isSurfaceRoad(road)) continue
      for (const middle of segmentMidpoints(road, ROAD_BRIDGE)) {
        expect(nearestRunDistance(runs, middle.x, middle.z)).toBeLessThan(road.width / 2 + 1)
      }
    }
  })

  it('never cut one rail into two runs', () => {
    // Where the road's samples begin is not a break in the rail: a run that
    // ends there and another that begins there would flare across each other.
    const runs = railRuns(map.roads)
    for (const a of runs) {
      const aEnd = a.points[a.flaredEnd ? a.points.length - 2 : a.points.length - 1]!
      const aStart = a.points[a.flaredStart ? 1 : 0]!
      for (const b of runs) {
        if (a === b || a.road !== b.road || a.side !== b.side) continue
        const bStart = b.points[b.flaredStart ? 1 : 0]!
        const bEnd = b.points[b.flaredEnd ? b.points.length - 2 : b.points.length - 1]!
        expect(Math.hypot(aEnd.x - bStart.x, aEnd.z - bStart.z)).toBeGreaterThan(RAIL_FLARE)
        expect(Math.hypot(aStart.x - bEnd.x, aStart.z - bEnd.z)).toBeGreaterThan(RAIL_FLARE)
      }
    }
  })

  it('flare away from the road at each end', () => {
    const runs = railRuns(map.roads)
    /** Distance in plan to the nearest stretch of a road's centerline. */
    const distanceTo = (road: Road, x: number, z: number): number => {
      const count = road.points.length
      const segmentCount = road.closed ? count : count - 1
      let nearest = Infinity
      for (let i = 0; i < segmentCount; i++) {
        const a = road.points[i]!
        const b = road.points[(i + 1) % count]!
        const vx = b.x - a.x
        const vz = b.z - a.z
        const lengthSq = vx * vx + vz * vz || 1
        const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
        nearest = Math.min(nearest, Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)))
      }
      return nearest
    }
    let flares = 0
    for (const run of runs) {
      if (run.points.length < 4) continue
      const { road, side, points } = run
      // Each flared end: the tip, the rail's end it leaves from, and the rail's direction of travel there.
      const ends: [RoadPoint, RoadPoint, RoadPoint, RoadPoint][] = []
      if (run.flaredStart) ends.push([points[0]!, points[1]!, points[1]!, points[2]!])
      const last = points.length - 1
      if (run.flaredEnd) ends.push([points[last]!, points[last - 1]!, points[last - 2]!, points[last - 1]!])
      for (const [tip, from, back, forth] of ends) {
        flares++
        const dx = forth.x - back.x
        const dz = forth.z - back.z
        const length = Math.hypot(dx, dz) || 1
        // Away from the road is the rail's own side of its direction of travel.
        const outX = (-dz / length) * side
        const outZ = (dx / length) * side
        // The tip leans out from the rail line by the flare's lean, and out is away from the road.
        const lean = (tip.x - from.x) * outX + (tip.z - from.z) * outZ
        expect(lean).toBeCloseTo(RAIL_FLARE * Math.sin((15 * Math.PI) / 180), 1)
        expect(distanceTo(road, from.x + outX, from.z + outZ)).toBeGreaterThan(distanceTo(road, from.x, from.z))
      }
    }
    expect(flares).toBeGreaterThan(8)
  })

  it('stand back from every ramp, and stay out of the tunnels', () => {
    const runs = railRuns(map.roads)
    const ramps = map.roads.filter((road) => road.kind === 'ramp')
    expect(ramps.length).toBeGreaterThan(0)
    for (const ramp of ramps) {
      const mouth = ramp.points[0]!
      expect(nearestRunDistance(runs, mouth.x, mouth.z)).toBeGreaterThan(RAMP_WIDTH / 2)
    }
    const highway = map.roads.find((road) => road.kind === 'highway')!
    for (const middle of segmentMidpoints(highway, ROAD_TUNNEL)) {
      expect(nearestRunDistance(runs, middle.x, middle.z)).toBeGreaterThan(3)
    }
  })

  it('make a barrier a block high along each run, standing on the deck inside its edge', () => {
    const runs = railRuns(map.roads)
    const mesh = railMesh(runs)
    const points = runs.reduce((sum, run) => sum + run.points.length, 0)
    expect(mesh.positions.length).toBe(points * 4 * 3)
    for (let i = 0; i < mesh.positions.length; i += 12) {
      // Outer bottom, outer top, inner top, inner bottom.
      expect(mesh.positions[i + 4]! - mesh.positions[i + 1]!).toBeCloseTo(RAIL_HEIGHT - RAIL_BASE, 5)
      expect(mesh.positions[i + 7]! - mesh.positions[i + 10]!).toBeCloseTo(RAIL_HEIGHT - RAIL_BASE, 5)
      const across = Math.hypot(mesh.positions[i + 9]! - mesh.positions[i]!, mesh.positions[i + 11]! - mesh.positions[i + 2]!)
      expect(across).toBeCloseTo(RAIL_THICKNESS, 3)
    }
    // The foot of the barrier is the deck's own edge: no gap between rail and road.
    const highway = map.roads.find((road) => road.kind === 'highway')!
    // The foot of a plain point, not a flare's, which leans out over the shoulder.
    const edge = runs[0]!.points[runs[0]!.flaredStart ? 1 : 0]!
    let nearestDeck = Infinity
    let deckY = 0
    for (const point of highway.points) {
      const distance = Math.hypot(point.x - edge.x, point.z - edge.z)
      if (distance < nearestDeck) {
        nearestDeck = distance
        deckY = point.y
      }
    }
    expect(mesh.positions[1]!).toBeCloseTo(edge.y, 5)
    expect(Math.abs(edge.y - 0.2 - deckY)).toBeLessThan(0.5)

    // Every face looks out of the barrier: the face toward the road at the
    // road, the top up, the far face away, and the end caps along the run.
    const normal = (at: number): { x: number; y: number; z: number } => {
      const corner = (k: number) => ({ x: mesh.positions[k * 3]!, y: mesh.positions[k * 3 + 1]!, z: mesh.positions[k * 3 + 2]! })
      const a = corner(mesh.indices[at]!)
      const b = corner(mesh.indices[at + 1]!)
      const c = corner(mesh.indices[at + 2]!)
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z
      return { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx }
    }
    let at = 0
    for (const run of runs) {
      const stretches = run.points.length - 1
      for (let i = 0; i < stretches; i++) {
        const a = run.points[i]!
        const b = run.points[i + 1]!
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
        const nearest = run.road.points.reduce((best, point) =>
          Math.hypot(point.x - mid.x, point.z - mid.z) < Math.hypot(best.x - mid.x, best.z - mid.z) ? point : best,
        )
        const toRoad = { x: nearest.x - mid.x, z: nearest.z - mid.z }
        const outer = normal(at + i * 18)
        const top = normal(at + i * 18 + 6)
        const inner = normal(at + i * 18 + 12)
        // Flares lean away from the road, so only plain stretches are held to it.
        if ((i > 0 || !run.flaredStart) && (i < stretches - 1 || !run.flaredEnd)) {
          expect(outer.x * toRoad.x + outer.z * toRoad.z).toBeLessThan(0)
          expect(inner.x * toRoad.x + inner.z * toRoad.z).toBeGreaterThan(0)
        }
        expect(top.y).toBeGreaterThan(0)
      }
      const along = {
        x: run.points[stretches]!.x - run.points[stretches - 1]!.x,
        z: run.points[stretches]!.z - run.points[stretches - 1]!.z,
      }
      const back = { x: run.points[0]!.x - run.points[1]!.x, z: run.points[0]!.z - run.points[1]!.z }
      const startCap = normal(at + stretches * 18)
      const endCap = normal(at + stretches * 18 + 6)
      expect(startCap.x * back.x + startCap.z * back.z).toBeGreaterThan(0)
      expect(endCap.x * along.x + endCap.z * along.z).toBeGreaterThan(0)
      at += stretches * 18 + 12
    }
    expect(at).toBe(mesh.indices.length)
    expect(mesh.indices.length).toBeGreaterThan(0)
  })
})
