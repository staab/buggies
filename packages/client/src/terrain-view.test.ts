import { PLANET_TERRAIN, generateTerrain, type TerrainMap, type World } from '@buggies/terrain'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

import { createTerrainView } from './terrain-view.ts'

let map: TerrainMap
let world: World
let view: THREE.Group

/** Every point of every plain mesh under a group, where the world has it. */
function positionValues(group: THREE.Group): THREE.Vector3[] {
  group.updateMatrixWorld(true)
  const points: THREE.Vector3[] = []
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return
    const attribute = object.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < attribute.count; i += 7) points.push(new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(object.matrixWorld))
  })
  return points
}

/** The meshes of the ground. */
function groundPieces(): THREE.Mesh[] {
  const pieces: THREE.Mesh[] = []
  view.getObjectByName('ground')!.traverse((node) => {
    if (node instanceof THREE.Mesh) pieces.push(node)
  })
  return pieces
}

describe('the planet drawn', () => {
  beforeAll(() => {
    // An island with tunnels through its hills.
    map = generateTerrain(7, PLANET_TERRAIN)
    world = map.world!
    view = createTerrainView(world)
  }, 120_000)

  it('builds finite geometry, all of it on the planet: nothing under its sea floor, nothing flown off', () => {
    const points = positionValues(view)
    expect(points.length).toBeGreaterThan(1000)
    for (const point of points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)).toBe(true)
      // The sea sphere and the ground reach the whole way round; nothing else stands far off the ground.
      expect(point.length() - world.radius).toBeGreaterThan(-80)
      expect(point.length() - world.radius).toBeLessThan(250)
    }
  })

  it('textures only the tiles with something painted on them, and draws the rest of each face in the land colors alone', () => {
    const pieces = groundPieces()
    const textured = pieces.filter((piece) => (piece.material as THREE.MeshStandardMaterial).map !== null)
    const plain = pieces.filter((piece) => (piece.material as THREE.MeshStandardMaterial).vertexColors)
    expect(textured.length).toBeGreaterThan(0)
    expect(plain.length).toBeLessThanOrEqual(6)
    for (const piece of plain) expect(piece.geometry.getAttribute('color').count).toBe(piece.geometry.getAttribute('position').count)
    // Every road at grade the ground carries is on a textured tile.
    const spheres = textured.map((piece) => {
      piece.geometry.computeBoundingSphere()
      return piece.geometry.boundingSphere!
    })
    for (const road of world.roads) {
      if (road.kind === 'highway') continue
      for (const point of road.points) {
        const at = new THREE.Vector3(point.x, point.y, point.z)
        expect(spheres.some((sphere) => sphere.distanceToPoint(at) <= 1)).toBe(true)
      }
    }
  })

  it('leaves the ground out where a tunnel is bored, and draws a solid shell through it', () => {
    expect(world.holes.some((hole) => hole === 1)).toBe(true)
    const cells = 6 * world.ground.n * world.ground.n
    const triangles = groundPieces().reduce((sum, piece) => sum + piece.geometry.getIndex()!.count / 3, 0)
    expect(triangles).toBeLessThan(cells * 2)
    const shells = view.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && (child.material as THREE.MeshStandardMaterial).flatShading === true)
    expect(shells.length).toBeGreaterThan(0)
  })

  it('stands everything upright on the sphere, moving parts too, and the sea a sphere round it all', () => {
    // Whatever moves, moved as a frame is drawn: the cranes' jibs, the rotors, the chairs, the hands, the mist.
    const none = null as never
    view.traverse((node) => node.onBeforeRender(none, none, none, none, none, none))
    view.updateMatrixWorld(true)
    // A crane's turning top stands on it, its five parts high over the ground.
    const cranes = world.buildings.filter((building) => building.kind === 'crane').length
    let tops = 0
    const point = new THREE.Vector3()
    view.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || node.parent?.parent?.name !== 'crane') return
      tops++
      point.setFromMatrixPosition(node.matrixWorld)
      expect(point.length() - world.radius).toBeGreaterThan(0)
      expect(point.length() - world.radius).toBeLessThan(200)
    })
    expect(tops).toBe(cranes * 5)
    // Nearly every instance upright: a few things are built leaning.
    const matrix = new THREE.Matrix4()
    const up = new THREE.Vector3()
    let seen = 0
    let upright = 0
    view.traverse((node) => {
      if (!(node instanceof THREE.InstancedMesh) || node.count === 0) return
      for (let i = 0; i < node.count; i += 13) {
        node.getMatrixAt(i, matrix)
        point.setFromMatrixPosition(matrix)
        up.set(0, 1, 0).transformDirection(matrix)
        expect(point.length() - world.radius).toBeGreaterThan(-60)
        seen++
        if (up.dot(point.clone().normalize()) > 0.9) upright++
      }
    })
    expect(seen).toBeGreaterThan(100)
    expect(upright / seen).toBeGreaterThan(0.95)
    const sea = view.getObjectByName('water') as THREE.Mesh
    expect(sea.geometry).toBeInstanceOf(THREE.SphereGeometry)
  })
})
