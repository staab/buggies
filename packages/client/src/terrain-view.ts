import {
  DISTRICT_CITY,
  DISTRICT_SUBURB,
  RIVER_BANK_LAP,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SKIRT,
  ROAD_SURFACE,
  ROAD_TUNNEL,
  heightAt,
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
/** How far the embankment skirt reaches out from the deck edge, in world units. */
const TUNNEL_SEGMENTS = 16
/** Wall thickness, so the shell buries itself in the land it cuts through. */
const TUNNEL_WALL_THICKNESS = 3
/** Boundary cells are split this many ways to fit the cut tightly to the bore. */
const TUNNEL_CUT_SUBDIVISIONS = 4

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

function buildTerrainMesh(
  field: Heightfield,
  seaLevel: number,
  districtOf: Uint8Array,
  hole: Uint8Array,
  segments: BoreSegment[],
  margin: number,
): THREE.Mesh {
  const { width, depth, cellSize, heights } = field
  const positions: number[] = []
  const colors: number[] = []
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
      positions.push(col * cellSize, height, row * cellSize)
      terrainColor(height, min, max, seaLevel, districtOf[cell]!, color)
      colors.push(color.r, color.g, color.b)
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
          const index = positions.length / 3
          positions.push(x, height, z)
          terrainColor(height, min, max, seaLevel, districtOf[topLeft]!, color)
          colors.push(color.r, color.g, color.b)
          line.push(index)
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
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
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
 * no ground to fall to.
 */
function buildRoadGeometry(road: Road, field: Heightfield): THREE.BufferGeometry {
  const points = road.points
  const count = points.length
  const segmentCount = road.closed ? count : count - 1
  const positions: number[] = []
  const colors: number[] = []
  const half = road.width / 2
  const skirt = half + ROAD_SKIRT
  const { cellSize } = field

  const groundUnder = (x: number, z: number): number =>
    heightAt(field, Math.floor(x / cellSize), Math.floor(z / cellSize))

  const structureColor = (structure: number): THREE.Color =>
    structure === ROAD_BRIDGE
      ? ROAD_BRIDGE_COLOR
      : structure === ROAD_TUNNEL
        ? ROAD_TUNNEL_COLOR
        : ROAD_GRADE_COLOR

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
    const y = point.y + ROAD_SURFACE
    const leftGround = Math.min(groundUnder(point.x + nx * skirt, point.z + nz * skirt), y)
    const rightGround = Math.min(groundUnder(point.x - nx * skirt, point.z - nz * skirt), y)

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
    )

    const color = structureColor(road.structure[Math.min(i, segmentCount - 1)]!)
    colors.push(
      color.r,
      color.g,
      color.b,
      color.r,
      color.g,
      color.b,
      ROAD_SKIRT_COLOR.r,
      ROAD_SKIRT_COLOR.g,
      ROAD_SKIRT_COLOR.b,
      ROAD_SKIRT_COLOR.r,
      ROAD_SKIRT_COLOR.g,
      ROAD_SKIRT_COLOR.b,
    )
  }

  const indices: number[] = []
  const isGrade = (segment: number): boolean => road.structure[segment] === ROAD_GRADE
  for (let i = 0; i < segmentCount; i++) {
    const next = (i + 1) % count
    const a = i * 4
    const b = next * 4
    indices.push(a, b, a + 1, a + 1, b, b + 1)
    if (road.structure[i] === ROAD_GRADE) {
      indices.push(a, a + 2, b, b, a + 2, b + 2)
      indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3)
    }
  }

  // Cap the embankment wherever a skirt starts or stops, so an at-grade run
  // between two bridges does not show its hollow end.
  for (let i = 0; i < count; i++) {
    const caps =
      road.closed
        ? isGrade((i - 1 + count) % count) !== isGrade(i)
        : (i === 0 && isGrade(0)) || (i === count - 1 && isGrade(count - 2))
    if (!caps) continue
    const a = i * 4
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** One straight piece of tunnel centreline, with the road height at each end. */
interface BoreSegment {
  ax: number
  az: number
  bx: number
  bz: number
  ay: number
  by: number
  /** Half the tunnel road's width. */
  radius: number
}

function tunnelSegments(roads: Road[]): BoreSegment[] {
  const segments: BoreSegment[] = []
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_TUNNEL) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ay: a.y, by: b.y, radius: road.width / 2 })
    }
  }
  return segments
}

