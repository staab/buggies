import {
  DISTRICT_CITY,
  DISTRICT_SUBURB,
  RIVER_BANK_LAP,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SKIRT,
  ROAD_TUNNEL,
  TUNNEL_CLEARANCE,
  boreClearance,
  buildTunnelHoles,
  heightAt,
  isSurfaceRoad,
  railMesh,
  railRuns,
  roadLift,
  tunnelSegments,
  tunnelShellMesh,
  type BoreSegment,
  type Heightfield,
  type Lake,
  type River,
  type Road,
  type TerrainMap,
} from '@buggies/terrain'
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
const CITY_TINT = new THREE.Color('#8c8f93')
const SUBURB_TINT = new THREE.Color('#a3a271')
const ROAD_GRADE_COLOR = new THREE.Color('#43464b')
const ROAD_BRIDGE_COLOR = new THREE.Color('#a8adb3')
const ROAD_TUNNEL_COLOR = new THREE.Color('#6d5b4a')
const ROAD_SKIRT_COLOR = new THREE.Color('#6f6152')
const RAIL_COLOR = new THREE.Color('#c9cdd2')
/** Boundary cells are split this many ways to fit the cut tightly to the bore. */
const TUNNEL_CUT_SUBDIVISIONS = 4

/**
 * The ground is painted at this many texels per metre: fine enough that a
 * street reads as a street, coarse enough that a whole island fits in one
 * texture.
 */
const TEXELS_PER_METRE = 1

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

function terrainColor(
  height: number,
  min: number,
  max: number,
  seaLevel: number,
  district: number,
  out: THREE.Color,
): THREE.Color {
  if (height <= seaLevel) {
    const depth = (seaLevel - height) / Math.max(seaLevel - min, 1e-3)
    return out.copy(SEABED_SHALLOW).lerp(SEABED_DEEP, Math.min(1, depth))
  }
  const t = (height - seaLevel) / Math.max(max - seaLevel, 1e-3)
  sampleRamp(t, LAND_STOPS, out)
  if (district === DISTRICT_CITY) out.lerp(CITY_TINT, 0.55)
  else if (district === DISTRICT_SUBURB) out.lerp(SUBURB_TINT, 0.35)
  return out
}

/**
 * The land, coloured by height and district, with every surface road painted
 * onto it. One texture over the whole island: the ground's colour is sampled
 * at each corner of the grid and blended between them, the way the mesh
 * blends its heights, and the roads are drawn on top with soft edges.
 */
