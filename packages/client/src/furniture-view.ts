import { ARCH, MUSHROOM_STEM, type Stand, type World, type WorldBuilding } from '@buggies/terrain'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import { uprightAt } from './stand.ts'

/** How many seconds the kelp has swayed for: moved on with the game's time, so every strand sways as it does. */
export const KELP_SWAY = { value: 0 }

/**
 * The furniture of the worlds past the planet, each kind drawn as one
 * batch of its own: Mars's solar arrays and radio dishes, the beacons
 * round Jupiter's platforms, Venus's giant mushrooms, monoliths, spires,
 * screw towers, arches and mine headframes, the glowing crystals of
 * Mercury's caverns and Venus's mines, and Neptune's kelp and coral out on
 * its sea floor. Each piece stands where the world has it, in its own
 * frame: across along its x, up its y, and along its z.
 */
export function buildFurniture(world: World): THREE.Object3D[] {
  const ofKind = (kind: WorldBuilding['kind']): WorldBuilding[] => world.buildings.filter((building) => building.kind === kind)
  const kelp = world.trees.filter((tree) => tree.kind === 'kelp')
  const coral = world.rocks.filter((rock) => rock.kind === 'coral')
  return [
    ...solarArrays(ofKind('solar')),
    ...dishes(ofKind('dish')),
    ...beacons(ofKind('beacon')),
    ...mushrooms(ofKind('mushroom')),
    ...crystals(ofKind('crystal')),
    ...monoliths(ofKind('monolith')),
    ...spires(ofKind('spire')),
    ...screws(ofKind('screw')),
    ...arches(ofKind('arch')),
    ...headframes(ofKind('headframe')),
    ...kelpStrands(kelp.map((tree) => ({ at: tree.at, turn: uprightAt(tree.at, new THREE.Quaternion()), height: tree.height, width: tree.radius, tone: tree.tone }))),
    ...coralHeads(coral),
    ...hoodoos(ofKind('hoodoo')),
    ...rovers(ofKind('rover')),
    ...pads(ofKind('pad')),
    ...rockets(ofKind('rocket')),
    ...greenhouses(ofKind('greenhouse')),
    ...anemones(ofKind('anemone')),
    ...clams(ofKind('clam')),
    ...starfish(ofKind('starfish')),
    ...urchins(ofKind('urchin')),
    ...anchors(ofKind('anchor')),
    ...amphorae(ofKind('amphora')),
    ...balloons(ofKind('balloon')),
    ...windsocks(ofKind('windsock')),
    ...helipads(ofKind('helipad')),
    ...logs(ofKind('log')),
    ...pitchers(ofKind('pitcher')),
    ...columns(ofKind('column')),
    ...pillars(ofKind('pillar')),
    ...fungus(ofKind('fungus')),
    ...lavaPools(ofKind('lava')),
    ...stalactites(ofKind('stalactite')),
    ...tracks(ofKind('track')),
    ...mineCarts(ofKind('minecart')),
    ...lifeguards(ofKind('lifeguard')),
    ...umbrellas(ofKind('umbrella')),
  ].filter((mesh): mesh is THREE.InstancedMesh => mesh !== null)
}

const SOLAR_PANEL = new THREE.Color('#1d2f5c')
const STEEL = new THREE.Color('#9aa0a8')
const DISH_WHITE = new THREE.Color('#e9ebee')
const BEACON_LIGHT = new THREE.Color('#ff3b2e')
const STEM = new THREE.Color('#efe6cf')
const GILLS = new THREE.Color('#5b4a3a')
/** A strand of kelp's stem, its blades from the stem out to their tips, and the green some strands lean toward. */
const KELP_STEM = new THREE.Color('#4a3e18')
const KELP_BLADE = new THREE.Color('#7c6d24')
const KELP_TIP = new THREE.Color('#a8963c')
const KELP_GREEN = new THREE.Color('#9fbf5a')
/** The colors a giant mushroom's cap comes in, a crystal's glow, and a coral head. */
const CAPS = ['#c8372d', '#e0742a', '#8e3fb0', '#d8b23a', '#3f9c8a'].map((hex) => new THREE.Color(hex))
const GLOWS = ['#5ce1ff', '#b67bff', '#7dffb0', '#ffb45c'].map((hex) => new THREE.Color(hex))
const CORALS = ['#ff7f7f', '#ff9f4a', '#c86bd6', '#ffd35c', '#ff5c9a'].map((hex) => new THREE.Color(hex))
/** The stone of whoever built Venus's wonders: a monolith's black, a spire's dark, a screw tower's and an arch's pale; the gold a spire is capped in, and the light that glows in their seams. */
const OBSIDIAN = new THREE.Color('#111114')
const DARKSTONE = new THREE.Color('#2e2822')
const PALESTONE = new THREE.Color('#9b8c73')
const GOLD = new THREE.Color('#d9a63a')
const SEAM = new THREE.Color('#ffd98a')
const MINE_STEEL = new THREE.Color('#7a4a2a')

/** How far a solar array's panel tilts to the sky, and how high its middle stands, as a share of its height. */
const PANEL = { tilt: 0.45, middle: 0.7, thick: 0.12 } as const
/** A dish's mast, as a share of its height, and how deep its bowl is. */
const DISH = { mast: 0.55, bowl: Math.PI / 3, tilt: 0.6 } as const
/** A beacon's lamp, how big, and how bright it glows. */
const LAMP = { radius: 0.45, glow: 2.5 } as const
/** A crystal's glow, how bright. */
const CRYSTAL_GLOW = 1.4

/** Something standing somewhere, with a size and a tone to draw it by. */
interface Piece extends Stand {
  readonly width?: number
  readonly depth?: number
  readonly height: number
  readonly tone: number
}

const stood = new THREE.Matrix4()
const at = new THREE.Vector3()
const turn = new THREE.Quaternion()
const unit = new THREE.Vector3(1, 1, 1)