/** How far below the arch a point at `x, z` is: negative inside the bore. */
function boreClearance(segments: BoreSegment[], x: number, z: number, height: number): number {
  let bestDistanceSq = Infinity
  let floor = 0
  let radius = 0
  for (const segment of segments) {
    const vx = segment.bx - segment.ax
    const vz = segment.bz - segment.az
    const lengthSq = vx * vx + vz * vz || 1
    const t = Math.min(Math.max(((x - segment.ax) * vx + (z - segment.az) * vz) / lengthSq, 0), 1)
    const dx = x - (segment.ax + vx * t)
    const dz = z - (segment.az + vz * t)
    const distanceSq = dx * dx + dz * dz
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      floor = segment.ay + (segment.by - segment.ay) * t
      radius = segment.radius
    }
  }
  const distance = Math.sqrt(bestDistanceSq)
  if (distance > radius) return Infinity
  const arch = Math.sqrt(Math.max(radius ** 2 - distance * distance, 0))
  return height - (floor + arch)
}

/** Cells whose landscape sits inside a tunnel bore, so their faces can be dropped. */
function buildTunnelHoles(field: Heightfield, segments: BoreSegment[]): Uint8Array {
  const { width, depth, cellSize, heights } = field
  const bestDistanceSq = new Float32Array(width * depth).fill(Infinity)
  const boreFloor = new Float32Array(width * depth)
  const boreRadius = new Float32Array(width * depth)
  let reach = cellSize
  for (const segment of segments) reach = Math.max(reach, segment.radius + cellSize)
  const margin = cellSize * 0.5

  for (const segment of segments) {
    const minCol = Math.max(Math.floor((Math.min(segment.ax, segment.bx) - reach) / cellSize), 0)
    const maxCol = Math.min(Math.ceil((Math.max(segment.ax, segment.bx) + reach) / cellSize), width - 1)
    const minRow = Math.max(Math.floor((Math.min(segment.az, segment.bz) - reach) / cellSize), 0)
    const maxRow = Math.min(Math.ceil((Math.max(segment.az, segment.bz) + reach) / cellSize), depth - 1)
    const vx = segment.bx - segment.ax
    const vz = segment.bz - segment.az
    const lengthSq = vx * vx + vz * vz || 1

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const x = col * cellSize
        const z = row * cellSize
        const t = Math.min(Math.max(((x - segment.ax) * vx + (z - segment.az) * vz) / lengthSq, 0), 1)
        const dx = x - (segment.ax + vx * t)
        const dz = z - (segment.az + vz * t)
        const distanceSq = dx * dx + dz * dz
        const cell = row * width + col
        if (distanceSq < bestDistanceSq[cell]!) {
          bestDistanceSq[cell] = distanceSq
          boreFloor[cell] = segment.ay + (segment.by - segment.ay) * t
          boreRadius[cell] = segment.radius
        }
      }
    }
  }

  const hole = new Uint8Array(width * depth)
  for (let cell = 0; cell < hole.length; cell++) {
    const distanceSq = bestDistanceSq[cell]!
    if (distanceSq === Infinity) continue
    const distance = Math.sqrt(distanceSq)
    const radius = boreRadius[cell]!
    if (distance > radius) continue
    const arch = Math.sqrt(Math.max(radius ** 2 - distance * distance, 0))
    if (heights[cell]! < boreFloor[cell]! + arch + margin) hole[cell] = 1
  }
  return hole
}

