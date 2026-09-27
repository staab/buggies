import { describe, expect, it } from 'vitest'

import { arcDistance, createSphereGround, gridDirection, gridPlace, groundIndex, sphereHeight } from './sphere.ts'

const N = 64

describe('the cube-sphere', () => {
  it('takes a grid point to a direction and back to the same point', () => {
    const direction = { x: 0, y: 0, z: 0 }
    const place = { face: 0, i: 0, j: 0 }
    for (let face = 0; face < 6; face++) {
      for (const [i, j] of [[1, 1], [32, 32], [63, 5], [10, 50]] as const) {
        gridDirection(N, face, i, j, direction)
        expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 12)
        gridPlace(N, direction, place)
        expect(place.face).toBe(face)
        expect(place.i).toBeCloseTo(i, 9)
        expect(place.j).toBeCloseTo(j, 9)
      }
    }
  })

  it('meets itself along every edge: each point on a face edge is a point on the face beside it', () => {
    const direction = { x: 0, y: 0, z: 0 }
    const other = { x: 0, y: 0, z: 0 }
    let matched = 0
    for (let face = 0; face < 6; face++) {
      for (let k = 0; k <= N; k += 8) {
        for (const [i, j] of [[0, k], [N, k], [k, 0], [k, N]] as const) {
          gridDirection(N, face, i, j, direction)
          // Some other face has a grid point in the same direction.
          let found = false
          for (let f = 0; f < 6 && !found; f++) {
            if (f === face) continue
            for (let a = 0; a <= N && !found; a++) {
              for (const b of [0, N]) {
                for (const [x, y] of [[a, b], [b, a]] as const) {
                  gridDirection(N, f, x, y, other)
                  if (Math.hypot(other.x - direction.x, other.y - direction.y, other.z - direction.z) < 1e-9) found = true
                }
              }
            }
          }
          expect(found).toBe(true)
          matched++
        }
      }
    }
    expect(matched).toBeGreaterThan(200)
  })

  it('makes cells nearly square and nearly the same size everywhere', () => {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 0, y: 0, z: 0 }
    let least = Infinity
    let most = 0
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j < N; j += 3) {
        for (let i = 0; i < N; i += 3) {
          gridDirection(N, face, i, j, a)
          gridDirection(N, face, i + 1, j, b)
          const side = arcDistance(a, b, 1)
          least = Math.min(least, side)
          most = Math.max(most, side)
        }
      }
    }
    expect(most / least).toBeLessThan(1.45)
  })

  it('reads a height anywhere between the grid points, and the distance along the sphere between two directions', () => {
    const ground = createSphereGround(N, 100)
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) ground.heights[groundIndex(ground, face, i, j)] = 5
    }
    const d = { x: 0.3, y: 0.8, z: -0.52 }
    const length = Math.hypot(d.x, d.y, d.z)
    expect(sphereHeight(ground, { x: d.x / length, y: d.y / length, z: d.z / length })).toBeCloseTo(5, 5)
    expect(arcDistance({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 100)).toBeCloseTo((Math.PI / 2) * 100, 9)
  })
})
