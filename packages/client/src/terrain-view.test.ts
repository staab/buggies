import { WORLD_SCALE, generateTerrain } from '@buggies/terrain'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createScaleCar, createTerrainView } from './terrain-view.ts'

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
    const margin = 20 * WORLD_SCALE

    for (const value of positionValues(view)) {
      expect(value).toBeGreaterThan(-margin)
      expect(value).toBeLessThan(worldSize + margin)
    }
  })

  it('carves a tunnel bore and draws a solid shell through it', () => {
    const map = generateTerrain(1, { size: 257 })
    const view = createTerrainView(map)

    const terrain = view.children.find(
      (child) =>
        child instanceof THREE.Mesh &&
        (child.material as THREE.MeshStandardMaterial).vertexColors &&
        (child.material as THREE.MeshStandardMaterial).side !== THREE.DoubleSide,
    ) as THREE.Mesh | undefined
    const tunnel = view.children.find(
      (child) =>
        child instanceof THREE.Mesh &&
        (child.material as THREE.MeshStandardMaterial).flatShading,
    ) as THREE.Mesh | undefined

    expect(terrain).toBeDefined()
    expect(tunnel).toBeDefined()

    // Boundary facets were split to fit the cut, so the carved landscape has
    // more vertices than the raw grid even though faces were removed.
    const gridVertices = map.size * map.size
    expect(terrain!.geometry.getAttribute('position').count).toBeGreaterThan(gridVertices)

    const position = tunnel!.geometry.getAttribute('position') as THREE.BufferAttribute
    expect(position.count).toBeGreaterThan(0)
    for (let i = 0; i < position.count; i++) {
      expect(Number.isFinite(position.getX(i))).toBe(true)
      expect(Number.isFinite(position.getY(i))).toBe(true)
      expect(Number.isFinite(position.getZ(i))).toBe(true)
    }
  })

  it('places the scale car on the highway', () => {
    const map = generateTerrain(5, { size: 257 })
    const road = map.roads[0]
    expect(road).toBeDefined()

    const car = createScaleCar(map)
    const index = Math.floor(road!.points.length * 0.25)
    const point = road!.points[index]!

    expect(car.position.x).toBeCloseTo(point.x, 5)
    expect(car.position.y).toBeCloseTo(point.y + 0.2, 5)
    expect(car.position.z).toBeCloseTo(point.z, 5)
    expect(Number.isFinite(car.rotation.y)).toBe(true)
  })
})
