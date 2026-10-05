import { generatePlanet, type World } from '@buggies/terrain'
import { beforeAll, describe, expect, it } from 'vitest'

import { HORN_TICKS, NEUTRAL_INPUT, advance, changeVehicle, createArena, initPhysics, takeSeat, wreckVehicle, type Arena, type Seat } from './index.ts'

let map: World

const SIGNAL = { ...NEUTRAL_INPUT, signal: true }

/** Hold the signal key down for this many ticks, on this seat alone. */
function hold(arena: Arena, seat: Seat, ticks: number): void {
  for (let i = 0; i < ticks; i++) advance(arena, (one) => (one === seat ? SIGNAL : NEUTRAL_INPUT))
}

describe('the signal key', () => {
  beforeAll(async () => {
    await initPhysics()
    map = generatePlanet(11)
  }, 60_000)

  it('turns an emergency vehicle\'s siren on with a press and off with the next, however long it is held', () => {
    const arena = createArena(map)
    const police = takeSeat(arena, 0, 'police')
    advance(arena)
    hold(arena, police, 30)
    expect(police.lightsOn).toBe(true)
    expect(police.hornTicks).toBe(0)
    advance(arena)
    hold(arena, police, 1)
    expect(police.lightsOn).toBe(false)
    // On again, and off once it is swapped into a car with no siren, or wrecked.
    advance(arena)
    hold(arena, police, 1)
    expect(police.lightsOn).toBe(true)
    changeVehicle(arena, police, 'sportsCar')
    expect(police.lightsOn).toBe(false)
    changeVehicle(arena, police, 'ambulance')
    advance(arena)
    hold(arena, police, 1)
    expect(police.lightsOn).toBe(true)
    wreckVehicle(police.vehicle, police.tuning)
    advance(arena)
    expect(police.lightsOn).toBe(false)
    arena.world.free()
  })

  it('blows any other car\'s horn for a second on a press, and does nothing else', () => {
    const arena = createArena(map)
    const semi = takeSeat(arena, 0, 'semi')
    advance(arena)
    const { score, weapon } = semi
    hold(arena, semi, 1)
    expect(semi.hornTicks).toBe(HORN_TICKS)
    expect(semi.lightsOn).toBe(false)
    hold(arena, semi, 20)
    expect(semi.hornTicks).toBe(HORN_TICKS - 20)
    for (let i = 0; i < HORN_TICKS; i++) advance(arena)
    expect(semi.hornTicks).toBe(0)
    expect(semi.score).toBe(score)
    expect(semi.weapon).toBe(weapon)
    arena.world.free()
  })
})
