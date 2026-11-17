import { corridorAt } from '@buggies/game'
import type { CheckpointView } from '@buggies/net'
import type { Vec3 } from '@buggies/physics'
import { ROAD_WIDTH, heightOver, roofOver, type World } from '@buggies/terrain'
import * as THREE from 'three'

import { standOn } from './stand.ts'

/** How tall a gate stands: clear of the tallest car, and under the roof of any room it is set in. */
export const GATE_HEIGHT = 9
/** How narrow a gate gets, across, before the road it spans is wider: a road's own width and two of these. */
const GATE_SPAN = 12
const GATE_MARGIN = 4
/** The least room a gate leaves under a low roof, even where that makes it shorter than a car. */
const GATE_LEAST = 3
/** How much narrower than the walls either side of it a gate in a tunnel is drawn, so that it clears them. */
const CORRIDOR_CLEARANCE = 1
/** The narrowest a gate is drawn in a tunnel, so that its posts never cross over one another where the roof closes in. */
const GATE_NARROWEST = 3
/** How far from a gate a road must run to be the road it spans. */
const ROAD_REACH = 20
/** A pillar's thickness, the lintel's above it, and how far and how wide the light shaft over a gate reaches up. */
const PILLAR = 1.8
const LINTEL = 2
const SHAFT_HEIGHT = 160
const SHAFT_RADIUS = 2.5
/** The sign over a gate's lintel that says which it is, as tall as this, and as wide as the gate. */
const SIGN_HEIGHT = 5

/** The gold a gate is lit in: bright for the one to head for next, faint for the one after it. */
const NEXT_COLOR = 0xffd24a
const FAINT_COLOR = 0x7a6420

/** A material, and how bright it is: what a gate is drawn in when it is the next one, and when it is the one after. */
interface Paints {
  readonly post: { next: THREE.Material; later: THREE.Material }
  readonly sheet: { next: THREE.Material; later: THREE.Material }
  readonly shaft: { next: THREE.Material; later: THREE.Material }
}

/** What the sign over each gate says: its number along the course, and the last one the portal on or the finish. */
export function gateLabels(count: number, finish: boolean): string[] {
  return Array.from({ length: count }, (_, index) => (index < count - 1 ? String(index + 1) : finish ? 'FINISH' : 'PORTAL'))
}

/** A sign's face: the label in dark letters on gold, or nothing where there is no page to paint it on. */
function signTexture(label: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const paint = canvas.getContext('2d')
  if (paint === null) return null
  paint.fillStyle = '#ffd24a'
  paint.fillRect(0, 0, canvas.width, canvas.height)
  paint.fillStyle = '#1d1a10'
  paint.font = 'bold 96px system-ui, sans-serif'
  paint.textAlign = 'center'
  paint.textBaseline = 'middle'
  paint.fillText(label, canvas.width / 2, canvas.height / 2 + 6)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A part of a gate, and the material it wears as the next gate to head for and as the one after it. */
interface GatePart {
  readonly mesh: THREE.Mesh
  readonly next: THREE.Material
  readonly later: THREE.Material
}

/** One gate: its parts, each with the material it wears as the next gate and as the one after. */
interface Gate {
  readonly group: THREE.Group
  readonly parts: readonly GatePart[]
  readonly geometry: readonly THREE.BufferGeometry[]
  /** Its sign's own paint and face, if it has a sign. */
  readonly sign: { material: THREE.Material; texture: THREE.Texture } | null
  /** Whether it is drawn, as it was last shown: only what changes is written. */
  shown: boolean
}

/** How wide the road under a gate is, or the narrowest a gate gets where no road runs under it. */
function roadWidthAt(world: World, at: Vec3): number {
  let nearest = ROAD_REACH
  let width = 0
  for (const road of world.roads) {
    for (const [index, point] of road.points.entries()) {
      const distance = Math.hypot(point.x - at.x, point.y - at.y, point.z - at.z)
      if (distance >= nearest) continue
      nearest = distance
      width = road.widths[index] ?? ROAD_WIDTH
    }
  }
  return width
}

/** How tall a gate may stand where it is: its full height in the open, less under a roof, but never less than a car. */
function gateHeight(world: World, at: Vec3): number {
  const room = roofOver(world, at) - heightOver(world, at)
  if (!Number.isFinite(room)) return GATE_HEIGHT
  return Math.min(GATE_HEIGHT, Math.max(GATE_LEAST, room - 1))
}

/**
 * Where a gate stands and how wide it is: in the middle of the tunnel it is
 * in, a metre short of its walls, or over the road where it stands in the
 * open.
 */
function gateAcross(world: World, at: Vec3, forward: Vec3): { foot: Vec3; span: number } {
  const corridor = corridorAt(world, at, forward)
  if (corridor === null) return { foot: at, span: Math.max(GATE_SPAN, roadWidthAt(world, at)) + GATE_MARGIN }
  return { foot: corridor.center, span: Math.max(corridor.width - CORRIDOR_CLEARANCE, GATE_NARROWEST) }
}

/** The paints a gate is drawn in: its posts and lintel glowing gold, day or night, its sheet and the shaft over it adding light. */
function makePaints(): Paints {
  const post = (color: number): THREE.Material => new THREE.MeshBasicMaterial({ color })
  const glow = (color: number, opacity: number): THREE.Material =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  return {
    post: { next: post(NEXT_COLOR), later: post(FAINT_COLOR) },
    sheet: { next: glow(NEXT_COLOR, 0.28), later: glow(FAINT_COLOR, 0.1) },
    shaft: { next: glow(NEXT_COLOR, 0.45), later: glow(FAINT_COLOR, 0.15) },
  }
}

/** One gate: two pillars and a lintel over the road, a sign on top saying which gate it is, a sheet of light across it and a shaft above, to be seen from afar. */
function makeGate(paints: Paints, world: World, checkpoint: CheckpointView, label: string): Gate {
  const { at, forward } = checkpoint
  const { foot, span } = gateAcross(world, at, forward)
  const height = gateHeight(world, foot)
  const group = new THREE.Group()
  group.name = 'gate'
  const geometry: THREE.BufferGeometry[] = []
  const parts: GatePart[] = []
  // A part of the gate: its own shape, where it stands on the gate, and the paints it wears.
  const add = (shape: THREE.BufferGeometry, material: { next: THREE.Material; later: THREE.Material }, x: number, y: number, z = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(shape, material.next)
    mesh.position.set(x, y, z)
    group.add(mesh)
    geometry.push(shape)
    parts.push({ mesh, next: material.next, later: material.later })
    return mesh
  }
  const post = new THREE.BoxGeometry(PILLAR, height, PILLAR)
  add(post, paints.post, -span / 2 - PILLAR / 2, height / 2)
  add(post, paints.post, span / 2 + PILLAR / 2, height / 2)
  add(new THREE.BoxGeometry(span + PILLAR * 2, LINTEL, PILLAR), paints.post, 0, height + LINTEL / 2)
  add(new THREE.PlaneGeometry(span, height), paints.sheet, 0, height / 2)
  add(
    new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_HEIGHT, 12, 1, true).translate(0, height + SHAFT_HEIGHT / 2, 0),
    paints.shaft,
    0,
    0,
  )
  const texture = signTexture(label)
  let sign: Gate['sign'] = null
  if (texture !== null) {
    const board = new THREE.PlaneGeometry(span + PILLAR * 2, SIGN_HEIGHT)
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
    const face = new THREE.Mesh(board, material)
    face.position.set(0, height + LINTEL + SIGN_HEIGHT / 2, 0)
    group.add(face)
    geometry.push(board)
    sign = { material, texture }
  }
  standOn(group, foot, forward)
  return { group, parts, geometry, sign, shown: true }
}

