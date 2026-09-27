import { ROAD_SKIRT, WORLD_SCALE, generateTerrain } from '@buggies/terrain'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createTerrainView } from './terrain-view.ts'

/** The test islands, laid out as when a seed picked at most eight: the maps these tests were written against. */
const TEST_ISLANDS = { islandsMost: 8 }

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
    const map = generateTerrain(5, { ...TEST_ISLANDS, size: 257 })
    const view = createTerrainView(map)

    // Land plus at least the sea plane.
    expect(view.children.length).toBeGreaterThanOrEqual(2)

    const values = positionValues(view)
    expect(values.length).toBeGreaterThan(0)
    expect(values.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('stays within the map bounds', () => {
    const map = generateTerrain(11, { ...TEST_ISLANDS, size: 257 })
    const view = createTerrainView(map)
    const worldSize = map.size * map.cellSize
    const margin = 20 * WORLD_SCALE

    for (const value of positionValues(view)) {
      expect(value).toBeGreaterThan(-margin)
      expect(value).toBeLessThan(worldSize + margin)
    }
  })

  it('textures only the tiles with something painted on them, and draws the rest in the land colors alone', () => {
    const map = generateTerrain(1, { ...TEST_ISLANDS, size: 385 })
    const view = createTerrainView(map)
    const pieces: THREE.Mesh[] = []
    view.getObjectByName('ground')!.traverse((node) => {
      if (node instanceof THREE.Mesh) pieces.push(node)
    })
    const textured = pieces.filter((piece) => (piece.material as THREE.MeshStandardMaterial).map !== null)
    const plain = pieces.filter((piece) => (piece.material as THREE.MeshStandardMaterial).vertexColors)
    // The roads are painted on tiles of their own; the open land and the sea are not.
    expect(textured.length).toBeGreaterThan(0)
    expect(plain).toHaveLength(1)
    expect(plain[0]!.geometry.getAttribute('color').count).toBe(plain[0]!.geometry.getAttribute('position').count)
    let texels = 0
    for (const piece of textured) {
      const image = (piece.material as THREE.MeshStandardMaterial).map!.image as { width: number; height: number }
      texels += image.width * image.height
    }
    // A good deal less than one texture over the whole island at the same detail.
    expect(texels).toBeLessThan((map.size * map.cellSize * 2) ** 2)
    // Every road at grade is on a textured tile.
    const boxes = textured.map((piece) => {
      piece.geometry.computeBoundingBox()
      return piece.geometry.boundingBox!
    })
    for (const road of map.roads) {
      if (road.kind === 'highway') continue
      for (const point of road.points) {
        expect(boxes.some((box) => point.x >= box.min.x - 0.5 && point.x <= box.max.x + 0.5 && point.z >= box.min.z - 0.5 && point.z <= box.max.z + 0.5)).toBe(true)
      }
    }
  })

  it('carves a tunnel bore and draws a solid shell through it', () => {
    const map = generateTerrain(1, { ...TEST_ISLANDS, size: 257 })
    const view = createTerrainView(map)

    const ground = view.getObjectByName('ground')
    const pieces: THREE.Mesh[] = []
    ground?.traverse((node) => {
      if (node instanceof THREE.Mesh) pieces.push(node)
    })
    const tunnel = view.children.find(
      (child) =>
        child instanceof THREE.Mesh &&
        (child.material as THREE.MeshStandardMaterial).flatShading,
    ) as THREE.Mesh | undefined

    expect(pieces.length).toBeGreaterThan(0)
    expect(tunnel).toBeDefined()

    // Boundary facets were split to fit the cut, so the carved landscape has
    // more vertices than the raw grid even though faces were removed.
    const gridVertices = map.size * map.size
    const vertices = pieces.reduce((sum, piece) => sum + piece.geometry.getAttribute('position').count, 0)
    expect(vertices).toBeGreaterThan(gridVertices)

    const position = tunnel!.geometry.getAttribute('position') as THREE.BufferAttribute
    expect(position.count).toBeGreaterThan(0)
    for (let i = 0; i < position.count; i++) {
      expect(Number.isFinite(position.getX(i))).toBe(true)
      expect(Number.isFinite(position.getY(i))).toBe(true)
      expect(Number.isFinite(position.getZ(i))).toBe(true)
    }
  })

  it('paves the deck skirt in the road color where each ramp runs out from under the deck', () => {
    const map = generateTerrain(1, TEST_ISLANDS)
    const view = createTerrainView(map)
    const highway = map.roads.find((road) => road.kind === 'highway')!
    const ramps = map.roads.filter((road) => road.kind === 'ramp')
    expect(ramps.length).toBeGreaterThan(0)
    const half = highway.width / 2
    const distanceToHighway = (x: number, z: number): number =>
      Math.min(...highway.points.map((point) => Math.hypot(point.x - x, point.z - z)))
    // The highway's deck mesh: six colored vertices per centerline point.
    const deck = view.children.find(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh &&
        child.geometry.getAttribute('color') !== undefined &&
        child.geometry.getAttribute('position').count === highway.points.length * 6,
    )
    expect(deck).toBeDefined()
    const colors = deck!.geometry.getAttribute('color')
    const positions = deck!.geometry.getAttribute('position')
    let paved = 0
    for (const ramp of ramps) {
      // The ramp begins under the deck's edge and comes out across the
      // skirt: where its lane crosses the skirt's foot, the skirt is road.
      const mouth = ramp.points.reduce((closest, point) =>
        Math.abs(distanceToHighway(point.x, point.z) - (half + ROAD_SKIRT)) <
        Math.abs(distanceToHighway(closest.x, closest.z) - (half + ROAD_SKIRT))
          ? point
          : closest,
      )
      expect(distanceToHighway(ramp.points[0]!.x, ramp.points[0]!.z)).toBeLessThan(half)
      let nearest = 0
      let best = Infinity
      for (const [i, point] of highway.points.entries()) {
        const distance = Math.hypot(point.x - mouth.x, point.z - mouth.z)
        if (distance < best) {
          best = distance
          nearest = i
        }
      }
      // Whichever skirt vertex is nearer the mouth is the one beside it.
      const left = nearest * 6 + 2
      const right = nearest * 6 + 3
      const nearer =
        Math.hypot(positions.getX(left) - mouth.x, positions.getZ(left) - mouth.z) <
        Math.hypot(positions.getX(right) - mouth.x, positions.getZ(right) - mouth.z)
          ? left
          : right
      const edge = nearest * 6 + (nearer === left ? 0 : 1)
      const sameColor =
        Math.abs(colors.getX(nearer) - colors.getX(edge)) < 1e-6 &&
        Math.abs(colors.getY(nearer) - colors.getY(edge)) < 1e-6 &&
        Math.abs(colors.getZ(nearer) - colors.getZ(edge)) < 1e-6
      // The skirt runs down to the lane's surface at its foot, a hair below the deck.
      const drop = positions.getY(edge) - positions.getY(nearer)
      if (sameColor && drop >= 0 && drop < 1) paved++
    }
    expect(paved).toBe(ramps.length)
  }, 30_000)


})
