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
  looseGone,
  nosePoint,
  takeSeat,
  weaponWon,
  wingsTurnRadius,
  disarm,
  BANANAS_PER_WEAPON,
  wreckVehicle,
  type Arena,
  type Seat,
  type VehicleInput,
  type VehicleProfileId,
} from './index.ts'

let map: TerrainMap
const FIRE: VehicleInput = { ...NEUTRAL_INPUT, fire: true }
const ABILITY: VehicleInput = { ...NEUTRAL_INPUT, ability: true }

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

  it('are bought with bananas, the same one everywhere, by a car carrying nothing', () => {
    expect(weaponWon(5, 0, 100, 10)).toBe(weaponWon(5, 0, 100, 10))
    const won = new Set<string>()
    for (let tick = 0; tick < 60; tick++) won.add(weaponWon(5, 0, tick, 10))
    expect([...won].sort()).toEqual([...WEAPONS].sort())

    const arena = createArena(map)
    const seat = takeSeat(arena, 0, 'sportsCar')
    // One banana short: nothing bought until the next is taken, and then it is spent at once.
    seat.score = BANANAS_PER_WEAPON - 1
    const { position } = arena.pickups[3]!
    respawn(seat, { position: { x: position.x, y: position.y - PICKUP_HEIGHT, z: position.z }, yaw: 0 })
    for (let i = 0; i < 30; i++) advance(arena)
    expect(seat.score).toBe(0)
    expect(WEAPONS).toContain(seat.weapon)
    expect(seat.ammoTicks).toBe(ammoFor(seat.weapon))

    // Taken while armed, a banana is kept, and what is carried stays.
    const held = seat.weapon
    seat.score = 0
    const next = arena.pickups[4]!.position
    respawn(seat, { position: { x: next.x, y: next.y - PICKUP_HEIGHT, z: next.z }, yaw: 0 })
    for (let i = 0; i < 30; i++) advance(arena)
    expect(seat.score).toBe(1)
    expect(seat.weapon).toBe(held)

    // Once what is carried is gone, the bananas kept buy the next at once.
    seat.score = BANANAS_PER_WEAPON + 2
    disarm(seat)
    respawn(seat, { position: { x: 0, y: 200, z: 0 }, yaw: 0 })
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
      power: 1,
    })
    for (let i = 0; i < LOOSE_MOST + 40; i++) {
      arena.loose.push({
        id: i,
        kind: i % 5 === 0 ? 'bomb' : 'banana',
        owner: 0,
        power: i % 5 === 0 ? 1 : 0,
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
    // The throttle drives it along up there.
    const drive: VehicleInput = { ...NEUTRAL_INPUT, fire: true, throttle: 1 }
    const before = { ...a.vehicle.frame.position }
    for (let i = 0; i < 90; i++) advance(arena, () => drive)
    expect(a.vehicle.groundedCount).toBe(0)
    expect(Math.hypot(a.vehicle.frame.position.x - before.x, a.vehicle.frame.position.z - before.z)).toBeGreaterThan(3)
    // Steered, it banks into a wide turn: the way it is going comes round gradually, its nose
    // following, and it levels off again once the steering is let go.
    const heading = (v: { x: number; z: number }): number => Math.atan2(v.x, v.z)
    const was = heading(a.vehicle.frame.linearVelocity)
    const from = { ...a.vehicle.frame.position }
    let leaned = 0
    for (let i = 0; i < 120; i++) {
      advance(arena, () => ({ ...drive, steer: 1 }))
      leaned = Math.max(leaned, Math.abs(a.vehicle.frame.right.y))
    }
    const { linearVelocity: going, forward, position } = a.vehicle.frame
    let swung = heading(going) - was
    if (swung > Math.PI) swung -= Math.PI * 2
    if (swung < -Math.PI) swung += Math.PI * 2
    expect(Math.abs(swung)).toBeGreaterThan(0.3)
    expect(Math.abs(swung)).toBeLessThan(2.5)
    expect(leaned).toBeGreaterThan(0.15)
    const speed = Math.hypot(going.x, going.z)
    // It faces the way it is going, through the turn.
    expect((forward.x * going.x + forward.z * going.z) / (Math.hypot(forward.x, forward.z) * speed)).toBeGreaterThan(0.98)
    // The arc is a wide one: the chord it has flown round says so.
    const chord = Math.hypot(position.x - from.x, position.z - from.z)
    expect(chord / (2 * Math.sin(Math.abs(swung) / 2))).toBeGreaterThan(wingsTurnRadius(a.tuning) * 0.5)
    for (let i = 0; i < 60; i++) advance(arena, () => drive)
    expect(a.vehicle.frame.up.y).toBeGreaterThan(0.95)
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
function twoCars(arena: Arena, first: VehicleProfileId, second: VehicleProfileId, ahead: number, aside = 0): [Seat, Seat] {
  const a = takeSeat(arena, 0, first)
  const b = takeSeat(arena, 1, second)
  advance(arena)
  const { position, forward, right } = a.vehicle.frame
  const x = position.x + forward.x * ahead + right.x * aside
  const z = position.z + forward.z * ahead + right.z * aside
  respawn(b, { position: { x, y: sampleHeight(map.heightfield, x, z), z }, yaw: a.spawn.yaw })
  for (let i = 0; i < 30; i++) advance(arena)
  return [a, b]
}

/** Put a car down on a loose thing, to reach it. */
function onto(seat: Seat, at: { x: number; y: number; z: number }): void {
  respawn(seat, { position: { x: at.x, y: at.y - PICKUP_HEIGHT, z: at.z }, yaw: 0 })
}

describe("the car's own key", () => {
  beforeAll(() => {
    initPhysics()
    map ??= generateTerrain(3)
  }, 60_000)

  it('the tank fires a missile from its gun on a press, with half a blast, and not again until it has cooled down', () => {
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
    expect(b.vehicle.damage).toBeCloseTo(ROCKET_DAMAGE * OWN_MISSILE_POWER, 5)
    expect(b.vehicle.wrecked).toBe(false)
    // Cooled down, it goes again.
    for (let i = 0; i < OWN_ACTIONS.tank.cooldownTicks; i++) advance(arena)
    expect(a.cooldownTicks).toBe(0)
    press(arena, a)
    expect(arena.rockets).toHaveLength(1)
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
    expect(a.vehicle.frame.linearVelocity.y).toBeGreaterThan(2)
    // Up in the air, another press gives nothing more.
    for (let i = 0; i < 4; i++) advance(arena)
    const rising = a.vehicle.frame.linearVelocity.y
    advance(arena, () => ABILITY)
    expect(a.vehicle.frame.linearVelocity.y).toBeLessThan(rising + 0.05)
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

  it('the sports car fires its own gun from its nose for as long as the key is held, trained on the car ahead, with a quarter of the bite', () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'sportsCar', 'sportsCar', 25, 12)
    expect(hold(arena, a, 60)).toBe(10)
    expect(a.aimTarget).toBe(b.id)
    expect(b.vehicle.damage).toBeCloseTo(10 * MACHINE_GUN_DAMAGE * OWN_GUN_POWER, 6)
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

  it('a police car takes half the bite of a machine gun', () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'sportsCar', 'police', 25, 12)
    arm(a, 'machineGun')
    expect(hold(arena, a, 60, FIRE)).toBe(10)
    expect(b.vehicle.damage).toBeCloseTo(10 * MACHINE_GUN_DAMAGE * POLICE_SHOT_SHARE, 6)
    arena.world.free()
  })

  it('the small car flies on wings of its own for as long as the key is held, lifted a tenth as hard', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'smallCar')
    for (let i = 0; i < 30; i++) advance(arena)
    const start = a.vehicle.frame.position.y
    hold(arena, a, 60 * 4)
    expect(a.vehicle.lifted).toBe(true)
    expect(a.vehicle.groundedCount).toBe(0)
    const risen = a.vehicle.frame.position.y - start
    expect(risen).toBeGreaterThan(1)
    // Far slower than the wings won would have lifted it, and with nothing running out.
    expect(risen).toBeLessThan(12)
    expect(a.cooldownTicks).toBe(0)
    arena.world.free()
  })

  it('the semi honks on every press: a car within ten metres is stunned for a second, and one further off is not', () => {
    const arena = createArena(map)
    const [a, near] = twoCars(arena, 'semi', 'sportsCar', HORN_RANGE - 2)
    const far = takeSeat(arena, 2, 'sportsCar')
    const { position, forward } = a.vehicle.frame
    const x = position.x + forward.x * (HORN_RANGE + 15)
    const z = position.z + forward.z * (HORN_RANGE + 15)
    respawn(far, { position: { x, y: sampleHeight(map.heightfield, x, z), z }, yaw: a.spawn.yaw })
    for (let i = 0; i < 30; i++) advance(arena)
    advance(arena, (seat) => (seat === a ? ABILITY : NEUTRAL_INPUT))
    expect(near.stunnedTicks).toBe(HORN_STUN_TICKS)
    expect(far.stunnedTicks).toBe(0)
    expect(a.actionTicks).toBe(OWN_ACTIONS.semi.activeTicks)
    expect(a.cooldownTicks).toBe(0)
    // A stunned car takes no driving.
    const drive: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }
    for (let i = 0; i < 30; i++) advance(arena, (seat) => (seat === near ? drive : NEUTRAL_INPUT))
    expect(near.vehicle.speed).toBeLessThan(0.5)
    // Pressed again at once, it honks again: the stun starts over.
    advance(arena)
    advance(arena, (seat) => (seat === a ? ABILITY : NEUTRAL_INPUT))
    expect(near.stunnedTicks).toBe(HORN_STUN_TICKS)
    arena.world.free()
  })

  it('the pickup drops a bomb behind it on every press, only so many out at once, the oldest going for the next', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'pickup')
    for (let i = 0; i < 30; i++) advance(arena)
    const bombs = (): number[] => arena.loose.filter((loose) => loose.kind === 'bomb').map((loose) => loose.id)
    press(arena, a)
    expect(bombs()).toHaveLength(1)
    expect(arena.loose[0]!.power).toBe(OWN_BOMB_POWER)
    expect(arena.loose[0]!.owner).toBe(a.id)
    expect(a.cooldownTicks).toBe(0)
    for (let i = 0; i < OWN_BOMBS_MOST + 1; i++) press(arena, a)
    const out = bombs()
    expect(out).toHaveLength(OWN_BOMBS_MOST)
    expect(out[0]).toBe(2)
    arena.world.free()
  })

  it("the pickup's bomb takes a quarter of a car's life, and a fire truck takes a tenth of a bomb's blast", () => {
    const arena = createArena(map)
    const [a, b] = twoCars(arena, 'pickup', 'sportsCar', 40)
    press(arena, a)
    const own = arena.loose.find((loose) => loose.kind === 'bomb')!
    onto(b, own.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS + 10; i++) advance(arena)
    expect(b.vehicle.damage).toBeCloseTo(OWN_BOMB_POWER, 5)
    expect(b.vehicle.wrecked).toBe(false)
    expect(arena.loose.filter((loose) => loose.kind === 'bomb')).toHaveLength(0)
    // A bomb won, dropped by the sports car, only dents a fire truck.
    const truck = takeSeat(arena, 2, 'firetruck')
    arm(b, 'bomb')
    hold(arena, b, 1, FIRE)
    const won = arena.loose.find((loose) => loose.kind === 'bomb')!
    expect(won.power).toBe(1)
    onto(truck, won.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS + 10; i++) advance(arena)
    expect(truck.vehicle.damage).toBeCloseTo(FIRETRUCK_BOMB_SHARE, 5)
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

  it('the shockwave stuns every car within thirty metres for five seconds', () => {
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

  it('the repair kit mends the car whole at once, and is spent', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 30; i++) advance(arena)
    a.vehicle.damage = 0.7
    arm(a, 'repair')
    expect(ammoFor('repair')).toBe(0)
    advance(arena)
    expect(a.vehicle.damage).toBe(0.7)
    fire(arena, a, 1)
    expect(a.vehicle.damage).toBe(0)
    expect(a.weapon).toBe('none')
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
})
