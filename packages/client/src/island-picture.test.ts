import { generateWorld } from '@buggies/terrain'
import { describe, expect, it } from 'vitest'

import { islandPixels, offPicture, onPicture } from './island-picture.ts'

describe('an island as pixels', () => {
  it('draws a world twice as wide as it is tall, every pixel filled in', () => {
    const world = generateWorld(11)
    const picture = islandPixels(world, 8)
    expect(picture.width).toBe(8)
    expect(picture.height).toBe(4)
    expect(picture.pixels).toBeInstanceOf(Uint8ClampedArray)
    expect(picture.pixels).toHaveLength(8 * 4 * 4)
    for (let at = 3; at < picture.pixels.length; at += 4) expect(picture.pixels[at]).toBe(255)
    // The sea and the land are not the same color, and the rock it is shut in is not either.
    const colors = new Set<string>()
    for (let at = 0; at < picture.pixels.length; at += 4) colors.add(`${picture.pixels[at]},${picture.pixels[at + 1]},${picture.pixels[at + 2]}`)
    expect(colors.size).toBeGreaterThan(1)
    // No canvas is touched: the same world draws the same picture again.
    expect(Array.from(islandPixels(world, 8).pixels)).toEqual(Array.from(picture.pixels))
  }, 120_000)

  it('knows where a point of the world is on its picture, and back again', () => {
    for (const raw of [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0.5, y: -0.5, z: 0.25 },
    ]) {
      // A picture is of directions out of the planet's middle, so the point is taken at the surface.
      const length = Math.sqrt(raw.x * raw.x + raw.y * raw.y + raw.z * raw.z)
      const point = { x: raw.x / length, y: raw.y / length, z: raw.z / length }
      const { u, v } = onPicture(point)
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThanOrEqual(1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      const back = offPicture(u, v)
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
      expect(back.z).toBeCloseTo(point.z, 6)
    }
  })
})
