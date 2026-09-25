import {
  DEFAULT_VEHICLE_PROFILE,
  FIXED_TIMESTEP,
  GRAPPLE_MISS_TICKS,
  GRAPPLE_RANGE,
  NEUTRAL_INPUT,
  NO_TARGET,
  OWN_ACTIONS,
  addHeightfield,
  createPhysicsWorld,
  createVehicle,
  createVehicleTuning,
  initPhysics,
  stepVehicle,
  wreckVehicle,
  type Seat,
} from '@buggies/game'
import { flatHeightfield } from '@buggies/terrain'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Sound } from './audio.ts'
import { CarPresence, hookPointOf } from './car-presence.ts'
import { createChaseTarget } from './chase-camera.ts'
import { Explosions } from './explosion.ts'
import { Smoke } from './smoke.ts'

/** A seat on flat ground, with nothing but a vehicle in it. */
function seatOnFlat(): { seat: Seat; free: () => void } {
  const world = createPhysicsWorld()
  addHeightfield(world, flatHeightfield(20, 20, 3))
  const tuning = createVehicleTuning(DEFAULT_VEHICLE_PROFILE)
  const vehicle = createVehicle(world, tuning, { position: { x: 30, y: 0, z: 30 }, yaw: 0 })
  // Settled on its springs, so that it is on the road and not still landing.
  for (let i = 0; i < 60; i++) {
    stepVehicle(world, vehicle, tuning, NEUTRAL_INPUT, FIXED_TIMESTEP)
    world.step()
  }
  const seat: Seat = {
    id: 3,
    spawn: { position: { x: 30, y: 0, z: 30 }, yaw: 0 },
    vehicle,
    tuning,
    profile: DEFAULT_VEHICLE_PROFILE,
    occupied: true,
    epoch: 0,
    submersion: 0,
    lostTicks: 0,
    score: 0,
    weapon: 'none',
    wins: 0,
    ammoTicks: 0,
    aimTarget: NO_TARGET,
    actionTicks: 0,
    cooldownTicks: 0,
    lightsOn: false,
    abilityHeld: false,
    rocketsFired: 0,
    stunnedTicks: 0,
    slowedTicks: 0,
    slowedBy: 0,
    shieldTicks: 0,
    magnetTicks: 0,
    plowTicks: 0,
    slipTicks: 0,
    grappleTicks: 0,
    grappleTarget: NO_TARGET,
  }
  return { seat, free: () => world.free() }
}

/** A sound that only counts what it is asked to play. */
function countingSound(): { sound: Sound; played: Record<string, number>; sirens: { on: boolean; power: boolean }[] } {
  const played: Record<string, number> = {}
  const sirens: { on: boolean; power: boolean }[] = []
  const count = (name: string) => () => {
    played[name] = (played[name] ?? 0) + 1
  }
  const voice = { set: () => undefined, stop: () => undefined }
  const sound = {
    engine: () => voice,
    skid: () => voice,
    thrust: () => voice,
    siren: () => ({ set: (on: boolean, _distance: number, power = false) => sirens.push({ on, power }), stop: () => undefined }),
    boom: count('boom'),
    chime: count('chime'),
    shot: count('shot'),
    whoosh: count('whoosh'),
    thud: count('thud'),
    horn: count('horn'),
    hop: count('hop'),
    shockwave: count('shockwave'),
  } as unknown as Sound
  return { sound, played, sirens }
}

