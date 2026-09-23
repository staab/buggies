import { SPILL_FLIGHT_TICKS, SPILL_LIFE_TICKS, type Pickup, type Loose } from '@buggies/game'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { BANANA_LENGTH, BOMB_RADIUS, PickupField, POP_LIFE, bananaGeometry, bombGeometry } from './pickups-view.ts'

function pickups(count: number): Pickup[] {
  return Array.from({ length: count }, (_, slot) => ({
    generation: 0,
    spawnTick: 0,
    position: { x: slot * 10, y: 2, z: 0 },
  }))
}

function column(mesh: THREE.InstancedMesh, index: number): number {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixColumn(matrix, 0).length()
}

describe('bananas as drawn', () => {
  it('are the length they say, pinched at browned tips', () => {
    const geometry = bananaGeometry()
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())
    // The tips' own thickness adds a little to the length.
    expect(Math.abs(size.x - BANANA_LENGTH)).toBeLessThan(BANANA_LENGTH * 0.05)
    expect(size.y).toBeGreaterThan(BANANA_LENGTH * 0.3)
    expect(size.z).toBeLessThan(BANANA_LENGTH * 0.3)
    const colour = geometry.getAttribute('color') as THREE.BufferAttribute
    // Yellow in the middle, brown at the ends.
    const middle = Math.floor(colour.count / 2)
    expect(colour.getX(middle)).toBeGreaterThan(0.8)
    expect(colour.getX(0)).toBeLessThan(0.5)
    geometry.dispose()
  })

  it('are drawn where they are, and not before they are out', () => {
    const source = { pickups: pickups(3), loose: [] as Loose[], tick: 100 }
    source.pickups[1]!.spawnTick = 200
    const field = new PickupField(source)
    field.update(0.1)
    const [bananas, looseBananas] = field.object.children as THREE.InstancedMesh[]
    expect(bananas!.count).toBe(3)
    expect(looseBananas!.count).toBe(0)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    bananas!.getMatrixAt(2, matrix)
    position.setFromMatrixPosition(matrix)
    expect(position.x).toBeCloseTo(20, 5)
    expect(Math.abs(position.y - 2)).toBeLessThan(0.3)
    // Out ones at full size, the rest scaled away to nothing.
    expect(column(bananas!, 0)).toBeCloseTo(1, 5)
    expect(column(bananas!, 1)).toBe(0)
    field.dispose()
  })

  it('pop when taken, and only then', () => {
    const source = { pickups: pickups(2), loose: [] as Loose[], tick: 0 }
    const field = new PickupField(source)
    field.update(0.1)
    expect(field.popping).toBe(0)
    // The slot moves on: the one that was out was taken.
    source.pickups[0]!.generation = 1
    source.pickups[0]!.spawnTick = 480
    field.update(0.1)
    expect(field.popping).toBe(1)
    // The three meshes of the field, and the pop.
    expect(field.object.children.length).toBe(4)
    field.update(POP_LIFE)
    expect(field.popping).toBe(0)
    expect(field.object.children.length).toBe(3)
    // Its next turning up is not a taking.
    source.tick = 480
    field.update(0.1)
    expect(field.popping).toBe(0)
    // Nor is a slot that was never out moving on, as a snapshot may have it do.
    source.pickups[1]!.spawnTick = 1000
    field.update(0.1)
    source.pickups[1]!.generation = 2
    field.update(0.1)
    expect(field.popping).toBe(0)
    field.dispose()
  })

  it('fling spilled bananas out of the blast in an arc, lie them where they land, and pop them when taken', () => {
    const loose: Loose[] = [
      { id: 1, kind: 'banana', from: { x: 0, y: 2, z: 0 }, position: { x: 12, y: 3, z: 0 }, bornTick: 100 },
    ]
    const source = { pickups: pickups(0), loose, tick: 100 + SPILL_FLIGHT_TICKS / 2 }
    const field = new PickupField(source)
    const looseBananas = field.object.children[1] as THREE.InstancedMesh
    expect(looseBananas.count).toBe(1)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    looseBananas.getMatrixAt(0, matrix)
    position.setFromMatrixPosition(matrix)
    // Halfway there, and well above the straight line between.
    expect(position.x).toBeCloseTo(6, 3)
    expect(position.y).toBeGreaterThan(2.5 + 2)
    // Landed: where it lands, near enough, bobbing.
    source.tick = 100 + SPILL_FLIGHT_TICKS + 10
    field.update(0.1)
    looseBananas.getMatrixAt(0, matrix)
    position.setFromMatrixPosition(matrix)
    expect(position.x).toBeCloseTo(12, 3)
    expect(Math.abs(position.y - 3)).toBeLessThan(0.3)
    // Gone before its time: taken, and it pops where it lay.
    loose.length = 0
    field.update(0.1)
    expect(looseBananas.count).toBe(0)
    expect(field.popping).toBe(1)
    field.update(POP_LIFE)
    // Gone at its time: faded, no pop.
    loose.push({
      id: 2,
      kind: 'banana',
      from: { x: 0, y: 2, z: 0 },
      position: { x: -8, y: 3, z: 4 },
      bornTick: 100,
    })
    field.update(0.1)
    source.tick = 100 + SPILL_LIFE_TICKS
    loose.length = 0
    field.update(0.1)
    expect(field.popping).toBe(0)
    field.dispose()
  })

  it('draw bombs where they float, and say where one went off', () => {
    const geometry = bombGeometry()
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(BOMB_RADIUS * 2, 1)
    expect(size.y).toBeGreaterThan(BOMB_RADIUS * 2)
    geometry.dispose()

    const loose: Loose[] = [
      { id: 5, kind: 'bomb', from: { x: 0, y: 2, z: 0 }, position: { x: -5, y: 2, z: 0 }, bornTick: 0 },
    ]
    const source = { pickups: pickups(0), loose, tick: SPILL_FLIGHT_TICKS + 10 }
    const wentOff: { x: number; y: number; z: number }[] = []
    const field = new PickupField(source, (at) => wentOff.push({ x: at.x, y: at.y, z: at.z }))
    field.update(0.1)
    const [, looseBananas, bombs] = field.object.children as THREE.InstancedMesh[]
    expect(looseBananas!.count).toBe(0)
    expect(bombs!.count).toBe(1)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    bombs!.getMatrixAt(0, matrix)
    position.setFromMatrixPosition(matrix)
    expect(position.x).toBeCloseTo(-5, 3)
    // Gone: it went off where it was, and it is no banana to pop.
    loose.length = 0
    field.update(0.1)
    expect(bombs!.count).toBe(0)
    expect(wentOff).toHaveLength(1)
    expect(wentOff[0]!.x).toBeCloseTo(-5, 3)
    expect(field.popping).toBe(0)
    field.dispose()
  })

  it('pop a banana and burst a bomb harvested before their time, as if taken and set off', () => {
    const loose: Loose[] = [
      { id: 1, kind: 'banana', from: { x: 0, y: 2, z: 0 }, position: { x: 6, y: 2, z: 0 }, bornTick: 0 },
      { id: 2, kind: 'bomb', from: { x: 0, y: 2, z: 0 }, position: { x: -6, y: 2, z: 0 }, bornTick: 0 },
    ]
    const source = { pickups: pickups(0), loose, tick: SPILL_FLIGHT_TICKS + 10 }
    const wentOff: number[] = []
    const field = new PickupField(source, (at) => wentOff.push(at.x))
    field.update(0.1)
    // The oldest go to make room: the same as being taken, or set off.
    loose.length = 0
    field.update(0.1)
    expect(field.popping).toBe(1)
    expect(wentOff).toEqual([-6])
    field.dispose()
  })
})