/**
 * A race's course through one world, as it is drawn: a gate over the road at
 * every checkpoint, the one to head for next bright and the one after it
 * faint, and the rest, and those already passed, not drawn at all. The gates
 * are meshes of the mode's own, not bodies: nothing is driven into them.
 */
export class RaceView {
  /** The gates, to be put in the mode's root. */
  readonly object = new THREE.Group()

  private readonly gates: Gate[]
  private readonly paints: Paints
  /** The place along the course of the gate last shown as the next one: nothing is written while it is the same. */
  private shownNext = Number.NaN

  /** `finish`: whether this world's last gate is the race's finish, rather than the portal on to the next world. */
  constructor(world: World, checkpoints: readonly CheckpointView[], finish = false) {
    this.paints = makePaints()
    this.object.name = 'race'
    const labels = gateLabels(checkpoints.length, finish)
    this.gates = checkpoints.map((checkpoint, index) => {
      const gate = makeGate(this.paints, world, checkpoint, labels[index]!)
      this.object.add(gate.group)
      return gate
    })
    this.show(0)
  }

  /**
   * Show the gate to head for and the one after it, by their places along
   * the course; nothing where there is no such gate. A negative or past-the-
   * end number, as a racer who has passed them all has, shows nothing. Asked
   * for every frame, it writes nothing while the gate to head for is the
   * same one, and only the gates that change along the course.
   */
  show(next: number): void {
    if (next === this.shownNext) return
    this.shownNext = next
    for (const [index, gate] of this.gates.entries()) {
      const near = index === next
      const shown = near || index === next + 1
      if (gate.shown !== shown) {
        gate.shown = shown
        gate.group.visible = shown
      }
      if (!shown) continue
      for (const part of gate.parts) {
        const paint = near ? part.next : part.later
        if (part.mesh.material !== paint) part.mesh.material = paint
      }
    }
  }

  dispose(): void {
    for (const gate of this.gates) {
      for (const geometry of gate.geometry) geometry.dispose()
      gate.sign?.material.dispose()
      gate.sign?.texture.dispose()
    }
    for (const set of [this.paints.post, this.paints.sheet, this.paints.shaft]) {
      set.next.dispose()
      set.later.dispose()
    }
    this.object.remove(...this.gates.map((gate) => gate.group))
  }
}
