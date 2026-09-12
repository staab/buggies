import { generateTerrain } from '@buggies/terrain'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createTerrainView } from './terrain-view.ts'

function positionValues(group: THREE.Group): number[] {
  group.updateMatrixWorld(true)
  const values: number[] = []
  const vertex = new THREE.Vector3()
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const attribute = object.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < attribute.count; i++) {
      vertex.fromBufferAttribute(attribute, i).applyMatrix4(object.matrixWorld)
      values.push(vertex.x, vertex.y, vertex.z)
    }
  })
  return values
}

describe('createTerrainView', () => {
  it('builds finite geometry for a generated map', () => {
    const map = generateTerrain(5, { size: 257 })
    const view = createTerrainView(map)

    // Land plus at least the sea plane.
    expect(view.children.length).toBeGreaterThanOrEqual(2)

    const values = positionValues(view)
    expect(values.length).toBeGreaterThan(0)
    expect(values.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('stays within the map bounds', () => {
    const map = generateTerrain(11, { size: 257 })
    const view = createTerrainView(map)
    const worldSize = map.size * map.cellSize
    const margin = 20

    for (const value of positionValues(view)) {
      expect(value).toBeGreaterThan(-margin)
      expect(value).toBeLessThan(worldSize + margin)
    }
  })
})
