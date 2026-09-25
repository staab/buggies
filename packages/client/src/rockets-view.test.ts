import { NO_TARGET, ROCKET_LIFE_TICKS, type Rocket } from '@buggies/game'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { PresenceEffects } from './car-presence.ts'
import { RocketsView } from './rockets-view.ts'

/** Effects that only remember where they were set off. */
function effects(): { effects: PresenceEffects; bursts: number[]; puffs: number } {
  const bursts: number[] = []
  const counted = { puffs: 0 }
  const stub = {
    explosions: { burst: (at: { x: number }) => bursts.push(at.x) },
    smoke: {
      trail: () => {
        counted.puffs += 1
      },
    },
    sound: null,
  } as unknown as PresenceEffects
  return {
    effects: stub,
    bursts,
    get puffs() {
      return counted.puffs
    },
  }
}

function rocket(id: number, x: number, bornTick: number): Rocket {
  return { id, owner: 0, target: NO_TARGET, position: { x, y: 5, z: 0 }, velocity: { x: 40, y: 0, z: 0 }, bornTick, power: 1 }
}

describe('rockets as drawn', () => {
  it('fly nose first where the simulation has them, and blow up where last seen if gone before their time', () => {
    const rockets: Rocket[] = [rocket(1, 10, 0)]
    const source = { rockets, tick: 5 }
    const stub = effects()
    const view = new RocketsView(source, stub.effects, () => ({ x: 0, y: 0, z: 0 }))
    view.update(1 / 60)
    expect(view.flying).toBe(1)
    const model = view.object.children[0]!
    expect(model.position.x).toBe(10)
    // Nose along the velocity: the model's -Z points +X.
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(model.quaternion)
    expect(nose.x).toBeCloseTo(1, 5)
    expect(stub.puffs).toBeGreaterThan(0)
    // Gone at five ticks old, harvested or gone off: a burst where it was.
    rockets.length = 0
    view.update(1 / 60)
    expect(view.flying).toBe(0)
    expect(stub.bursts).toEqual([10])
    // Gone at the end of its time: spent, and nothing to see.
    rockets.push(rocket(2, 20, 0))
    source.tick = ROCKET_LIFE_TICKS
    view.update(1 / 60)
    rockets.length = 0
    view.update(1 / 60)
    expect(stub.bursts).toEqual([10])
    view.dispose()
  })
})
