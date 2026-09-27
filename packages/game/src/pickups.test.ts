import { DRY, generatePlanet, groundUnder, heightOver, tangentFrame, upOf, waterUnder, type World } from '@buggies/terrain'
import type { Vec3 } from '@buggies/physics'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  arm,
  BANANA_REACH,
  BANANA_SLOTS,
  HEALTH_MEND,
  HEALTH_SLOTS,
  NEUTRAL_INPUT,
  PICKUP_HEIGHT,
  PICKUP_HELD,
  PICKUP_RESPAWN_TICKS,
  PICKUP_SLOTS,
  SPILL_FAR,
  SPILL_FLIGHT_TICKS,
  SPILL_NEAR,
  advance,
  createArena,
  initPhysics,
  wreckVehicle,
  pickupKind,
  pickupOut,
  pickupSpot,
  respawn,
  looseOut,
  spawnHere,
  takeSeat,
  type Arena,
  type Loose,
} from './index.ts'
import { apart, between, lifted } from './test-planet.ts'


let map: World
let planet: World

/** A spawn on the ground under a floating pickup, facing east. */
function under(point: Vec3): ReturnType<typeof spawnHere> {
  return spawnHere(lifted(point, -PICKUP_HEIGHT), tangentFrame(upOf(point)).east)
}