/** A batch of one shape, each piece laid out by `place` in its own frame and then stood where it is. */
function batch<T extends Piece>(geometry: THREE.BufferGeometry, material: THREE.Material, pieces: readonly T[], place: (piece: T, local: THREE.Matrix4, color: THREE.Color) => void): THREE.InstancedMesh | null {
  if (pieces.length === 0) return null
  const mesh = new THREE.InstancedMesh(geometry, material, pieces.length)
  const local = new THREE.Matrix4()
  const color = new THREE.Color()
  pieces.forEach((piece, k) => {
    local.identity()
    // White unless told otherwise: the material's own color, untinted.
    color.set('#ffffff')
    place(piece, local, color)
    at.set(piece.at.x, piece.at.y, piece.at.z)
    turn.set(piece.turn.x, piece.turn.y, piece.turn.z, piece.turn.w)
    stood.compose(at, turn, unit).multiply(local)
    mesh.setMatrixAt(k, stood)
    mesh.setColorAt(k, color)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}

const scaled = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeScale(x, y, z)
const moved = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z)
const tilted = (angle: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationX(angle)
const pick = <T,>(choices: readonly T[], tone: number): T => choices[Math.min(Math.floor(tone * choices.length), choices.length - 1)]!

/** A unit shape with its foot at its own origin. */
function footed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.translate(0, 0.5, 0)
  return geometry
}

/** A solar array: a dark panel tilted to the sky on a post. */
function solarArrays(arrays: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const box = footed(new THREE.BoxGeometry(1, 1, 1))
  const panel = new THREE.BoxGeometry(1, 1, 1)
  return [
    batch(box, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.5 }), arrays, (array, local, color) => {
      local.copy(scaled(0.3, array.height * PANEL.middle, 0.3))
      color.copy(STEEL)
    }),
    batch(panel, new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.6 }), arrays, (array, local, color) => {
      local.copy(moved(0, array.height * PANEL.middle, 0)).multiply(tilted(PANEL.tilt)).multiply(scaled(array.width, PANEL.thick, array.depth))
      color.copy(SOLAR_PANEL)
    }),
  ]
}

/** A radio dish: a mast with a bowl on it, turned up to the sky. */
function dishes(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const mast = footed(new THREE.CylinderGeometry(0.5, 0.7, 1, 8))
  const bowl = new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0, DISH.bowl)
  // The bowl opens upward from its bottom at the origin.
  bowl.translate(0, -1, 0)
  bowl.rotateX(Math.PI)
  return [
    batch(mast, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4 }), found, (dish, local, color) => {
      local.copy(scaled(1, dish.height * DISH.mast, 1))
      color.copy(STEEL)
    }),
    batch(bowl, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }), found, (dish, local, color) => {
      const r = Math.min(dish.width, dish.depth) / 2
      local.copy(moved(0, dish.height * DISH.mast, 0)).multiply(tilted(DISH.tilt)).multiply(scaled(r, r, r))
      color.copy(DISH_WHITE)
    }),
  ]
}

/** A beacon: a post with a red lamp glowing on top. */
function beacons(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const post = footed(new THREE.CylinderGeometry(0.12, 0.16, 1, 6))
  const lamp = new THREE.SphereGeometry(LAMP.radius, 10, 6)
  const glowing = new THREE.MeshStandardMaterial({ color: BEACON_LIGHT, emissive: BEACON_LIGHT, emissiveIntensity: LAMP.glow, roughness: 0.3 })
  return [
    batch(post, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4 }), found, (beacon, local, color) => {
      local.copy(scaled(1, beacon.height, 1))
      color.copy(STEEL)
    }),
    batch(lamp, glowing, found, (beacon, local) => {
      local.copy(moved(0, beacon.height, 0))
    }),
  ]
}

/** A giant mushroom: a pale stem under a broad, bright cap, its gills dark underneath. */
function mushrooms(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const stem = footed(new THREE.CylinderGeometry(0.85, 1, 1, 10))
  const cap = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  const gills = new THREE.CircleGeometry(1, 18)
  gills.rotateX(Math.PI / 2)
  const capFrom = (mushroom: WorldBuilding): number => mushroom.height * MUSHROOM_STEM.height
  return [
    batch(stem, new THREE.MeshStandardMaterial({ roughness: 0.9 }), found, (mushroom, local, color) => {
      const r = mushroom.width * MUSHROOM_STEM.radius
      local.copy(scaled(r, capFrom(mushroom) + 0.4, r))
      color.copy(STEM)
    }),
    batch(cap, new THREE.MeshStandardMaterial({ roughness: 0.55 }), found, (mushroom, local, color) => {
      local.copy(moved(0, capFrom(mushroom), 0)).multiply(scaled(mushroom.width / 2, mushroom.height - capFrom(mushroom), mushroom.depth / 2))
      color.copy(pick(CAPS, mushroom.tone))
    }),
    batch(gills, new THREE.MeshStandardMaterial({ roughness: 1 }), found, (mushroom, local, color) => {
      local.copy(moved(0, capFrom(mushroom) + 0.02, 0)).multiply(scaled(mushroom.width / 2, 1, mushroom.depth / 2))
      color.copy(GILLS)
    }),
  ]
}

/** A crystal: a long point of glowing stone, leaning as it grew; those of each color drawn together, as a glow is not tinted piece by piece. */
function crystals(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const point = new THREE.OctahedronGeometry(0.5, 0)
  point.translate(0, 0.5, 0)
  return GLOWS.map((glow) => {
    const material = new THREE.MeshStandardMaterial({ color: glow, roughness: 0.15, metalness: 0.1, emissive: glow, emissiveIntensity: CRYSTAL_GLOW, flatShading: true })
    return batch(point, material, found.filter((crystal) => pick(GLOWS, crystal.tone) === glow), (crystal, local) => {
      const lean = (crystal.tone - 0.5) * 0.6
      local.copy(moved(0, -0.4, 0)).multiply(new THREE.Matrix4().makeRotationZ(lean)).multiply(scaled(crystal.width, crystal.height + 0.4, crystal.depth))
    })
  })
}

/** A shape painted one color, as a piece of a model made of several: no texture to it, only its corners and their color. */
function painted(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const plain = geometry.index === null ? geometry : geometry.toNonIndexed()
  plain.deleteAttribute('uv')
  const colors = new Float32Array(plain.getAttribute('position').count * 3)
  for (let k = 0; k < colors.length; k += 3) color.toArray(colors, k)
  plain.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return plain
}

/** How a strand of kelp is made, as shares of its height: its stem and how much it bends, and how many blades and how long. */
const STRAND = { stem: 0.007, bend: 0.035, blades: 11, blade: 0.12, bladeWidth: 0.022, crown: 3 } as const
/** How far a strand sways at its top, as a share of its height, and how fast, one way and across. */
const SWAY = { reach: 0.07, along: 0.9, across: 0.63 } as const

/** Where the stem of a strand of kelp is across, this share of the way up: bent a little, as it grows toward the light. */
function stemAt(share: number): number {
  return STRAND.bend * Math.sin(share * Math.PI * 1.5)
}

/**
 * A strand of kelp a unit high, its foot at its origin: a slender stem
 * curving up, blades out from it all the way up, turned about it a little
 * more each time, and a few long blades streaming from its top. The stem
 * darker, the blades paler toward their tips.
 */
function kelpGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const stem = new THREE.CylinderGeometry(STRAND.stem * 0.7, STRAND.stem, 1, 4, 4, true)
  stem.translate(0, 0.5, 0)
  const corners = stem.getAttribute('position') as THREE.BufferAttribute
  for (let k = 0; k < corners.count; k++) corners.setX(k, corners.getX(k) + stemAt(corners.getY(k)))
  parts.push(painted(stem, KELP_STEM))
  const blade = (share: number, turn: number, length: number, lean: number): void => {
    const leaf = new THREE.PlaneGeometry(STRAND.bladeWidth, length, 1, 3)
    leaf.translate(0, length / 2, 0)
    // Out from the stem and drooping toward its tip, paler as it goes.
    const at = leaf.getAttribute('position') as THREE.BufferAttribute
    const colors = new Float32Array(at.count * 3)
    const color = new THREE.Color()
    for (let k = 0; k < at.count; k++) {
      const along = at.getY(k) / length
      at.setZ(k, -0.25 * along * along * length)
      color.copy(KELP_BLADE).lerp(KELP_TIP, along).toArray(colors, k * 3)
    }
    leaf.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    leaf.rotateZ(-lean)
    leaf.rotateY(turn)
    leaf.translate(stemAt(share), share, 0)
    const plain = leaf.toNonIndexed()
    plain.deleteAttribute('uv')
    parts.push(plain)
  }
  for (let k = 0; k < STRAND.blades; k++) blade(0.16 + (0.78 * k) / (STRAND.blades - 1), k * 2.4, STRAND.blade, 0.95)
  for (let k = 0; k < STRAND.crown; k++) blade(0.97, k * 2.1, STRAND.blade * 1.4, 0.5)
  const strand = mergeGeometries(parts)
  strand.computeVertexNormals()
  return strand
}

/**
 * The kelp's material: its corners pushed with the current, more the
 * higher up the strand, each strand in its own time by where it stands,
 * so the beds sway and no two strands together.
 */
function kelpMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.kelpSway = KELP_SWAY
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float kelpSway;').replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  float bend = clamp( position.y, 0.0, 1.0 );
  bend *= bend;
  float phase = dot( instanceMatrix[ 3 ].xyz, vec3( 0.071, 0.053, 0.037 ) );
  // In meters at the top, back into the strand's own measure across and along.
  float reach = ${SWAY.reach.toFixed(3)} * length( instanceMatrix[ 1 ].xyz );
  transformed.x += sin( kelpSway * ${SWAY.along.toFixed(3)} + phase ) * reach * bend / length( instanceMatrix[ 0 ].xyz );
  transformed.z += sin( kelpSway * ${SWAY.across.toFixed(3)} + phase * 1.7 ) * reach * 0.6 * bend / length( instanceMatrix[ 2 ].xyz );
}
#endif`,
    )
  }
  material.customProgramCacheKey = () => 'kelp-sway'
  return material
}

/** Kelp: tall, slender strands swaying up from the sea floor, golden brown, some greener. */
function kelpStrands(found: readonly Piece[]): (THREE.InstancedMesh | null)[] {
  const mesh = batch(kelpGeometry(), kelpMaterial(), found, (kelp, local, color) => {
    const wide = (kelp.width ?? 1.5) / 1.5
    local.copy(new THREE.Matrix4().makeRotationY(kelp.tone * Math.PI * 2)).multiply(scaled(kelp.height * wide, kelp.height, kelp.height * wide))
    color.setScalar(0.8 + 0.25 * kelp.tone).lerp(KELP_GREEN, ((kelp.tone * 7.3) % 1) * 0.35)
  })
  // Swayed in the drawing alone: its shadow would stand still.
  if (mesh !== null) mesh.name = 'kelp'
  return [mesh]
}

/** The shapes coral comes in: a knobbled mound, branches like antlers, a fan, and a cluster of tubes. */
type CoralShape = 'mound' | 'branches' | 'fan' | 'tubes'
const CORAL_SHAPES: readonly CoralShape[] = ['mound', 'branches', 'fan', 'tubes']

/** A coral's shape, a unit high and its foot at its origin. */
function coralGeometry(shape: CoralShape): THREE.BufferGeometry {
  const white = new THREE.Color('#ffffff')
  switch (shape) {
    case 'mound': {
      const mound = new THREE.IcosahedronGeometry(0.5, 1)
      mound.scale(1, 1.4, 1)
      mound.translate(0, 0.35, 0)
      return mound
    }
    case 'branches': {
      // A trunk forking twice, each fork leaning out from the last.
      const parts: THREE.BufferGeometry[] = []
      const limb = (from: THREE.Vector3, lean: number, turn: number, length: number, depth: number): void => {
        const branch = new THREE.CylinderGeometry(0.035 * (depth + 1), 0.05 * (depth + 1), length, 5)
        branch.translate(0, length / 2, 0)
        branch.rotateZ(lean)
        branch.rotateY(turn)
        branch.translate(from.x, from.y, from.z)
        parts.push(painted(branch, white))
        if (depth === 0) return
        const tip = new THREE.Vector3(0, length, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), lean).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).add(from)
        for (const side of [-1, 1]) limb(tip, lean + side * 0.5, turn + side * 0.9, length * 0.7, depth - 1)
      }
      limb(new THREE.Vector3(), 0, 0, 0.4, 2)
      return mergeGeometries(parts)
    }
    case 'fan': {
      const fan = new THREE.CircleGeometry(0.5, 14, 0, Math.PI)
      fan.translate(0, 0.1, 0)
      const stalk = new THREE.CylinderGeometry(0.04, 0.06, 0.15, 5)
      stalk.translate(0, 0.075, 0)
      return mergeGeometries([painted(fan, white), painted(stalk, white)])
    }
    case 'tubes': {
      const parts = [
        [0, 0, 0.9],
        [0.2, 0.1, 0.65],
        [-0.15, 0.18, 0.75],
        [0.05, -0.2, 0.55],
      ].map(([x, z, height]) => {
        const tube = new THREE.CylinderGeometry(0.09, 0.07, height!, 7, 1, true)
        tube.translate(x!, height! / 2, z!)
        return painted(tube, white)
      })
      return mergeGeometries(parts)
    }
  }
}

/** Coral on the sea floor, bright, each head one of the shapes coral comes in. */
function coralHeads(found: readonly (Stand & { size: number; tone: number })[]): (THREE.InstancedMesh | null)[] {
  const pieces = found.map((rock) => ({ ...rock, height: rock.size }))
  const shapeOf = (tone: number): CoralShape => pick(CORAL_SHAPES, (tone * 13.7) % 1)
  return CORAL_SHAPES.map((shape) =>
    batch(coralGeometry(shape), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true, side: shape === 'fan' ? THREE.DoubleSide : THREE.FrontSide }), pieces.filter((head) => shapeOf(head.tone) === shape), (head, local, color) => {
      const across = shape === 'fan' ? head.height * 1.2 : head.height
      local.copy(new THREE.Matrix4().makeRotationY(head.tone * 17)).multiply(scaled(across, head.height * (shape === 'mound' ? 0.5 : 1), across))
      color.copy(pick(CORALS, head.tone))
    }),
  )
}

