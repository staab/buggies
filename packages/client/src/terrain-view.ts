import {
  DISTRICT_CITY,
  DISTRICT_SUBURB,
  RIVER_BANK_LAP,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SKIRT,
  ROAD_TUNNEL,
  TUNNEL_CLEARANCE,
  TUNNEL_WALL_HEIGHT,
  boreClearance,
  buildTunnelHoles,
  deckShouldered,
  heightAt,
  isSurfaceRoad,
  railMesh,
  railRuns,
  rampFacets,
  roadLift,
  sidewalkMesh,
  tunnelSegments,
  tunnelShellMesh,
  type BoreSegment,
  type Building,
  type Heightfield,
  type Lake,
  type Ramp,
  type River,
  type Road,
  type Sidewalk,
  type TerrainMap,
  type Tree,
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
/** City buildings run from warm stone to cool concrete and glass. */
const BLOCK_STOPS: ColorStop[] = [
  { t: 0, color: new THREE.Color('#b9a58c') },
  { t: 0.35, color: new THREE.Color('#d8d3c8') },
  { t: 0.7, color: new THREE.Color('#8f979f') },
  { t: 1, color: new THREE.Color('#5d6f80') },
]
/** Houses come in a few colours of render and brick, each a plain box under a pitched roof. */
const HOUSE_COLORS = [
  new THREE.Color('#e8dcc0'),
  new THREE.Color('#d9c9a3'),
  new THREE.Color('#b8624a'),
  new THREE.Color('#c9d3d8'),
  new THREE.Color('#e3c9b0'),
]
const ROOF_COLORS = [
  new THREE.Color('#6b3f34'),
  new THREE.Color('#4d4a48'),
  new THREE.Color('#7a5230'),
]
/** The pitch of a house's roof, as a fraction of its width. */
const ROOF_PITCH = 0.3
const TRUNK_COLOR = new THREE.Color('#5a4030')
const CROWN_STOPS: ColorStop[] = [
  { t: 0, color: new THREE.Color('#2f6b2a') },
  { t: 0.5, color: new THREE.Color('#4a8a35') },
  { t: 1, color: new THREE.Color('#7a9a3a') },
]
/** Trunks are this wide, matching the collider. */
const TRUNK_RADIUS = 0.35
/** How far up a tree the crown starts, as a fraction of its height. */
const CROWN_FROM = 0.25
/** Storeys are this tall, and a block's windows this far apart along a face. */
const STOREY = 3
const WINDOW_PITCH = 3.5
/** A house's windows are this far apart, one storey tall between them. */
const HOUSE_PITCH = 3
/** Roof tiles repeat every this many metres. */
const ROOF_TILE = 2

/**
 * A repeating picture of a wall, as pixels: `tile` metres of it, drawn by
 * `paint` with the pixel's place in the tile. Near white where the wall is
 * bare, so the building's own colour comes through it.
 */
interface Facade {
  texture: THREE.DataTexture
  /** How many metres across and up one repeat of the picture covers. */
  tile: THREE.Vector2
}

function paintedFacade(
  size: number,
  tile: [number, number],
  paint: (u: number, v: number, out: THREE.Color) => void,
): Facade {
  const data = new Uint8Array(size * size * 4)
  const color = new THREE.Color()
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rows run from the top of the tile down, as the wall is read.
      paint((x + 0.5) / size, 1 - (y + 0.5) / size, color)
      const at = (y * size + x) * 4
      data[at] = Math.round(color.r * 255)
      data[at + 1] = Math.round(color.g * 255)
      data[at + 2] = Math.round(color.b * 255)
      data[at + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return { texture, tile: new THREE.Vector2(tile[0], tile[1]) }
}

/** A cheap hash of a window's place, so each is lit its own way. */
function windowHash(column: number, row: number): number {
  const n = Math.sin(column * 127.1 + row * 311.7) * 43758.5453
  return n - Math.floor(n)
}

/** Four bays of four storeys of a block's windows, on a bare wall. */
function blockFacade(): Facade {
  const bays = 4
  const storeys = 4
  return paintedFacade(128, [bays * WINDOW_PITCH, storeys * STOREY], (u, v, out) => {
    const column = Math.floor(u * bays)
    const row = Math.floor(v * storeys)
    const du = u * bays - column
    const dv = v * storeys - row
    const inWindow = du > 0.22 && du < 0.78 && dv > 0.2 && dv < 0.72
    if (!inWindow) {
      out.setRGB(0.92, 0.92, 0.92)
      return
    }
    const hash = windowHash(column, row)
    // Most windows show sky and shadow; a few are lit from inside.
    if (hash > 0.85) out.setRGB(0.95, 0.85, 0.55)
    else out.setRGB(0.3 + hash * 0.15, 0.36 + hash * 0.15, 0.48 + hash * 0.12)
  })
}

/** Two windows with sills and frames per storey of a house, on a bare wall. */
function houseFacade(): Facade {
  const bays = 2
  return paintedFacade(64, [bays * HOUSE_PITCH, STOREY], (u, v, out) => {
    const column = Math.floor(u * bays)
    const du = u * bays - column
    const inFrame = du > 0.25 && du < 0.75 && v > 0.3 && v < 0.8
    const inPane = du > 0.3 && du < 0.7 && v > 0.35 && v < 0.75
    if (inPane) {
      const hash = windowHash(column, 1)
      out.setRGB(0.35 + hash * 0.1, 0.42 + hash * 0.1, 0.55)
    } else if (inFrame) out.setRGB(1, 1, 1)
    else out.setRGB(0.94, 0.93, 0.9)
  })
}

/** Courses of roof tiles, each a little darker along its lower edge. */
function roofFacade(): Facade {
  return paintedFacade(32, [ROOF_TILE, ROOF_TILE], (u, v, out) => {
    const course = v * 4
    const along = u * 4 + (Math.floor(course) % 2) * 0.5
    const edge = course - Math.floor(course) < 0.18 || along - Math.floor(along) < 0.08
    const shade = edge ? 0.62 : 0.9 + 0.06 * windowHash(Math.floor(along), Math.floor(course))
    out.setRGB(shade, shade, shade)
  })
}

/**
 * A material that repeats its facade every `tile` metres over every face of
 * an instanced box, whatever the box's size. The box's size is read back
 * from its instance matrix, and a face's own span from its normal: the sides
 * run along the box and up it, the top across it. Storeys count down from
 * the roof, so the row under the ground is the one cut short.
 */
function facadeMaterial(facade: Facade, roughness: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map: facade.texture, roughness, metalness: 0.05 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.facadeTile = { value: facade.tile }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 facadeTile;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 boxSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec2 faceSpan = abs(normal.x) > 0.5 ? boxSize.zy : abs(normal.z) > 0.5 ? boxSize.xy : boxSize.xz;
        vMapUv = vec2(uv.x, 1.0 - uv.y) * faceSpan / facadeTile;
        #endif`,
      )
  }
  material.customProgramCacheKey = () => 'facade'
  return material
}
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

  // The ground inside each block's sidewalk is paved too, darker than the walk.
  BLOCK_PAVEMENT_COLOR.getRGB(rgb, THREE.SRGBColorSpace)
  const pavement = [rgb.r * 255, rgb.g * 255, rgb.b * 255]
  for (const walk of map.sidewalks) paintBlock(data, texels, walk, pavement)

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

