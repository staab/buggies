import type { Vec3 } from '@buggies/physics'
import { nearestGridPoint, roomAt, sphereHeight, type World } from '@buggies/terrain'
import * as THREE from 'three'

import { WORLD_LOOKS, groundTone } from './world-looks.ts'

/** Rock with no room in it, drawn dark. */
const SOLID = new THREE.Color('#141110')

/** A run across an island's picture: a river or a road, drawn over the colors once they are painted. */
export interface IslandLine {
  /** Where it goes, in picture coordinates each 0 to 1. */
  readonly points: readonly { u: number; v: number }[]
  readonly closed: boolean
  readonly color: string
  readonly width: number
}

/**
 * A world as a picture, ready to be painted anywhere: its colors a byte a
 * channel, row by row, and the lines of its rivers and roads over them. It
 * is plain data, so it can be made off the page's thread and handed over.
 */
export interface IslandPicture {
  /** How many pixels across, and down: twice as wide as it is tall. */
  readonly width: number
  readonly height: number
  readonly pixels: Uint8ClampedArray
  readonly lines: readonly IslandLine[]
}

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
 * colors, the rock it is shut in dark, and the runs its rivers and its
 * roads make, the whole way round. No canvas is touched, so it can be made
 * where there is no page.
 */
export function islandPixels(world: World, pixels: number): IslandPicture {
  const width = pixels
  const height = Math.round(pixels / 2)
  const data = new Uint8ClampedArray(width * height * 4)
  const { heights } = world.ground
  const look = WORLD_LOOKS[world.kind]
  let lowest = Infinity
  let highest = -Infinity
  for (let at = 0; at < heights.length; at++) {
    if (!roomAt(world.roof, heights, at)) continue
    lowest = Math.min(lowest, heights[at]!)
    highest = Math.max(highest, heights[at]!)
  }
  const color = new THREE.Color()
  const rgb = { r: 0, g: 0, b: 0 }
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const direction = offPicture((col + 0.5) / width, (row + 0.5) / height)
      const nearest = nearestGridPoint(world, direction)
      if (roomAt(world.roof, heights, nearest)) groundTone(look, sphereHeight(world.ground, direction), lowest, highest, world.seaLevel, world.districtOf[nearest]!, color)
      else color.copy(SOLID)
      color.getRGB(rgb, THREE.SRGBColorSpace)
      const at = (row * width + col) * 4
      data[at] = rgb.r * 255
      data[at + 1] = rgb.g * 255
      data[at + 2] = rgb.b * 255
      data[at + 3] = 255
    }
  }
  const lines: IslandLine[] = []
  for (const river of world.rivers) {
    lines.push({ points: river.points.map((point) => onPicture(point.at)), closed: false, color: '#4f9fd0', width: 1.5 })
  }
  for (const road of world.roads) {
    if (road.kind === 'street' || road.kind === 'ramp') continue
    lines.push({
      points: road.points.map(onPicture),
      closed: road.closed,
      color: road.kind === 'highway' ? '#f2d27a' : '#d8d2c4',
      width: road.kind === 'highway' ? 2.5 : 1.2,
    })
  }
  return { width, height, pixels: data, lines }
}

/** Paint an island's picture into a canvas: its colors first, then a line through the points of every river and road, broken where it runs off one side of the picture and on at the other. */
export function paintIsland(picture: IslandPicture): HTMLCanvasElement {
  const { width, height } = picture
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) return canvas
  const image = context.createImageData(width, height)
  image.data.set(picture.pixels)
  context.putImageData(image, 0, 0)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const line of picture.lines) {
    const spots = line.points
    context.strokeStyle = line.color
    context.lineWidth = line.width
    context.beginPath()
    spots.forEach((spot, i) => {
      const x = spot.u * width
      const y = spot.v * height
      const before = spots[i - 1]
      if (i === 0 || before === undefined || Math.abs(spot.u - before.u) > 0.5) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    if (line.closed && spots.length > 0) context.closePath()
    context.stroke()
  }
  return canvas
}

/**
 * A world as a picture this many pixels across, twice as wide as it is
 * tall, ready to draw, the whole way round.
 */
export function drawIsland(world: World, pixels: number): HTMLCanvasElement {
  return paintIsland(islandPixels(world, pixels))
}
