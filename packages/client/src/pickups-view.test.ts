import { SPILL_FLIGHT_TICKS, SPILL_LIFE_TICKS, type Pickup, type Spilled } from '@buggies/game'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { BANANA_LENGTH, BOMB_RADIUS, PickupField, POP_LIFE, bananaGeometry, bombGeometry } from './pickups-view.ts'

function pickups(bananas: number, bombs = 0): Pickup[] {
  return Array.from({ length: bananas + bombs }, (_, slot) => ({
    kind: slot < bananas ? 'banana' : 'bomb',
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

describe('pickups as drawn', () => {
  it('bananas are the length they say, pinched at browned tips', () => {
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

  it('bombs are a ball with a fuse on top', () => {
    const geometry = bombGeometry()
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.max.x - box.min.x).toBeCloseTo(BOMB_RADIUS * 2, 1)
    expect(box.max.y).toBeGreaterThan(BOMB_RADIUS * 1.5)
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count)
    geometry.dispose()
  })

  it('are drawn where they are, each kind with its own mesh, and not before they are out', () => {
    const source = { pickups: pickups(3, 2), spilled: [] as Spilled[], tick: 100 }
    source.pickups[1]!.spawnTick = 200
    source.pickups[4]!.spawnTick = 200
    const field = new PickupField(source)
    field.update(0.1)
    const [bananas, bombs, loose] = field.object.children as THREE.InstancedMesh[]
    expect(bananas!.count).toBe(3)
    expect(bombs!.count).toBe(2)
    expect(loose!.count).toBe(0)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    bananas!.getMatrixAt(2, matrix)
    position.setFromMatrixPosition(matrix)
    expect(position.x).toBeCloseTo(20, 5)
    expect(Math.abs(position.y - 2)).toBeLessThan(0.3)
    bombs!.getMatrixAt(0, matrix)
    position.setFromMatrixPosition(matrix)
    expect(position.x).toBeCloseTo(30, 5)
    // Out ones at full size, the rest scaled away to nothing.
    expect(column(bananas!, 0)).toBeCloseTo(1, 5)
    expect(column(bananas!, 1)).toBe(0)
    expect(column(bombs!, 0)).toBeCloseTo(1, 5)
    expect(column(bombs!, 1)).toBe(0)
    field.dispose()
  })

  it('pop a banana when it is taken, and hand on a bomb when it is set off, and only then', () => {
    const source = { pickups: pickups(2, 1), spilled: [] as Spilled[], tick: 0 }
    const blasts: number[] = []
    const field = new PickupField(source, (at) => blasts.push(at.x))
    field.update(0.1)
    expect(field.popping).toBe(0)
    // The slot moves on: the one that was out was taken.
    source.pickups[0]!.generation = 1
    source.pickups[0]!.spawnTick = 480
    field.update(0.1)
    expect(field.popping).toBe(1)
    expect(field.object.children.length).toBe(4)
    field.update(POP_LIFE)
    expect(field.popping).toBe(0)
    expect(field.object.children.length).toBe(3)
    // A bomb going is a blast where it was, not a pop.
    source.pickups[2]!.generation = 1
    source.pickups[2]!.spawnTick = 480
    field.update(0.1)
    expect(field.popping).toBe(0)
    expect(blasts).toEqual([20])
    // Its next turning up is not a taking.
    source.tick = 480
    field.update(0.1)
    expect(field.popping).toBe(0)
    expect(blasts).toHaveLength(1)
    // Nor is a slot that was never out moving on, as a snapshot may have it do.
    source.pickups[1]!.spawnTick = 1000
    field.update(0.1)
    source.pickups[1]!.generation = 2
    field.update(0.1)
    expect(field.popping).toBe(0)
    field.dispose()
  })

  it('fling spilled bananas out of the blast in an arc, lie them where they land, and pop them when taken', () => {
    const spilled: Spilled[] = [{ from: { x: 0, y: 2, z: 0 }, position: { x: 12, y: 3, z: 0 }, bornTick: 100 }]
    const source = { pickups: pickups(0, 0), spilled, tick: 100 + SPILL_FLIGHT_TICKS / 2 }
    const field = new PickupField(source)
    const loose = field.object.children[2] as THREE.InstancedMesh
    expect(loose.count).toBe(1)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    loose.getMatrixAt(0, matrix)
    position.setFromMatrixPosition(matrix)
    // Halfway there, and well above the straight line between.
    expect(position.x).toBeCloseTo(6, 3)
    expect(position.y).toBeGreaterThan(2.5 + 2)
    // Landed: where it lands, near enough, bobbing.
    source.tick = 100 + SPILL_FLIGHT_TICKS + 10
    field.update(0.1)
    loose.getMatrixAt(0, matrix)
    position.setFromMatrixPosition(matrix)
    expect(position.x).toBeCloseTo(12, 3)
    expect(Math.abs(position.y - 3)).toBeLessThan(0.3)
    // Gone before its time: taken, and it pops where it lay.
    spilled.length = 0
    field.update(0.1)
    expect(loose.count).toBe(0)
    expect(field.popping).toBe(1)
    field.update(POP_LIFE)
    // Gone at its time: faded, no pop.
    spilled.push({ from: { x: 0, y: 2, z: 0 }, position: { x: -8, y: 3, z: 4 }, bornTick: 100 })
    field.update(0.1)
    source.tick = 100 + SPILL_LIFE_TICKS
    spilled.length = 0
    field.update(0.1)
    expect(field.popping).toBe(0)
    field.dispose()
  })
})