describe('a car on the screen', () => {
  it('is heard blowing its horn, setting off a shockwave, and sounding the siren power while it is held', () => {
    const { seat, free } = seatOnFlat()
    const { sound, played, sirens } = countingSound()
    const explosions = new Explosions()
    const presence = new CarPresence(seat, 0xff0000, { explosions, smoke: new Smoke(), sound })
    presence.render(0, FIXED_TIMESTEP)
    // The semi's horn: heard once as its action starts, not every frame it goes on, and again as it starts over.
    seat.profile = 'semi'
    seat.actionTicks = 60
    presence.render(0, FIXED_TIMESTEP)
    presence.render(0, FIXED_TIMESTEP)
    expect(played.horn).toBe(1)
    seat.actionTicks = 30
    presence.render(0, FIXED_TIMESTEP)
    expect(played.horn).toBe(1)
    seat.actionTicks = 60
    presence.render(0, FIXED_TIMESTEP)
    expect(played.horn).toBe(2)
    seat.actionTicks = 0
    seat.profile = DEFAULT_VEHICLE_PROFILE
    // The shockwave: armed, then gone the moment it is fired, and heard then.
    seat.weapon = 'shockwave'
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBeUndefined()
    seat.weapon = 'none'
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBe(1)
    expect(explosions.object.children).toHaveLength(1)
    // Fired and won again on the same tick: never seen carrying nothing, but it went off all the same.
    seat.weapon = 'shockwave'
    seat.wins += 1
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBe(1)
    seat.wins += 1
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBe(2)
    expect(explosions.object.children).toHaveLength(2)
    seat.weapon = 'none'
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBe(3)
    // The siren power: sounds while the key is held with time left, as the power and not a vehicle's own.
    seat.weapon = 'siren'
    seat.ammoTicks = 300
    seat.vehicle.command.fire = true
    presence.render(0, FIXED_TIMESTEP)
    expect(sirens.at(-1)).toEqual({ on: true, power: true })
    seat.vehicle.command.fire = false
    presence.render(0, FIXED_TIMESTEP)
    expect(sirens.at(-1)).toEqual({ on: false, power: false })
    presence.dispose()
    free()
  })

  it('names only what it carries in the power-up slot, and nothing of its own, mounting nothing for that either', () => {
    const { seat, free } = seatOnFlat()
    const presence = new CarPresence(seat, 0xff0000, { explosions: new Explosions(), smoke: new Smoke(), sound: null })
    expect(OWN_ACTIONS[seat.profile].kind).toBe('gun')
    presence.render(0, FIXED_TIMESTEP)
    expect(presence.weaponLabel).toBe('')
    // Its own gun going, and cooling, makes no difference to the slot, and puts no gun over the roof.
    seat.vehicle.command.ability = true
    seat.cooldownTicks = 150
    seat.actionTicks = 60
    presence.render(0, FIXED_TIMESTEP)
    expect(presence.weaponLabel).toBe('')
    const mount = presence.object.children.find((child) => child.position.y > seat.tuning.chassisHalfHeight + 1)!
    expect(mount.children.some((child) => child.visible)).toBe(false)
    // Something won is named, once the roll that reveals it has stopped on it.
    seat.weapon = 'bomb'
    for (let i = 0; i < 200; i++) presence.render(0, FIXED_TIMESTEP)
    expect(presence.weaponLabel).toBe('Bomb')
    expect(mount.children.some((child) => child.visible)).toBe(true)
    presence.dispose()
    free()
  })

  beforeAll(async () => {
    await initPhysics()
  })

  it('draws the shield up, the plow set, the magnet pulling and the grappling line out, while they last', () => {
    const { seat, free } = seatOnFlat()
    const presence = new CarPresence(seat, 0xff0000, { explosions: new Explosions(), smoke: new Smoke(), sound: null })
    const children = presence.object.children
    const bubble = children.find((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry)!
    const ring = children.find((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry)!
    // The rope and its hook are the last things hung on the car.
    const [rope, hook] = children.slice(-2) as [THREE.Object3D, THREE.Object3D]
    presence.render(0, FIXED_TIMESTEP)
    expect([bubble.visible, ring.visible, rope.visible, hook.visible]).toEqual([false, false, false, false])
    seat.shieldTicks = 10
    seat.magnetTicks = 10
    presence.hookAt({ x: 60, y: 0, z: 30 })
    presence.render(0, FIXED_TIMESTEP)
    expect([bubble.visible, ring.visible, rope.visible, hook.visible]).toEqual([true, true, true, true])
    // The rope runs from the car to the point hooked, wherever the car is, and the hook is there.
    presence.object.updateMatrixWorld()
    const end = rope.localToWorld(new THREE.Vector3(0, 1, 0))
    expect(end.x).toBeCloseTo(60, 3)
    expect(end.z).toBeCloseTo(30, 3)
    expect(hook.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(60, 3)
    presence.hookAt(null)
    seat.shieldTicks = 0
    presence.render(0, FIXED_TIMESTEP)
    expect([bubble.visible, rope.visible, hook.visible]).toEqual([false, false, false])
    presence.dispose()
    free()
  })

  it('shoots a grappling line that caught nothing straight out to its full reach and back in', () => {
    const { seat, free } = seatOnFlat()
    seat.grappleTarget = NO_TARGET
    const reach = (ticks: number): number => {
      seat.grappleTicks = ticks
      const at = hookPointOf(seat, [seat])!
      const { position } = seat.vehicle.frame
      return Math.hypot(at.x - position.x, at.y - position.y, at.z - position.z)
    }
    expect(reach(GRAPPLE_MISS_TICKS)).toBeCloseTo(0, 5)
    expect(reach(GRAPPLE_MISS_TICKS / 2)).toBeCloseTo(GRAPPLE_RANGE, 5)
    expect(reach(GRAPPLE_MISS_TICKS / 4)).toBeCloseTo(GRAPPLE_RANGE / 2, 5)
    seat.grappleTicks = 0
    expect(hookPointOf(seat, [seat])).toBeNull()
    free()
  })

  it('draws its body, says its state, and bursts when it is wrecked', () => {
    const { seat, free } = seatOnFlat()
    const explosions = new Explosions()
    const smoke = new Smoke()
    const presence = new CarPresence(seat, 0xff0000, { explosions, smoke, sound: null })
    expect(presence.object.children.length).toBeGreaterThan(0)
    presence.body.captureStep()
    presence.render(0.5, 0.016)
    presence.object.updateMatrixWorld(true)
    // Drawn where the body is.
    expect(presence.object.position.x).toBeCloseTo(30, 1)
    expect(presence.object.position.z).toBeCloseTo(30, 1)

    const target = createChaseTarget()
    presence.aim(target)
    expect(target.position.x).toBeCloseTo(30, 1)
    expect(target.wrecked).toBe(false)

    seat.score = 2
    const hud = presence.hudState('me', [])
    expect(hud).toMatchObject({ title: 'me', score: 2, damage: 0, maxSpeed: seat.tuning.maxSpeed })

    // Blown up: one burst, the car hidden, and the HUD says so.
    expect(explosions.object.children).toHaveLength(0)
    wreckVehicle(seat.vehicle, seat.tuning)
    presence.render(0.5, 0.016)
    expect(explosions.object.children).toHaveLength(1)
    expect(presence.object.visible).toBe(false)
    expect(presence.wrecked).toBe(true)
    expect(presence.hudState('me', [])).toMatchObject({ damage: 1 })
    // And not again while it lies there.
    presence.render(0.5, 0.016)
    expect(explosions.object.children).toHaveLength(1)

    presence.dispose()
    explosions.dispose()
    smoke.dispose()
    free()
  })
})
