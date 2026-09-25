import { addProp, createPhysicsWorld, initPhysics, type ArenaProp } from '@buggies/game'
import { beforeAll, describe, expect, it } from 'vitest'
import { PropsView } from './props-view.ts'

describe('the props on the screen', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  it('draws one instance a prop, each where its body is', () => {
    const world = createPhysicsWorld()
    const homes = [
      { kind: 'cone' as const, x: 10, z: 10, bottom: 0, yaw: 0 },
      { kind: 'cone' as const, x: 12, z: 10, bottom: 0, yaw: 0 },
      { kind: 'barrel' as const, x: 20, z: 10, bottom: 0, yaw: 1 },
    ]
    const props: ArenaProp[] = homes.map((home, id) => ({ id, kind: home.kind, home, body: addProp(world, home) }))
    const view = new PropsView({ props })
    expect(view.drawn).toBe(3)
    expect(view.object.children.length).toBe(2)
    props[2]!.body.setTranslation({ x: 25, y: 4, z: 11 }, true)
    view.update()
    const drum = view.object.children.find((child) => child instanceof Object && 'count' in child && child.count === 1)
    expect(drum).toBeDefined()
    view.dispose()
    world.free()
  })
})
