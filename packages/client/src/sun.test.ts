import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { SHADOW_REACH, SUN_DIRECTION, SUN_DISTANCE, Sun } from './sun.ts'

describe('the sun', () => {
  it('hangs far off along the light, above the horizon, unfogged', () => {
    const sun = new Sun({ x: 750, y: 0, z: 750 })
    const expected = SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE).add(new THREE.Vector3(750, 0, 750))
    expect(sun.position.distanceTo(expected)).toBeLessThan(1e-6)
    expect(sun.position.y).toBeGreaterThan(SUN_DISTANCE / 2)
    sun.object.traverse((node) => {
      if (node instanceof THREE.Mesh) expect((node.material as THREE.MeshBasicMaterial).fog).toBe(false)
    })
    sun.dispose()
  })

  it('casts shadows from a frustum that follows the car', () => {
    const sun = new Sun()
    expect(sun.light.castShadow).toBe(true)
    const { camera } = sun.light.shadow
    expect(camera.right - camera.left).toBe(2 * SHADOW_REACH)
    expect(camera.top - camera.bottom).toBe(2 * SHADOW_REACH)

    sun.follow({ x: 100, y: 20, z: -40 })
    expect(sun.light.target.position.toArray()).toEqual([100, 20, -40])
    // The light stands up the sun's line from the car, so its shadows fall the same way everywhere.
    const line = sun.light.position.clone().sub(sun.light.target.position).normalize()
    expect(line.distanceTo(SUN_DIRECTION)).toBeLessThan(1e-6)
    sun.follow({ x: -300, y: 0, z: 900 })
    expect(sun.light.target.position.x).toBe(-300)
    sun.dispose()
  })
})
