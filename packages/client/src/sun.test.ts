import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { DAY_SECONDS, sunDirection } from '@buggies/game'

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

  it('turns round the planet over a day, lighting the side facing it and leaving the other in the dark', () => {
    const sun = new Sun()
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#a9cbe6')
    scene.fog = new THREE.Fog('#a9cbe6', 1, 2)
    sun.turn(0)
    const morning = sun.position.clone().normalize()
    sun.turn(DAY_SECONDS / 4)
    const noon = sun.position.clone().normalize()
    expect(morning.dot(noon)).toBeLessThan(0.5)
    // Where the game says it is by then.
    const way = sunDirection(DAY_SECONDS / 4)
    expect(noon.distanceTo(new THREE.Vector3(way.x, way.y, way.z))).toBeLessThan(1e-6)

    // Where the sun stands overhead, it is day: its light, its disc, a blue sky.
    sun.follow({ x: way.x * 612, y: way.y * 612, z: way.z * 612 }, way)
    sun.shade(scene)
    expect(sun.light.intensity).toBeGreaterThan(1)
    expect((scene.background as THREE.Color).getHexString()).toBe('a9cbe6')
    // Round the far side, it is night: no sunlight, no disc, a dark sky and haze.
    const under = { x: -way.x, y: -way.y, z: -way.z }
    sun.follow({ x: under.x * 612, y: under.y * 612, z: under.z * 612 }, under)
    sun.shade(scene)
    expect(sun.light.intensity).toBe(0)
    expect(sun.sky.intensity).toBeLessThan(0.5)
    const night = scene.background as THREE.Color
    expect(night.r + night.g + night.b).toBeLessThan(0.5)
    expect((scene.fog as THREE.Fog).color.equals(night)).toBe(true)
    sun.dispose()
  })
})
