import { generateTerrain, sampleHeight, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BOMB_DROP_BACK,
  BUILT_IN_GUNS,
  ENGINE_BURN_TICKS,
  LOOSE_MOST,
  MACHINE_GUN_AMMO_TICKS,
  MACHINE_GUN_DAMAGE,
  NEUTRAL_INPUT,
  NO_TARGET,
  PICKUP_HEIGHT,
  ROCKET_DAMAGE,
  ROCKET_LIFE_TICKS,
  ROCKET_SPEED,
  SPILL_FLIGHT_TICKS,
  SPILL_LIFE_TICKS,
  WEAPONS,
  WINGS_FLIGHT_TICKS,
  advance,
  ammoFor,
  arm,
  createArena,
  initPhysics,
  respawn,
  looseGone,
  takeSeat,
  weaponWon,
  wreckVehicle,
  type Arena,
  type Seat,
  type VehicleInput,
} from './index.ts'

let map: TerrainMap
const FIRE: VehicleInput = { ...NEUTRAL_INPUT, fire: true }

/** Run the arena with one seat holding the fire button and everyone else nothing. */
function fire(arena: Arena, shooter: Seat, ticks: number): number {
  let shots = 0
  for (let i = 0; i < ticks; i++) {
    advance(arena, (seat) => (seat === shooter ? FIRE : NEUTRAL_INPUT))
    shots += arena.shots.length
  }
  return shots
}

/** Two cars: one on its spawn, and another this far ahead of it and this far to its right, facing the same way. */
function pair(arena: Arena, ahead: number, aside: number): [Seat, Seat] {
  const a = takeSeat(arena, 0, 'sportsCar')
  const b = takeSeat(arena, 1, 'sportsCar')
  advance(arena)
  const { position, forward, right } = a.vehicle.frame
  const x = position.x + forward.x * ahead + right.x * aside
  const z = position.z + forward.z * ahead + right.z * aside
  respawn(b, { position: { x, y: sampleHeight(map.heightfield, x, z), z }, yaw: a.spawn.yaw })
  for (let i = 0; i < 30; i++) advance(arena)
  return [a, b]
}