function buildGroundTexture(map: TerrainMap): THREE.DataTexture {
  const { width, depth, cellSize, heights } = map.heightfield
  const { seaLevel, districtOf } = map

  let min = Infinity
  let max = -Infinity
  for (const height of heights) {
    if (height < min) min = height
    if (height > max) max = height
  }

  // The colour at every grid corner, ready to display.
  const corner = new Float32Array(width * depth * 3)
  const color = new THREE.Color()
  const rgb = { r: 0, g: 0, b: 0 }
  for (let cell = 0; cell < width * depth; cell++) {
    terrainColor(heights[cell]!, min, max, seaLevel, districtOf[cell]!, color)
    color.getRGB(rgb, THREE.SRGBColorSpace)
    corner[cell * 3] = rgb.r
    corner[cell * 3 + 1] = rgb.g
    corner[cell * 3 + 2] = rgb.b
  }

  const texels = Math.ceil(width * cellSize * TEXELS_PER_METRE)
  const data = new Uint8Array(texels * texels * 4)
  for (let ty = 0; ty < texels; ty++) {
    const gz = Math.min(((ty + 0.5) / TEXELS_PER_METRE) / cellSize, depth - 1)
    const row = Math.min(Math.floor(gz), depth - 2)
    const tz = gz - row
    for (let tx = 0; tx < texels; tx++) {
      const gx = Math.min(((tx + 0.5) / TEXELS_PER_METRE) / cellSize, width - 1)
      const col = Math.min(Math.floor(gx), width - 2)
      const txf = gx - col
      const a = (row * width + col) * 3
      const b = a + 3
      const c = a + width * 3
      const d = c + 3
      const at = (ty * texels + tx) * 4
      for (let channel = 0; channel < 3; channel++) {
        const top = corner[a + channel]! * (1 - txf) + corner[b + channel]! * txf
        const bottom = corner[c + channel]! * (1 - txf) + corner[d + channel]! * txf
        data[at + channel] = Math.round((top * (1 - tz) + bottom * tz) * 255)
      }
      data[at + 3] = 255
    }
  }

  ROAD_GRADE_COLOR.getRGB(rgb, THREE.SRGBColorSpace)
  const asphalt = [rgb.r * 255, rgb.g * 255, rgb.b * 255]
  for (const road of map.roads) {
    if (!isSurfaceRoad(road)) continue
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const half = road.width / 2
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      paintSegment(data, texels, road.points[i]!, road.points[(i + 1) % count]!, half, asphalt)
    }
  }

  const texture = new THREE.DataTexture(data, texels, texels, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

/** One stretch of carriageway, as a capsule with an edge a texel wide. */
function paintSegment(
  data: Uint8Array,
  texels: number,
  a: { x: number; z: number },
  b: { x: number; z: number },
  half: number,
  rgb: number[],
): void {
  const vx = b.x - a.x
  const vz = b.z - a.z
  const lengthSq = vx * vx + vz * vz || 1
  const reach = half + 1 / TEXELS_PER_METRE
  const minX = Math.max(Math.floor((Math.min(a.x, b.x) - reach) * TEXELS_PER_METRE), 0)
  const maxX = Math.min(Math.ceil((Math.max(a.x, b.x) + reach) * TEXELS_PER_METRE), texels - 1)
  const minZ = Math.max(Math.floor((Math.min(a.z, b.z) - reach) * TEXELS_PER_METRE), 0)
  const maxZ = Math.min(Math.ceil((Math.max(a.z, b.z) + reach) * TEXELS_PER_METRE), texels - 1)
  const edge = 0.5 / TEXELS_PER_METRE

  for (let ty = minZ; ty <= maxZ; ty++) {
    const z = (ty + 0.5) / TEXELS_PER_METRE
    for (let tx = minX; tx <= maxX; tx++) {
      const x = (tx + 0.5) / TEXELS_PER_METRE
      const t = Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0), 1)
      const distance = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t))
      const coverage = Math.min(Math.max((half + edge - distance) * TEXELS_PER_METRE, 0), 1)
      if (coverage <= 0) continue
      const at = (ty * texels + tx) * 4
      for (let channel = 0; channel < 3; channel++) {
        data[at + channel] = Math.round(data[at + channel]! + (rgb[channel]! - data[at + channel]!) * coverage)
      }
    }
  }
}