/**
 * A solid half-arch around the road for every tunnel run: an inner wall at the
 * road edge and an outer wall buried in the hillside, joined at the base and
 * capped at each portal. It follows the centreline through the mountain.
 */
function buildTunnelGeometry(road: Road): THREE.BufferGeometry | null {
  const count = road.points.length
  const segmentCount = road.closed ? count : count - 1

  const inTunnel = new Uint8Array(count)
  for (let i = 0; i < segmentCount; i++) {
    if (road.structure[i] !== ROAD_TUNNEL) continue
    inTunnel[i] = 1
    inTunnel[(i + 1) % count] = 1
  }

  // Gather contiguous runs, starting from a sample outside every tunnel so no
  // run has to wrap.
  let firstOpen = 0
  while (firstOpen < count && inTunnel[firstOpen]) firstOpen++
  const runs: number[][] = []
  if (firstOpen === count) {
    runs.push(Array.from({ length: count }, (_, k) => k))
  } else {
    for (let k = 0; k < count; ) {
      if (!inTunnel[(firstOpen + k) % count]) {
        k++
        continue
      }
      const run: number[] = []
      while (k < count && inTunnel[(firstOpen + k) % count]) {
        run.push((firstOpen + k) % count)
        k++
      }
      runs.push(run)
    }
  }
  if (runs.length === 0) return null

  const positions: number[] = []
  const indices: number[] = []
  const arc = TUNNEL_SEGMENTS
  const width = arc + 1
  const archRadius = road.width / 2
  const outerRadius = archRadius + TUNNEL_WALL_THICKNESS

  for (const run of runs) {
    // Overhang a sample into the hillside at each portal so the shell meets the
    // landscape without a gap.
    const samples =
      run.length === count
        ? run
        : [(run[0]! - 1 + count) % count, ...run, (run[run.length - 1]! + 1) % count]

    const base = positions.length / 3
    for (const index of samples) {
      const point = road.points[index]!
      const prev = road.points[(index - 1 + count) % count]!
      const next = road.points[(index + 1) % count]!
      let dx = next.x - prev.x
      let dz = next.z - prev.z
      const length = Math.hypot(dx, dz) || 1
      dx /= length
      dz /= length
      const nx = -dz
      const nz = dx

      for (const radius of [archRadius, outerRadius]) {
        for (let j = 0; j <= arc; j++) {
          const angle = (Math.PI * 2 * j) / arc
          const cos = Math.cos(angle)
          const sin = Math.sin(angle)
          positions.push(
            point.x + nx * radius * cos,
            point.y + ROAD_SURFACE + radius * sin,
            point.z + nz * radius * cos,
          )
        }
      }
    }

    const inner = (s: number, j: number): number => base + s * width * 2 + j
    const outer = (s: number, j: number): number => base + s * width * 2 + width + j
    const quad = (a: number, b: number, c: number, d: number): void => {
      indices.push(a, b, c, b, d, c)
    }

    for (let s = 0; s < samples.length - 1; s++) {
      for (let j = 0; j < arc; j++) {
        quad(inner(s, j), inner(s + 1, j), inner(s, j + 1), inner(s + 1, j + 1))
        quad(outer(s, j), outer(s + 1, j), outer(s, j + 1), outer(s + 1, j + 1))
      }
    }
    // Cap the wall at each portal.
    for (const s of [0, samples.length - 1]) {
      for (let j = 0; j < arc; j++) {
        quad(inner(s, j), inner(s, j + 1), outer(s, j), outer(s, j + 1))
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
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
    car.position.set(point.x, point.y + ROAD_SURFACE, point.z)
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
    buildTerrainMesh(
      map.heightfield,
      map.seaLevel,
      map.districtOf,
      hole,
      segments,
      map.cellSize * 0.5,
    ),
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
      group.add(new THREE.Mesh(buildRoadGeometry(road, map.heightfield), roadMaterial))
      const tunnel = buildTunnelGeometry(road)
      if (tunnel) group.add(new THREE.Mesh(tunnel, tunnelMaterial))
    }
  }

  return group
}
