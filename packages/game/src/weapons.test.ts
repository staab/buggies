import { vdot, type Vec3 } from '@buggies/physics'
import { PLANET_TERRAIN, alongGround, atHeight, generateTerrain, groundUnder, heightOver, tangentFrame, upOf, type TerrainMap } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  armorShare,
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
  LASER_AMMO_TICKS,
  LASER_DAMAGE,
  BOMB_DAMAGE,
  DURABILITY,
  ROCKET_LIFE_TICKS,
  ROCKET_SPEED,
  SPILL_FLIGHT_TICKS,
  WEAPONS,
  WINGS_FLIGHT_TICKS,
  HOP_SPEED,
  HORN_RANGE,
  HORN_STUN_TICKS,
  OWN_ACTIONS,
  OWN_BOMBS_MOST,
  OWN_BOMB_POWER,
  OWN_GUN_POWER,
  OWN_MISSILE_POWER,
  AMBULANCE_HEAL,
  AMBULANCE_HEAL_TICKS,
  FIRETRUCK_BOMB_SHARE,
  POLICE_SHOT_SHARE,
  SHOCKWAVE_STUN_TICKS,
  SIREN_SLOW,
  SIREN_TICKS,
  EMERGENCY_SLOW,
  advance,
  ammoFor,
  arm,
  createArena,
  initPhysics,
  respawn,
  spawnHere,
  looseGone,
  nosePoint,
  takeSeat,
  weaponWon,
  NATIVE_POWER_UPS,
  VEHICLE_PROFILE_IDS,
  wingsTurnRadius,
  worldGravity,
  disarm,
  BANANAS_PER_WEAPON,
  wreckVehicle,
  GRAPPLE_TICKS,
  GRAPPLE_MISS_TICKS,
  MAGNET_REACH,
  MINES,
  MINE_POWER,
  OIL_GRIP,
  OIL_LIFE_TICKS,
  OIL_SLIP_TICKS,
  OWN_OILS_MOST,
  OWN_OIL_POWER,
  SHIELD_TICKS,
  TRIPLE_ROCKETS,
  TRIPLE_ROCKET_POWER,
  type Loose,
  type Arena,
  type Seat,
  type VehicleInput,
  type VehicleProfileId,
} from './index.ts'
import { nearestRoadSpotTo } from './spawns.ts'
import { ahead, angleBetween, apart, lifted } from './test-planet.ts'


let map: TerrainMap
const FIRE: VehicleInput = { ...NEUTRAL_INPUT, fire: true }
const ABILITY: VehicleInput = { ...NEUTRAL_INPUT, ability: true }

/** Run the arena with one seat holding the fire button and everyone else nothing. */
/**
 * What a car stands on at a point: the road there, where one runs, which
 * may be up on an embankment or a deck; the ground otherwise.
 */
function surfaceAt(point: Vec3): Vec3 {
  const planet = map.world!
  const ground = groundUnder(planet, point)
  const spot = nearestRoadSpotTo(planet, point)
  const onRoad = spot !== null && apart(spot.point, point) <= (spot.road.widths[spot.index] ?? 0) / 2 + ROAD_POINT_SLACK
  return atHeight(planet, upOf(point), onRoad ? Math.max(ground, heightOver(planet, spot.point)) : ground)
}

/** Set a car down on what it would stand on at a point, facing this way, or east. */
function setDown(seat: Seat, point: Vec3, facing?: Vec3): void {
  respawn(seat, spawnHere(surfaceAt(point), facing ?? tangentFrame(upOf(point)).east))
}

/** The point this far ahead of a car and this far to its right. */
function besides(seat: Seat, forward: number, aside: number): Vec3 {
  const { position, right } = seat.vehicle.frame
  return ahead(ahead(position, seat.vehicle.frame.forward, forward), right, aside)
}

/** How fast a car goes along the ground, and which way. */
function going(seat: Seat): Vec3 {
  return alongGround(seat.vehicle.frame.linearVelocity, seat.vehicle.up)
}
/** How far past a road's edge a point may be from the nearest of its points, which are spaced out along it, and still be on it. */
const ROAD_POINT_SLACK = 6

function fire(arena: Arena, shooter: Seat, ticks: number): number {
  let shots = 0
  for (let i = 0; i < ticks; i++) {
    advance(arena, (seat) => (seat === shooter ? FIRE : NEUTRAL_INPUT))
    shots += arena.shots.length
  }
  return shots
}

/** Two cars: one on its spawn, and another this far ahead of it and this far to its right, facing the same way. */
function pair(arena: Arena, forward: number, aside: number): [Seat, Seat] {
  const a = takeSeat(arena, 0, 'sportsCar')
  const b = takeSeat(arena, 1, 'sportsCar')
  advance(arena)
  setDown(b, besides(a, forward, aside), a.vehicle.frame.forward)
  for (let i = 0; i < 30; i++) advance(arena)
  return [a, b]
}

