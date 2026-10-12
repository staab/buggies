import { MUSHROOM_STEM, type Stand, type World, type WorldBuilding } from '@buggies/terrain'
import * as THREE from 'three'

import { uprightAt } from './stand.ts'

/**
 * The furniture of the worlds past the planet, each kind drawn as one
 * batch of its own: Mars's solar arrays and radio dishes, the beacons
 * round Jupiter's platforms, Venus's giant mushrooms, Mercury's glowing
 * crystals, and Neptune's kelp and coral out on its sea floor. Each piece
 * stands where the world has it, in its own frame: across along its x, up
 * its y, and along its z.
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
const KELP = new THREE.Color('#5b6b2a')
/** The colors a giant mushroom's cap comes in, a crystal's glow, and a coral head. */
const CAPS = ['#c8372d', '#e0742a', '#8e3fb0', '#d8b23a', '#3f9c8a'].map((hex) => new THREE.Color(hex))
const GLOWS = ['#5ce1ff', '#b67bff', '#7dffb0', '#ffb45c'].map((hex) => new THREE.Color(hex))
const CORALS = ['#ff7f7f', '#ff9f4a', '#c86bd6', '#ffd35c', '#ff5c9a'].map((hex) => new THREE.Color(hex))

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

/** Kelp: a tall, slender strand swaying up from the sea floor, leaning with the current. */
function kelpStrands(found: readonly Piece[]): (THREE.InstancedMesh | null)[] {
  const strand = footed(new THREE.ConeGeometry(1, 1, 5))
  return [
    batch(strand, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), found, (kelp, local, color) => {
      const lean = (kelp.tone - 0.5) * 0.35
      const r = (kelp.width ?? 1) * 0.3
      local.copy(new THREE.Matrix4().makeRotationZ(lean)).multiply(scaled(r, kelp.height, r))
      color.copy(KELP).offsetHSL((kelp.tone - 0.5) * 0.06, 0, (kelp.tone - 0.5) * 0.1)
    }),
  ]
}

/** A coral head: a bright, knobbled mound on the sea floor. */
function coralHeads(found: readonly (Stand & { size: number; tone: number })[]): (THREE.InstancedMesh | null)[] {
  const mound = new THREE.IcosahedronGeometry(0.5, 1)
  mound.translate(0, 0.25, 0)
  return [
    batch(mound, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), found.map((rock) => ({ ...rock, height: rock.size })), (head, local, color) => {
      local.copy(scaled(head.height, head.height * 0.7, head.height))
      color.copy(pick(CORALS, head.tone))
    }),
  ]
}