function buildTerrainMesh(
  field: Heightfield,
  texture: THREE.DataTexture,
  hole: Uint8Array,
  segments: BoreSegment[],
  margin: number,
): THREE.Mesh {
  const { width, depth, cellSize, heights } = field
  const worldSize = width * cellSize
  const positions: number[] = []
  const uvs: number[] = []

  const vertex = (x: number, height: number, z: number): number => {
    positions.push(x, height, z)
    uvs.push(x / worldSize, z / worldSize)
    return positions.length / 3 - 1
  }

  for (let row = 0; row < depth; row++) {
    for (let col = 0; col < width; col++) {
      vertex(col * cellSize, heights[row * width + col]!, row * cellSize)
    }
  }

  const indices: number[] = []
  const steps = TUNNEL_CUT_SUBDIVISIONS
  for (let row = 0; row < depth - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const topLeft = row * width + col
      const topRight = topLeft + 1
      const bottomLeft = topLeft + width
      const bottomRight = bottomLeft + 1
      const inside =
        (hole[topLeft] ?? 0) + (hole[topRight] ?? 0) + (hole[bottomLeft] ?? 0) + (hole[bottomRight] ?? 0)

      if (inside === 4) continue
      if (inside === 0) {
        indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight)
        continue
      }

      // This facet straddles the bore. Split it and test each piece, so the cut
      // hugs the tunnel wall instead of snapping to whole cells.
      const vertices: number[][] = []
      for (let sv = 0; sv <= steps; sv++) {
        const line: number[] = []
        const tz = sv / steps
        for (let su = 0; su <= steps; su++) {
          const tx = su / steps
          const x = (col + tx) * cellSize
          const z = (row + tz) * cellSize
          const height =
            heights[topLeft]! * (1 - tx) * (1 - tz) +
            heights[topRight]! * tx * (1 - tz) +
            heights[bottomLeft]! * (1 - tx) * tz +
            heights[bottomRight]! * tx * tz
          if (boreClearance(segments, x, z, height) < margin) {
            line.push(-1)
            continue
          }
          line.push(vertex(x, height, z))
        }
        vertices.push(line)
      }

      for (let sv = 0; sv < steps; sv++) {
        for (let su = 0; su < steps; su++) {
          const a = vertices[sv]![su]!
          const b = vertices[sv]![su + 1]!
          const c = vertices[sv + 1]![su]!
          const d = vertices[sv + 1]![su + 1]!
          if (a >= 0 && c >= 0 && b >= 0) indices.push(a, c, b)
          if (b >= 0 && c >= 0 && d >= 0) indices.push(b, c, d)
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 })
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
    // Drawn wider than the river so the ribbon laps into its banks: the channel
    // is swept round bends, while these quads cut the corner, and the cut bank
    // shows through any daylight left between them.
    const halfWidth = (point.width / 2) * (1 + RIVER_BANK_LAP)
    // The channel is cut to meet the water line at the ribbon's edge, so the
    // surface is drawn where it actually sits rather than lifted clear of it.
    const y = point.y
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
 * The deck, plus an embankment skirt that falls from each edge to the ground.
 * Skirts are only drawn where the road is at grade; bridges and tunnels have
 * no ground to fall to. A surface road is the ground where it is at grade and
 * is painted there instead, so only its bridges are drawn; nothing is returned
 * for one with no bridge at all.
 */
function buildRoadGeometry(road: Road, field: Heightfield): THREE.BufferGeometry | null {
  const points = road.points
  const count = points.length
  const segmentCount = road.closed ? count : count - 1
  const positions: number[] = []
  const colors: number[] = []
  const half = road.width / 2
  const skirt = half + ROAD_SKIRT
  const verge = half + TUNNEL_CLEARANCE
  const lift = roadLift(road)
  const painted = isSurfaceRoad(road)
  const { cellSize } = field

  const groundUnder = (x: number, z: number): number =>
    heightAt(field, Math.floor(x / cellSize), Math.floor(z / cellSize))

  const structureColor = (structure: number): THREE.Color =>
    structure === ROAD_BRIDGE
      ? ROAD_BRIDGE_COLOR
      : structure === ROAD_TUNNEL
        ? ROAD_TUNNEL_COLOR
        : ROAD_GRADE_COLOR

  const drawn = (segment: number): boolean => !painted || road.structure[segment] !== ROAD_GRADE
  const isGrade = (segment: number): boolean => drawn(segment) && road.structure[segment] === ROAD_GRADE
  const isTunnel = (segment: number): boolean => road.structure[segment] === ROAD_TUNNEL

  for (let i = 0; i < count; i++) {
    const point = points[i]!
    const prev = points[road.closed ? (i - 1 + count) % count : Math.max(i - 1, 0)]!
    const next = points[road.closed ? (i + 1) % count : Math.min(i + 1, count - 1)]!
    let dx = next.x - prev.x
    let dz = next.z - prev.z
    const length = Math.hypot(dx, dz) || 1
    dx /= length
    dz /= length
    const nx = -dz
    const nz = dx

    // Lift the deck clear of the ground so it never z-fights the terrain.
    const y = point.y + lift
    const leftGround = Math.min(groundUnder(point.x + nx * skirt, point.z + nz * skirt), y)
    const rightGround = Math.min(groundUnder(point.x - nx * skirt, point.z - nz * skirt), y)

    // Six points across: the edges, the skirts down to the ground beside an
    // embankment, and the verges out to the wall of a tunnel.
    positions.push(
      point.x + nx * half,
      y,
      point.z + nz * half,
      point.x - nx * half,
      y,
      point.z - nz * half,
      point.x + nx * skirt,
      leftGround,
      point.z + nz * skirt,
      point.x - nx * skirt,
      rightGround,
      point.z - nz * skirt,
      point.x + nx * verge,
      y,
      point.z + nz * verge,
      point.x - nx * verge,
      y,
      point.z - nz * verge,
    )

    const color = structureColor(road.structure[Math.min(i, segmentCount - 1)]!)
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    for (let k = 0; k < 4; k++) colors.push(ROAD_SKIRT_COLOR.r, ROAD_SKIRT_COLOR.g, ROAD_SKIRT_COLOR.b)
  }

  const indices: number[] = []
  for (let i = 0; i < segmentCount; i++) {
    if (!drawn(i)) continue
    const next = (i + 1) % count
    const a = i * 6
    const b = next * 6
    indices.push(a, b, a + 1, a + 1, b, b + 1)
    if (isGrade(i)) {
      indices.push(a, a + 2, b, b, a + 2, b + 2)
      indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3)
    } else if (isTunnel(i)) {
      indices.push(a, a + 4, b, b, a + 4, b + 4)
      indices.push(a + 1, b + 1, a + 5, a + 5, b + 1, b + 5)
    }
  }
  if (indices.length === 0) return null

  // Cap the embankment wherever a skirt starts or stops, so an at-grade run
  // between two bridges does not show its hollow end.
  for (let i = 0; i < count; i++) {
    const caps =
      road.closed
        ? isGrade((i - 1 + count) % count) !== isGrade(i)
        : (i === 0 && isGrade(0)) || (i === count - 1 && isGrade(count - 2))
    if (!caps) continue
    const a = i * 6
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** The guardrails: the barriers the collider's blocks stand in. */
function buildRailGeometry(map: TerrainMap): THREE.BufferGeometry | null {
  const mesh = railMesh(railRuns(map.roads))
  if (mesh.indices.length === 0) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3))
  geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

/** The tunnel shell, the same one the collider is built from. */
function buildTunnelGeometry(road: Road): THREE.BufferGeometry | null {
  const shell = tunnelShellMesh(road)
  if (shell === null) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(shell.positions, 3))
  geometry.setIndex(new THREE.Uint32BufferAttribute(shell.indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

const CAR_LENGTH = 4.4
const CAR_WIDTH = 2
const CAR_BODY_HEIGHT = 0.7
const CAR_WHEEL_RADIUS = 0.45

/** A small blocky car, origin at the contact patch, nose toward local +Z. */
function buildCar(): THREE.Group {
  const car = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.35, metalness: 0.25 })
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#181818', roughness: 0.85 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH, CAR_BODY_HEIGHT, CAR_LENGTH), bodyMaterial)
  body.position.y = CAR_WHEEL_RADIUS + CAR_BODY_HEIGHT / 2
  car.add(body)

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2), bodyMaterial)
  cabin.position.set(0, CAR_WHEEL_RADIUS + CAR_BODY_HEIGHT + 0.3, -0.2)
  car.add(cabin)

  const wheelGeometry = new THREE.CylinderGeometry(CAR_WHEEL_RADIUS, CAR_WHEEL_RADIUS, 0.4, 12)
  for (const [x, z] of [
    [-1.0, 1.4],
    [1.0, 1.4],
    [-1.0, -1.4],
    [1.0, -1.4],
  ]) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(x!, CAR_WHEEL_RADIUS, z!)
    car.add(wheel)
  }

  return car
}

