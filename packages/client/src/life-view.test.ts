import { generateWorld, roofOver, sphereHeight, worldId, type World } from '@buggies/terrain'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

import { KELP_SWAY } from './furniture-view.ts'
import { buildLife } from './life-view.ts'

/** Every point drawn of what lives in a view, where it is: each instance's middle, or each point of a cloud. */
function wherever(life: THREE.Object3D): THREE.Vector3[] {
  life.updateMatrixWorld(true)
  const found: THREE.Vector3[] = []
  const matrix = new THREE.Matrix4()
  life.traverse((node) => {
    if (node instanceof THREE.InstancedMesh) {
      for (let k = 0; k < node.count; k++) {
        node.getMatrixAt(k, matrix)
        found.push(new THREE.Vector3().setFromMatrixPosition(matrix))
      }
    } else if (node instanceof THREE.Points) {
      const at = node.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let k = 0; k < at.count; k++) found.push(new THREE.Vector3().fromBufferAttribute(at, k))
    } else if (node instanceof THREE.Mesh) {
      found.push(new THREE.Vector3().setFromMatrixPosition(node.matrixWorld))
    }
  })
  return found
}

const heightOver = (world: World, p: THREE.Vector3): number => p.length() - world.radius

describe('what lives in the worlds', () => {
  let neptune: World
  let mercury: World
  beforeAll(() => {
    neptune = generateWorld(worldId(7, 'neptune'))
    mercury = generateWorld(worldId(7, 'mercury'))
  }, 60_000)

  it('fills Neptune’s open water with fish, jellyfish, bubbles and whales, under the surface and never in the glass', () => {
    const life = buildLife(neptune)!
    expect(life.name).toBe('life')
    for (const seconds of [0, 37, 600]) {
      life.userData.move(seconds)
      expect(KELP_SWAY.value).toBe(seconds)
      const points = wherever(life)
      expect(points.length).toBeGreaterThan(1000)
      for (const p of points) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true)
        const height = heightOver(neptune, p)
        expect(height).toBeLessThan(neptune.seaLevel)
        expect(height).toBeGreaterThan(sphereHeight(neptune.ground, p.clone().normalize()) - 0.01)
        // The whales swim over everything; whatever else swims out in the open, clear of the stations and tunnels.
        if (height < neptune.seaLevel - 12) expect(roofOver(neptune, p)).toBe(Infinity)
      }
    }
  })

  it('floats will-o’-the-wisps in Mercury’s caverns, in the air between floor and ceiling', () => {
    const life = buildLife(mercury)!
    for (const seconds of [0, 90]) {
      life.userData.move(seconds)
      const points = wherever(life)
      expect(points.length).toBeGreaterThanOrEqual(mercury.districts.length * 10)
      for (const p of points) {
        const height = heightOver(mercury, p)
        expect(height).toBeGreaterThan(sphereHeight(mercury.ground, p.clone().normalize()) + 1)
        expect(height).toBeLessThan(roofOver(mercury, p) - 1)
      }
    }
  })

  it('leaves the worlds with nothing of the sort alone', () => {
    expect(buildLife(generateWorld(worldId(7, 'jupiter')))).toBeNull()
  })
})