describe('pickups', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(11)
    planet = map
  }, 60_000)

  it('are put out over the planet, above dry land or a road, the same every time', () => {
    const arena = createArena(map)
    expect(arena.pickups).toHaveLength(PICKUP_SLOTS)
    let onRoads = 0
    let moved = 0
    for (const [slot, pickup] of arena.pickups.entries()) {
      const { position } = pickup
      const height = heightOver(planet, position)
      // Floating over the ground, or over a road that may be above it or in a tunnel under it.
      const ground = groundUnder(planet, position)
      if (height >= ground) expect(height).toBeGreaterThanOrEqual(ground + PICKUP_HEIGHT - 0.5)
      const water = waterUnder(planet, position)
      if (water !== DRY) expect(height).toBeGreaterThan(water + 1)
      if (Math.abs(height - ground - PICKUP_HEIGHT) > 0.5) onRoads++
      expect(pickupOut(pickup, 0)).toBe(true)
      // Worked out again, it is where it was; the slot's next is elsewhere.
      expect(pickupSpot(planet, slot, 0)).toEqual(position)
      if (apart(pickupSpot(planet, slot, 1), position) > 5) moved++
    }
    // Some are up on decks; most are on the ground or on roads at grade.
    expect(onRoads).toBeLessThan(PICKUP_SLOTS / 2)
    // All but the odd coincidence of a slot's next pickup is well away from its first.
    expect(moved).toBeGreaterThan(PICKUP_SLOTS - 4)
    arena.world.free()
  })

  function driveOnto(arena: Arena, slot: number): ReturnType<typeof takeSeat> {
    const seat = takeSeat(arena, 0, 'sportsCar')
    const { position } = arena.pickups[slot]!
    // On the ground under the pickup, rolling, and armed already, so the
    // banana it takes is kept and counted rather than spent on a weapon.
    arm(seat, 'rocket')
    respawn(seat, under(position))
    return seat
  }

  it('bananas are taken by a vehicle that reaches them, for a point, and turn up elsewhere later', () => {
    const arena = createArena(map)
    const seat = driveOnto(arena, 3)
    const before = { ...arena.pickups[3]!.position }
    for (let i = 0; i < 30; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    expect(seat.collected).toBe(1)
    expect(seat.vehicle.wrecked).toBe(false)
    const banana = arena.pickups[3]!
    expect(banana.generation).toBe(1)
    // Gone for a while, then out again somewhere else.
    expect(pickupOut(banana, arena.tick)).toBe(false)
    expect(banana.spawnTick).toBeGreaterThan(arena.tick)
    expect(banana.spawnTick - arena.tick).toBeLessThanOrEqual(PICKUP_RESPAWN_TICKS)
    expect(pickupOut(banana, banana.spawnTick)).toBe(true)
    expect(apart(banana.position, before)).toBeGreaterThan(1)
    // The one taken is not taken again, and the rest were out of reach.
    for (let i = 0; i < 30; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    arena.world.free()
  })

  it('health packs are left for a car with damage to mend, and mend half of what wrecks one', () => {
    const arena = createArena(map)
    const slot = BANANA_SLOTS + 3
    expect(pickupKind(slot)).toBe('health')
    expect(PICKUP_SLOTS).toBe(BANANA_SLOTS + HEALTH_SLOTS)
    const seat = driveOnto(arena, slot)
    // Undamaged, the car drives through and leaves it.
    for (let i = 0; i < 30; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(arena.pickups[slot]!.generation).toBe(0)
    seat.vehicle.damage = 0.8
    for (let i = 0; i < 30; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(arena.pickups[slot]!.generation).toBe(1)
    expect(seat.vehicle.damage).toBeCloseTo(0.8 - HEALTH_MEND, 2)
    // A health pack is no banana: nothing is scored for it.
    expect(seat.score).toBe(0)
    arena.world.free()
  })

  it('spill from a car blown up, flying out to land about the wreck for anyone to take', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    const b = takeSeat(arena, 1, 'sportsCar')
    a.score = 5
    wreckVehicle(a.vehicle, a.tuning)
    const wreck = { ...a.vehicle.frame.position }
    advance(arena, () => NEUTRAL_INPUT)
    expect(a.score).toBe(0)
    expect(arena.loose).toHaveLength(5)
    // Numbered as they come.
    expect(arena.loose.map((loose) => loose.id)).toEqual([0, 1, 2, 3, 4])
    for (const loose of arena.loose) {
      expect(between(loose.from, wreck)).toBeLessThan(0.1)
      const flung = apart(loose.position, wreck)
      expect(flung).toBeGreaterThanOrEqual(SPILL_NEAR - 0.5)
      expect(flung).toBeLessThanOrEqual(SPILL_FAR + 0.5)
      // Landed on the ground, or on the water where that is higher.
      const surface = Math.max(groundUnder(planet, loose.position), planet.seaLevel)
      expect(heightOver(planet, loose.position)).toBeCloseTo(surface + PICKUP_HEIGHT, 3)
      expect(looseOut(loose, arena.tick)).toBe(false)
      expect(looseOut(loose, loose.bornTick + SPILL_FLIGHT_TICKS)).toBe(true)
    }
    // Nothing more spills as the wreck lies there.
    advance(arena, () => NEUTRAL_INPUT)
    expect(arena.loose).toHaveLength(5)

    // Once one has landed, someone driving onto it takes it, and it is gone:
    // the one lying furthest from the others, so that it is the only one taken.
    const alone = (banana: Loose): number => Math.min(...arena.loose.filter((other) => other !== banana).map((other) => apart(other.position, banana.position)))
    const target = arena.loose.reduce((best, banana) => (alone(banana) > alone(best) ? banana : best))
    expect(alone(target)).toBeGreaterThan(BANANA_REACH + 1)
    arm(b, 'rocket')
    respawn(b, under(target.position))
    for (let i = 0; i < 10; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(b.score).toBe(0)
    for (let i = 0; i < SPILL_FLIGHT_TICKS; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(b.score).toBe(1)
    expect(arena.loose).toHaveLength(4)
    expect(arena.loose.includes(target)).toBe(false)

    // Each one spilled holds a banana slot off the map until it is taken; the one taken has let its slot go.
    const held = (): number => arena.pickups.filter((pickup) => pickup.spawnTick === PICKUP_HELD).length
    expect(held()).toBe(4)
    // The rest lie there until they are taken.
    arena.tick += 60 * 60 * 10
    advance(arena, () => NEUTRAL_INPUT)
    expect(arena.loose).toHaveLength(4)

    // Every banana of a wreck spills, as many as there are banana slots to hold them, taken off the map if need be.
    a.score = BANANA_SLOTS + 40
    advance(arena, () => NEUTRAL_INPUT)
    expect(arena.loose).toHaveLength(BANANA_SLOTS)
    expect(held()).toBe(BANANA_SLOTS)
    expect(arena.pickups.slice(0, BANANA_SLOTS).some((pickup) => pickupOut(pickup, arena.tick))).toBe(false)
    expect(arena.loose[4]!.id).toBe(5)
    arena.world.free()
  })

  it('are not taken by a wreck, and a score goes with the seat', () => {
    const arena = createArena(map)
    const seat = driveOnto(arena, 5)
    seat.vehicle.wrecked = true
    for (let i = 0; i < 10; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(0)
    expect(arena.pickups[5]!.generation).toBe(0)
    // Back on its wheels, and armed again, since a wreck is disarmed: the banana is taken and kept.
    seat.vehicle.wrecked = false
    arm(seat, 'rocket')
    for (let i = 0; i < 10; i++) advance(arena, () => NEUTRAL_INPUT)
    expect(seat.score).toBe(1)
    // Sitting down afresh starts from nothing.
    takeSeat(arena, 0, 'tank')
    expect(seat.score).toBe(0)
    arena.world.free()
  })
})
