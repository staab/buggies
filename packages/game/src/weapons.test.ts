import { vdot, type Vec3 } from '@buggies/physics'
import { alongGround, atHeight, generatePlanet, groundUnder, heightOver, tangentFrame, upOf, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  armorShare,
  AMBULANCE_HEAL,
  AMBULANCE_HEAL_TICKS,
  BANANA_BURN,
  BUILT_IN_GUNS,
  DURABILITY,
  FIRETRUCK_BOMB_SHARE,
  LASER_DAMAGE,
  LOOSE_MOST,
  MACHINE_GUN_DAMAGE,
  MAGNET_REACH,
  MINES,
  MINE_POWER,
  NEUTRAL_INPUT,
  NO_KEY,
  NO_TARGET,
  POLICE_SHOT_SHARE,
  ROCKET_DAMAGE,
  ROCKET_LIFE_TICKS,
  ROCKET_SPEED,
  SHOCKWAVE_RANGE,
  SHOCKWAVE_SHOWN_TICKS,
  SHOCKWAVE_STUN_TICKS,
  SPILL_FLIGHT_TICKS,
  WEAPON_COSTS,
  WEAPONS,
  advance,
  createArena,
  initPhysics,
  keyOf,
  lasting,
  respawn,
  spawnHere,
  takeSeat,
  weaponOfKey,
  wingsTurnRadius,
  wreckVehicle,
  type Arena,
  type Seat,
  type VehicleInput,
  type VehicleProfileId,
  type Weapon,
} from './index.ts'
import { nearestRoadSpotTo } from './spawns.ts'
import { ahead, angleBetween, apart } from './test-planet.ts'

let map: World

/** Holding a weapon's key down, and nothing else. */
function key(weapon: Weapon, input: Partial<VehicleInput> = {}): VehicleInput {
  return { ...NEUTRAL_INPUT, ...input, weapon: keyOf(weapon) }
}

/** How far past a road's edge a point may be from the nearest of its points, which are spaced out along it, and still be on it. */
const ROAD_POINT_SLACK = 6

/**
 * What a car stands on at a point: the road there, where one runs, which
 * may be up on an embankment or a deck; the ground otherwise.
 */
