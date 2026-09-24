import {
  DISTRICT_CITY,
  DISTRICT_SUBURB,
  RIVER_BANK_LAP,
  RAMP_PLATEAU,
  RAMP_WIDTH,
  ROAD_BRIDGE,
  ROAD_GRADE,
  ROAD_SKIRT,
  ROAD_TUNNEL,
  ROAD_WIDTH,
  STREET_SPACING,
  TUNNEL_CLEARANCE,
  TUNNEL_WALL_HEIGHT,
  boreClearance,
  buildTunnelHoles,
  cityFrame,
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
  type Field,
  type Heightfield,
  type Lake,
  type Ramp,
  type River,
  type Road,
  type TerrainMap,
  type Tree,
} from '@buggies/terrain'
import * as THREE from 'three'

interface ColorStop {
  t: number
  color: THREE.Color
}

/** A ramp of colours: always at least the one to start from. */
type Stops = [ColorStop, ...ColorStop[]]

const LAND_STOPS: Stops = [
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
const BLOCK_STOPS: Stops = [
  { t: 0, color: new THREE.Color('#b9a58c') },
  { t: 0.35, color: new THREE.Color('#d8d3c8') },
  { t: 0.7, color: new THREE.Color('#8f979f') },
  { t: 1, color: new THREE.Color('#5d6f80') },
]
/** Houses come in a few colours of render and brick, each a plain box under a pitched roof. */
const HOUSE_COLORS: [THREE.Color, ...THREE.Color[]] = [
  new THREE.Color('#e8dcc0'),
  new THREE.Color('#d9c9a3'),
  new THREE.Color('#b8624a'),
  new THREE.Color('#c9d3d8'),
  new THREE.Color('#e3c9b0'),
]
const ROOF_COLORS: [THREE.Color, ...THREE.Color[]] = [
  new THREE.Color('#6b3f34'),
  new THREE.Color('#4d4a48'),
  new THREE.Color('#7a5230'),
]
/** The pitch of a house's roof, as a fraction of its width. */
const ROOF_PITCH = 0.3
/** Cottages are whitewashed or stone under a steep roof of thatch or slate, with a chimney. */
const COTTAGE_COLORS: [THREE.Color, ...THREE.Color[]] = [
  new THREE.Color('#f1ebdc'),
  new THREE.Color('#b8b0a0'),
  new THREE.Color('#c8d5dc'),
  new THREE.Color('#e9dfc4'),
]
const THATCH_COLORS: [THREE.Color, ...THREE.Color[]] = [
  new THREE.Color('#8a7448'),
  new THREE.Color('#5a5b5e'),
  new THREE.Color('#6d4b3a'),
]
const COTTAGE_PITCH = 0.6
const CHIMNEY = { width: 0.9, height: 1.8 } as const
const BRICK = new THREE.Color('#8a4a3a')
/** Villas are pale, flat-roofed, with a smaller second storey set on the first. */
const VILLA_COLORS: [THREE.Color, ...THREE.Color[]] = [
  new THREE.Color('#f3efe6'),
  new THREE.Color('#e6d8c3'),
  new THREE.Color('#d9b8a3'),
  new THREE.Color('#cfd8cf'),
]
const VILLA_UPPER = 0.7
/** An observatory is a stone tower under a white dome with a dark slit, turned whichever way. */
const TOWER_COLOR = new THREE.Color('#c9c4b8')
const DOME_COLOR = new THREE.Color('#f2f2ee')
const SLIT_COLOR = new THREE.Color('#2a2f38')
/** The tower takes this much of the observatory's width; the dome on it is a true hemisphere of the same radius. */
const TOWER_SHARE = 0.9
/** Crops run from young green to ripe gold, in stripes this far apart along the field, the odd one a shade darker. */
const CROP_STOPS: Stops = [
  { t: 0, color: new THREE.Color('#6f9a3c') },
  { t: 0.4, color: new THREE.Color('#9db04a') },
  { t: 0.75, color: new THREE.Color('#c9a94a') },
  { t: 1, color: new THREE.Color('#b78a3e') },
]
const CROP_STRIPE = 4
const CROP_STRIPE_SHADE = 0.86
/** Barns are painted red, a shade or two of it, under a grey gambrel roof; silos are pale steel with a domed cap. */
const BARN_COLORS: [THREE.Color, ...THREE.Color[]] = [
  new THREE.Color('#a63a2c'),
  new THREE.Color('#b8402f'),
  new THREE.Color('#93352a'),
]
const BARN_ROOF = new THREE.Color('#5c5c5a')
const BARN_PITCH = 0.6
const SILO_COLOR = new THREE.Color('#d6d8d6')
/** Turbines are white towers with a nacelle and three blades this long, turning this fast in radians a second. */
const TURBINE_COLOR = new THREE.Color('#f0f2f2')
const BLADE_LENGTH = 18
const BLADE_SPIN = 0.7
const NACELLE = { length: 4.2, width: 1.7 } as const
/** Standing stones are a pale weathered grey, a little different each, to stand out against the grass. */
const STONE_COLOR = new THREE.Color('#bcbdb5')
/**
 * A lighthouse is a white tower tapering to this share of its width at the
 * top, with two red bands, a railed gallery, a glazed lantern room with the
 * lamp in it, a cap and a finial, and a door at the foot.
 */
const LIGHTHOUSE_COLOR = new THREE.Color('#f4f1ea')
const LIGHTHOUSE_BAND = new THREE.Color('#c93a2e')
const LIGHTHOUSE_TAPER = 0.62
const GALLERY = { out: 1.45, height: 0.5, rail: 1.1 } as const
const LANTERN = { share: 0.82, height: 3.4 } as const
const CAP = { out: 1.12, height: 2.4 } as const
const IRONWORK = new THREE.Color('#2b2f36')
const GLAZING = new THREE.Color('#bfe0ee')
const LAMP_COLOR = new THREE.Color('#ffe8a0')
const DOOR = { width: 1.4, height: 2.6 } as const
/** Fruit trees are short, round and a lighter green than the woods. */
const FRUIT_STOPS: Stops = [
  { t: 0, color: new THREE.Color('#5f9a3a') },
  { t: 0.5, color: new THREE.Color('#79b04a') },
  { t: 1, color: new THREE.Color('#93b658') },
]
/** Churches are pale stone under a slate ridge running from the tower, with a spire this tall over the tower and a cross on it. */
const CHURCH_COLOR = new THREE.Color('#d9d2c2')
const SLATE = new THREE.Color('#4d4f55')
const SPIRE_HEIGHT = 11
const CHURCH_PITCH = 0.45
/** A church's windows come one line to a wall, one every so many metres, tall and arched. */
const CHURCH_WINDOW_PITCH = 4.5
/** Water towers are pale green-grey: a column, four legs, a spheroid tank this wide and tall at the top, and a ladder. */
const WATER_TOWER_COLOR = new THREE.Color('#b8c2b8')
const TANK = { radius: 4, height: 5.5 } as const
/** Filling stations: a white canopy with a red fascia over two pump islands, a glazed shop, and a red sign. */
/** How high a canopy stands over the ground, as the generator puts it. */
const CANOPY_OVER = 4.5
const CANOPY_COLOR = new THREE.Color('#f4f4f0')
const FASCIA = new THREE.Color('#d0392b')
const PUMP_COLOR = new THREE.Color('#e8e8e4')
const SHOP_GLASS = new THREE.Color('#9fc3d8')
/** Camp sites: tents in bright colours, white caravans, a ring of stones round the fire with an ember in it. */
const TENT_COLORS: [THREE.Color, ...THREE.Color[]] = [
  new THREE.Color('#d9542b'),
  new THREE.Color('#2f7fbf'),
  new THREE.Color('#e0b429'),
  new THREE.Color('#3f9a5a'),
]
const CARAVAN_COLOR = new THREE.Color('#f2f1ec')
const CARAVAN_STRIPE = new THREE.Color('#4a7fb5')
/** How far a building's bottom is buried below the ground, as the generator does it. */
const BURY_SHOWN = 1
const TRUNK_COLOR = new THREE.Color('#5a4030')
const CROWN_STOPS: Stops = [
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

/** One tall arched window every so far along a church's wall, on bare stone: a line of them, no more. */
function churchFacade(height: number): Facade {
  return paintedFacade(64, [CHURCH_WINDOW_PITCH, height], (u, v, out) => {
    // The window: a slot up the middle of the bay, rounded over at the top.
    const du = (u - 0.5) / 0.16
    const above = (v - 0.62) / 0.16
    const inArch = Math.abs(du) < 1 && (v > 0.28 && v < 0.62 ? true : above > 0 && du * du + above * above < 1)
    const df = (u - 0.5) / 0.2
    const aboveFrame = (v - 0.62) / 0.2
    const inFrame = Math.abs(df) < 1 && (v > 0.24 && v < 0.62 ? true : aboveFrame > 0 && df * df + aboveFrame * aboveFrame < 1)
    if (inArch) out.setRGB(0.22, 0.28, 0.45)
    else if (inFrame) out.setRGB(0.8, 0.78, 0.72)
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

function sampleRamp(t: number, stops: Stops, out: THREE.Color): THREE.Color {
  let lo = stops[0]
  if (t <= lo.t) return out.copy(lo.color)
  for (const hi of stops) {
    if (t <= hi.t) {
      const span = hi.t - lo.t || 1
      return out.copy(lo.color).lerp(hi.color, (t - lo.t) / span)
    }
    lo = hi
  }
  return out.copy(lo.color)
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
function buildGroundTexture(map: TerrainMap, mouths: Mouth[]): THREE.DataTexture {
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
  // The heights and districts cover the field, a value a cell.
  for (let cell = 0; cell < width * depth; cell++) {
    terrainColor(heights[cell]!, min, max, seaLevel, districtOf[cell]!, color)
    color.getRGB(rgb, THREE.SRGBColorSpace)
    corner[cell * 3] = rgb.r
    corner[cell * 3 + 1] = rgb.g
    corner[cell * 3 + 2] = rgb.b
  }

  ROAD_GRADE_COLOR.getRGB(rgb, THREE.SRGBColorSpace)
  const asphalt: [number, number, number] = [rgb.r * 255, rgb.g * 255, rgb.b * 255]
  const city = cityBlocks(map)
  const crops = map.fields.map((field) => cropOf(field))

  const texels = Math.ceil(width * cellSize * TEXELS_PER_METRE)
  const data = new Uint8Array(texels * texels * 4)
  for (let ty = 0; ty < texels; ty++) {
    const z = (ty + 0.5) / TEXELS_PER_METRE
    const gz = Math.min(z / cellSize, depth - 1)
    const row = Math.min(Math.floor(gz), depth - 2)
    const tz = gz - row
    for (let tx = 0; tx < texels; tx++) {
      const x = (tx + 0.5) / TEXELS_PER_METRE
      const gx = Math.min(x / cellSize, width - 1)
      const col = Math.min(Math.floor(gx), width - 2)
      const txf = gx - col
      const at = (ty * texels + tx) * 4
      // In a city, everything outside a block's sidewalk is asphalt: the
      // streets and every gap between them alike, one crisp grey. Inside the
      // sidewalk the ground keeps its own colour.
      if (districtOf[Math.round(gz) * width + Math.round(gx)] === DISTRICT_CITY && !city.insideBlock(x, z)) {
        data[at] = asphalt[0]
        data[at + 1] = asphalt[1]
        data[at + 2] = asphalt[2]
        data[at + 3] = 255
        continue
      }
      // The four corners of a cell within the field: the row and column were held one short of its edge.
      const a = (row * width + col) * 3
      const b = a + 3
      const c = a + width * 3
      const d = c + 3
      for (let channel = 0; channel < 3; channel++) {
        const top = corner[a + channel]! * (1 - txf) + corner[b + channel]! * txf
        const bottom = corner[c + channel]! * (1 - txf) + corner[d + channel]! * txf
        data[at + channel] = Math.round((top * (1 - tz) + bottom * tz) * 255)
      }
      data[at + 3] = 255
    }
  }

  // The fields are painted on over the land, and the roads over everything.
  for (const [i, field] of map.fields.entries()) {
    const crop = crops[i]
    if (crop !== undefined) paintField(data, texels, field, crop)
  }
  for (const road of map.roads) {
    if (!isSurfaceRoad(road)) continue
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const half = road.width / 2
    // Within the road: i runs over its segments, and the point after the last is a loop's first.
    for (let i = 0; i < segmentCount; i++) {
      if (road.structure[i] !== ROAD_GRADE) continue
      const a = road.points[i]!
      const b = road.points[(i + 1) % count]!
      if (city.inCity((a.x + b.x) / 2, (a.z + b.z) / 2)) continue
      paintSegment(data, texels, a, b, half, asphalt)
    }
  }
  // And the strip between each ramp's plateau and the deck it leaves, under
  // the deck's paved skirt, so no ground shows at the seam between them.
  for (const mouth of mouths) {
    const out = RAMP_WIDTH / 2 + ROAD_SKIRT / 2
    const a = { x: mouth.x + mouth.inX * out, y: 0, z: mouth.z + mouth.inZ * out }
    const b = { x: a.x + mouth.dx * RAMP_PLATEAU, y: 0, z: a.z + mouth.dz * RAMP_PLATEAU }
    paintSegment(data, texels, a, b, ROAD_SKIRT / 2 + 1.5, asphalt)
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

/** A field's crop: its colour and the shade of its stripes, as texel values. */
interface Crop {
  plain: [number, number, number]
  striped: [number, number, number]
}

function cropOf(field: Field): Crop {
  if (field.kind === 'asphalt') {
    const rgb = { r: 0, g: 0, b: 0 }
    ROAD_GRADE_COLOR.getRGB(rgb, THREE.SRGBColorSpace)
    const plain: [number, number, number] = [rgb.r * 255, rgb.g * 255, rgb.b * 255]
    return { plain, striped: plain }
  }
  const color = sampleRamp(field.tone, CROP_STOPS, new THREE.Color())
  const rgb = { r: 0, g: 0, b: 0 }
  color.getRGB(rgb, THREE.SRGBColorSpace)
  const plain: [number, number, number] = [rgb.r * 255, rgb.g * 255, rgb.b * 255]
  return { plain, striped: [plain[0] * CROP_STRIPE_SHADE, plain[1] * CROP_STRIPE_SHADE, plain[2] * CROP_STRIPE_SHADE] }
}

/** A field, as a rectangle of crop turned with the field, striped along its length. */
function paintField(data: Uint8Array, texels: number, field: Field, crop: Crop): void {
  const cos = Math.cos(field.yaw)
  const sin = Math.sin(field.yaw)
  const reach = Math.hypot(field.width, field.depth) / 2
  const from = Math.max(Math.floor((field.x - reach) * TEXELS_PER_METRE), 0)
  const to = Math.min(Math.ceil((field.x + reach) * TEXELS_PER_METRE), texels - 1)
  const top = Math.max(Math.floor((field.z - reach) * TEXELS_PER_METRE), 0)
  const bottom = Math.min(Math.ceil((field.z + reach) * TEXELS_PER_METRE), texels - 1)
  for (let ty = top; ty <= bottom; ty++) {
    const dz = (ty + 0.5) / TEXELS_PER_METRE - field.z
    for (let tx = from; tx <= to; tx++) {
      const dx = (tx + 0.5) / TEXELS_PER_METRE - field.x
      // Into the field's own frame: u along its width, v along its depth.
      const u = dx * cos - dz * sin
      const v = dx * sin + dz * cos
      if (Math.abs(u) > field.width / 2 || Math.abs(v) > field.depth / 2) continue
      const shade = Math.floor((u + field.width / 2) / CROP_STRIPE) % 2 === 0 ? crop.plain : crop.striped
      const at = (ty * texels + tx) * 4
      data[at] = Math.round(shade[0])
      data[at + 1] = Math.round(shade[1])
      data[at + 2] = Math.round(shade[2])
      data[at + 3] = 255
    }
  }
}

/** One stretch of carriageway, as a capsule with an edge a texel wide. */
function paintSegment(
  data: Uint8Array,
  texels: number,
  a: { x: number; z: number },
  b: { x: number; z: number },
  half: number,
  rgb: [number, number, number],
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
      // Within the texture: the texel was held inside it above.
      const at = (ty * texels + tx) * 4
      for (const [channel, level] of rgb.entries()) {
        const was = data[at + channel]!
        data[at + channel] = Math.round(was + (level - was) * coverage)
      }
    }
  }
}

/**
 * Where the cities' blocks are, for colouring the ground: a point is inside a
 * block where a sidewalk rings it, read straight off the city's grid frame
 * rather than by searching the rings.
 */
function cityBlocks(map: TerrainMap): {
  inCity: (x: number, z: number) => boolean
  insideBlock: (x: number, z: number) => boolean
} {
  const { width, depth, cellSize } = map.heightfield
  const inCity = (x: number, z: number): boolean => {
    const col = Math.floor(x / cellSize)
    const row = Math.floor(z / cellSize)
    if (col < 0 || col >= width || row < 0 || row >= depth) return false
    return map.districtOf[row * width + col] === DISTRICT_CITY
  }
  const frames = map.districts.map((district) => cityFrame(map.heightfield, map.districtOf, district))
  // The blocks that have a sidewalk, by city and grid cell, with how far in
  // from the block's grid lines the sidewalk's inner edge lies.
  const ringed = new Map<string, number>()
  const frameOf = (x: number, z: number): { index: number; u: number; v: number } | null => {
    let best: { index: number; u: number; v: number } | null = null
    let bestDistance = Infinity
    for (const [index, frame] of frames.entries()) {
      if (frame === null) continue
      const distance = Math.hypot(x - frame.cx, z - frame.cz)
      if (distance >= bestDistance) continue
      bestDistance = distance
      const dx = x - frame.cx
      const dz = z - frame.cz
      best = { index, u: dx * frame.cos + dz * frame.sin, v: -dx * frame.sin + dz * frame.cos }
    }
    return best
  }
  for (const walk of map.sidewalks) {
    const at = frameOf(walk.x, walk.z)
    if (at === null) continue
    const i = Math.floor(at.u / STREET_SPACING)
    const j = Math.floor(at.v / STREET_SPACING)
    ringed.set(`${at.index}:${i}:${j}`, STREET_SPACING / 2 - (walk.half - walk.band))
  }
  const insideBlock = (x: number, z: number): boolean => {
    const at = frameOf(x, z)
    if (at === null) return false
    const i = Math.floor(at.u / STREET_SPACING)
    const j = Math.floor(at.v / STREET_SPACING)
    const inset = ringed.get(`${at.index}:${i}:${j}`)
    if (inset === undefined) return false
    const ou = at.u - i * STREET_SPACING
    const ov = at.v - j * STREET_SPACING
    return ou >= inset && ou <= STREET_SPACING - inset && ov >= inset && ov <= STREET_SPACING - inset
  }
  return { inCity, insideBlock }
}

/** Where a ramp leaves the highway's deck, and the way it runs from there. */
interface Mouth {
  x: number
  z: number
  dx: number
  dz: number
  /** Unit direction from the mouth in toward the highway's centreline. */
  inX: number
  inZ: number
}

/**
 * The mouths of the ramps. A ramp's carriageway starts at the foot of the
 * deck's skirt and runs level beside the deck for its plateau, so the deck's
 * skirt there is not an embankment but a strip of road between the two.
 */
function rampMouths(roads: Road[]): Mouth[] {
  const highways = roads.filter((road) => road.kind === 'highway')
  const mouths: Mouth[] = []
  for (const road of roads) {
    const start = road.points[0]
    const next = road.points[1]
    if (road.kind !== 'ramp' || start === undefined || next === undefined) continue
    const length = Math.hypot(next.x - start.x, next.z - start.z) || 1
    let nearest = { x: start.x, z: start.z }
    let best = Infinity
    for (const highway of highways) {
      for (const point of highway.points) {
        const distance = Math.hypot(point.x - start.x, point.z - start.z)
        if (distance < best) {
          best = distance
          nearest = point
        }
      }
    }
    const reach = Math.hypot(nearest.x - start.x, nearest.z - start.z) || 1
    mouths.push({
      x: start.x,
      z: start.z,
      dx: (next.x - start.x) / length,
      dz: (next.z - start.z) / length,
      inX: (nearest.x - start.x) / reach,
      inZ: (nearest.z - start.z) / reach,
    })
  }
  return mouths
}

/**
 * Whether a point on the deck's centreline lies beside a ramp's plateau on
 * the given side: 1 for its left, along the normal `nx, nz`, -1 for its
 * right. An interchange has a ramp on each side of the same stretch.
 */
function mouthBeside(mouths: Mouth[], x: number, z: number, nx: number, nz: number, side: number): boolean {
  for (const mouth of mouths) {
    const toMouthX = mouth.x - x
    const toMouthZ = mouth.z - z
    const along = -(toMouthX * mouth.dx + toMouthZ * mouth.dz)
    if (along < -(RAMP_WIDTH / 2 + ROAD_SKIRT) || along > RAMP_PLATEAU) continue
    const across = (toMouthX * nx + toMouthZ * nz) * side
    if (across < 0 || across > ROAD_WIDTH / 2 + ROAD_SKIRT + RAMP_WIDTH + 2) continue
    return true
  }
  return false
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

  // The heights cover the field, one a cell, read by row and column within it.
  for (let row = 0; row < depth; row++) {
    for (let col = 0; col < width; col++) {
      vertex(col * cellSize, heights[row * width + col]!, row * cellSize)
    }
  }

  const indices: number[] = []
  const steps = TUNNEL_CUT_SUBDIVISIONS
  for (let row = 0; row < depth - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      // The cell's four corners, all within the field: the loops stop a cell short of its edges.
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
      // hugs the tunnel wall instead of snapping to whole cells. The pieces
      // are a grid of steps plus one each way, read within that below.
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
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'ground'
  return mesh
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

  for (const [i, point] of points.entries()) {
    const prev = points[i - 1] ?? point
    const next = points[i + 1] ?? point
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
function buildRoadGeometry(road: Road, field: Heightfield, mouths: Mouth[]): THREE.BufferGeometry | null {
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

  for (const [i, point] of points.entries()) {
    // Round a loop the neighbours wrap; at the end of an open road they stop at the point.
    const prev = points[road.closed ? (i - 1 + count) % count : i - 1] ?? point
    const next = points[road.closed ? (i + 1) % count : i + 1] ?? point
    let dx = next.x - prev.x
    let dz = next.z - prev.z
    const length = Math.hypot(dx, dz) || 1
    dx /= length
    dz /= length
    const nx = -dz
    const nz = dx

    // Lift the deck clear of the ground so it never z-fights the terrain.
    const y = point.y + lift
    // Beside a ramp's plateau the skirt is level with the deck and is road,
    // not embankment: the strip a car crosses between the two.
    const pavedLeft = road.kind === 'highway' && mouthBeside(mouths, point.x, point.z, nx, nz, 1)
    const pavedRight = road.kind === 'highway' && mouthBeside(mouths, point.x, point.z, nx, nz, -1)
    const leftGround = pavedLeft ? y : Math.min(groundUnder(point.x + nx * skirt, point.z + nz * skirt), y)
    const rightGround = pavedRight ? y : Math.min(groundUnder(point.x - nx * skirt, point.z - nz * skirt), y)

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

    // A point's colour is its segment's, the last point taking the last segment's.
    const color = structureColor(road.structure[Math.min(i, segmentCount - 1)]!)
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    const leftSkirt = pavedLeft ? color : ROAD_SKIRT_COLOR
    const rightSkirt = pavedRight ? color : ROAD_SKIRT_COLOR
    colors.push(leftSkirt.r, leftSkirt.g, leftSkirt.b, rightSkirt.r, rightSkirt.g, rightSkirt.b)
    for (let k = 0; k < 2; k++) colors.push(ROAD_SKIRT_COLOR.r, ROAD_SKIRT_COLOR.g, ROAD_SKIRT_COLOR.b)
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
    // Within the road: i runs over its segments, and the point after the last is a loop's first.
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
  mesh.name = 'lights'
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
  for (const [i, item] of items.entries()) {
    matrix.identity()
    place(item, matrix, color)
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

/**
 * A roof as a prism: a profile drawn across the building, in a unit square
 * with the eaves at the bottom corners and the ridge at the top, swept
 * along the building's length. Flat-shaded, so each slope reads as one.
 */
function prismGeometry(profile: [number, number][]): THREE.BufferGeometry {
  const positions: number[] = []
  const push = (...points: [number, number, number][]): void => {
    for (const [x, y, z] of points) positions.push(x, y, z)
  }
  // The slopes: a quad along the length for each edge of the profile.
  for (let i = 0; i + 1 < profile.length; i++) {
    const [z0, y0] = profile[i]!
    const [z1, y1] = profile[i + 1]!
    push([-0.5, y0, z0], [0.5, y0, z0], [0.5, y1, z1])
    push([-0.5, y0, z0], [0.5, y1, z1], [-0.5, y1, z1])
  }
  // The ends: fans from the first eave, one each way.
  for (const [x, wind] of [
    [-0.5, 1],
    [0.5, -1],
  ] as const) {
    for (let i = 1; i + 1 < profile.length; i++) {
      const [za, ya] = profile[0]!
      const [zb, yb] = profile[i]!
      const [zc, yc] = profile[i + 1]!
      if (wind > 0) push([x, ya, za], [x, yb, zb], [x, yc, zc])
      else push([x, ya, za], [x, yc, zc], [x, yb, zb])
    }
  }
  // Wound so the outside faces out: each triangle's last two corners the other way about.
  for (let i = 0; i < positions.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const second = positions[i + 3 + k]!
      positions[i + 3 + k] = positions[i + 6 + k]!
      positions[i + 6 + k] = second
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** A gable: two slopes meeting at the ridge. */
const GABLE: [number, number][] = [
  [-0.5, 0],
  [0, 1],
  [0.5, 0],
]

/** A gambrel, the barn's roof: steep at the eaves, easing to the ridge. */
const GAMBREL: [number, number][] = [
  [-0.5, 0],
  [-0.4, 0.6],
  [0, 1],
  [0.4, 0.6],
  [0.5, 0],
]

/** The buildings, trees and shrubs of a map, as a few instanced meshes. */
function buildStanding(map: TerrainMap): THREE.Object3D[] {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const plain = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 })
  const flatRoof = new THREE.MeshStandardMaterial({ color: '#bdbdb8', roughness: 0.95, metalness: 0 })
  const slateRoof = new THREE.MeshStandardMaterial({ color: '#4d4f55', roughness: 0.9, metalness: 0 })
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
  const ofKind = (kind: Building['kind']): Building[] => map.buildings.filter((building) => building.kind === kind)
  const blocks = ofKind('block')
  const houses = ofKind('house')
  const cottages = ofKind('cottage')
  const villas = ofKind('villa')
  const observatories = ofKind('observatory')
  const barns = ofKind('barn')
  const silos = ofKind('silo')
  const turbines = ofKind('turbine')
  const stones = [...ofKind('stone'), ...ofKind('lintel')]
  const lighthouses = ofKind('lighthouse')
  const churches = ofKind('church')
  const steeples = ofKind('steeple')
  const waterTowers = ofKind('watertower')
  const shops = ofKind('shop')
  const canopies = ofKind('canopy')
  const posts = ofKind('post')
  const signs = ofKind('sign')
  const tents = ofKind('tent')
  const caravans = ofKind('caravan')
  const firepits = ofKind('firepit')
  const blockWall = facadeMaterial(blockFacade(), 0.6)
  const houseWall = facadeMaterial(houseFacade(), 0.9)
  const pick = (palette: [THREE.Color, ...THREE.Color[]], tone: number): THREE.Color =>
    palette[Math.floor(tone * palette.length) % palette.length] ?? palette[0]
  meshes.push(
    instanced(box, walled(blockWall, flatRoof), blocks, (building, matrix, color) => {
      boxAt(building, matrix)
      sampleRamp(building.tone, BLOCK_STOPS, color)
    }),
    instanced(box, walled(houseWall, houseWall), houses, (building, matrix, color) => {
      boxAt(building, matrix)
      color.copy(pick(HOUSE_COLORS, building.tone))
    }),
    instanced(box, walled(houseWall, houseWall), cottages, (building, matrix, color) => {
      boxAt(building, matrix)
      color.copy(pick(COTTAGE_COLORS, building.tone))
    }),
  )

  // A villa: its ground floor the whole footprint, and a smaller storey set on top, both flat-roofed.
  const villaAt = (villa: Building, matrix: THREE.Matrix4, upper: boolean): void => {
    const share = upper ? VILLA_UPPER : 1
    const bottom = upper ? villa.top - STOREY : villa.bottom
    const top = upper ? villa.top : villa.top - STOREY
    matrix.compose(
      new THREE.Vector3(villa.x, (top + bottom) / 2, villa.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), villa.yaw),
      new THREE.Vector3(villa.width * share, top - bottom, villa.depth * share),
    )
  }
  meshes.push(
    instanced(box, walled(houseWall, flatRoof), villas, (villa, matrix, color) => {
      villaAt(villa, matrix, false)
      color.copy(pick(VILLA_COLORS, villa.tone))
    }),
    instanced(box, walled(houseWall, flatRoof), villas, (villa, matrix, color) => {
      villaAt(villa, matrix, true)
      color.copy(pick(VILLA_COLORS, villa.tone))
    }),
  )

  // A pitched roof: a four-sided cone, turned so its base is square to the box.
  const roof = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4)
  roof.rotateY(Math.PI / 4)
  roof.translate(0, 0.5, 0)
  const roofing = new THREE.MeshStandardMaterial({ map: roofFacade().texture, roughness: 0.95, metalness: 0 })
  const roofAt = (house: Building, matrix: THREE.Matrix4, pitch: number): void => {
    const span = Math.min(house.width, house.depth)
    matrix.compose(
      new THREE.Vector3(house.x, house.top, house.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw),
      new THREE.Vector3(house.width + 0.6, span * pitch, house.depth + 0.6),
    )
  }
  meshes.push(
    instanced(roof, roofing, houses, (house, matrix, color) => {
      roofAt(house, matrix, ROOF_PITCH)
      color.copy(pick(ROOF_COLORS, house.tone))
    }),
    instanced(roof, roofing, cottages, (cottage, matrix, color) => {
      roofAt(cottage, matrix, COTTAGE_PITCH)
      color.copy(pick(THATCH_COLORS, cottage.tone))
    }),
    // A chimney up through the steep roof, off to one end of the ridge.
    instanced(box, plain, cottages, (cottage, matrix, color) => {
      const rise = Math.min(cottage.width, cottage.depth) * COTTAGE_PITCH
      const along = new THREE.Vector3(cottage.width * 0.3, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), cottage.yaw)
      matrix.compose(
        new THREE.Vector3(cottage.x + along.x, cottage.top + rise * 0.45, cottage.z + along.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cottage.yaw),
        new THREE.Vector3(CHIMNEY.width, CHIMNEY.height, CHIMNEY.width),
      )
      color.copy(BRICK)
    }),
  )

  // A barn: a red box under a grey gambrel roof, its ridge along the barn. Stones: boxes, each its own grey.
  const gambrel = prismGeometry(GAMBREL)
  const gable = prismGeometry(GABLE)
  meshes.push(
    instanced(box, walled(plain, plain), barns, (barn, matrix, color) => {
      boxAt(barn, matrix)
      color.copy(pick(BARN_COLORS, barn.tone))
    }),
    instanced(gambrel, plain, barns, (barn, matrix, color) => {
      roofAt(barn, matrix, BARN_PITCH)
      color.copy(BARN_ROOF)
    }),
    instanced(box, plain, stones, (stone, matrix, color) => {
      boxAt(stone, matrix)
      color.copy(STONE_COLOR).multiplyScalar(0.85 + stone.tone * 0.3)
    }),
  )

  // Shapes shared by the towers and what stands on them, built once.
  const tower = new THREE.CylinderGeometry(1, 1, 1, 18)
  tower.translate(0, 0.5, 0)
  const cap = new THREE.ConeGeometry(1, 1, 16)
  cap.translate(0, 0.5, 0)
  const ring = new THREE.TorusGeometry(1, 0.06, 6, 32).rotateX(Math.PI / 2)
  const lamp = new THREE.SphereGeometry(0.5, 10, 8)

  // A church: the nave a pale box under slate, the tower a box with a spire and a cross, a door at its foot.
  const spire = new THREE.ConeGeometry(1, 1, 8)
  spire.translate(0, 0.5, 0)
  const upright = (building: Building, matrix: THREE.Matrix4, sx: number, sy: number, sz: number, y: number, along = 0, across = 0): void => {
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), building.yaw)
    const offset = new THREE.Vector3(along, 0, across).applyQuaternion(turn)
    matrix.compose(new THREE.Vector3(building.x + offset.x, y, building.z + offset.z), turn, new THREE.Vector3(sx, sy, sz))
  }
  const naveHeight = churches[0] === undefined ? 8 : churches[0].top - churches[0].bottom - BURY_SHOWN
  const churchWall = facadeMaterial(churchFacade(naveHeight), 0.9)
  meshes.push(
    instanced(box, walled(churchWall, slateRoof), churches, (church, matrix, color) => {
      boxAt(church, matrix)
      color.copy(CHURCH_COLOR)
    }),
    instanced(gable, plain, churches, (church, matrix, color) => {
      roofAt(church, matrix, CHURCH_PITCH)
      color.copy(SLATE)
    }),
    instanced(box, walled(plain, slateRoof), steeples, (steeple, matrix, color) => {
      boxAt(steeple, matrix)
      color.copy(CHURCH_COLOR)
    }),
    instanced(spire, plain, steeples, (steeple, matrix, color) => {
      upright(steeple, matrix, steeple.width * 0.55, SPIRE_HEIGHT, steeple.depth * 0.55, steeple.top)
      color.copy(SLATE)
    }),
    instanced(box, plain, steeples, (steeple, matrix, color) => {
      upright(steeple, matrix, 0.15, 1.6, 0.15, steeple.top + SPIRE_HEIGHT + 0.6)
      color.copy(IRONWORK)
    }),
    instanced(box, plain, steeples, (steeple, matrix, color) => {
      upright(steeple, matrix, 1.0, 0.15, 0.15, steeple.top + SPIRE_HEIGHT + 1.0)
      color.copy(IRONWORK)
    }),
    instanced(box, plain, steeples, (steeple, matrix, color) => {
      upright(steeple, matrix, 1.4, 2.6, 0.3, steeple.bottom + BURY_SHOWN + 1.3, 0, steeple.depth / 2)
      color.copy(IRONWORK)
    }),
  )

  // A water tower: a column with four legs about it, all reaching up into a spheroid tank at the
  // top, and a ladder up the side to it.
  const tankMiddle = (watertower: Building): number => watertower.top - TANK.height / 2
  meshes.push(
    instanced(tower, plain, waterTowers, (watertower, matrix, color) => {
      const radius = watertower.width / 2
      matrix.makeScale(radius, tankMiddle(watertower) - watertower.bottom, radius)
      matrix.setPosition(watertower.x, watertower.bottom, watertower.z)
      color.copy(WATER_TOWER_COLOR)
    }),
    ...[0, 1, 2, 3].map((k) =>
      instanced(box, plain, waterTowers, (watertower, matrix, color) => {
        const angle = (k * Math.PI) / 2 + Math.PI / 4
        const reach = TANK.radius * 0.6
        const height = tankMiddle(watertower) - watertower.bottom
        matrix.makeScale(0.35, height, 0.35)
        matrix.setPosition(
          watertower.x + Math.cos(angle) * reach,
          watertower.bottom + height / 2,
          watertower.z + Math.sin(angle) * reach,
        )
        color.copy(WATER_TOWER_COLOR)
      }),
    ),
    instanced(lamp, plain, waterTowers, (watertower, matrix, color) => {
      // The lamp is a half-metre sphere: scaled to the tank's radius across and its height up.
      matrix.makeScale(TANK.radius * 2, TANK.height, TANK.radius * 2)
      matrix.setPosition(watertower.x, tankMiddle(watertower), watertower.z)
      color.copy(WATER_TOWER_COLOR)
    }),
    instanced(box, plain, waterTowers, (watertower, matrix, color) => {
      const height = tankMiddle(watertower) - watertower.bottom
      matrix.makeScale(0.5, height, 0.12)
      matrix.setPosition(watertower.x + watertower.width / 2 + 0.2, watertower.bottom + height / 2, watertower.z)
      color.copy(IRONWORK)
    }),
  )

  // A filling station: the shop with a glazed front, the canopy on its posts with a red fascia,
  // two pump islands under it, and a sign on a pole by the road.
  const glass = new THREE.MeshStandardMaterial({ color: SHOP_GLASS, roughness: 0.2, metalness: 0.1 })
  const fasciaFace = new THREE.MeshStandardMaterial({ color: FASCIA, roughness: 0.7, metalness: 0.05 })
  const canopyFace = new THREE.MeshStandardMaterial({ color: CANOPY_COLOR, roughness: 0.8, metalness: 0.05 })
  meshes.push(
    instanced(box, walled(plain, flatRoof), shops, (shop, matrix, color) => {
      boxAt(shop, matrix)
      color.copy(CANOPY_COLOR)
    }),
    instanced(box, glass, shops, (shop, matrix, color) => {
      upright(shop, matrix, shop.width - 1, shop.top - shop.bottom - BURY_SHOWN - 1, 0.2, (shop.top + shop.bottom + BURY_SHOWN) / 2 - 0.5, 0, -shop.depth / 2)
      color.copy(SHOP_GLASS)
    }),
    // The canopy is one slab: its edges the red fascia, its top and underside white.
    instanced(box, [fasciaFace, fasciaFace, canopyFace, canopyFace, fasciaFace, fasciaFace], canopies, (canopy, matrix, color) => {
      boxAt(canopy, matrix)
      color.setRGB(1, 1, 1)
    }),
    instanced(box, plain, posts, (post, matrix, color) => {
      boxAt(post, matrix)
      color.copy(IRONWORK)
    }),
    ...[-1, 1].flatMap((side) => [
      instanced(box, plain, canopies, (canopy, matrix, color) => {
        upright(canopy, matrix, 3.2, 0.2, 1.4, canopy.bottom - CANOPY_OVER + 0.1, side * (canopy.width / 4))
        color.copy(PUMP_COLOR)
      }),
      instanced(box, plain, canopies, (canopy, matrix, color) => {
        upright(canopy, matrix, 0.8, 1.7, 0.5, canopy.bottom - CANOPY_OVER + 1.05, side * (canopy.width / 4))
        color.copy(FASCIA)
      }),
    ]),
    instanced(tower, plain, signs, (sign, matrix, color) => {
      matrix.makeScale(0.15, sign.top - sign.bottom - 2.2, 0.15)
      matrix.setPosition(sign.x, sign.bottom, sign.z)
      color.copy(IRONWORK)
    }),
    instanced(box, plain, signs, (sign, matrix, color) => {
      upright(sign, matrix, sign.width, 2.2, sign.depth, sign.top - 1.1)
      color.copy(FASCIA)
    }),
  )

  // A camp: tents as ridged prisms in bright colours, white caravans with a stripe and wheels,
  // and the fire pit as a ring of stones with an ember glowing in it.
  const tentShape = new THREE.CylinderGeometry(1, 1, 1, 3, 1, false, Math.PI / 2)
  tentShape.rotateZ(Math.PI / 2)
  tentShape.translate(0, 0.5, 0)
  const ember = new THREE.MeshStandardMaterial({ color: '#ff8c3a', emissive: '#ff5a1c', emissiveIntensity: 1.8 })
  meshes.push(
    instanced(tentShape, plain, tents, (tent, matrix, color) => {
      upright(tent, matrix, tent.width, (tent.top - tent.bottom - BURY_SHOWN) / 1.5, tent.depth / 1.732, tent.bottom + BURY_SHOWN)
      color.copy(pick(TENT_COLORS, tent.tone))
    }),
    instanced(box, plain, caravans, (caravan, matrix, color) => {
      upright(caravan, matrix, caravan.width, caravan.top - caravan.bottom - BURY_SHOWN - 0.5, caravan.depth, (caravan.top + caravan.bottom + BURY_SHOWN + 0.5) / 2)
      color.copy(CARAVAN_COLOR)
    }),
    instanced(box, plain, caravans, (caravan, matrix, color) => {
      upright(caravan, matrix, caravan.width + 0.04, 0.3, caravan.depth + 0.04, caravan.bottom + BURY_SHOWN + 1.3)
      color.copy(CARAVAN_STRIPE)
    }),
    ...[-1, 1].map((side) =>
      instanced(box, plain, caravans, (caravan, matrix, color) => {
        upright(caravan, matrix, 0.7, 0.7, 0.3, caravan.bottom + BURY_SHOWN + 0.3, 0, side * (caravan.depth / 2 - 0.1))
        color.copy(IRONWORK)
      }),
    ),
    instanced(ring, plain, firepits, (firepit, matrix, color) => {
      matrix.makeScale(firepit.width / 2, 2.5, firepit.width / 2)
      matrix.setPosition(firepit.x, firepit.bottom + BURY_SHOWN + 0.15, firepit.z)
      color.copy(STONE_COLOR)
    }),
    instanced(lamp, ember, firepits, (firepit, matrix, color) => {
      matrix.makeScale(0.9, 0.5, 0.9)
      matrix.setPosition(firepit.x, firepit.bottom + BURY_SHOWN + 0.2, firepit.z)
      color.copy(new THREE.Color('#ff8c3a'))
    }),
  )

  // An observatory: a round tower with a dome on it, its slit facing whichever way the tone says.
  const dome = new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2)
  const slit = new THREE.BoxGeometry(0.18, 1, 0.9)
  slit.translate(0, 0.5, 0.55)
  // The dome is a hemisphere of the tower's radius, so the tower stops that far short of the top.
  const domeAt = (observatory: Building, matrix: THREE.Matrix4): void => {
    const radius = (observatory.width / 2) * TOWER_SHARE
    matrix.compose(
      new THREE.Vector3(observatory.x, observatory.top - radius, observatory.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), observatory.tone * Math.PI * 2),
      new THREE.Vector3(radius, radius, radius),
    )
  }
  meshes.push(
    instanced(tower, plain, observatories, (observatory, matrix, color) => {
      const radius = (observatory.width / 2) * TOWER_SHARE
      matrix.makeScale(radius, observatory.top - radius - observatory.bottom, radius)
      matrix.setPosition(observatory.x, observatory.bottom, observatory.z)
      color.copy(TOWER_COLOR)
    }),
    instanced(dome, plain, observatories, (observatory, matrix, color) => {
      domeAt(observatory, matrix)
      color.copy(DOME_COLOR)
    }),
    instanced(slit, plain, observatories, (observatory, matrix, color) => {
      domeAt(observatory, matrix)
      color.copy(SLIT_COLOR)
    }),
  )

  // A silo: a round tower capped with a hemisphere of its own radius.
  meshes.push(
    instanced(tower, plain, silos, (silo, matrix, color) => {
      const radius = silo.width / 2
      matrix.makeScale(radius, silo.top - radius - silo.bottom, radius)
      matrix.setPosition(silo.x, silo.bottom, silo.z)
      color.copy(SILO_COLOR)
    }),
    instanced(dome, plain, silos, (silo, matrix, color) => {
      const radius = silo.width / 2
      matrix.makeScale(radius, radius, radius)
      matrix.setPosition(silo.x, silo.top - radius, silo.z)
      color.copy(SILO_COLOR)
    }),
  )

  // A wind turbine: a tapering tower, a nacelle across its top facing the
  // way the tone says, and three blades on the front of it, turning.
  const mast = new THREE.CylinderGeometry(0.55, 1, 1, 12)
  mast.translate(0, 0.5, 0)
  const nacelle = new THREE.BoxGeometry(NACELLE.width, NACELLE.width, NACELLE.length)
  nacelle.translate(0, 0, -NACELLE.length * 0.15)
  const rotor = new THREE.BufferGeometry()
  {
    const blades: THREE.BufferGeometry[] = []
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.BoxGeometry(0.5, BLADE_LENGTH, 0.14)
      blade.translate(0, BLADE_LENGTH / 2, 0)
      blade.rotateZ((k * Math.PI * 2) / 3)
      blades.push(blade)
    }
    const hub = new THREE.SphereGeometry(0.9, 10, 8)
    blades.push(hub)
    const positions: number[] = []
    const normals: number[] = []
    const indices: number[] = []
    let vertices = 0
    for (const part of blades) {
      const position = part.getAttribute('position')
      const normal = part.getAttribute('normal')
      const index = part.getIndex()
      for (let i = 0; i < position.count; i++) {
        positions.push(position.getX(i), position.getY(i), position.getZ(i))
        normals.push(normal.getX(i), normal.getY(i), normal.getZ(i))
      }
      if (index !== null) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + vertices)
      vertices += position.count
      part.dispose()
    }
    rotor.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    rotor.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    rotor.setIndex(indices)
  }
  const facing = (turbine: Building): THREE.Quaternion =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turbine.yaw)
  const hubOf = (turbine: Building): THREE.Vector3 =>
    new THREE.Vector3(0, 0, NACELLE.length * 0.4).applyQuaternion(facing(turbine)).add(
      new THREE.Vector3(turbine.x, turbine.top - NACELLE.width / 2, turbine.z),
    )
  const rotors = instanced(rotor, plain, turbines, (turbine, matrix, color) => {
    matrix.compose(hubOf(turbine), facing(turbine), new THREE.Vector3(1, 1, 1))
    color.copy(TURBINE_COLOR)
  })
  if (rotors !== null) {
    // The blades turn as the frames go by, each rotor a little out of step with the next.
    const spin = new THREE.Quaternion()
    const axis = new THREE.Vector3(0, 0, 1)
    const one = new THREE.Vector3(1, 1, 1)
    rotors.onBeforeRender = () => {
      const time = performance.now() / 1000
      for (const [i, turbine] of turbines.entries()) {
        spin.setFromAxisAngle(axis, time * BLADE_SPIN + i * 0.9)
        rotors.setMatrixAt(i, new THREE.Matrix4().compose(hubOf(turbine), facing(turbine).multiply(spin), one))
      }
      rotors.instanceMatrix.needsUpdate = true
    }
  }
  meshes.push(
    instanced(mast, plain, turbines, (turbine, matrix, color) => {
      const radius = turbine.width / 2
      matrix.makeScale(radius, turbine.top - NACELLE.width - turbine.bottom, radius)
      matrix.setPosition(turbine.x, turbine.bottom, turbine.z)
      color.copy(TURBINE_COLOR)
    }),
    instanced(nacelle, plain, turbines, (turbine, matrix, color) => {
      matrix.compose(
        new THREE.Vector3(turbine.x, turbine.top - NACELLE.width / 2, turbine.z),
        facing(turbine),
        new THREE.Vector3(1, 1, 1),
      )
      color.copy(TURBINE_COLOR)
    }),
    rotors,
  )

  // A lighthouse: a tapering white shaft with two red bands, a railed
  // gallery round the top, a glazed lantern room with the lamp in it under
  // a cap and finial, and a door at the foot. The shaft is as tall as the
  // building less what stands on it.
  const taper = new THREE.CylinderGeometry(LIGHTHOUSE_TAPER, 1, 1, 24)
  taper.translate(0, 0.5, 0)
  const finial = new THREE.SphereGeometry(0.35, 8, 6)
  const glazing = new THREE.MeshStandardMaterial({
    color: GLAZING,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.45,
  })
  const glow = new THREE.MeshStandardMaterial({ color: LAMP_COLOR, emissive: LAMP_COLOR, emissiveIntensity: 2.5 })
  const above = GALLERY.height + LANTERN.height + CAP.height
  const shaftOf = (lighthouse: Building): { radius: number; height: number; rim: number } => {
    const radius = lighthouse.width / 2
    const height = lighthouse.top - lighthouse.bottom - above
    return { radius, height, rim: lighthouse.bottom + height }
  }
  /** The shaft's radius this far up it, as it tapers. */
  const radiusAt = (lighthouse: Building, up: number): number => {
    const { radius, height } = shaftOf(lighthouse)
    return radius * (1 - (1 - LIGHTHOUSE_TAPER) * Math.min(Math.max(up / height, 0), 1))
  }
  const standing = (lighthouse: Building, matrix: THREE.Matrix4, radius: number, height: number, y: number): void => {
    matrix.makeScale(radius, height, radius)
    matrix.setPosition(lighthouse.x, y, lighthouse.z)
  }
  meshes.push(
    instanced(taper, plain, lighthouses, (lighthouse, matrix, color) => {
      const { radius, height } = shaftOf(lighthouse)
      standing(lighthouse, matrix, radius, height, lighthouse.bottom)
      color.copy(LIGHTHOUSE_COLOR)
    }),
    ...[0.35, 0.65].map((share) =>
      instanced(tower, plain, lighthouses, (lighthouse, matrix, color) => {
        const { height } = shaftOf(lighthouse)
        const up = height * share
        standing(lighthouse, matrix, radiusAt(lighthouse, up) * 1.03, height * 0.09, lighthouse.bottom + up)
        color.copy(LIGHTHOUSE_BAND)
      }),
    ),
    instanced(tower, plain, lighthouses, (lighthouse, matrix, color) => {
      const { radius, rim } = shaftOf(lighthouse)
      standing(lighthouse, matrix, radius * LIGHTHOUSE_TAPER * GALLERY.out, GALLERY.height, rim)
      color.copy(IRONWORK)
    }),
    instanced(ring, plain, lighthouses, (lighthouse, matrix, color) => {
      const { radius, rim } = shaftOf(lighthouse)
      const reach = radius * LIGHTHOUSE_TAPER * GALLERY.out
      matrix.makeScale(reach, 1, reach)
      matrix.setPosition(lighthouse.x, rim + GALLERY.height + GALLERY.rail, lighthouse.z)
      color.copy(IRONWORK)
    }),
    instanced(tower, glazing, lighthouses, (lighthouse, matrix, color) => {
      const { radius, rim } = shaftOf(lighthouse)
      standing(lighthouse, matrix, radius * LIGHTHOUSE_TAPER * LANTERN.share, LANTERN.height, rim + GALLERY.height)
      color.copy(GLAZING)
    }),
    instanced(lamp, glow, lighthouses, (lighthouse, matrix, color) => {
      const { rim } = shaftOf(lighthouse)
      matrix.makeScale(1.8, 1.8, 1.8)
      matrix.setPosition(lighthouse.x, rim + GALLERY.height + LANTERN.height / 2, lighthouse.z)
      color.copy(LAMP_COLOR)
    }),
    instanced(cap, plain, lighthouses, (lighthouse, matrix, color) => {
      const { radius, rim } = shaftOf(lighthouse)
      standing(lighthouse, matrix, radius * LIGHTHOUSE_TAPER * CAP.out, CAP.height, rim + GALLERY.height + LANTERN.height)
      color.copy(LIGHTHOUSE_BAND)
    }),
    instanced(finial, plain, lighthouses, (lighthouse, matrix, color) => {
      matrix.makeScale(1, 1, 1)
      matrix.setPosition(lighthouse.x, lighthouse.top, lighthouse.z)
      color.copy(IRONWORK)
    }),
    instanced(box, plain, lighthouses, (lighthouse, matrix, color) => {
      const { radius } = shaftOf(lighthouse)
      matrix.makeScale(DOOR.width, DOOR.height, 0.4)
      matrix.setPosition(lighthouse.x, lighthouse.bottom + BURY_SHOWN + DOOR.height / 2, lighthouse.z + radius * 0.97)
      color.copy(IRONWORK)
    }),
  )

  const trees = map.trees.filter((tree) => tree.kind === 'tree')
  const shrubs = map.trees.filter((tree) => tree.kind === 'shrub')
  const fruits = map.trees.filter((tree) => tree.kind === 'fruit')
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
    // A fruit tree: a short trunk under a round crown.
    instanced(trunk, plain, fruits, (tree: Tree, matrix, color) => {
      matrix.makeScale(0.8, tree.height * 0.45, 0.8)
      matrix.setPosition(tree.x, tree.bottom, tree.z)
      color.copy(TRUNK_COLOR)
    }),
    instanced(bush, leaves, fruits, (tree: Tree, matrix, color) => {
      matrix.makeScale(tree.radius, tree.height * 0.32, tree.radius)
      matrix.setPosition(tree.x, tree.bottom + tree.height * 0.4, tree.z)
      sampleRamp(tree.tone, FRUIT_STOPS, color)
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
  ] as const) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(x, CAR_WHEEL_RADIUS, z)
    car.add(wheel)
  }

  return car
}

/**
 * A single car parked on the highway (or the first city, or the map centre) so
 * the size of roads, cities and features can be judged at a glance. Given a
 * car to park, in the chassis frame (its front toward -Z, its wheels below
 * its origin), that one is parked, facing along the road.
 */
export function createScaleCar(map: TerrainMap, passenger: THREE.Object3D = buildCar()): THREE.Group {
  const car = new THREE.Group()
  car.add(passenger)
  const road = map.roads[0]

  if (road && road.points.length > 1) {
    // A quarter of the way along, and the point after: both within the road, whose length was just checked.
    const index = Math.floor(road.points.length * 0.25)
    const point = road.points[index]!
    const next = road.points[(index + 1) % road.points.length]!
    car.position.set(point.x, point.y + roadLift(road), point.z)
    car.rotation.y = Math.atan2(-(next.x - point.x), -(next.z - point.z))
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
  const mouths = rampMouths(map.roads)
  group.add(
    buildTerrainMesh(map.heightfield, buildGroundTexture(map, mouths), hole, segments, map.cellSize * 0.5),
  )

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(worldSize, worldSize), waterMaterial)
  sea.name = 'water'
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
      const deck = buildRoadGeometry(road, map.heightfield, mouths)
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

  // Everything on the island takes the sun's shadows; everything but the
  // ground itself, the water and the tunnel lights throws them. The ground
  // is one mesh the size of the island, and drawing it into every shadow
  // map would cost more than its own shadows are worth.
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    if (node.name === 'lights' || node.material === waterMaterial) return
    node.receiveShadow = true
    node.castShadow = node.name !== 'ground'
  })

  return group
}

const RAMP_COLOR = new THREE.Color('#4a4a48')
const SIDEWALK_COLOR = new THREE.Color('#b9b5ad')
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
