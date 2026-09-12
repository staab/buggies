import type { Heightfield, Lake, River, TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

interface ColorStop {
  t: number
  color: THREE.Color
}

const LAND_STOPS: ColorStop[] = [
  { t: 0, color: new THREE.Color('#c8b98a') },
  { t: 0.06, color: new THREE.Color('#6f8f3f') },
  { t: 0.32, color: new THREE.Color('#4f7a34') },
  { t: 0.6, color: new THREE.Color('#7d7367') },
  { t: 0.82, color: new THREE.Color('#9d9d9d') },
  { t: 1, color: new THREE.Color('#f4f6f8') },
]

const SEABED_DEEP = new THREE.Color('#1c3a4a')
const SEABED_SHALLOW = new THREE.Color('#4a7f86')

function sampleRamp(t: number, stops: ColorStop[], out: THREE.Color): THREE.Color {
  if (t <= stops[0]!.t) return out.copy(stops[0]!.color)
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i]!
    if (t <= hi.t) {
      const lo = stops[i - 1]!
      const span = hi.t - lo.t || 1
      return out.copy(lo.color).lerp(hi.color, (t - lo.t) / span)
    }
  }
  return out.copy(stops[stops.length - 1]!.color)
}

function terrainColor(height: number, min: number, max: number, seaLevel: number, out: THREE.Color): THREE.Color {
  if (height <= seaLevel) {
    const depth = (seaLevel - height) / Math.max(seaLevel - min, 1e-3)
    return out.copy(SEABED_SHALLOW).lerp(SEABED_DEEP, Math.min(1, depth))
  }
  const t = (height - seaLevel) / Math.max(max - seaLevel, 1e-3)
  return sampleRamp(t, LAND_STOPS, out)
}

function buildTerrainMesh(field: Heightfield, seaLevel: number): THREE.Mesh {
  const { width, depth, cellSize, heights } = field
  const count = width * depth
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const color = new THREE.Color()

  let min = Infinity
  let max = -Infinity
  for (const height of heights) {
    if (height < min) min = height
    if (height > max) max = height
  }

  for (let row = 0; row < depth; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col
      const height = heights[cell]!
      const offset = cell * 3
      positions[offset] = col * cellSize
      positions[offset + 1] = height
      positions[offset + 2] = row * cellSize
      terrainColor(height, min, max, seaLevel, color)
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
    }
  }

  const indices = new Uint32Array((width - 1) * (depth - 1) * 6)
  let i = 0
  for (let row = 0; row < depth - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const topLeft = row * width + col
      const topRight = topLeft + 1
      const bottomLeft = topLeft + width
      const bottomRight = bottomLeft + 1
      indices[i++] = topLeft
      indices[i++] = bottomLeft
      indices[i++] = topRight
      indices[i++] = topRight
      indices[i++] = bottomLeft
      indices[i++] = bottomRight
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  return new THREE.Mesh(geometry, material)
}

function quadIndices(base: number): number[] {
  return [base, base + 2, base + 1, base + 1, base + 2, base + 3]
}

function buildLakeGeometry(lakes: Lake[], size: number, cellSize: number): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const lake of lakes) {
    const y = lake.level + 0.05
    for (const cell of lake.cells) {
      const col = cell % size
      const row = Math.floor(cell / size)
      const x0 = col * cellSize
      const z0 = row * cellSize
      const x1 = x0 + cellSize
      const z1 = z0 + cellSize
      const base = positions.length / 3
      positions.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1)
      indices.push(...quadIndices(base))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function buildRiverGeometry(river: River): THREE.BufferGeometry {
  const points = river.points
  const positions: number[] = []
  const indices: number[] = []

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const prev = points[Math.max(0, i - 1)]!
    const next = points[Math.min(points.length - 1, i + 1)]!
    let dx = next.x - prev.x
    let dz = next.z - prev.z
    const length = Math.hypot(dx, dz) || 1
    dx /= length
    dz /= length
    const halfWidth = point.width / 2
    const y = point.y + 0.1
    positions.push(point.x - dz * halfWidth, y, point.z + dx * halfWidth)
    positions.push(point.x + dz * halfWidth, y, point.z - dx * halfWidth)
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The visual layer for a generated map. Pure presentation: it reads the data
 * layer and builds geometry, and knows nothing about physics or simulation.
 */
export function createTerrainView(map: TerrainMap): THREE.Group {
  const group = new THREE.Group()
  const worldSize = map.size * map.cellSize
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2f6f9f'),
    transparent: true,
    opacity: 0.75,
    roughness: 0.25,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })

  group.add(buildTerrainMesh(map.heightfield, map.seaLevel))

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(worldSize, worldSize), waterMaterial)
  sea.rotation.x = -Math.PI / 2
  sea.position.set(worldSize / 2, map.seaLevel + 0.02, worldSize / 2)
  group.add(sea)

  if (map.lakes.length > 0) {
    group.add(new THREE.Mesh(buildLakeGeometry(map.lakes, map.size, map.cellSize), waterMaterial))
  }
  for (const river of map.rivers) {
    group.add(new THREE.Mesh(buildRiverGeometry(river), waterMaterial))
  }

  return group
}