/** A light that glows in the stone, at night and by day. */
function seamMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: SEAM, emissive: SEAM, emissiveIntensity: 1.6, roughness: 0.4 })
}

/** A monolith: a sheer slab of polished black stone, a seam of light down the middle of each face. */
function monoliths(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const box = footed(new THREE.BoxGeometry(1, 1, 1))
  return [
    batch(box, new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.65 }), found, (slab, local, color) => {
      local.copy(scaled(slab.width, slab.height, slab.depth))
      color.copy(OBSIDIAN)
    }),
    batch(box, seamMaterial(), found, (slab, local) => {
      local.copy(moved(0, slab.height * 0.08, 0)).multiply(scaled(slab.width * 0.05, slab.height * 0.84, slab.depth * 1.04))
    }),
  ]
}

/** A pyramid a unit square at its foot and a unit high, its foot at its origin, its sides square to its x and z. */
function pyramidGeometry(): THREE.BufferGeometry {
  const pyramid = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1)
  pyramid.rotateY(Math.PI / 4)
  pyramid.translate(0, 0.5, 0)
  return pyramid
}

/** How much of a spire's height is its capstone of gold. */
const CAPSTONE = 0.12

/** A spire: a steep pyramid of dark stone, capped in gold. */
function spires(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pyramid = pyramidGeometry()
  return [
    batch(pyramid, new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }), found, (spire, local, color) => {
      local.copy(scaled(spire.width, spire.height, spire.depth))
      color.copy(DARKSTONE).offsetHSL(0, 0, (spire.tone - 0.5) * 0.04)
    }),
    batch(pyramid, new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.85, roughness: 0.3, emissive: GOLD, emissiveIntensity: 0.25, flatShading: true }), found, (spire, local) => {
      const cap = 1 + 0.02
      local.copy(moved(0, spire.height * (1 - CAPSTONE), 0)).multiply(scaled(spire.width * CAPSTONE * cap, spire.height * CAPSTONE * cap, spire.depth * CAPSTONE * cap))
    }),
  ]
}

/** How tall a screw tower's crown is, and how far it flares out past the tower. */
const CROWN = { height: 3.5, flare: 1.25 } as const

/** A screw tower: a round tower of pale stone, its crown flared over the top of the ramp wound round it, a lamp burning on it. */
function screws(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const drum = footed(new THREE.CylinderGeometry(0.5, 0.5, 1, 28))
  const crown = footed(new THREE.CylinderGeometry(0.5 * CROWN.flare, 0.5, 1, 28))
  const lamp = new THREE.SphereGeometry(1, 12, 8)
  return [
    batch(drum, new THREE.MeshStandardMaterial({ roughness: 0.9 }), found, (tower, local, color) => {
      local.copy(scaled(tower.width, tower.height - CROWN.height, tower.depth))
      color.copy(PALESTONE)
    }),
    batch(crown, new THREE.MeshStandardMaterial({ roughness: 0.85 }), found, (tower, local, color) => {
      local.copy(moved(0, tower.height - CROWN.height, 0)).multiply(scaled(tower.width, CROWN.height, tower.depth))
      color.copy(PALESTONE).offsetHSL(0, 0, -0.08)
    }),
    batch(lamp, seamMaterial(), found, (tower, local) => {
      local.copy(moved(0, tower.height + 1.2, 0)).multiply(scaled(1.6, 1.6, 1.6))
    }),
  ]
}

/** An arch over a road: two square pillars of pale stone and a lintel across their tops, a band of light along its face. */
function arches(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const box = footed(new THREE.BoxGeometry(1, 1, 1))
  const stone = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true })
  const standing = (arch: WorldBuilding): number => arch.height - ARCH.lintel
  return [
    ...[-1, 1].map((side) =>
      batch(box, stone, found, (arch, local, color) => {
        local.copy(moved((side * (arch.width - ARCH.pillar)) / 2, 0, 0)).multiply(scaled(ARCH.pillar, standing(arch), arch.depth))
        color.copy(PALESTONE).offsetHSL(0, 0, (arch.tone - 0.5) * 0.06)
      }),
    ),
    batch(box, stone, found, (arch, local, color) => {
      local.copy(moved(0, standing(arch), 0)).multiply(scaled(arch.width, ARCH.lintel, arch.depth * 1.1))
      color.copy(PALESTONE).offsetHSL(0, 0, (arch.tone - 0.5) * 0.06 - 0.04)
    }),
    batch(box, seamMaterial(), found, (arch, local) => {
      local.copy(moved(0, standing(arch) + ARCH.lintel * 0.4, 0)).multiply(scaled(arch.width * 0.8, ARCH.lintel * 0.12, arch.depth * 1.14))
    }),
  ]
}

/**
 * A headframe a unit square at its foot and a unit high: four legs leaning
 * in from its corners to a platform at its top, braced across twice on
 * the way up.
 */
function headframeGeometry(): THREE.BufferGeometry {
  const white = new THREE.Color('#ffffff')
  const parts: THREE.BufferGeometry[] = []
  const strut = (from: THREE.Vector3, to: THREE.Vector3, thick: number): void => {
    const length = from.distanceTo(to)
    const piece = new THREE.BoxGeometry(thick, length, thick)
    piece.translate(0, length / 2, 0)
    piece.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()))
    piece.translate(from.x, from.y, from.z)
    parts.push(painted(piece, white))
  }
  const corner = (x: number, z: number, y: number): THREE.Vector3 => new THREE.Vector3(x * (0.5 - 0.3 * y), y, z * (0.5 - 0.3 * y))
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  for (const [x, z] of corners) strut(corner(x, z, 0), corner(x, z, 1), 0.06)
  for (const y of [0.35, 0.7, 1]) {
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = corners[k]!
      const [x1, z1] = corners[(k + 1) % 4]!
      strut(corner(x0, z0, y), corner(x1, z1, y), 0.04)
    }
  }
  return mergeGeometries(parts)
}

/** A headframe over a mine's rim: a frame of rusted steel, and the great wheel at its top that the cage is wound up and down by. */
function headframes(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const steel = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.5, flatShading: true })
  const wheel = new THREE.TorusGeometry(1, 0.08, 6, 20)
  return [
    batch(headframeGeometry(), steel, found, (frame, local, color) => {
      local.copy(scaled(frame.width, frame.height, frame.depth))
      color.copy(MINE_STEEL)
    }),
    batch(wheel, steel, found, (frame, local, color) => {
      const r = frame.width * 0.3
      local.copy(moved(0, frame.height + r * 0.6, 0)).multiply(scaled(r, r, r))
      color.copy(MINE_STEEL).offsetHSL(0, 0, -0.05)
    }),
  ]
}

// Models made of a few plain shapes, each painted its own color: a unit across, along and high unless said, foot at the origin.

