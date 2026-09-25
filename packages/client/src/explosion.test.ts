import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { Explosions } from './explosion.ts'

describe('explosions', () => {
  it('race a shockwave ring out to its reach, fading, and take it away once it has gone', () => {
    const explosions = new Explosions()
    explosions.shockwave({ x: 10, y: 2, z: -5 }, 30)
    const ring = explosions.object.children[0] as THREE.Mesh
    const material = ring.material as THREE.MeshBasicMaterial
    expect(ring.position.toArray()).toEqual([10, 2, -5])
    const sizes: number[] = []
    const opacities: number[] = []
    for (let frame = 0; frame < 5; frame++) {
      explosions.update(0.09)
      sizes.push(ring.scale.x)
      opacities.push(material.opacity)
    }
    for (let k = 1; k < sizes.length; k++) {
      expect(sizes[k]!).toBeGreaterThan(sizes[k - 1]!)
      expect(opacities[k]!).toBeLessThan(opacities[k - 1]!)
    }
    expect(sizes.at(-1)!).toBeGreaterThan(25)
    explosions.update(0.2)
    expect(explosions.object.children).toHaveLength(0)
    explosions.dispose()
  })
})
