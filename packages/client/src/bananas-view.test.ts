import type { Banana } from '@buggies/game'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { BANANA_LENGTH, BananaField, POP_LIFE, bananaGeometry } from './bananas-view.ts'

function bananas(count: number): Banana[] {
  return Array.from({ length: count }, (_, slot) => ({
    generation: 0,
    spawnTick: 0,
    position: { x: slot * 10, y: 2, z: 0 },
  }))
}

describe('bananas as drawn', () => {
  it('are the length they say, pinched at browned tips', () => {
    const geometry = bananaGeometry()
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(BANANA_LENGTH, 1)
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
    const source = { bananas: bananas(3), tick: 100 }
    source.bananas[1]!.spawnTick = 200
    const field = new BananaField(source)
    field.update(0.1)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const mesh = field.object.children[0] as THREE.InstancedMesh
    for (const slot of [0, 2]) {
      mesh.getMatrixAt(slot, matrix)
      position.setFromMatrixPosition(matrix)
      expect(position.x).toBeCloseTo(slot * 10, 5)
      expect(Math.abs(position.y - 2)).toBeLessThan(0.3)
      // Drawn at full size: the matrix's axes have length.
      expect(new THREE.Vector3().setFromMatrixColumn(matrix, 0).length()).toBeCloseTo(1, 5)
    }
    // Not out yet: scaled away to nothing.
    mesh.getMatrixAt(1, matrix)
    expect(new THREE.Vector3().setFromMatrixColumn(matrix, 0).length()).toBe(0)
    expect(new THREE.Vector3().setFromMatrixColumn(matrix, 1).length()).toBe(0)
    field.dispose()
  })

  it('pop when taken, and only then', () => {
    const source = { bananas: bananas(2), tick: 0 }
    const field = new BananaField(source)
    field.update(0.1)
    expect(field.popping).toBe(0)
    // The slot moves on: the one that was out was taken.
    source.bananas[0]!.generation = 1
    source.bananas[0]!.spawnTick = 480
    field.update(0.1)
    expect(field.popping).toBe(1)
    expect(field.object.children.length).toBe(2)
    field.update(POP_LIFE)
    expect(field.popping).toBe(0)
    expect(field.object.children.length).toBe(1)
    // Its next banana turning up is not a taking.
    source.tick = 480
    field.update(0.1)
    expect(field.popping).toBe(0)
    // Nor is a slot that was never out moving on, as a snapshot may have it do.
    source.bananas[1]!.spawnTick = 1000
    field.update(0.1)
    source.bananas[1]!.generation = 2
    field.update(0.1)
    expect(field.popping).toBe(0)
    field.dispose()
  })
})