/**
 * A single car parked on the highway (or the first city, or the map centre) so
 * the size of roads, cities and features can be judged at a glance.
 */
export function createScaleCar(map: TerrainMap): THREE.Group {
  const car = buildCar()
  const road = map.roads[0]

  if (road && road.points.length > 1) {
    const index = Math.floor(road.points.length * 0.25)
    const point = road.points[index]!
    const next = road.points[(index + 1) % road.points.length]!
    car.position.set(point.x, point.y + roadLift(road), point.z)
    car.rotation.y = Math.atan2(next.x - point.x, next.z - point.z)
    return car
  }

  const district = map.districts[0]
  const x = district?.cx ?? (map.size * map.cellSize) / 2
  const z = district?.cz ?? (map.size * map.cellSize) / 2
  const ground = heightAt(map.heightfield, Math.floor(x / map.cellSize), Math.floor(z / map.cellSize))
  car.position.set(x, ground, z)
  return car
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

  const segments = tunnelSegments(map.roads)
  const hole = buildTunnelHoles(map.heightfield, segments)
  group.add(
    buildTerrainMesh(map.heightfield, buildGroundTexture(map), hole, segments, map.cellSize * 0.5),
  )

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

  if (map.roads.length > 0) {
    const roadMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
    })
    const tunnelMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4a443d'),
      roughness: 0.95,
      metalness: 0,
      // A solid wall, seen from inside the bore and out of the cut.
      side: THREE.DoubleSide,
      flatShading: true,
    })
    for (const road of map.roads) {
      const deck = buildRoadGeometry(road, map.heightfield)
      if (deck) group.add(new THREE.Mesh(deck, roadMaterial))
      const tunnel = buildTunnelGeometry(road)
      if (tunnel) group.add(new THREE.Mesh(tunnel, tunnelMaterial))
    }
    const rails = buildRailGeometry(map)
    if (rails) {
      const railMaterial = new THREE.MeshStandardMaterial({
        color: RAIL_COLOR,
        roughness: 0.4,
        metalness: 0.6,
        side: THREE.DoubleSide,
      })
      group.add(new THREE.Mesh(rails, railMaterial))
    }
  }

  return group
}
