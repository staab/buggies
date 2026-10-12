import { generateWorld, worldId, type WorldKind } from '@buggies/terrain'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { buildFurniture } from './furniture-view.ts'

describe('the furniture drawn', () => {
  it('draws each world past the planet its own, a batch a part, every piece where the world stands it', () => {
    const wanted: Partial<Record<WorldKind, number>> = { mars: 4, neptune: 2, jupiter: 2, venus: 3, mercury: 1 }
    for (const [kind, least] of Object.entries(wanted)) {
      const world = generateWorld(worldId(7, kind as WorldKind))
      const meshes = buildFurniture(world) as THREE.InstancedMesh[]
      expect(meshes.length, kind).toBeGreaterThanOrEqual(least)
      for (const mesh of meshes) {
        expect(mesh.count).toBeGreaterThan(0)
        const matrix = new THREE.Matrix4()
        const point = new THREE.Vector3()
        mesh.getMatrixAt(0, matrix)
        // Stood on the world, not at its middle.
        expect(point.setFromMatrixPosition(matrix).length()).toBeGreaterThan(world.radius - 200)
      }
    }
  }, 120_000)
})