/** A shape moved into its place in a model, and painted one color. */
function piece(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, place?: THREE.Matrix4): THREE.BufferGeometry {
  if (place !== undefined) geometry.applyMatrix4(place)
  return painted(geometry, new THREE.Color(color))
}

/** A model of its pieces, merged into one shape. */
function model(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(pieces)
  merged.computeVertexNormals()
  return merged
}

/** A material that takes its colors from a model's pieces, tinted by each instance's. */
function modelMaterial(options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true, ...options })
}

const at3 = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z)
const turnedZ = (angle: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationZ(angle)
const turnedY = (angle: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationY(angle)
const turnedX = (angle: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationX(angle)

/** A batch of a model, each piece scaled to its building's width, height and depth, and tinted a little by its tone. */
function stretched(geometry: THREE.BufferGeometry, material: THREE.Material, found: readonly WorldBuilding[], tint = 0.1): THREE.InstancedMesh | null {
  return batch(geometry, material, found, (thing, local, color) => {
    local.copy(scaled(thing.width, thing.height, thing.depth))
    color.setScalar(1 - tint / 2 + tint * thing.tone)
  })
}

// Mars.

/** A hoodoo: a column of red rock in bands, narrowing to a neck under a broad flat cap of harder stone. */
function hoodoos(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const band = (bottom: number, top: number, from: number, to: number, color: string): THREE.BufferGeometry =>
    piece(new THREE.CylinderGeometry(top, bottom, to - from, 9), color, at3(0, (from + to) / 2, 0))
  const shape = model([
    band(0.5, 0.42, 0, 0.3, '#8f3c1f'),
    band(0.42, 0.33, 0.3, 0.55, '#b4552c'),
    band(0.33, 0.26, 0.55, 0.78, '#9c4524'),
    band(0.26, 0.2, 0.78, 0.9, '#c2703f'),
    band(0.42, 0.38, 0.9, 1, '#6e2b17'),
  ])
  return [stretched(shape, modelMaterial({ roughness: 1 }), found)]
}

/** A rover: a white body on six wheels, a mast with its camera over its front, and a panel over its back. */
function rovers(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pieces = [
    piece(new THREE.BoxGeometry(0.9, 0.28, 0.85), '#e6e3dc', at3(0, 0.48, 0)),
    piece(new THREE.BoxGeometry(1, 0.04, 0.5), '#1d2f5c', at3(0, 0.64, 0.2)),
    piece(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), '#9aa0a8', at3(0, 0.82, -0.3)),
    piece(new THREE.BoxGeometry(0.16, 0.1, 0.1), '#3a3a3a', at3(0, 1, -0.3)),
  ]
  for (const x of [-0.5, 0.5]) for (const z of [-0.36, 0, 0.36]) pieces.push(piece(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10).applyMatrix4(turnedZ(Math.PI / 2)), '#2b2b2b', at3(x, 0.16, z)))
  return [stretched(model(pieces), modelMaterial({ roughness: 0.6 }), found)]
}

/** A landing pad: a round slab of pale concrete, a ring painted on it. */
function pads(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const slab = piece(new THREE.CylinderGeometry(0.5, 0.5, 1, 32), '#a8a29a', at3(0, 0.5, 0))
  const ring = piece(new THREE.RingGeometry(0.34, 0.38, 32).applyMatrix4(turnedX(-Math.PI / 2)), '#e8c547', at3(0, 1.01, 0))
  return [stretched(model([slab, ring]), modelMaterial({ roughness: 0.95, flatShading: false }), found, 0.04)]
}

/** A rocket on its pad, nose up: a white body with a red band, its nose, and four fins round its foot. */
function rockets(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pieces = [
    piece(new THREE.CylinderGeometry(0.5, 0.5, 0.58, 16), '#eeeeee', at3(0, 0.29, 0)),
    piece(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16), '#c8372d', at3(0, 0.61, 0)),
    piece(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), '#eeeeee', at3(0, 0.69, 0)),
    piece(new THREE.ConeGeometry(0.5, 0.26, 16), '#c8372d', at3(0, 0.87, 0)),
  ]
  for (let k = 0; k < 4; k++) pieces.push(piece(new THREE.BoxGeometry(0.04, 0.2, 0.4), '#9aa0a8', turnedY((k * Math.PI) / 2).multiply(at3(0, 0.1, 0.55))))
  return [stretched(model(pieces), modelMaterial({ roughness: 0.4, flatShading: false }), found, 0)]
}

/** A greenhouse: a long half-round of glass along its length, and green rows growing under it. */
function greenhouses(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const vault = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false, -Math.PI / 2, Math.PI)
  // Its round side up, its length along its depth.
  vault.applyMatrix4(turnedX(-Math.PI / 2))
  vault.scale(1, 2, 1)
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe8ff', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
  const rows = model([-0.25, 0, 0.25].map((x) => piece(new THREE.BoxGeometry(0.14, 0.12, 0.92), '#4f8f3a', at3(x, 0.06, 0))))
  return [stretched(vault, glass, found, 0), stretched(rows, modelMaterial(), found)]
}

// Neptune.

const ANEMONE_COLORS = ['#ff7fa8', '#ff9f4a', '#b07bff', '#ffd35c', '#7fffb0']

/** An anemone: a short stalk and a tuft of tentacles spreading up and out from its top, in one bright color. */
function anemones(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pieces = [piece(new THREE.CylinderGeometry(0.22, 0.28, 0.35, 8), '#ffffff', at3(0, 0.175, 0))]
  for (let k = 0; k < 16; k++) {
    const lean = 0.3 + (k % 3) * 0.25
    const tentacle = new THREE.ConeGeometry(0.035, 0.65, 4)
    tentacle.translate(0, 0.325, 0)
    pieces.push(piece(tentacle, '#ffffff', turnedY(k * 2.4).multiply(at3(0.12, 0.35, 0)).multiply(turnedZ(-lean))))
  }
  return [
    batch(model(pieces), modelMaterial({ roughness: 0.6, flatShading: false }), found, (anemone, local, color) => {
      local.copy(scaled(anemone.width, anemone.height, anemone.depth))
      color.copy(pick(ANEMONE_COLORS.map((hex) => new THREE.Color(hex)), anemone.tone))
    }),
  ]
}

/** A giant clam lying a little open: two fluted shells hinged at the back, a pearl glowing between them. */
function clams(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const shell = (): THREE.BufferGeometry => new THREE.SphereGeometry(0.5, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2)
  const lower = piece(shell().applyMatrix4(turnedX(Math.PI)).scale(1, 0.5, 1), '#8a7f9a', at3(0, 0.25, 0))
  // The upper shell turned up about its back edge.
  const upper = piece(shell().scale(1, 0.5, 1), '#9b90ab', at3(0, 0.25, 0.5).multiply(turnedX(-0.35)).multiply(at3(0, 0, -0.5)))
  const pearl = piece(new THREE.SphereGeometry(0.1, 10, 6), '#fff6ec', at3(0, 0.3, 0.05))
  return [stretched(model([lower, upper, pearl]), modelMaterial({ roughness: 0.5, flatShading: false, side: THREE.DoubleSide }), found)]
}