describe('weapons', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, { size: 513 })
  }, 60_000)

  it('are won every tenth banana, and the same one everywhere', () => {
    expect(weaponWon(5, 0, 100, 10)).toBe(weaponWon(5, 0, 100, 10))
    const won = new Set<string>()
    for (let tick = 0; tick < 60; tick++) won.add(weaponWon(5, 0, tick, 10))
    expect([...won].sort()).toEqual([...WEAPONS].sort())

    const arena = createArena(map)
    const seat = takeSeat(arena, 0, 'sportsCar')
    seat.score = 9
    const { position } = arena.pickups[3]!
    respawn(seat, { position: { x: position.x, y: position.y - PICKUP_HEIGHT, z: position.z }, yaw: 0 })
    for (let i = 0; i < 30; i++) advance(arena)
    expect(seat.score).toBe(10)
    expect(WEAPONS).toContain(seat.weapon)
    expect(seat.ammoTicks).toBe(ammoFor(seat.weapon))
    arena.world.free()
  })

  it('the machine gun trains itself on the car ahead, fires while the button is held, and runs dry', () => {
    const arena = createArena(map)
    // Ahead and well off to one side: in the gun's sweep, not on its line.
    const [a, b] = pair(arena, 25, 12)
    arm(a, 'machineGun')
    // Not held: nothing fired, but the gun is on the car already.
    for (let i = 0; i < 10; i++) advance(arena)
    expect(a.ammoTicks).toBe(MACHINE_GUN_AMMO_TICKS)
    expect(b.vehicle.damage).toBe(0)
    expect(a.aimTarget).toBe(b.id)
    expect(b.aimTarget).toBe(NO_TARGET)
    // Held for a second: ten shots, every one into the car ahead.
    expect(fire(arena, a, 60)).toBe(10)
    expect(b.vehicle.damage).toBeCloseTo(10 * MACHINE_GUN_DAMAGE, 6)
    expect(a.ammoTicks).toBe(MACHINE_GUN_AMMO_TICKS - 60)
    expect(a.vehicle.damage).toBe(0)
    // Dry, and gone.
    a.ammoTicks = 12
    fire(arena, a, 12)
    expect(a.weapon).toBe('none')
    expect(a.ammoTicks).toBe(0)
    arena.world.free()
  })

  it('the machine gun does not hit a car behind, and a wreck holds nothing', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, -25, 0)
    arm(a, 'machineGun')
    expect(fire(arena, a, 60)).toBe(10)
    expect(a.aimTarget).toBe(NO_TARGET)
    expect(b.vehicle.damage).toBe(0)
    wreckVehicle(a.vehicle, a.tuning)
    advance(arena)
    expect(a.weapon).toBe('none')
    arena.world.free()
  })

  it('a rocket goes after the car ahead, even off to one side, and blows it up', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 40, 10)
    arm(a, 'rocket')
    b.vehicle.damage = 1 - ROCKET_DAMAGE
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    expect(arena.rockets).toHaveLength(1)
    expect(arena.rockets[0]!.target).toBe(b.id)
    let flew = 0
    while (arena.rockets.length > 0 && flew < ROCKET_LIFE_TICKS) {
      advance(arena)
      flew += 1
    }
    expect(flew).toBeLessThan(ROCKET_LIFE_TICKS)
    expect(b.vehicle.wrecked).toBe(true)
    expect(a.vehicle.damage).toBe(0)
    arena.world.free()
  })

  it('a bomb is dropped behind the car to float there, and goes off on the first car to reach it once landed, its own too', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 40, 0)
    arm(a, 'bomb')
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    expect(arena.loose).toHaveLength(1)
    const bomb = arena.loose[0]!
    expect(bomb.kind).toBe('bomb')
    // Behind the car, floating over the ground, and there for good until it goes off.
    const { position, forward } = a.vehicle.frame
    const behind = { x: position.x - forward.x * BOMB_DROP_BACK, z: position.z - forward.z * BOMB_DROP_BACK }
    expect(Math.hypot(bomb.position.x - behind.x, bomb.position.z - behind.z)).toBeLessThan(0.5)
    expect(bomb.position.y).toBeGreaterThan(sampleHeight(map.heightfield, bomb.position.x, bomb.position.z))
    expect(looseGone(bomb, bomb.bornTick + SPILL_LIFE_TICKS * 10)).toBe(false)
    // The car that dropped it is safe while the bomb is still in the air, and no longer once it has landed.
    respawn(a, { position: { x: bomb.position.x, y: bomb.position.y - PICKUP_HEIGHT, z: bomb.position.z }, yaw: 0 })
    for (let i = 0; i < SPILL_FLIGHT_TICKS - 10; i++) advance(arena)
    expect(a.vehicle.wrecked).toBe(false)
    expect(arena.loose).toHaveLength(1)
    for (let i = 0; i < 20; i++) advance(arena)
    expect(a.vehicle.wrecked).toBe(true)
    expect(b.vehicle.wrecked).toBe(false)
    expect(arena.loose.filter((loose) => loose.kind === 'bomb')).toHaveLength(0)
    arena.world.free()
  })

  it('only so much lies loose at once, the oldest going first', () => {
    const arena = createArena(map)
    takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    // A rocket older than all of it, and far more bananas than the map holds.
    arena.rockets.push({
      id: 1,
      owner: 0,
      target: NO_TARGET,
      position: { x: 100, y: 500, z: 100 },
      velocity: { x: 0, y: 1, z: 0 },
      bornTick: arena.tick - 2,
    })
    for (let i = 0; i < LOOSE_MOST + 40; i++) {
      arena.loose.push({
        id: i,
        kind: i % 5 === 0 ? 'bomb' : 'banana',
        from: { x: 0, y: 0, z: 0 },
        position: { x: 10, y: 500, z: 10 },
        bornTick: arena.tick - 1 + Math.floor(i / 100),
      })
    }
    advance(arena)
    expect(arena.loose.length + arena.rockets.length).toBe(LOOSE_MOST)
    // The rocket went first, then the forty oldest bananas.
    expect(arena.rockets).toHaveLength(0)
    expect(arena.loose[0]!.id).toBe(40)
    arena.world.free()
  })

  it('the rocket engine pushes the car on while the button is held, and burns out in time', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 30; i++) advance(arena)
    arm(a, 'engine')
    fire(arena, a, 120)
    expect(a.vehicle.speed).toBeGreaterThan(8)
    expect(a.ammoTicks).toBe(ENGINE_BURN_TICKS - 120)
    // Let go, and it coasts; what is left keeps.
    for (let i = 0; i < 30; i++) advance(arena)
    expect(a.ammoTicks).toBe(ENGINE_BURN_TICKS - 120)
    fire(arena, a, ENGINE_BURN_TICKS)
    expect(a.weapon).toBe('none')
    arena.world.free()
  })

  it('the wings lift the car into the air while held, let it turn up there, and set it down when let go', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 30; i++) advance(arena)
    const ground = a.vehicle.frame.position.y
    arm(a, 'wings')
    fire(arena, a, 180)
    expect(a.vehicle.frame.position.y - ground).toBeGreaterThan(8)
    expect(a.vehicle.groundedCount).toBe(0)
    expect(a.ammoTicks).toBe(WINGS_FLIGHT_TICKS - 180)
    // Steered while aloft, it comes round.
    const { x: fx, z: fz } = a.vehicle.frame.forward
    for (let i = 0; i < 60; i++) advance(arena, () => ({ ...NEUTRAL_INPUT, fire: true, steer: 1 }))
    const { x: gx, z: gz } = a.vehicle.frame.forward
    expect(fx * gx + fz * gz).toBeLessThan(0.9)
    // Let go: down it comes.
    for (let i = 0; i < 60 * 6; i++) advance(arena)
    expect(a.vehicle.groundedCount).toBeGreaterThan(0)
    arena.world.free()
  })

  it('the tank fires from its own gun, not from over its roof', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'tank')
    const b = takeSeat(arena, 1, 'sportsCar')
    advance(arena)
    const { position, forward, right } = a.vehicle.frame
    const x = position.x + forward.x * 30 + right.x * 4
    const z = position.z + forward.z * 30 + right.z * 4
    respawn(b, { position: { x, y: sampleHeight(map.heightfield, x, z), z }, yaw: a.spawn.yaw })
    for (let i = 0; i < 30; i++) advance(arena)
    const gun = BUILT_IN_GUNS.tank!
    const expected = (): { x: number; y: number; z: number } => {
      const { position, forward, up } = a.vehicle.frame
      return {
        x: position.x + forward.x * gun.ahead + up.x * gun.up,
        y: position.y + forward.y * gun.ahead + up.y * gun.up,
        z: position.z + forward.z * gun.ahead + up.z * gun.up,
      }
    }
    arm(a, 'machineGun')
    fire(arena, a, 1)
    const shot = arena.shots[0]!
    const muzzle = expected()
    expect(shot.hit).toBe(b.id)
    expect(Math.hypot(shot.from.x - muzzle.x, shot.from.y - muzzle.y, shot.from.z - muzzle.z)).toBeLessThan(0.05)
    arm(a, 'rocket')
    fire(arena, a, 1)
    const rocket = arena.rockets[0]!
    const from = expected()
    expect(Math.hypot(rocket.position.x - from.x, rocket.position.y - from.y, rocket.position.z - from.z)).toBeLessThan(
      ROCKET_SPEED / 60 + 0.05,
    )
    arena.world.free()
  })

  it('a rocket with nobody ahead flies straight and is gone in time', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, -40, 0)
    arm(a, 'rocket')
    fire(arena, a, 1)
    expect(arena.rockets[0]!.target).toBe(NO_TARGET)
    for (let i = 0; i < ROCKET_LIFE_TICKS; i++) advance(arena)
    expect(arena.rockets).toHaveLength(0)
    expect(b.vehicle.damage).toBe(0)
    arena.world.free()
  })
})
