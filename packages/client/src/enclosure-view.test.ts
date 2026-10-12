import { generateWorld, worldId } from '@buggies/terrain'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildPlatforms } from './enclosure-view.ts'
import { lookOf } from './world-looks.ts'

describe("Jupiter's platforms drawn", () => {
  let world: ReturnType<typeof generateWorld>
  let meshes: THREE.Mesh[]
  beforeAll(() => {
    world = generateWorld(worldId(7, 'jupiter'))
    meshes = buildPlatforms(world, lookOf('jupiter'))!.children as THREE.Mesh[]
  }, 120_000)

  it('lay each top on the sphere at its platform’s height all the way out, to an edge as round as a circle', () => {
    const tops = meshes.filter((mesh) => mesh.name === 'ground')
    expect(tops).toHaveLength(world.platforms.length)
    tops.forEach((top, k) => {
      const platform = world.platforms[k]!
      const middle = new THREE.Vector3(platform.center.x, platform.center.y, platform.center.z).normalize()
      const position = top.geometry.getAttribute('position')
      const point = new THREE.Vector3()
      let farthest = 0
      let nearestEdge = Infinity
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i)
        // Curving with the planet, not flat: every corner exactly the platform's height over its radius.
        expect(point.length() - world.radius).toBeCloseTo(platform.height, 3)
        const reach = point.clone().normalize().angleTo(middle) * world.radius
        farthest = Math.max(farthest, reach)
        if (reach > platform.radius - 1) nearestEdge = Math.min(nearestEdge, reach)
      }
      expect(farthest).toBeCloseTo(platform.radius, 1)
      expect(nearestEdge).toBeCloseTo(platform.radius, 1)
    })
  })

  it('hang the rock under each top, never above it', () => {
    const rocks = meshes.filter((mesh) => mesh.name === 'underside')
    expect(rocks).toHaveLength(world.platforms.length)
    rocks.forEach((rock, k) => {
      const position = rock.geometry.getAttribute('position')
      const point = new THREE.Vector3()
      for (let i = 0; i < position.count; i++) expect(point.fromBufferAttribute(position, i).length() - world.radius).toBeLessThan(world.platforms[k]!.height)
    })
  })
})