/** A starfish: five arms out from its middle, flat on the sea floor. */
function starfish(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pieces: THREE.BufferGeometry[] = [piece(new THREE.CylinderGeometry(0.14, 0.16, 1, 5), '#ffffff', at3(0, 0.5, 0))]
  for (let k = 0; k < 5; k++) {
    const arm = new THREE.ConeGeometry(0.11, 0.42, 4)
    arm.applyMatrix4(turnedZ(-Math.PI / 2))
    pieces.push(piece(arm, '#ffffff', turnedY((k * 2 * Math.PI) / 5).multiply(at3(0.3, 0.4, 0)).multiply(new THREE.Matrix4().makeScale(1, 1.6, 1))))
  }
  return [
    batch(model(pieces), modelMaterial({ roughness: 0.9 }), found, (star, local, color) => {
      local.copy(scaled(star.width, star.height, star.depth))
      color.copy(pick(['#ff6a3d', '#e8443a', '#a94fd1', '#f2a23a'].map((hex) => new THREE.Color(hex)), star.tone))
    }),
  ]
}

/** A sea urchin: a dark ball bristling with spines. */
function urchins(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const ball = new THREE.IcosahedronGeometry(0.3, 1)
  const pieces = [piece(ball.clone(), '#2a1530', at3(0, 0.3, 0))]
  const corners = ball.getAttribute('position') as THREE.BufferAttribute
  const seen = new Set<string>()
  for (let k = 0; k < corners.count; k++) {
    const out = new THREE.Vector3().fromBufferAttribute(corners, k).normalize()
    const key = out.toArray().map((v) => v.toFixed(2)).join()
    if (seen.has(key) || out.y < -0.5) continue
    seen.add(key)
    const spine = new THREE.ConeGeometry(0.025, 0.35, 3)
    spine.translate(0, 0.175 + 0.28, 0)
    spine.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out))
    pieces.push(piece(spine, '#3d1f47', at3(0, 0.3, 0)))
  }
  return [stretched(model(pieces), modelMaterial({ roughness: 0.7 }), found)]
}

/** An anchor standing where it sank: its shank, the stock across its top and the ring above, and its two arms curving up. */
function anchors(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const rust = '#5a3a2a'
  const pieces = [
    piece(new THREE.BoxGeometry(0.12, 0.8, 0.5), rust, at3(0, 0.45, 0)),
    piece(new THREE.BoxGeometry(1, 0.08, 0.2), rust, at3(0, 0.82, 0)),
    piece(new THREE.TorusGeometry(0.08, 0.025, 5, 10).applyMatrix4(turnedY(Math.PI / 2)), rust, at3(0, 0.95, 0)),
  ]
  for (const side of [-1, 1]) pieces.push(piece(new THREE.BoxGeometry(0.4, 0.09, 0.4), rust, at3(side * 0.2, 0.18, 0).multiply(turnedZ(side * 0.6))))
  return [stretched(model(pieces), modelMaterial({ roughness: 0.9 }), found)]
}

/** An amphora: a terracotta jar, round-bellied and narrow-necked, with a handle either side. */
function amphorae(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const outline = [
    [0, 0],
    [0.12, 0.02],
    [0.32, 0.2],
    [0.42, 0.45],
    [0.36, 0.68],
    [0.16, 0.8],
    [0.13, 0.95],
    [0.17, 1],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const pieces = [piece(new THREE.LatheGeometry(outline, 12), '#b5653a')]
  for (const side of [-1, 1]) pieces.push(piece(new THREE.TorusGeometry(0.11, 0.025, 4, 8, Math.PI), '#a65a32', at3(side * 0.2, 0.82, 0).multiply(turnedZ(side * -1.2))))
  return [stretched(model(pieces), modelMaterial({ roughness: 0.85, flatShading: false }), found)]
}

// Jupiter.

const BALLOON_COLORS = [
  ['#e8443a', '#ffd35c'],
  ['#3a7bd5', '#ffffff'],
  ['#7a3fb0', '#4fc3c8'],
] as const

/** A balloon tethered over a platform's edge: a stake, its rope up to a basket, and the balloon over it in two-color bands. */
function balloons(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  // In its building's height: the rope up to its basket, and the balloon over that, its diameter its width.
  const rope = footed(new THREE.CylinderGeometry(0.03, 0.03, 1, 4))
  return [
    batch(rope, new THREE.MeshStandardMaterial({ color: '#d8cfb8', roughness: 1 }), found, (balloon, local) => {
      local.copy(scaled(1, balloon.height - balloon.width * 1.05, 1))
    }),
    ...BALLOON_COLORS.map((colors, k) => {
      // Its gores in its two colors by turns, round it.
      const bands = new THREE.SphereGeometry(0.5, 16, 12).toNonIndexed()
      bands.deleteAttribute('uv')
      const corners = bands.getAttribute('position') as THREE.BufferAttribute
      const paint = new Float32Array(corners.count * 3)
      for (let c = 0; c < corners.count; c += 3) {
        const x = corners.getX(c) + corners.getX(c + 1) + corners.getX(c + 2)
        const z = corners.getZ(c) + corners.getZ(c + 1) + corners.getZ(c + 2)
        const gore = new THREE.Color(colors[Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * 8) % 2])
        for (let corner = 0; corner < 3; corner++) gore.toArray(paint, (c + corner) * 3)
      }
      bands.setAttribute('color', new THREE.BufferAttribute(paint, 3))
      bands.scale(1, 1.15, 1)
      bands.translate(0, 0.58, 0)
      const shape = model([bands, piece(new THREE.BoxGeometry(0.22, 0.14, 0.22), '#7a5230', at3(0, -0.09, 0))])
      const theirs = found.filter((balloon) => Math.floor(balloon.tone * BALLOON_COLORS.length) % BALLOON_COLORS.length === k)
      return batch(shape, modelMaterial({ roughness: 0.6, flatShading: false }), theirs, (balloon, local) => {
        local.copy(moved(0, balloon.height - balloon.width * 1.05, 0)).multiply(scaled(balloon.width, balloon.width, balloon.width))
      })
    }),
  ]
}