describe('weapons', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generateTerrain(11, PLANET_TERRAIN)
  }, 60_000)

  it('are bought with bananas, the same one everywhere, by a car carrying nothing', () => {
    expect(weaponWon(5, 0, 100, 10, 'goKart')).toBe(weaponWon(5, 0, 100, 10, 'goKart'))
    const won = new Set<string>()
    for (let tick = 0; tick < 60; tick++) won.add(weaponWon(5, 0, tick, 10, 'goKart'))
    expect([...won].sort()).toEqual([...WEAPONS].sort())
    // A car never wins what it already has of its own.
    for (const profile of VEHICLE_PROFILE_IDS) {
      const theirs = new Set<string>()
      for (let tick = 0; tick < 300; tick++) theirs.add(weaponWon(5, 0, tick, 10, profile))
      for (const native of NATIVE_POWER_UPS[profile]) expect(theirs.has(native)).toBe(false)
      expect(theirs.size).toBe(WEAPONS.length - NATIVE_POWER_UPS[profile].length)
    }

    const arena = createArena(map)
    const seat = takeSeat(arena, 0, 'sportsCar')
    // One banana short: nothing bought until the next is taken, and then it is spent at once.
    seat.score = BANANAS_PER_WEAPON - 1
    const { position } = arena.pickups[3]!
    setDown(seat, lifted(position, -PICKUP_HEIGHT))
    for (let i = 0; i < 30; i++) advance(arena)
    expect(seat.score).toBe(0)
    expect(WEAPONS).toContain(seat.weapon)
    expect(seat.ammoTicks).toBe(ammoFor(seat.weapon))

    // Taken while armed, a banana is kept, and what is carried stays.
    const held = seat.weapon
    seat.score = 0
    const next = arena.pickups[4]!.position
    setDown(seat, lifted(next, -PICKUP_HEIGHT))
    for (let i = 0; i < 30; i++) advance(arena)
    expect(seat.score).toBe(1)
    expect(seat.weapon).toBe(held)

    // Once what is carried is gone, the bananas kept buy the next at once.
    seat.score = BANANAS_PER_WEAPON + 2
    disarm(seat)
    respawn(seat, spawnHere(lifted(seat.vehicle.frame.position, 200), seat.vehicle.frame.forward))
    advance(arena)
    expect(WEAPONS).toContain(seat.weapon)
    expect(seat.score).toBe(2)
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
    expect(b.vehicle.damage).toBeCloseTo((10 * MACHINE_GUN_DAMAGE) / DURABILITY, 6)
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

  it('the laser burns the car ahead for as long as the key is held, tick by tick, and runs dry', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 40, 0)
    arm(a, 'laser')
    expect(a.ammoTicks).toBe(LASER_AMMO_TICKS)
    const lit = fire(arena, a, 60)
    expect(lit).toBeGreaterThan(0)
    expect(a.aimTarget).toBe(b.id)
    expect(b.vehicle.damage).toBeCloseTo((60 * LASER_DAMAGE) / DURABILITY, 3)
    expect(arena.shots.every((shot) => shot.kind === 'laser')).toBe(true)
    fire(arena, a, LASER_AMMO_TICKS)
    expect(a.weapon).toBe('none')
    arena.world.free()
  })

  it('a rocket goes after the car ahead, even off to one side, and blows it up, a kill to whoever fired it', () => {
    const arena = createArena(map)
    // Off to one side, but still on the road, clear of the banks either side of it.
    const [a, b] = pair(arena, 40, 4)
    arm(a, 'rocket')
    b.vehicle.damage = 1 - ROCKET_DAMAGE / DURABILITY
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
    expect(a.kills).toBe(1)
    expect(b.kills).toBe(0)
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
    expect(apart(bomb.position, ahead(position, forward, -BOMB_DROP_BACK))).toBeLessThan(0.5)
    expect(heightOver(arena.planet, bomb.position)).toBeGreaterThan(groundUnder(arena.planet, bomb.position))
    expect(looseGone(bomb, bomb.bornTick + 60 * 60 * 60)).toBe(false)
    // The car that dropped it is safe while the bomb is still in the air, and no longer once it has landed.
    setDown(a, bomb.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS - 10; i++) advance(arena)
    expect(a.vehicle.wrecked).toBe(false)
    expect(arena.loose).toHaveLength(1)
    for (let i = 0; i < 20; i++) advance(arena)
    expect(a.vehicle.damage).toBeGreaterThanOrEqual(BOMB_DAMAGE / DURABILITY - 1e-6)
    expect(b.vehicle.damage).toBe(0)
    expect(arena.loose.filter((loose) => loose.kind === 'bomb')).toHaveLength(0)
    arena.world.free()
  })

  it('only so many bombs, mines, slicks and rockets lie loose at once, the oldest going first, and spilled bananas are not among them', () => {
    const arena = createArena(map)
    takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    // A rocket older than all of it, far more bombs, mines and slicks than the map holds, and bananas among them.
    arena.rockets.push({
      id: 1,
      owner: 0,
      target: NO_TARGET,
      position: { x: 100, y: 500, z: 100 },
      velocity: { x: 0, y: 1, z: 0 },
      bornTick: arena.tick - 2,
      power: 1,
    })
    const kinds = ['bomb', 'mine', 'oil'] as const
    for (let i = 0; i < LOOSE_MOST + 40; i++) {
      arena.loose.push({
        id: i,
        kind: kinds[i % 3]!,
        owner: 0,
        power: 1,
        from: { x: 0, y: 0, z: 0 },
        position: { x: 10, y: 500, z: 10 },
        bornTick: arena.tick - 1 + Math.floor(i / 100),
      })
    }
    for (let i = 0; i < 50; i++) {
      arena.loose.push({ id: 1000 + i, kind: 'banana', owner: 0, power: 0, from: { x: 0, y: 0, z: 0 }, position: { x: 20, y: 500, z: 20 }, bornTick: arena.tick - 5 })
    }
    advance(arena)
    const others = arena.loose.filter((loose) => loose.kind !== 'banana')
    expect(others.length + arena.rockets.length).toBe(LOOSE_MOST)
    expect(arena.loose.filter((loose) => loose.kind === 'banana')).toHaveLength(50)
    // The rocket went first, then the forty oldest of the rest.
    expect(arena.rockets).toHaveLength(0)
    expect(others[0]!.id).toBe(40)
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
    const ground = heightOver(arena.planet, a.vehicle.frame.position)
    arm(a, 'wings')
    fire(arena, a, 180)
    expect(heightOver(arena.planet, a.vehicle.frame.position) - ground).toBeGreaterThan(8)
    expect(a.vehicle.groundedCount).toBe(0)
    expect(a.ammoTicks).toBe(WINGS_FLIGHT_TICKS - 180)
    // The throttle drives it along up there.
    const drive: VehicleInput = { ...NEUTRAL_INPUT, fire: true, throttle: 1 }
    const before = { ...a.vehicle.frame.position }
    for (let i = 0; i < 90; i++) advance(arena, () => drive)
    expect(a.vehicle.groundedCount).toBe(0)
    expect(apart(a.vehicle.frame.position, before)).toBeGreaterThan(3)
    // Steered, it banks into a wide turn: the way it is going comes around gradually, its nose
    // following, and it levels off again once the steering is let go.
    const was = going(a)
    const from = { ...a.vehicle.frame.position }
    let leaned = 0
    for (let i = 0; i < 120; i++) {
      advance(arena, () => ({ ...drive, steer: 1 }))
      leaned = Math.max(leaned, Math.abs(vdot(a.vehicle.frame.right, a.vehicle.up)))
    }
    const swung = angleBetween(going(a), was)
    expect(swung).toBeGreaterThan(0.3)
    expect(swung).toBeLessThan(2.5)
    expect(leaned).toBeGreaterThan(0.15)
    // It faces the way it is going, through the turn.
    expect(angleBetween(alongGround(a.vehicle.frame.forward, a.vehicle.up), going(a))).toBeLessThan(Math.acos(0.98))
    // The arc is a wide one: the chord it has flown around says so.
    const chord = apart(a.vehicle.frame.position, from)
    expect(chord / (2 * Math.sin(swung / 2))).toBeGreaterThan(wingsTurnRadius(a.tuning) * 0.5)
    for (let i = 0; i < 60; i++) advance(arena, () => drive)
    expect(vdot(a.vehicle.frame.up, a.vehicle.up)).toBeGreaterThan(0.95)
    // Let go: down it comes.
    for (let i = 0; i < 60 * 6; i++) advance(arena)
    expect(a.vehicle.groundedCount).toBeGreaterThan(0)
    arena.world.free()
  })

  it('a car carrying wings steers by banking whenever it is in the air, key or no key, and without them it does not', () => {
    // Up and along on the key, then the key let go while it is still well up, and the steering held.
    const drive: VehicleInput = { ...NEUTRAL_INPUT, fire: true, throttle: 1 }
    const glide: VehicleInput = { ...NEUTRAL_INPUT, steer: 1 }
    const aloft = (): [Arena, Seat] => {
      const arena = createArena(map)
      const a = takeSeat(arena, 0, 'sportsCar')
      for (let i = 0; i < 30; i++) advance(arena)
      arm(a, 'wings')
      for (let i = 0; i < 150; i++) advance(arena, () => drive)
      expect(a.vehicle.groundedCount).toBe(0)
      return [arena, a]
    }
    const [arena, a] = aloft()
    const was = going(a)
    for (let i = 0; i < 45; i++) advance(arena, () => glide)
    expect(a.vehicle.lifted).toBe(false)
    expect(a.vehicle.winged).toBe(true)
    expect(a.vehicle.groundedCount).toBe(0)
    expect(angleBetween(going(a), was)).toBeGreaterThan(0.15)
    // Held level, banked into the turn, and still falling: nothing lifts it.
    expect(vdot(a.vehicle.frame.up, a.vehicle.up)).toBeGreaterThan(0.8)
    expect(vdot(a.vehicle.frame.linearVelocity, a.vehicle.up)).toBeLessThan(0)
    arena.world.free()
    // Its wings gone, the same steering up there swings the way it is going not at all.
    const [bare, b] = aloft()
    disarm(b)
    const before = going(b)
    for (let i = 0; i < 45; i++) advance(bare, () => glide)
    expect(b.vehicle.winged).toBe(false)
    expect(b.vehicle.groundedCount).toBe(0)
    expect(angleBetween(going(b), before)).toBeLessThan(0.05)
    bare.world.free()
  })

  it('the tank fires from its own gun, not from over its roof', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'tank')
    const b = takeSeat(arena, 1, 'sportsCar')
    advance(arena)
    setDown(b, besides(a, 30, 4), a.vehicle.frame.forward)
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

