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