/** A wind sock: a pole, and an orange and white striped sock off its top, out along its depth. */
function windsocks(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pole = footed(new THREE.CylinderGeometry(0.06, 0.08, 1, 6))
  const stripes = [0, 1, 2, 3, 4].map((k) => {
    const ring = new THREE.CylinderGeometry(0.5 - k * 0.07, 0.5 - (k + 1) * 0.07, 0.2, 10, 1, true)
    return piece(ring, k % 2 === 0 ? '#ff7a1f' : '#ffffff', turnedX(Math.PI / 2 + 0.25).premultiply(at3(0, 0, 0.1 + k * 0.2)))
  })
  return [
    batch(pole, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4 }), found, (sock, local, color) => {
      local.copy(scaled(1, sock.height, 1))
      color.copy(STEEL)
    }),
    batch(model(stripes), modelMaterial({ roughness: 0.9, side: THREE.DoubleSide }), found, (sock, local) => {
      local.copy(moved(0, sock.height - 0.4, 0)).multiply(scaled(0.7, 0.7, sock.depth))
    }),
  ]
}

/** A landing pad: a round slab of dark paving, a yellow ring round it, and a white H painted in the middle. */
function helipads(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const flat = (geometry: THREE.BufferGeometry): THREE.BufferGeometry => geometry.applyMatrix4(turnedX(-Math.PI / 2))
  const pieces = [
    piece(new THREE.CylinderGeometry(0.5, 0.5, 1, 32), '#3e4146', at3(0, 0.5, 0)),
    piece(flat(new THREE.RingGeometry(0.4, 0.44, 32)), '#e8c547', at3(0, 1.02, 0)),
    piece(flat(new THREE.PlaneGeometry(0.06, 0.4)), '#f2f2f2', at3(-0.12, 1.02, 0)),
    piece(flat(new THREE.PlaneGeometry(0.06, 0.4)), '#f2f2f2', at3(0.12, 1.02, 0)),
    piece(flat(new THREE.PlaneGeometry(0.24, 0.06)), '#f2f2f2', at3(0, 1.02, 0)),
  ]
  return [stretched(model(pieces), modelMaterial({ roughness: 0.9, flatShading: false }), found, 0)]
}

// Venus.

/** A fallen giant's trunk lying along the jungle floor, its bark brown and mossy on top, its broken ends pale wood. */
function logs(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const trunk = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1)
  trunk.applyMatrix4(turnedZ(Math.PI / 2))
  const plain = trunk.toNonIndexed()
  plain.deleteAttribute('uv')
  plain.computeVertexNormals()
  const normals = plain.getAttribute('normal') as THREE.BufferAttribute
  const colors = new Float32Array(normals.count * 3)
  const bark = new THREE.Color('#5a3f26')
  const moss = new THREE.Color('#4e7d2f')
  const wood = new THREE.Color('#c9a774')
  const color = new THREE.Color()
  for (let k = 0; k < normals.count; k++) {
    const end = Math.abs(normals.getX(k)) > 0.9
    ;(end ? color.copy(wood) : color.copy(bark).lerp(moss, Math.max(0, normals.getY(k)) * 0.8)).toArray(colors, k * 3)
  }
  plain.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  // Lying along its length, resting on the highest ground under it.
  return [
    batch(plain, modelMaterial({ roughness: 0.95 }), found, (log, local, color) => {
      local.copy(moved(0, log.height - log.depth / 2, 0)).multiply(scaled(log.width, log.depth, log.depth))
      color.setScalar(0.9 + 0.2 * log.tone)
    }),
  ]
}

/** A pitcher plant: a green stem, a tall cup leaning out from its top, reddening to its rim, and its lid held up over it. */
function pitchers(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const cup = new THREE.CylinderGeometry(0.5, 0.3, 0.5, 12, 4, true)
  const corners = cup.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(corners.count * 3)
  for (let k = 0; k < corners.count; k++) new THREE.Color('#5d8f2f').lerp(new THREE.Color('#b8322a'), corners.getY(k) + 0.5).toArray(colors, k * 3)
  cup.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  cup.applyMatrix4(at3(0, 0.25, 0))
  const tilt = turnedZ(0.25)
  const cupped = cup.toNonIndexed()
  cupped.deleteAttribute('uv')
  cupped.applyMatrix4(at3(0, 0.45, 0).multiply(tilt))
  const pieces = [
    piece(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 6), '#4a7a28', at3(0, 0.225, 0)),
    cupped,
    piece(new THREE.CircleGeometry(0.42, 10).applyMatrix4(turnedX(-Math.PI / 2 + 0.6)), '#9c2a24', at3(0, 0.45, 0).multiply(tilt).multiply(at3(0.1, 0.62, 0.3))),
  ]
  return [stretched(model(pieces), modelMaterial({ roughness: 0.7, side: THREE.DoubleSide }), found)]
}

/** A broken column on its square plinth, pale stone, worn by the jungle. */
function columns(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const plinth = piece(new THREE.BoxGeometry(1.25, 0.08, 1.25), '#9b8c73', at3(0, 0.04, 0))
  const drum = piece(new THREE.CylinderGeometry(0.45, 0.5, 0.92, 12), '#b0a184', at3(0, 0.54, 0))
  return [stretched(model([plinth, drum]), modelMaterial({ roughness: 0.95 }), found)]
}

// Mercury.

/** A pillar of rock where a stalagmite grew up to its stalactite: wide at the floor and the roof, waisted between. */
function pillars(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const outline = [
    [0.5, 0],
    [0.36, 0.15],
    [0.27, 0.35],
    [0.24, 0.5],
    [0.27, 0.65],
    [0.36, 0.85],
    [0.5, 1],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  return [
    batch(new THREE.LatheGeometry(outline, 10), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), found, (pillar, local, color) => {
      local.copy(scaled(pillar.width, pillar.height, pillar.depth))
      color.set('#4d4038').offsetHSL(0, 0, (pillar.tone - 0.5) * 0.06)
    }),
  ]
}

const FUNGUS_GLOWS = ['#7dffd0', '#7fb6ff', '#d38bff'].map((hex) => new THREE.Color(hex))

/** A cluster of fungus: pale stems of different heights, each under a cap that glows; those of each glow drawn together. */
function fungus(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const tufts = [
    [0, 0, 1, 0.35],
    [0.28, 0.12, 0.7, 0.26],
    [-0.25, 0.18, 0.55, 0.22],
    [0.1, -0.3, 0.8, 0.3],
    [-0.2, -0.22, 0.45, 0.18],
  ]
  const stems = model(tufts.map(([x, z, high, cap]) => piece(new THREE.CylinderGeometry(cap! * 0.22, cap! * 0.3, high!, 6), '#e8e2cf', at3(x!, high! / 2, z!))))
  const caps = model(tufts.map(([x, z, high, cap]) => piece(new THREE.SphereGeometry(cap!, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), '#ffffff', at3(x!, high!, z!))))
  return [
    stretched(stems, modelMaterial({ roughness: 0.8 }), found),
    ...FUNGUS_GLOWS.map((glow) =>
      stretched(caps, new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 1.3, roughness: 0.4 }), found.filter((cluster) => pick(FUNGUS_GLOWS, cluster.tone) === glow), 0),
    ),
  ]
}

