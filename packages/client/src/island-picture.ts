import { sampleHeight, type TerrainMap } from '@buggies/terrain'

/** Mix two colors, `t` of the way from the first to the second. */
function mix(a: readonly number[], b: readonly number[], t: number): number[] {
  return a.map((value, i) => value + (b[i]! - value) * t)
}

const DEEP = [22, 58, 92]
const SHALLOW = [58, 118, 150]
const LOW = [86, 132, 72]
const HIGH = [150, 128, 96]
const PEAK = [226, 226, 222]

/**
 * The island from above, as a picture this many pixels a side: the sea by
 * its depth, the land by its height, the rivers and the roads over it.
 */
export function drawIsland(map: TerrainMap, pixels: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = pixels
  canvas.height = pixels
  const context = canvas.getContext('2d')
  if (context === null) return canvas
  const extent = map.size * map.cellSize
  const scale = pixels / extent
  let highest = map.seaLevel + 1
  for (const height of map.heightfield.heights) highest = Math.max(highest, height)
  const image = context.createImageData(pixels, pixels)
  for (let row = 0; row < pixels; row++) {
    for (let col = 0; col < pixels; col++) {
      const height = sampleHeight(map.heightfield, (col + 0.5) / scale, (row + 0.5) / scale)
      const color =
        height <= map.seaLevel
          ? mix(DEEP, SHALLOW, Math.max(1 + (height - map.seaLevel) / 30, 0))
          : (() => {
              const up = (height - map.seaLevel) / (highest - map.seaLevel)
              return up < 0.5 ? mix(LOW, HIGH, up * 2) : mix(HIGH, PEAK, (up - 0.5) * 2)
            })()
      const at = (row * pixels + col) * 4
      image.data[at] = color[0]!
      image.data[at + 1] = color[1]!
      image.data[at + 2] = color[2]!
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const trace = (points: readonly { x: number; z: number }[], closed: boolean): void => {
    context.beginPath()
    points.forEach((point, i) => (i === 0 ? context.moveTo(point.x * scale, point.z * scale) : context.lineTo(point.x * scale, point.z * scale)))
    if (closed) context.closePath()
    context.stroke()
  }
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = '#4f9fd0'
  context.lineWidth = 1.5
  for (const river of map.rivers) trace(river.points, false)
  for (const road of map.roads) {
    if (road.kind === 'street' || road.kind === 'ramp') continue
    context.strokeStyle = road.kind === 'highway' ? '#f2d27a' : '#d8d2c4'
    context.lineWidth = road.kind === 'highway' ? 2.5 : 1.2
    trace(road.points, road.closed)
  }
  return canvas
}

