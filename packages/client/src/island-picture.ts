import type { Vec3 } from '@buggies/physics'
import { nearestGridPoint, roomAt, sphereHeight, type World } from '@buggies/terrain'
import * as THREE from 'three'

import { WORLD_LOOKS, groundTone } from './world-looks.ts'

/** Rock with no room in it, drawn dark. */
const SOLID = new THREE.Color('#141110')

/**
 * Where a point of the planet is on its picture, each 0 to 1: its
 * longitude across, from the far side round, and its latitude down, from
 * the north pole.
 */
export function onPicture(point: Vec3): { u: number; v: number } {
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1
  const longitude = Math.atan2(point.x, point.z)
  const latitude = Math.asin(Math.min(Math.max(point.y / length, -1), 1))
  return { u: (longitude + Math.PI) / (2 * Math.PI), v: 0.5 - latitude / Math.PI }
}

/** The way out from the planet's middle through a spot of its picture. */
export function offPicture(u: number, v: number): Vec3 {
  const longitude = u * 2 * Math.PI - Math.PI
  const latitude = (0.5 - v) * Math.PI
  const ring = Math.cos(latitude)
  return { x: ring * Math.sin(longitude), y: Math.sin(latitude), z: ring * Math.cos(longitude) }
}

/**
 * A world as a picture this many pixels across, twice as wide as it is
 * tall: the sea by its depth, the land by its height, in the world's own
 * colors, the rock it is shut in dark, and the rivers and the roads over
 * it, the whole way round.
 */
export function drawIsland(world: World, pixels: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const across = pixels
  const down = Math.round(pixels / 2)
  canvas.width = across
  canvas.height = down
  const context = canvas.getContext('2d')
  if (context === null) return canvas
  const { heights } = world.ground
  const look = WORLD_LOOKS[world.kind]
  let lowest = Infinity
  let highest = -Infinity
  for (let at = 0; at < heights.length; at++) {
    if (!roomAt(world.roof, heights, at)) continue
    lowest = Math.min(lowest, heights[at]!)
    highest = Math.max(highest, heights[at]!)
  }
  const image = context.createImageData(across, down)
  const color = new THREE.Color()
  const rgb = { r: 0, g: 0, b: 0 }
  for (let row = 0; row < down; row++) {
    for (let col = 0; col < across; col++) {
      const direction = offPicture((col + 0.5) / across, (row + 0.5) / down)
      const nearest = nearestGridPoint(world, direction)
      if (roomAt(world.roof, heights, nearest)) groundTone(look, sphereHeight(world.ground, direction), lowest, highest, world.seaLevel, world.districtOf[nearest]!, color)
      else color.copy(SOLID)
      color.getRGB(rgb, THREE.SRGBColorSpace)
      const at = (row * across + col) * 4
      image.data[at] = rgb.r * 255
      image.data[at + 1] = rgb.g * 255
      image.data[at + 2] = rgb.b * 255
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  // A line through the points, broken where it runs off one side of the picture and on at the other.
  const trace = (points: readonly Vec3[], closed: boolean): void => {
    const spots = points.map(onPicture)
    if (closed && spots.length > 0) spots.push(spots[0]!)
    context.beginPath()
    spots.forEach((spot, i) => {
      const x = spot.u * across
      const y = spot.v * down
      if (i === 0 || Math.abs(spot.u - spots[i - 1]!.u) > 0.5) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()
  }
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = '#4f9fd0'
  context.lineWidth = 1.5
  for (const river of world.rivers) trace(river.points.map((point) => point.at), false)
  for (const road of world.roads) {
    if (road.kind === 'street' || road.kind === 'ramp') continue
    context.strokeStyle = road.kind === 'highway' ? '#f2d27a' : '#d8d2c4'
    context.lineWidth = road.kind === 'highway' ? 2.5 : 1.2
    trace(road.points, road.closed)
  }
  return canvas
}