/** Fill the square inside a sidewalk ring with a colour. */
function paintBlock(data: Uint8Array, texels: number, walk: Sidewalk, color: number[]): void {
  const inner = walk.half - walk.band
  const cos = Math.cos(walk.yaw)
  const sin = Math.sin(walk.yaw)
  const reach = inner * Math.SQRT2
  const fromX = Math.max(Math.floor((walk.x - reach) * TEXELS_PER_METRE), 0)
  const toX = Math.min(Math.ceil((walk.x + reach) * TEXELS_PER_METRE), texels - 1)
  const fromY = Math.max(Math.floor((walk.z - reach) * TEXELS_PER_METRE), 0)
  const toY = Math.min(Math.ceil((walk.z + reach) * TEXELS_PER_METRE), texels - 1)
  for (let ty = fromY; ty <= toY; ty++) {
    const z = (ty + 0.5) / TEXELS_PER_METRE - walk.z
    for (let tx = fromX; tx <= toX; tx++) {
      const x = (tx + 0.5) / TEXELS_PER_METRE - walk.x
      // Into the block's frame: u along its first side, v along the second.
      const u = x * cos + z * sin
      const v = -x * sin + z * cos
      if (Math.abs(u) > inner || Math.abs(v) > inner) continue
      const at = (ty * texels + tx) * 4
      data[at] = color[0]!
      data[at + 1] = color[1]!
      data[at + 2] = color[2]!
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
  const isGrade = (segment: number): boolean => drawn(segment) && deckShouldered(road, field, segment)
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
/**
 * Strip lights along the crown of every tunnel, one every few metres: bright
 * panels that need no light of their own to be seen glowing in the dark.
 */
function buildTunnelLights(roads: Road[]): THREE.InstancedMesh | null {
  const spots: { x: number; y: number; z: number; dx: number; dz: number }[] = []
  for (const road of roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const crown = TUNNEL_WALL_HEIGHT + road.width / 2 + TUNNEL_CLEARANCE - TUNNEL_LIGHT_DROP
    const lift = roadLift(road)
    let owed = TUNNEL_LIGHT_SPACING / 2
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_TUNNEL) {
        owed = TUNNEL_LIGHT_SPACING / 2
        continue
      }
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      const length = Math.hypot(b.x - a.x, b.z - a.z)
      if (length < 1e-6) continue
      const dx = (b.x - a.x) / length
      const dz = (b.z - a.z) / length
      let along = owed
      while (along <= length) {
        const t = along / length
        spots.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + lift + crown, z: a.z + (b.z - a.z) * t, dx, dz })
        along += TUNNEL_LIGHT_SPACING
      }
      owed = along - length
    }
  }
  if (spots.length === 0) return null
  const panel = new THREE.BoxGeometry(0.5, 0.12, 2.2)
  const glow = new THREE.MeshBasicMaterial({ color: TUNNEL_LIGHT_COLOR })
  const mesh = new THREE.InstancedMesh(panel, glow, spots.length)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const one = new THREE.Vector3(1, 1, 1)
  for (const [i, spot] of spots.entries()) {
    position.set(spot.x, spot.y, spot.z)
    rotation.setFromAxisAngle(up, Math.atan2(spot.dx, spot.dz))
    matrix.compose(position, rotation, one)
    mesh.setMatrixAt(i, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

function buildTunnelGeometry(road: Road): THREE.BufferGeometry | null {
  const shell = tunnelShellMesh(road)
  if (shell === null) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(shell.positions, 3))
  geometry.setIndex(new THREE.Uint32BufferAttribute(shell.indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A batch of the same shape at many places: one draw call for every building,
 * every roof, every trunk. `place` fills in where each goes and what colour it is.
 */
function instanced<T>(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  items: T[],
  place: (item: T, matrix: THREE.Matrix4, color: THREE.Color) => void,
): THREE.InstancedMesh | null {
  if (items.length === 0) return null
  const mesh = new THREE.InstancedMesh(geometry, material, items.length)
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  for (let i = 0; i < items.length; i++) {
    matrix.identity()
    place(items[i]!, matrix, color)
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, color)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  return mesh
}

const boxAt = (building: Building, matrix: THREE.Matrix4): void => {
  matrix.compose(
    new THREE.Vector3(building.x, (building.top + building.bottom) / 2, building.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), building.yaw),
    new THREE.Vector3(building.width, building.top - building.bottom, building.depth),
  )
}

/** The buildings, trees and shrubs of a map, as a few instanced meshes. */
function buildStanding(map: TerrainMap): THREE.Object3D[] {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const plain = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 })
  const flatRoof = new THREE.MeshStandardMaterial({ color: '#bdbdb8', roughness: 0.95, metalness: 0 })
  const meshes: (THREE.Object3D | null)[] = []

  // A box's faces come in the order +X, -X, +Y, -Y, +Z, -Z: walls all round, a roof on top.
  const walled = (wall: THREE.Material, top: THREE.Material): THREE.Material[] => [
    wall,
    wall,
    top,
    wall,
    wall,
    wall,
  ]
  const blocks = map.buildings.filter((building) => building.kind === 'block')
  const houses = map.buildings.filter((building) => building.kind === 'house')
  const blockWall = facadeMaterial(blockFacade(), 0.6)
  const houseWall = facadeMaterial(houseFacade(), 0.9)
  meshes.push(
    instanced(box, walled(blockWall, flatRoof), blocks, (building, matrix, color) => {
      boxAt(building, matrix)
      sampleRamp(building.tone, BLOCK_STOPS, color)
    }),
    instanced(box, walled(houseWall, houseWall), houses, (building, matrix, color) => {
      boxAt(building, matrix)
      color.copy(HOUSE_COLORS[Math.floor(building.tone * HOUSE_COLORS.length) % HOUSE_COLORS.length]!)
    }),
  )

  // A pitched roof: a four-sided cone, turned so its base is square to the box.
  const roof = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4)
  roof.rotateY(Math.PI / 4)
  roof.translate(0, 0.5, 0)
  const roofing = new THREE.MeshStandardMaterial({ map: roofFacade().texture, roughness: 0.95, metalness: 0 })
  meshes.push(
    instanced(roof, roofing, houses, (house, matrix, color) => {
      const span = Math.min(house.width, house.depth)
      matrix.compose(
        new THREE.Vector3(house.x, house.top, house.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw),
        new THREE.Vector3(house.width + 0.6, span * ROOF_PITCH, house.depth + 0.6),
      )
      color.copy(ROOF_COLORS[Math.floor(house.tone * ROOF_COLORS.length) % ROOF_COLORS.length]!)
    }),
  )

  const trees = map.trees.filter((tree) => tree.kind === 'tree')
  const shrubs = map.trees.filter((tree) => tree.kind === 'shrub')
  const trunk = new THREE.CylinderGeometry(TRUNK_RADIUS, TRUNK_RADIUS * 1.3, 1, 6)
  trunk.translate(0, 0.5, 0)
  const crown = new THREE.ConeGeometry(1, 1, 7)
  crown.translate(0, 0.5, 0)
  const bush = new THREE.SphereGeometry(1, 7, 5)
  bush.translate(0, 0.5, 0)
  const leaves = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true })
  meshes.push(
    instanced(trunk, plain, trees, (tree: Tree, matrix, color) => {
      matrix.makeScale(1, tree.height * (CROWN_FROM + 0.1), 1)
      matrix.setPosition(tree.x, tree.bottom, tree.z)
      color.copy(TRUNK_COLOR)
    }),
    instanced(crown, leaves, trees, (tree: Tree, matrix, color) => {
      matrix.makeScale(tree.radius, tree.height * (1 - CROWN_FROM), tree.radius)
      matrix.setPosition(tree.x, tree.bottom + tree.height * CROWN_FROM, tree.z)
      sampleRamp(tree.tone, CROWN_STOPS, color)
    }),
    instanced(bush, leaves, shrubs, (shrub: Tree, matrix, color) => {
      matrix.makeScale(shrub.radius, shrub.height / 2, shrub.radius)
      matrix.setPosition(shrub.x, shrub.bottom - shrub.height * 0.15, shrub.z)
      sampleRamp(shrub.tone, CROWN_STOPS, color).multiplyScalar(0.85)
    }),
  )
  return meshes.filter((mesh): mesh is THREE.Object3D => mesh !== null)
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
    const lights = buildTunnelLights(map.roads)
    if (lights) group.add(lights)
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

  for (const standing of buildStanding(map)) group.add(standing)

  if (map.sidewalks.length > 0) {
    const { positions, indices } = sidewalkMesh(map.heightfield, map.sidewalks)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeVertexNormals()
    const concrete = new THREE.MeshStandardMaterial({
      color: SIDEWALK_COLOR,
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
    })
    group.add(new THREE.Mesh(geometry, concrete))
  }

  if (map.ramps.length > 0) {
    const rampMaterial = new THREE.MeshStandardMaterial({
      color: RAMP_COLOR,
      roughness: 0.9,
      metalness: 0.05,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    group.add(new THREE.Mesh(buildRampGeometry(map.ramps), rampMaterial))
  }

  return group
}

const RAMP_COLOR = new THREE.Color('#4a4a48')
const SIDEWALK_COLOR = new THREE.Color('#b9b5ad')
const BLOCK_PAVEMENT_COLOR = new THREE.Color('#6a6763')
const TUNNEL_LIGHT_COLOR = new THREE.Color('#fff1c4')
/** How far apart the lights hang along a tunnel's ceiling, and how far below the arch's crown. */
const TUNNEL_LIGHT_SPACING = 9
const TUNNEL_LIGHT_DROP = 0.3

/** Every ramp as one mesh: a faceted arc to drive up, two sides, and a face under the lip. */
function buildRampGeometry(ramps: Ramp[]): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const ramp of ramps) {
    const sx = -ramp.dz * (ramp.width / 2)
    const sz = ramp.dx * (ramp.width / 2)
    const under = ramp.bottom - 1
    const facets = rampFacets(ramp)
    const base = positions.length / 3
    // Four vertices per facet edge: the two top corners and the two under them.
    for (const facet of facets) {
      const x = ramp.x + ramp.dx * facet.along
      const z = ramp.z + ramp.dz * facet.along
      positions.push(x + sx, facet.height, z + sz, x - sx, facet.height, z - sz, x + sx, under, z + sz, x - sx, under, z - sz)
    }
    for (let i = 0; i + 1 < facets.length; i++) {
      const here = base + i * 4
      const next = here + 4
      // Top, then the two sides.
      indices.push(here, here + 1, next, here + 1, next + 1, next)
      indices.push(here, next, here + 2, next, next + 2, here + 2)
      indices.push(here + 1, here + 3, next + 1, next + 1, here + 3, next + 3)
    }
    const lip = base + (facets.length - 1) * 4
    indices.push(lip, lip + 1, lip + 2, lip + 1, lip + 3, lip + 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
