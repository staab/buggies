import { PLANET_TERRAIN, generateTerrain, mapExtent, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  NEUTRAL_INPUT,
  PICKUP_HEIGHT,
  ROBOT_SIZE,
  advance,
  arm,
  chartPoint,
  createArena,
  createPlanet,
  createVehicleInput,
  initPhysics,
  isLost,
  npcInput,
  respawn,
  seatNpc,
  takeSeat,
  type WorldShape,
} from './index.ts'

let map: TerrainMap
let shape: WorldShape

describe('the game on a planet', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(1, PLANET_TERRAIN)
    const extent = mapExtent(map)
    shape = { kind: 'planet', planet: createPlanet(extent.x, extent.z) }
  }, 60_000)

  it('sets a car down on its spawn, upright, where the map has it, and lets it drive on round the planet', () => {
    const arena = createArena(map, 8, shape)
    const seat = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 120; i++) advance(arena)
    const { x, y, z } = seat.spawn.position
    expect(Math.hypot(seat.chart.position.x - x, seat.chart.position.z - z)).toBeLessThan(2)
    expect(Math.abs(seat.chart.position.y - y)).toBeLessThan(2)
    const { up, frame } = seat.vehicle
    expect(up.x * frame.up.x + up.y * frame.up.y + up.z * frame.up.z).toBeGreaterThan(0.95)
    expect(isLost(arena, seat)).toBe(false)
    expect(seat.vehicle.wrecked).toBe(false)
    const start = { ...seat.chart.position }
    for (let i = 0; i < 60 * 4; i++) advance(arena, (one) => (one === seat ? { ...NEUTRAL_INPUT, throttle: 1 } : NEUTRAL_INPUT))
    expect(Math.hypot(seat.chart.position.x - start.x, seat.chart.position.z - start.z)).toBeGreaterThan(30)
    expect(isLost(arena, seat)).toBe(false)
    arena.world.free()
  }, 60_000)

  it('gives a car the banana it drives onto', () => {
    const arena = createArena(map, 8, shape)
    const seat = takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    arm(seat, 'rocket')
    const banana = arena.pickups[3]!
    respawn(seat, { position: { x: banana.position.x, y: banana.position.y - PICKUP_HEIGHT, z: banana.position.z }, yaw: 0 })
    for (let i = 0; i < 30; i++) advance(arena)
    expect(seat.score).toBe(1)
    arena.world.free()
  }, 60_000)

  it("drives a car nobody drives along its road, and keeps each robot's body where the map has the robot", () => {
    const arena = createArena(map, 8, shape)
    const npc = seatNpc(arena, 7)
    expect(npc).not.toBeNull()
    advance(arena)
    const start = { ...npc!.chart.position }
    const input = createVehicleInput()
    for (let i = 0; i < 60 * 10; i++) advance(arena, (seat) => (seat.npc ? npcInput(arena, seat, input) : NEUTRAL_INPUT))
    expect(Math.hypot(npc!.chart.position.x - start.x, npc!.chart.position.z - start.z)).toBeGreaterThan(20)
    expect(npc!.vehicle.wrecked).toBe(false)
    for (const robot of arena.robots) {
      const middle = chartPoint(shape, { x: robot.position.x, y: robot.position.y + ROBOT_SIZE.halfHeight, z: robot.position.z })
      const body = robot.body.translation()
      expect(Math.hypot(body.x - middle.x, body.y - middle.y, body.z - middle.z)).toBeLessThan(0.5)
    }
    arena.world.free()
  }, 60_000)
})
