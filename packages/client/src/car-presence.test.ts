import {
  DEFAULT_VEHICLE_PROFILE,
  FIXED_TIMESTEP,
  HORN_TICKS,
  NEUTRAL_INPUT,
  NOT_RACING,
  NO_KEY,
  NO_TARGET,
  SHOCKWAVE_SHOWN_TICKS,
  WEAPON_COSTS,
  addHeightfield,
  createPhysicsWorld,
  createVehicle,
  createVehicleTuning,
  initPhysics,
  levelSpawn,
  stepVehicle,
  wreckVehicle,
  type Seat,
} from '@buggies/game'
import { flatHeightfield } from '@buggies/terrain'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Sound } from './audio.ts'
import { CarPresence } from './car-presence.ts'
import { createChaseTarget } from './chase-camera.ts'
import { Explosions } from './explosion.ts'
import { Smoke } from './smoke.ts'

/** A seat on flat ground, with nothing but a vehicle in it. */
function seatOnFlat(): { seat: Seat; free: () => void } {
  const world = createPhysicsWorld()
  addHeightfield(world, flatHeightfield(20, 20, 3))
  const tuning = createVehicleTuning(DEFAULT_VEHICLE_PROFILE)
  const vehicle = createVehicle(world, tuning, levelSpawn({ x: 30, y: 0, z: 30 }, 0))
  // Settled on its springs, so that it is on the road and not still landing.
  for (let i = 0; i < 60; i++) {
    stepVehicle(world, vehicle, tuning, NEUTRAL_INPUT, FIXED_TIMESTEP)
    world.step()
  }
  const seat: Seat = {
    id: 3,
    spawn: levelSpawn({ x: 30, y: 0, z: 30 }, 0),
    vehicle,
    tuning,
    profile: DEFAULT_VEHICLE_PROFILE,
    occupied: true,
    epoch: 0,
    submersion: 0,
    lostTicks: 0,
    score: 0,
    collected: 0,
    kills: 0,
    robotKills: 0,
    game: null,
    gamesWon: 0,
    racePassed: NOT_RACING,
    npc: false,
    driver: null,
    rover: null,
    coasting: false,
    weapon: 'none',
    weaponHeld: NO_KEY,
    burnLeft: 0,
    aimTarget: NO_TARGET,
    rocketsFired: 0,
    stunnedTicks: 0,
    shockTicks: 0,
    magnetTicks: 0,
    plowTicks: 0,
    lightsOn: false,
    hornTicks: 0,
    signalHeld: false,
  }
  return { seat, free: () => world.free() }
}

/** A sound that only counts what it is asked to play. */
function countingSound(): { sound: Sound; played: Record<string, number>; sirens: boolean[] } {
  const played: Record<string, number> = {}
  const sirens: boolean[] = []
  const count = (name: string) => () => {
    played[name] = (played[name] ?? 0) + 1
  }
  const voice = { set: () => undefined, stop: () => undefined }
  const sound = {
    engine: () => voice,
    skid: () => voice,
    thrust: () => voice,
    siren: () => ({ set: (on: boolean) => sirens.push(on), stop: () => undefined }),
    boom: count('boom'),
    chime: count('chime'),
    shot: count('shot'),
    whoosh: count('whoosh'),
    thud: count('thud'),
    shockwave: count('shockwave'),
    horn: count('horn'),
  } as unknown as Sound
  return { sound, played, sirens }
}

describe('a car on the screen', () => {
  it('is seen and heard setting off a shockwave, once each time it goes off', () => {
    const { seat, free } = seatOnFlat()
    const { sound, played } = countingSound()
    const explosions = new Explosions()
    const presence = new CarPresence(seat, 0xff0000, { explosions, smoke: new Smoke(), sound })
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBeUndefined()
    seat.shockTicks = SHOCKWAVE_SHOWN_TICKS
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBe(1)
    expect(explosions.object.children).toHaveLength(1)
    // Not again as it wears off, but again when it goes off once more.
    seat.shockTicks = SHOCKWAVE_SHOWN_TICKS - 10
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBe(1)
    seat.shockTicks = SHOCKWAVE_SHOWN_TICKS
    presence.render(0, FIXED_TIMESTEP)
    expect(played.shockwave).toBe(2)
    presence.dispose()
    free()
  })

  it('sounds its siren while it is on, and its horn once each time it is blown', () => {
    const { seat, free } = seatOnFlat()
    const { sound, played, sirens } = countingSound()
    const presence = new CarPresence(seat, 0xff0000, { explosions: new Explosions(), smoke: new Smoke(), sound })
    presence.render(0, FIXED_TIMESTEP)
    expect(sirens).toEqual([])
    seat.lightsOn = true
    presence.render(0, FIXED_TIMESTEP)
    expect(sirens.at(-1)).toBe(true)
    seat.lightsOn = false
    presence.render(0, FIXED_TIMESTEP)
    expect(sirens.at(-1)).toBe(false)
    seat.hornTicks = HORN_TICKS
    presence.render(0, FIXED_TIMESTEP)
    seat.hornTicks = HORN_TICKS - 10
    presence.render(0, FIXED_TIMESTEP)
    expect(played.horn).toBe(1)
    seat.hornTicks = HORN_TICKS
    presence.render(0, FIXED_TIMESTEP)
    expect(played.horn).toBe(2)
    presence.dispose()
    free()
  })

  it('carries the weapon selected over its roof, faded while there are not the bananas for it', () => {
    const { seat, free } = seatOnFlat()
    const presence = new CarPresence(seat, 0xff0000, { explosions: new Explosions(), smoke: new Smoke(), sound: null })
    const mount = presence.object.children.find((child) => child.position.y > seat.tuning.chassisHalfHeight + 1)!
    const shown = (): THREE.Object3D | undefined => mount.children.find((child) => child.visible)
    const opacity = (): number => {
      let least = 1
      shown()!.traverse((part) => {
        if (part instanceof THREE.Mesh) least = Math.min(least, (part.material as THREE.Material).opacity)
      })
      return least
    }
    presence.render(0, FIXED_TIMESTEP)
    expect(shown()).toBeUndefined()
    // Selected with too few bananas: on the roof, at half strength.
    seat.weapon = 'mines'
    seat.score = WEAPON_COSTS.mines - 1
    presence.render(0, FIXED_TIMESTEP)
    expect(opacity()).toBeCloseTo(0.5)
    // With enough, whole.
    seat.score = WEAPON_COSTS.mines
    presence.render(0, FIXED_TIMESTEP)
    expect(opacity()).toBe(1)
    presence.dispose()
    free()
  })

  beforeAll(async () => {
    await initPhysics()
  })

  it('draws the plow set and the magnet pulling, while they last', () => {
    const { seat, free } = seatOnFlat()
    const presence = new CarPresence(seat, 0xff0000, { explosions: new Explosions(), smoke: new Smoke(), sound: null })
    const children = presence.object.children
    const ring = children.find((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry)!
    // The blade and the ring are the last things hung on the car.
    const [blade] = children.slice(-2) as [THREE.Object3D]
    presence.render(0, FIXED_TIMESTEP)
    expect([blade.visible, ring.visible]).toEqual([false, false])
    seat.plowTicks = 10
    seat.magnetTicks = 10
    presence.render(0, FIXED_TIMESTEP)
    expect([blade.visible, ring.visible]).toEqual([true, true])
    seat.plowTicks = 0
    seat.magnetTicks = 0
    presence.render(0, FIXED_TIMESTEP)
    expect([blade.visible, ring.visible]).toEqual([false, false])
    presence.dispose()
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