function surfaceAt(point: Vec3): Vec3 {
  const planet = map
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

/** Run the arena with one seat holding a weapon's key and everyone else nothing; how many shots went. */
function hold(arena: Arena, shooter: Seat, weapon: Weapon, ticks: number, input: Partial<VehicleInput> = {}): number {
  let shots = 0
  for (let i = 0; i < ticks; i++) {
    advance(arena, (seat) => (seat === shooter ? key(weapon, input) : NEUTRAL_INPUT))
    shots += arena.shots.length
  }
  return shots
}

/** Press a weapon's key once: down for a tick, then up for a tick. */
function press(arena: Arena, shooter: Seat, weapon: Weapon): void {
  hold(arena, shooter, weapon, 1)
  advance(arena)
}

/** Two cars of these kinds: one on its spawn, and another this far ahead of it and this far to its right, facing the same way, settled. */
function pair(arena: Arena, forward: number, aside: number, first: VehicleProfileId = 'sportsCar', second: VehicleProfileId = 'sportsCar'): [Seat, Seat] {
  const a = takeSeat(arena, 0, first)
  const b = takeSeat(arena, 1, second)
  advance(arena)
  setDown(b, besides(a, forward, aside), a.vehicle.frame.forward)
  for (let i = 0; i < 30; i++) advance(arena)
  return [a, b]
}

describe('weapons', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(11)
  }, 60_000)

  it('are on the keys 1 to 9, every one with a price in bananas, some going at once and some lasting while held', () => {
    expect(WEAPONS).toEqual(['rocket', 'machineGun', 'mines', 'engine', 'wings', 'magnet', 'plow', 'laser', 'shockwave'])
    WEAPONS.forEach((weapon, index) => {
      expect(keyOf(weapon)).toBe(index + 1)
      expect(weaponOfKey(index + 1)).toBe(weapon)
      expect(WEAPON_COSTS[weapon]).toBeGreaterThan(0)
    })
    expect(weaponOfKey(NO_KEY)).toBe('none')
    expect(weaponOfKey(10)).toBe('none')
    expect(WEAPONS.filter(lasting)).toEqual(['machineGun', 'engine', 'wings', 'laser'])
  })

  it('a press picks the weapon, and one that goes at once goes only on the press, and only with the bananas for it', () => {
    const arena = createArena(map)
    const [a] = pair(arena, 40, 0)
    // Short of the price: picked, but nothing goes and nothing is spent.
    a.score = WEAPON_COSTS.rocket - 1
    press(arena, a, 'rocket')
    expect(a.weapon).toBe('rocket')
    expect(arena.rockets).toHaveLength(0)
    expect(a.score).toBe(WEAPON_COSTS.rocket - 1)
    // With enough, held on, one goes and no more.
    a.score = WEAPON_COSTS.rocket * 3
    hold(arena, a, 'rocket', 30)
    expect(a.rocketsFired).toBe(1)
    expect(a.score).toBe(WEAPON_COSTS.rocket * 2)
    // Let go and pressed again, another.
    advance(arena)
    press(arena, a, 'rocket')
    expect(a.rocketsFired).toBe(2)
    expect(a.score).toBe(WEAPON_COSTS.rocket)
    // Another key picks another weapon, and the last stays on the roof once let go.
    press(arena, a, 'magnet')
    expect(a.weapon).toBe('magnet')
    arena.world.free()
  })

  it('a rocket goes after the car ahead, even off to one side, and blows it up, a kill to whoever fired it', () => {
    const arena = createArena(map)
    // Off to one side, but still on the road, clear of the banks either side of it.
    const [a, b] = pair(arena, 40, 4)
    a.score = WEAPON_COSTS.rocket
    b.vehicle.damage = 1 - ROCKET_DAMAGE / DURABILITY
    hold(arena, a, 'rocket', 1)
    expect(a.score).toBe(0)
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

  it('a rocket with nobody ahead flies straight and is gone in time', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, -40, 0)
    a.score = WEAPON_COSTS.rocket
    hold(arena, a, 'rocket', 1)
    expect(arena.rockets[0]!.target).toBe(NO_TARGET)
    for (let i = 0; i < ROCKET_LIFE_TICKS; i++) advance(arena)
    expect(arena.rockets).toHaveLength(0)
    expect(b.vehicle.damage).toBe(0)
    arena.world.free()
  })

  it('numbers a rocket by whose it is and how many went before, not by the tick it went on', () => {
    const arena = createArena(map)
    const [a] = pair(arena, 30, 0)
    a.score = 100
    press(arena, a, 'rocket')
    const first = arena.rockets[0]!.id
    expect(a.rocketsFired).toBe(1)
    // Counted back, and fired again a good while later, it gets the same number; counted on, another.
    for (let i = 0; i < 60; i++) advance(arena)
    a.rocketsFired = 0
    press(arena, a, 'rocket')
    expect(arena.rockets.at(-1)!.id).toBe(first)
    press(arena, a, 'rocket')
    expect(arena.rockets.at(-1)!.id).not.toBe(first)
    arena.world.free()
  })

  it('the machine gun trains itself on the car ahead, fires while its key is held, and burns a banana a second', () => {
    const arena = createArena(map)
    // Ahead and off to one side, on the road: in the gun's sweep, not on its line.
    const [a, b] = pair(arena, 25, 6)
    a.score = 3
    // Picked and not held: nothing fired, nothing spent, but the gun is on the car already.
    a.weapon = 'machineGun'
    for (let i = 0; i < 10; i++) advance(arena)
    expect(a.score).toBe(3)
    expect(b.vehicle.damage).toBe(0)
    expect(a.aimTarget).toBe(b.id)
    expect(b.aimTarget).toBe(NO_TARGET)
    // Held for a second: ten shots, every one into the car ahead, and one banana burned.
    expect(hold(arena, a, 'machineGun', 60)).toBe(10)
    expect(b.vehicle.damage).toBeCloseTo((10 * MACHINE_GUN_DAMAGE) / DURABILITY, 6)
    expect(a.score).toBe(2)
    expect(a.burnLeft).toBe(0)
    expect(a.vehicle.damage).toBe(0)
    // Two seconds more and it is out: held on, it fires nothing.
    hold(arena, a, 'machineGun', 120)
    expect(a.score).toBe(0)
    expect(hold(arena, a, 'machineGun', 60)).toBe(0)
    arena.world.free()
  })

  it('the machine gun does not hit a car behind, and a wreck fires nothing', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, -25, 0)
    a.score = 10
    expect(hold(arena, a, 'machineGun', 60)).toBe(10)
    expect(a.aimTarget).toBe(NO_TARGET)
    expect(b.vehicle.damage).toBe(0)
    wreckVehicle(a.vehicle, a.tuning)
    expect(hold(arena, a, 'machineGun', 60)).toBe(0)
    arena.world.free()
  })

  it('the laser burns the car ahead for as long as its key is held, tick by tick, two bananas a second', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 40, 0)
    a.score = 1
    const lit = hold(arena, a, 'laser', 30)
    expect(lit).toBe(30)
    expect(a.aimTarget).toBe(b.id)
    expect(b.vehicle.damage).toBeCloseTo((30 * LASER_DAMAGE) / DURABILITY, 3)
    expect(arena.shots.every((shot) => shot.kind === 'laser')).toBe(true)
    // Half a second on one banana, and it is out.
    expect(a.score).toBe(0)
    expect(a.burnLeft).toBe(0)
    expect(hold(arena, a, 'laser', 10)).toBe(0)
    arena.world.free()
  })

  it('what is left of a banana broken into keeps for the next lasting weapon', () => {
    const arena = createArena(map)
    const [a] = pair(arena, 40, 0)
    a.score = 1
    hold(arena, a, 'machineGun', 20)
    expect(a.score).toBe(0)
    expect(a.burnLeft).toBe(BANANA_BURN - 20)
    advance(arena)
    hold(arena, a, 'engine', 10)
    expect(a.burnLeft).toBe(BANANA_BURN - 30)
    arena.world.free()
  })

  it('a mine field lays its mines in a spread behind the car, each going off with a share of a bomb', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 40, 0)
    a.score = WEAPON_COSTS.mines
    hold(arena, a, 'mines', 1)
    expect(a.score).toBe(0)
    const mines = arena.loose.filter((loose) => loose.kind === 'mine')
    expect(mines).toHaveLength(MINES)
    expect(mines.every((mine) => mine.power === MINE_POWER && mine.owner === a.id)).toBe(true)
    setDown(b, mines[2]!.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS + 10; i++) advance(arena)
    expect(b.vehicle.damage).toBeCloseTo(MINE_POWER / DURABILITY, 5)
    expect(arena.loose.filter((loose) => loose.kind === 'mine').length).toBeLessThan(MINES)
    arena.world.free()
  })

  it('a fire truck takes a tenth of a mine\'s blast', () => {
    const arena = createArena(map)
    const [a, truck] = pair(arena, 40, 0, 'sportsCar', 'firetruck')
    a.score = WEAPON_COSTS.mines
    hold(arena, a, 'mines', 1)
    setDown(truck, arena.loose.find((loose) => loose.kind === 'mine')!.position)
    for (let i = 0; i < SPILL_FLIGHT_TICKS + 10; i++) advance(arena)
    expect(truck.vehicle.damage).toBeCloseTo((MINE_POWER * FIRETRUCK_BOMB_SHARE * armorShare(truck.tuning)) / DURABILITY, 5)
    arena.world.free()
  })

  it('only so many bombs, mines and rockets lie loose at once, the oldest going first, and spilled bananas are not among them', () => {
    const arena = createArena(map)
    takeSeat(arena, 0, 'sportsCar')
    advance(arena)
    // A rocket older than all of it, far more bombs and mines than the map holds, and bananas among them.
    arena.rockets.push({
      id: 1,
      owner: 0,
      target: NO_TARGET,
      position: { x: 100, y: 500, z: 100 },
      velocity: { x: 0, y: 1, z: 0 },
      bornTick: arena.tick - 2,
      power: 1,
    })
    const kinds = ['bomb', 'mine'] as const
    for (let i = 0; i < LOOSE_MOST + 40; i++) {
      arena.loose.push({
        id: i,
        kind: kinds[i % 2]!,
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

  it('the rocket engine pushes the car on while its key is held, a banana a second, and stops when they run out', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 30; i++) advance(arena)
    a.score = 2
    // Less any bananas it takes on the way.
    const left = (): number => a.score - a.collected
    hold(arena, a, 'engine', 60)
    expect(a.vehicle.speed).toBeGreaterThan(5)
    expect(a.vehicle.boosted).toBe(true)
    expect(left()).toBe(1)
    // Let go, it coasts, and nothing is burned.
    for (let i = 0; i < 30; i++) advance(arena)
    expect(a.vehicle.boosted).toBe(false)
    expect(left()).toBe(1)
    a.score = 1
    a.collected = 0
    hold(arena, a, 'engine', 60)
    expect(left()).toBe(0)
    a.score = 0
    hold(arena, a, 'engine', 1)
    expect(a.vehicle.boosted).toBe(false)
    arena.world.free()
  })

  it('the wings lift the car into the air while held, let it turn up there, and set it down when let go', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    for (let i = 0; i < 30; i++) advance(arena)
    a.score = 20
    const ground = heightOver(arena.planet, a.vehicle.frame.position)
    hold(arena, a, 'wings', 180)
    expect(heightOver(arena.planet, a.vehicle.frame.position) - ground).toBeGreaterThan(8)
    expect(a.vehicle.groundedCount).toBe(0)
    expect(a.score).toBe(17)
    // The throttle drives it along up there.
    const before = { ...a.vehicle.frame.position }
    hold(arena, a, 'wings', 90, { throttle: 1 })
    expect(a.vehicle.groundedCount).toBe(0)
    expect(apart(a.vehicle.frame.position, before)).toBeGreaterThan(3)
    // Steered, it banks into a wide turn: the way it is going comes around gradually, its nose
    // following, and it levels off again once the steering is let go.
    const was = going(a)
    const from = { ...a.vehicle.frame.position }
    let leaned = 0
    for (let i = 0; i < 120; i++) {
      hold(arena, a, 'wings', 1, { throttle: 1, steer: 1 })
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
    hold(arena, a, 'wings', 60, { throttle: 1 })
    expect(vdot(a.vehicle.frame.up, a.vehicle.up)).toBeGreaterThan(0.95)
    // Let go: down it comes.
    for (let i = 0; i < 60 * 6; i++) advance(arena)
    expect(a.vehicle.groundedCount).toBeGreaterThan(0)
    arena.world.free()
  })

  it('a car with wings picked steers by banking whenever it is in the air, key or no key, and with another picked it does not', () => {
    // Up and along on the key, then the key let go while it is still well up, and the steering held.
    const glide: VehicleInput = { ...NEUTRAL_INPUT, steer: 1 }
    const aloft = (): [Arena, Seat] => {
      const arena = createArena(map)
      const a = takeSeat(arena, 0, 'sportsCar')
      for (let i = 0; i < 30; i++) advance(arena)
      a.score = 20
      hold(arena, a, 'wings', 150, { throttle: 1 })
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
    // Another weapon picked, the same steering up there swings the way it is going not at all.
    const [bare, b] = aloft()
    b.score = 0
    hold(bare, b, 'rocket', 1)
    expect(b.weapon).toBe('rocket')
    const before = going(b)
    for (let i = 0; i < 45; i++) advance(bare, () => glide)
    expect(b.vehicle.winged).toBe(false)
    expect(b.vehicle.groundedCount).toBe(0)
    expect(angleBetween(going(b), before)).toBeLessThan(0.05)
    bare.world.free()
  })

  it('the tank fires from its own gun, not from over its roof', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 30, 4, 'tank')
    a.score = 10
    const gun = BUILT_IN_GUNS.tank!
    const expected = (): { x: number; y: number; z: number } => {
      const { position, forward, up } = a.vehicle.frame
      return {
        x: position.x + forward.x * gun.ahead + up.x * gun.up,
        y: position.y + forward.y * gun.ahead + up.y * gun.up,
        z: position.z + forward.z * gun.ahead + up.z * gun.up,
      }
    }
    // Picked a tick before it is held, so the gun is trained when it fires.
    hold(arena, a, 'machineGun', 1)
    while (arena.shots.length === 0) hold(arena, a, 'machineGun', 1)
    const shot = arena.shots[0]!
    const muzzle = expected()
    expect(shot.hit).toBe(b.id)
    expect(Math.hypot(shot.from.x - muzzle.x, shot.from.y - muzzle.y, shot.from.z - muzzle.z)).toBeLessThan(0.05)
    hold(arena, a, 'rocket', 1)
    const rocket = arena.rockets[0]!
    const from = expected()
    expect(Math.hypot(rocket.position.x - from.x, rocket.position.y - from.y, rocket.position.z - from.z)).toBeLessThan(ROCKET_SPEED / 60 + 0.05)
    arena.world.free()
  })

  it('a police car takes half the bite of a machine gun', () => {
    const arena = createArena(map)
    const [a, b] = pair(arena, 25, 6, 'sportsCar', 'police')
    a.score = 10
    expect(hold(arena, a, 'machineGun', 60)).toBe(10)
    expect(b.vehicle.damage).toBeCloseTo((10 * MACHINE_GUN_DAMAGE * POLICE_SHOT_SHARE * armorShare(b.tuning)) / DURABILITY, 6)
    arena.world.free()
  })

  it('the shockwave stuns every car within thirty meters for five seconds, and one further off not at all', () => {
    const arena = createArena(map)
    const [a, near] = pair(arena, SHOCKWAVE_RANGE - 10, 0)
    const far = takeSeat(arena, 2, 'sportsCar')
    setDown(far, besides(a, SHOCKWAVE_RANGE + 15, 0), a.vehicle.frame.forward)
    for (let i = 0; i < 30; i++) advance(arena)
    a.score = WEAPON_COSTS.shockwave
    hold(arena, a, 'shockwave', 1)
    expect(a.score).toBe(0)
    expect(a.shockTicks).toBe(SHOCKWAVE_SHOWN_TICKS)
    expect(near.stunnedTicks).toBe(SHOCKWAVE_STUN_TICKS)
    expect(far.stunnedTicks).toBe(0)
    // A stunned car takes no driving.
    const drive: VehicleInput = { ...NEUTRAL_INPUT, throttle: 1 }
    for (let i = 0; i < 30; i++) advance(arena, (seat) => (seat === near ? drive : NEUTRAL_INPUT))
    expect(near.vehicle.speed).toBeLessThan(0.5)
    for (let i = 0; i < SHOCKWAVE_STUN_TICKS; i++) advance(arena)
    expect(near.stunnedTicks).toBe(0)
    arena.world.free()
  })

  it('the magnet takes bananas from far off while it pulls', () => {
    const arena = createArena(map)
    const a = takeSeat(arena, 0, 'sportsCar')
    const slot = arena.pickups[3]!
    setDown(a, ahead(slot.position, tangentFrame(upOf(slot.position)).east, MAGNET_REACH * 0.6))
    for (let i = 0; i < 30; i++) advance(arena)
    expect(slot.generation).toBe(0)
    a.score = WEAPON_COSTS.magnet
    hold(arena, a, 'magnet', 1)
    expect(a.magnetTicks).toBeGreaterThan(0)
    advance(arena)
    expect(slot.generation).toBe(1)
    // Paid for, and every banana it has pulled in since kept.
    expect(a.score).toBe(a.collected)
    arena.world.free()
  })

  it('the ram plow throws a car it runs into much further than a car without one does', () => {
    const shoved = (plowed: boolean): number => {
      const arena = createArena(map)
      const [a, b] = pair(arena, 12, 0)
      if (plowed) {
        a.score = WEAPON_COSTS.plow
        hold(arena, a, 'plow', 1)
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
})