/** A pool of lava on a level floor: a ragged glowing disc, a dark crust round its edge. */
function lavaPools(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const ragged = (reach: number, sides: number): THREE.BufferGeometry => {
    const outline = new THREE.Shape()
    for (let k = 0; k <= sides; k++) {
      const angle = (k / sides) * Math.PI * 2
      const r = reach * (0.85 + 0.15 * Math.sin(k * 2.7) * Math.cos(k * 1.3))
      if (k === 0) outline.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
      else outline.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
    }
    return new THREE.ShapeGeometry(outline).applyMatrix4(turnedX(-Math.PI / 2))
  }
  const glow = new THREE.Color('#ff5a1a')
  return [
    batch(ragged(0.5, 18), new THREE.MeshStandardMaterial({ color: '#2a1a14', roughness: 1 }), found, (pool, local) => {
      local.copy(moved(0, pool.height - 0.02, 0)).multiply(scaled(pool.width, 1, pool.depth))
    }),
    batch(ragged(0.42, 18), new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 2.2, roughness: 0.3 }), found, (pool, local) => {
      local.copy(moved(0, pool.height + 0.01, 0)).multiply(scaled(pool.width, 1, pool.depth))
    }),
  ]
}

/** A stalactite: a long point of rock hanging from the roof, its root up in it, paler toward its tip. */
function stalactites(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const point = new THREE.ConeGeometry(0.5, 1, 7)
  point.applyMatrix4(turnedX(Math.PI))
  point.translate(0, 0.5, 0)
  const corners = point.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(corners.count * 3)
  for (let k = 0; k < corners.count; k++) new THREE.Color('#8a7a68').lerp(new THREE.Color('#3b302a'), corners.getY(k)).toArray(colors, k * 3)
  point.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return [stretched(point, modelMaterial({ roughness: 1 }), found)]
}

/** A stretch of mine track: two rails along its length on sleepers across it. */
function tracks(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pieces: THREE.BufferGeometry[] = []
  for (let k = 0; k < 24; k++) pieces.push(piece(new THREE.BoxGeometry(0.02, 0.3, 1.3), '#5a4632', at3(-0.48 + k * (0.96 / 23), 0.15, 0)))
  for (const side of [-0.38, 0.38]) pieces.push(piece(new THREE.BoxGeometry(1, 0.35, 0.07), '#6a6a6e', at3(0, 0.47, side)))
  return [stretched(model(pieces), modelMaterial({ roughness: 0.7, metalness: 0.4 }), found, 0)]
}

/** A mine cart: an open box of rusted iron on four small wheels, ore heaped in it. */
function mineCarts(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pieces = [
    piece(new THREE.BoxGeometry(1, 0.08, 1), '#6b3f26', at3(0, 0.3, 0)),
    piece(new THREE.BoxGeometry(1, 0.62, 0.06), '#7a4a2a', at3(0, 0.63, 0.47)),
    piece(new THREE.BoxGeometry(1, 0.62, 0.06), '#7a4a2a', at3(0, 0.63, -0.47)),
    piece(new THREE.BoxGeometry(0.06, 0.62, 1), '#7a4a2a', at3(0.47, 0.63, 0)),
    piece(new THREE.BoxGeometry(0.06, 0.62, 1), '#7a4a2a', at3(-0.47, 0.63, 0)),
    piece(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.5, 1), '#5a4a3e', at3(0, 0.8, 0)),
  ]
  for (const x of [-0.32, 0.32]) for (const z of [-0.4, 0.4]) pieces.push(piece(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10).applyMatrix4(turnedX(Math.PI / 2)), '#2b2b2b', at3(x, 0.15, z)))
  return [stretched(model(pieces), modelMaterial({ roughness: 0.8, metalness: 0.3 }), found)]
}

// The planet.

/** A lifeguard tower: four white legs up to a red hut with a white roof, a ramp down from its front to the sand. */
function lifeguards(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  const pieces: THREE.BufferGeometry[] = []
  for (const x of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) pieces.push(piece(new THREE.BoxGeometry(0.08, 0.6, 0.08), '#f2f2f2', at3(x, 0.3, z)))
  pieces.push(
    piece(new THREE.BoxGeometry(1.1, 0.04, 1.1), '#d9d2c4', at3(0, 0.6, 0)),
    piece(new THREE.BoxGeometry(0.9, 0.28, 0.9), '#d33a2c', at3(0, 0.76, 0)),
    piece(new THREE.BoxGeometry(1.15, 0.05, 1.15), '#f2f2f2', at3(0, 0.93, 0)),
    piece(new THREE.BoxGeometry(0.3, 0.04, 0.9), '#d9d2c4', at3(0.95, 0.3, 0).multiply(turnedZ(0.6))),
  )
  return [stretched(model(pieces), modelMaterial({ roughness: 0.7 }), found, 0)]
}

const UMBRELLA_COLORS = ['#e8443a', '#3a7bd5', '#f2c14a', '#2fae8f']

/** A beach umbrella: a pole stuck in the sand and a low canopy over it, its panels white and one color by turns. */
function umbrellas(found: readonly WorldBuilding[]): (THREE.InstancedMesh | null)[] {
  // The canopy's panels by turns round it: the white ones, or the colored.
  const panels = (white: boolean): THREE.BufferGeometry => {
    const canopy = new THREE.ConeGeometry(0.5, 0.18, 8, 1, true).toNonIndexed()
    const corners = canopy.getAttribute('position') as THREE.BufferAttribute
    const kept: number[] = []
    for (let k = 0; k < corners.count; k += 3) {
      const x = corners.getX(k) + corners.getX(k + 1) + corners.getX(k + 2)
      const z = corners.getZ(k) + corners.getZ(k + 1) + corners.getZ(k + 2)
      if ((Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * 8) % 2 === 0) !== white) continue
      for (let c = 0; c < 3; c++) kept.push(corners.getX(k + c), corners.getY(k + c) + 0.91, corners.getZ(k + c))
    }
    const half = new THREE.BufferGeometry()
    half.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3))
    half.computeVertexNormals()
    return half
  }
  const cloth = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true, side: THREE.DoubleSide })
  const colors = UMBRELLA_COLORS.map((hex) => new THREE.Color(hex))
  return [
    batch(footed(new THREE.CylinderGeometry(0.02, 0.02, 1, 4)), new THREE.MeshStandardMaterial({ color: '#eeeeee', roughness: 0.6 }), found, (umbrella, local) => {
      local.copy(scaled(umbrella.width, umbrella.height * 0.95, umbrella.depth))
    }),
    batch(panels(true), cloth(), found, (umbrella, local) => {
      local.copy(scaled(umbrella.width, umbrella.height, umbrella.depth))
    }),
    batch(panels(false), cloth(), found, (umbrella, local, color) => {
      local.copy(scaled(umbrella.width, umbrella.height, umbrella.depth))
      color.copy(pick(colors, umbrella.tone))
    }),
  ]
}