/** Press the car's own key once: down for a tick, then up for a tick. */
function press(arena: Arena, driver: Seat): void {
  advance(arena, (seat) => (seat === driver ? ABILITY : NEUTRAL_INPUT))
  advance(arena)
}

/** Run the arena with one seat holding its own key down and everyone else nothing. */
function hold(arena: Arena, driver: Seat, ticks: number, input: VehicleInput = ABILITY): number {
  let shots = 0
  for (let i = 0; i < ticks; i++) {
    advance(arena, (seat) => (seat === driver ? input : NEUTRAL_INPUT))
    shots += arena.shots.length
  }
  return shots
}

/** Two cars of these kinds: one on its spawn, and another this far ahead of it and this far to its right, facing the same way, settled. */
function twoCars(arena: Arena, first: VehicleProfileId, second: VehicleProfileId, forward: number, aside = 0): [Seat, Seat] {
  const a = takeSeat(arena, 0, first)
  const b = takeSeat(arena, 1, second)
  advance(arena)
  setDown(b, besides(a, forward, aside), a.vehicle.frame.forward)
  for (let i = 0; i < 30; i++) advance(arena)
  return [a, b]
}

/** Put a car down on a loose thing, to reach it: on whatever it lies on. */
function onto(seat: Seat, at: Vec3): void {
  setDown(seat, at)
}
/** Put a car on whatever is underfoot at a point: onto an oil slick, which lies on it. */
function ontoGround(seat: Seat, at: Vec3): void {
  setDown(seat, at)
}

describe("the car's own key", () => {
  beforeAll(() => {
    initPhysics()
    map ??= generateTerrain(3, PLANET_TERRAIN)
  }, 60_000)

  it('the tank fires a missile from its gun on a press, with the blast of a rocket, and not again until it has cooled down', () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'tank', 'sportsCar', 30)
    press(arena, a)
    expect(arena.rockets).toHaveLength(1)
    expect(arena.rockets[0]!.power).toBe(OWN_MISSILE_POWER)
    expect(arena.rockets[0]!.target).toBe(b.id)
    expect(a.cooldownTicks).toBeGreaterThan(0)
    // Held on, or pressed again, nothing more goes while it cools.
    hold(arena, a, 30)
    press(arena, a)
    expect(arena.rockets.length).toBeLessThanOrEqual(1)
    // The missile takes half of what a rocket would, and the car is not wrecked by it.
    for (let i = 0; i < ROCKET_LIFE_TICKS && arena.rockets.length > 0; i++) advance(arena)
    expect(b.vehicle.damage).toBeCloseTo((ROCKET_DAMAGE * OWN_MISSILE_POWER) / DURABILITY, 5)
    expect(b.vehicle.wrecked).toBe(false)
    // Cooled down, it goes again.
    for (let i = 0; i < OWN_ACTIONS.tank.cooldownTicks; i++) advance(arena)
    expect(a.cooldownTicks).toBe(0)
    press(arena, a)
    expect(arena.rockets).toHaveLength(1)
    arena.world.free()
  })

  it('numbers a rocket by whose it is and how many went before, not by the tick it went on', () => {
    const arena = createArena(map)
    const [a] = twoCars(arena, 'tank', 'sportsCar', 30)
    press(arena, a)
    const first = arena.rockets[0]!.id
    expect(a.rocketsFired).toBe(1)
    // Counted back, and fired again a good while later, it gets the same number; counted on, another.
    for (let i = 0; i < OWN_ACTIONS.tank.cooldownTicks; i++) advance(arena)
    a.rocketsFired = 0
    press(arena, a)
    expect(arena.rockets.at(-1)!.id).toBe(first)
    for (let i = 0; i < OWN_ACTIONS.tank.cooldownTicks; i++) advance(arena)
    press(arena, a)
    expect(arena.rockets.at(-1)!.id).not.toBe(first)
    arena.world.free()
  })

  it('the go-kart hops from the ground, and not from the air', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'goKart')
    for (let i = 0; i < 60; i++) advance(arena)
    expect(a.vehicle.groundedCount).toBeGreaterThan(0)
    // The hop goes on the press, and shows in the car's speed from the step after.
    advance(arena, () => ABILITY)
    expect(a.actionTicks).toBeGreaterThan(0)
    advance(arena)
    expect(vdot(a.vehicle.frame.linearVelocity, a.vehicle.up)).toBeGreaterThan(HOP_SPEED * 0.8)
    // High enough to clear something: most of the height the launch speed buys against the world's gravity.
    const ground = heightOver(arena.planet, a.vehicle.frame.position)
    let top = ground
    for (let i = 0; i < 90; i++) {
      advance(arena)
      top = Math.max(top, heightOver(arena.planet, a.vehicle.frame.position))
    }
    expect(top - ground).toBeGreaterThan(((HOP_SPEED * HOP_SPEED) / (2 * worldGravity(arena.world))) * 0.8)
    for (let i = 0; i < 90; i++) advance(arena)
    expect(a.vehicle.groundedCount).toBeGreaterThan(0)
    // Up in the air, another press gives nothing more.
    advance(arena, () => ABILITY)
    advance(arena)
    for (let i = 0; i < 4; i++) advance(arena)
    const rising = vdot(a.vehicle.frame.linearVelocity, a.vehicle.up)
    advance(arena, () => ABILITY)
    expect(vdot(a.vehicle.frame.linearVelocity, a.vehicle.up)).toBeLessThan(rising + 0.05)
    arena.world.free()
  })

  it('the race car boosts for as long as the key is held, with nothing to cool down', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'raceCar')
    for (let i = 0; i < 30; i++) advance(arena)
    const drive: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1, ability: true }
    advance(arena, () => drive)
    expect(a.vehicle.boosted).toBe(true)
    // Held for a good while, it goes on: nothing runs out, and nothing is owed after. The
    // car is put back on its spawn each second, so that it is a boost held and not a crash.
    for (let second = 0; second < 12; second++) {
      respawn(a)
      for (let i = 0; i < 60; i++) advance(arena, () => drive)
      expect(a.vehicle.boosted).toBe(true)
      expect(a.vehicle.wrecked).toBe(false)
    }
    expect(a.cooldownTicks).toBe(0)
    expect(a.vehicle.speed).toBeGreaterThan(10)
    // Let go, it stops at once.
    advance(arena)
    expect(a.vehicle.boosted).toBe(false)
    arena.world.free()
  })

  it('an emergency vehicle turns its lights on and off with a press, slows the cars near it while they are on, and is slowed by nothing', () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'police', 'sportsCar', 15)
    expect(a.lightsOn).toBe(false)
    // A press turns them on, and holding the key on from it leaves them on.
    hold(arena, a, 20)
    expect(a.lightsOn).toBe(true)
    expect(b.slowedTicks).toBeGreaterThan(0)
    expect(b.slowedBy).toBe(EMERGENCY_SLOW)
    // Let go and pressed again, off.
    advance(arena)
    press(arena, a)
    expect(a.lightsOn).toBe(false)
    for (let i = 0; i < 5; i++) advance(arena)
    expect(b.slowedTicks).toBe(0)
    expect(b.slowedBy).toBe(0)
    // The sports car's siren, sounded at the police car, slows it not at all.
    arm(b, 'siren')
    hold(arena, b, 10, FIRE)
    expect(b.ammoTicks).toBe(SIREN_TICKS - 10)
    expect(a.slowedTicks).toBe(0)
    expect(a.slowedBy).toBe(0)
    arena.world.free()
  })

  it('the small car fires its own gun from its nose for as long as the key is held, trained on the car ahead, with the full bite', () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'smallCar', 'sportsCar', 25, 12)
    expect(hold(arena, a, 60)).toBe(10)
    expect(a.aimTarget).toBe(b.id)
    expect(b.vehicle.damage).toBeCloseTo((10 * MACHINE_GUN_DAMAGE * OWN_GUN_POWER) / DURABILITY, 6)
    // From the nose of the car, and not from over its roof.
    while (arena.shots.length === 0) hold(arena, a, 1)
    const nose = nosePoint({ x: 0, y: 0, z: 0 }, a)
    const { from } = arena.shots[0]!
    expect(Math.hypot(from.x - nose.x, from.y - nose.y, from.z - nose.z)).toBeLessThan(0.05)
    // Held on for a good while, it keeps firing: nothing runs out, and nothing cools.
    hold(arena, a, 60 * 10)
    expect(hold(arena, a, 60)).toBe(10)
    expect(a.cooldownTicks).toBe(0)
    // Let go, it stops, and is trained on nothing.
    expect(hold(arena, a, 10, NEUTRAL_INPUT)).toBe(0)
    expect(a.aimTarget).toBe(NO_TARGET)
    arena.world.free()
  })

  it('the dune buggy fires three rockets of its own in a fan on a press, and not again for thirty seconds', () => {
    const arena = createArena(map)
    const [a] = twoCars(arena, 'duneBuggy', 'sportsCar', 40)
    press(arena, a)
    expect(a.rocketsFired).toBe(3)
    expect(arena.rockets.length).toBeGreaterThan(0)
    expect(a.cooldownTicks).toBeGreaterThan(60 * 29)
    // Cooling down, a press does nothing.
    hold(arena, a, 60)
    press(arena, a)
    expect(a.rocketsFired).toBe(3)
    // Cooled down, it goes again.
    for (let i = 0; i < 60 * 30; i++) advance(arena)
    press(arena, a)
    expect(a.rocketsFired).toBe(6)
    arena.world.free()
  })

  it('the rocket ship hovers clear of the ground, lifts off and flies while its key is held, and settles again when let go', () => {
    const arena = createArena(map)
    const [a] = twoCars(arena, 'rocketShip', 'sportsCar', 40)
    for (let i = 0; i < 60; i++) advance(arena)
    const resting = heightOver(arena.planet, a.vehicle.frame.position)
    expect(a.vehicle.groundedCount).toBeGreaterThan(0)
    const climb = { ...ABILITY, throttle: 1 }
    hold(arena, a, 120, climb)
    expect(heightOver(arena.planet, a.vehicle.frame.position)).toBeGreaterThan(resting + 5)
    expect(a.vehicle.wrecked).toBe(false)
    // Let go, it comes back down to hover.
    for (let i = 0; i < 60 * 8; i++) advance(arena)
    expect(a.vehicle.groundedCount).toBeGreaterThan(0)
    arena.world.free()
  })

  it('a police car takes half the bite of a machine gun', () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'sportsCar', 'police', 25, 12)
    arm(a, 'machineGun')
    expect(hold(arena, a, 60, FIRE)).toBe(10)
    expect(b.vehicle.damage).toBeCloseTo((10 * MACHINE_GUN_DAMAGE * POLICE_SHOT_SHARE * armorShare(b.tuning)) / DURABILITY, 6)
    arena.world.free()
  })

  it('the sports car drops a slick of its own on a press, as slippery as one won, not another for three seconds, and only so many out at once', () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'sportsCar', 'smallCar', 40)
    press(arena, a)
    const slicks = (): Loose[] => arena.loose.filter((loose) => loose.kind === 'oil')
    expect(slicks()).toHaveLength(1)
    expect(slicks()[0]!.power).toBe(OWN_OIL_POWER)
    press(arena, a)
    expect(slicks()).toHaveLength(1)
    // Driven into once it has landed, it slips for half as long as a full slick would have it.
    ontoGround(b, slicks()[0]!.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS; i++) advance(arena)
    expect(b.slipTicks).toBeGreaterThan(0)
    expect(b.slipTicks).toBeLessThanOrEqual(OIL_SLIP_TICKS * OWN_OIL_POWER)
    // Only so many out at once.
    for (let i = 0; i < OWN_OILS_MOST + 1; i++) {
      for (let t = 0; t < OWN_ACTIONS.sportsCar.cooldownTicks; t++) advance(arena)
      press(arena, a)
    }
    expect(slicks()).toHaveLength(OWN_OILS_MOST)
    arena.world.free()
  })

  it('the semi honks: a car within thirty meters is stunned for five seconds, one further off is not, and not again for five seconds', () => {
    const arena = createArena(map)
    const [a, near] = twoCars(arena, 'semi', 'sportsCar', HORN_RANGE - 2)
    const far = takeSeat(arena, 2, 'sportsCar')
    setDown(far, besides(a, HORN_RANGE + 15, 0), a.vehicle.frame.forward)
    for (let i = 0; i < 30; i++) advance(arena)
    advance(arena, (seat) => (seat === a ? ABILITY : NEUTRAL_INPUT))
    expect(near.stunnedTicks).toBe(HORN_STUN_TICKS)
    expect(far.stunnedTicks).toBe(0)
    expect(a.actionTicks).toBe(OWN_ACTIONS.semi.activeTicks)
    expect(a.cooldownTicks).toBe(OWN_ACTIONS.semi.cooldownTicks)
    // A stunned car takes no driving.
    const drive: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }
    for (let i = 0; i < 30; i++) advance(arena, (seat) => (seat === near ? drive : NEUTRAL_INPUT))
    expect(near.vehicle.speed).toBeLessThan(0.5)
    // Pressed again at once, it does nothing; once the horn is ready, it honks again and the stun starts over.
    advance(arena)
    advance(arena, (seat) => (seat === a ? ABILITY : NEUTRAL_INPUT))
    expect(near.stunnedTicks).toBe(HORN_STUN_TICKS - 32)
    for (let i = 0; i < OWN_ACTIONS.semi.cooldownTicks; i++) advance(arena)
    advance(arena, (seat) => (seat === a ? ABILITY : NEUTRAL_INPUT))
    expect(near.stunnedTicks).toBe(HORN_STUN_TICKS)
    arena.world.free()
  })

  it('the pickup drops a bomb behind it on a press, not another for five seconds, and only so many out at once, the oldest going for the next', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'pickup')
    for (let i = 0; i < 30; i++) advance(arena)
    // Its own bombs: the spider lets its own fall meanwhile.
    const bombs = (): number[] => arena.loose.filter((loose) => loose.kind === 'bomb' && loose.owner === a.id).map((loose) => loose.id)
    press(arena, a)
    expect(bombs()).toHaveLength(1)
    expect(arena.loose[0]!.power).toBe(OWN_BOMB_POWER)
    expect(arena.loose[0]!.owner).toBe(a.id)
    expect(a.cooldownTicks).toBeGreaterThan(0)
    press(arena, a)
    expect(bombs()).toHaveLength(1)
    const wait = (): void => {
      for (let i = 0; i < OWN_ACTIONS.pickup.cooldownTicks; i++) advance(arena)
    }
    for (let i = 0; i < OWN_BOMBS_MOST + 1; i++) {
      wait()
      press(arena, a)
    }
    const out = bombs()
    expect(out).toHaveLength(OWN_BOMBS_MOST)
    expect(out[0]).toBe(2)
    arena.world.free()
  })

  it("the pickup's bomb blasts a car as a bomb won does, and a fire truck takes a tenth of a bomb's blast", () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'pickup', 'sportsCar', 40)
    press(arena, a)
    const own = arena.loose.find((loose) => loose.kind === 'bomb')!
    expect(own.power).toBe(OWN_BOMB_POWER)
    onto(b, own.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS + 10; i++) advance(arena)
    expect(b.vehicle.damage).toBeCloseTo(OWN_BOMB_POWER / DURABILITY, 5)
    expect(arena.loose.filter((loose) => loose.kind === 'bomb')).toHaveLength(0)
    // A bomb won, dropped by the sports car once it is back, only dents a fire truck.
    respawn(b)
    const truck = takeSeat(arena, 2, 'firetruck')
    arm(b, 'bomb')
    hold(arena, b, 1, FIRE)
    const won = arena.loose.find((loose) => loose.kind === 'bomb')!
    expect(won.power).toBe(1)
    onto(truck, won.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS + 10; i++) advance(arena)
    expect(truck.vehicle.damage).toBeCloseTo((FIRETRUCK_BOMB_SHARE * armorShare(truck.tuning)) / DURABILITY, 5)
    expect(truck.vehicle.wrecked).toBe(false)
    arena.world.free()
  })

  it('the ambulance mends itself as it goes, a hundredth of its life every five seconds, unless it is a wreck', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'ambulance')
    a.vehicle.damage = 0.5
    for (let i = 0; i < AMBULANCE_HEAL_TICKS; i++) advance(arena)
    expect(a.vehicle.damage).toBeCloseTo(0.5 - AMBULANCE_HEAL, 6)
    a.vehicle.damage = 0.001
    for (let i = 0; i < AMBULANCE_HEAL_TICKS; i++) advance(arena)
    expect(a.vehicle.damage).toBe(0)
    wreckVehicle(a.vehicle, a.tuning)
    advance(arena)
    expect(a.vehicle.damage).toBe(1)
    arena.world.free()
  })

  it("a car's own goes alongside what it carries, each on its own key", () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'raceCar')
    for (let i = 0; i < 30; i++) advance(arena)
    arm(a, 'rocket')
    const both: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1, fire: true, ability: true }
    advance(arena, () => both)
    expect(arena.rockets).toHaveLength(1)
    expect(arena.rockets[0]!.power).toBe(1)
    expect(a.weapon).toBe('none')
    expect(a.vehicle.boosted).toBe(true)
    // The fire key alone does nothing of the car's own, and the car's own key fires nothing carried.
    arm(a, 'rocket')
    advance(arena, () => ABILITY)
    expect(a.weapon).toBe('rocket')
    expect(a.vehicle.boosted).toBe(true)
    advance(arena, () => FIRE)
    expect(a.weapon).toBe('none')
    expect(a.vehicle.boosted).toBe(false)
    arena.world.free()
  })

  it('the shockwave stuns every car within thirty meters for five seconds', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 20, 0)
    arm(a, 'shockwave')
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    expect(b.stunnedTicks).toBe(SHOCKWAVE_STUN_TICKS)
    for (let i = 0; i < SHOCKWAVE_STUN_TICKS; i++) advance(arena)
    expect(b.stunnedTicks).toBe(0)
    arena.world.free()
  })

  it('the siren slows the cars near it by half while it sounds, and runs out', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 20, 0)
    arm(a, 'siren')
    fire(arena, a, 10)
    expect(b.slowedTicks).toBeGreaterThan(0)
    expect(b.slowedBy).toBe(SIREN_SLOW)
    expect(a.ammoTicks).toBe(SIREN_TICKS - 10)
    fire(arena, a, SIREN_TICKS)
    expect(a.weapon).toBe('none')
    arena.world.free()
  })

  it('counts every weapon won, so one won again the moment the last runs out is a new one', () => {
    const arena = createArena(map)
    const [a] = pair(arena, 20, 0)
    arm(a, 'siren')
    const wins = a.wins
    // A banana kept while it sounds buys the next the tick the siren runs out, whatever that is.
    a.score = BANANAS_PER_WEAPON
    a.ammoTicks = 5
    fire(arena, a, 5)
    expect(WEAPONS).toContain(a.weapon)
    expect(a.score).toBe(0)
    expect(a.wins).toBe(wins + 1)
    arena.world.free()
  })

  it('an oil slick lies behind the car, takes the grip of every car in it for a while, and fades in time', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 40, 0)
    arm(a, 'oil')
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    const slick = arena.loose.find((loose) => loose.kind === 'oil')!
    expect(slick.power).toBe(1)
    ontoGround(b, slick.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS; i++) advance(arena)
    advance(arena)
    expect(b.slipTicks).toBeGreaterThan(OIL_SLIP_TICKS - 5)
    expect(b.vehicle.grip).toBe(OIL_GRIP)
    // It stays for the next car, and the grip comes back once out of it.
    expect(arena.loose).toContain(slick)
    const { east, north } = tangentFrame(upOf(slick.position))
    ontoGround(b, ahead(ahead(slick.position, east, 30), north, 30))
    for (let i = 0; i < OIL_SLIP_TICKS + 2; i++) advance(arena)
    expect(b.slipTicks).toBe(0)
    expect(b.vehicle.grip).toBe(1)
    for (let i = 0; i < OIL_LIFE_TICKS; i++) advance(arena)
    expect(arena.loose).not.toContain(slick)
    arena.world.free()
  })

  it('the shield keeps off damage, stuns and slows for a while, and then they reach the car again', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 10, 0)
    arm(a, 'shield')
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    expect(a.shieldTicks).toBe(SHIELD_TICKS)
    arm(b, 'shockwave')
    fire(arena, b, 1)
    expect(a.stunnedTicks).toBe(0)
    arm(b, 'bomb')
    fire(arena, b, 1)
    const bomb = arena.loose.find((loose) => loose.kind === 'bomb')!
    onto(a, bomb.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS + 10; i++) advance(arena)
    expect(arena.loose).not.toContain(bomb)
    expect(a.vehicle.damage).toBe(0)
    // Down, and the next shockwave stuns it.
    for (let i = 0; i < SHIELD_TICKS; i++) advance(arena)
    expect(a.shieldTicks).toBe(0)
    arm(b, 'shockwave')
    fire(arena, b, 1)
    expect(a.stunnedTicks).toBeGreaterThan(0)
    arena.world.free()
  })

  it('the magnet takes bananas from far off while it pulls, and not after', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    const slot = arena.pickups[3]!
    const off = ahead(slot.position, tangentFrame(upOf(slot.position)).east, MAGNET_REACH * 0.6)
    ontoGround(a, off)
    for (let i = 0; i < 30; i++) advance(arena)
    expect(slot.generation).toBe(0)
    arm(a, 'magnet')
    fire(arena, a, 1)
    expect(a.magnetTicks).toBeGreaterThan(0)
    advance(arena)
    expect(slot.generation).toBe(1)
    arena.world.free()
  })

  it('the triple rocket fans three half rockets out, one after each car ahead, nearest first', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 30, 0)
    const c = takeSeat(arena, 2, 'sportsCar')
    setDown(c, besides(a, 50, 10), a.vehicle.frame.forward)
    for (let i = 0; i < 30; i++) advance(arena)
    arm(a, 'tripleRocket')
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    expect(arena.rockets).toHaveLength(TRIPLE_ROCKETS)
    expect(arena.rockets.map((rocket) => rocket.target)).toEqual([b.id, c.id, b.id])
    expect(arena.rockets.every((rocket) => rocket.power === TRIPLE_ROCKET_POWER)).toBe(true)
    expect(new Set(arena.rockets.map((rocket) => rocket.id)).size).toBe(TRIPLE_ROCKETS)
    arena.world.free()
  })

  it('the ram plow throws a car it runs into much further than a car without one does', () => {
    const shoved = (plowed: boolean): number => {
      const arena = createArena(map)
      const [a, b] = pair(arena, 12, 0)
      if (plowed) {
        arm(a, 'plow')
        fire(arena, a, 1)
        expect(a.plowTicks).toBeGreaterThan(0)
      }
      const start = { ...b.vehicle.frame.position }
      const drive: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }
      for (let i = 0; i < 150; i++) advance(arena, (seat) => (seat === a ? drive : NEUTRAL_INPUT))
      const moved = apart(b.vehicle.frame.position, start)
      arena.world.free()
      return moved
    }
    expect(shoved(true)).toBeGreaterThan(shoved(false) * 1.5)
  })

  it('the grappling hook shoots at nothing and is spent when there is no car ahead, pulling on nothing', () => {
    const arena = createArena(map)
    const [a] = pair(arena, -30, 0)
    arm(a, 'grapple')
    const before = { ...a.vehicle.frame.position }
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    expect(a.grappleTarget).toBe(NO_TARGET)
    expect(a.grappleTicks).toBe(GRAPPLE_MISS_TICKS)
    expect(a.vehicle.boosted).toBe(false)
    for (let i = 0; i < GRAPPLE_MISS_TICKS; i++) advance(arena)
    expect(a.grappleTicks).toBe(0)
    expect(apart(a.vehicle.frame.position, before)).toBeLessThan(0.5)
    arena.world.free()
  })

  it('the grappling hook catches the car ahead, reels the two together, and lets go in time', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 35, 0)
    arm(a, 'grapple')
    const gap = (): number => apart(b.vehicle.frame.position, a.vehicle.frame.position)
    const before = gap()
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    expect(a.grappleTarget).toBe(b.id)
    for (let i = 0; i < 120; i++) advance(arena)
    expect(gap()).toBeLessThan(before - 5)
    for (let i = 0; i < GRAPPLE_TICKS; i++) advance(arena)
    expect(a.grappleTicks).toBe(0)
    expect(a.grappleTarget).toBe(NO_TARGET)
    arena.world.free()
  })

  it('a mine field lays its mines in a spread behind the car, each going off with a share of a bomb', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 40, 0)
    arm(a, 'mines')
    fire(arena, a, 1)
    expect(a.weapon).toBe('none')
    const mines = arena.loose.filter((loose) => loose.kind === 'mine')
    expect(mines).toHaveLength(MINES)
    expect(mines.every((mine) => mine.power === MINE_POWER)).toBe(true)
    onto(b, mines[2]!.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS + 10; i++) advance(arena)
    expect(b.vehicle.damage).toBeCloseTo(MINE_POWER / DURABILITY, 5)
    expect(arena.loose.filter((loose) => loose.kind === 'mine').length).toBeLessThan(MINES)
    arena.world.free()
  })
})
