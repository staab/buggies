import { PROP_SHAPES, type ArenaProp } from '@buggies/game'
import type { PropKind } from '@buggies/terrain'
import * as THREE from 'three'
import { disposeObject } from './dispose.ts'

/** Where the props are: an arena, or a mirror of one. */
export interface PropSource {
  readonly props: readonly ArenaProp[]
}

const PROP_COLORS: Readonly<Record<PropKind, THREE.Color>> = {
  crate: new THREE.Color('#a8763e'),
  barrel: new THREE.Color('#2f5f9e'),
  cone: new THREE.Color('#f07a1a'),
  bale: new THREE.Color('#d9b45a'),
}

/** The model of each kind of prop, a unit of its shape, scaled to its size when drawn. */
function geometryFor(kind: PropKind): THREE.BufferGeometry {
  const shape = PROP_SHAPES[kind]
  switch (shape.shape) {
    case 'box':
      return new THREE.BoxGeometry(shape.halfWidth * 2, shape.halfHeight * 2, shape.halfDepth * 2)
    case 'drum':
      return new THREE.CylinderGeometry(shape.halfWidth, shape.halfWidth, shape.halfHeight * 2, 14)
    default:
      return new THREE.ConeGeometry(shape.halfWidth, shape.halfHeight * 2, 12)
  }
}

const KINDS: readonly PropKind[] = ['crate', 'barrel', 'cone', 'bale']
const position = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const one = new THREE.Vector3(1, 1, 1)
const matrix = new THREE.Matrix4()

/**
 * The props of an island, drawn where the simulation has them each frame:
 * one instanced mesh a kind, every instance following its body, so a cone
 * a car has scattered is seen where it landed and a barrel where it rolled.
 */
export class PropsView {
  readonly object = new THREE.Group()
  private readonly source: PropSource
  private readonly meshes = new Map<PropKind, { mesh: THREE.InstancedMesh; props: ArenaProp[] }>()

  constructor(source: PropSource) {
    this.source = source
    for (const kind of KINDS) {
      const props = source.props.filter((prop) => prop.kind === kind)
      if (props.length === 0) continue
      const material = new THREE.MeshStandardMaterial({ color: PROP_COLORS[kind], roughness: 0.8, metalness: kind === 'barrel' ? 0.3 : 0.05 })
      const mesh = new THREE.InstancedMesh(geometryFor(kind), material, props.length)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.meshes.set(kind, { mesh, props })
      this.object.add(mesh)
    }
    this.update()
  }

  /** How many props are drawn. */
  get drawn(): number {
    let count = 0
    for (const { props } of this.meshes.values()) count += props.length
    return count
  }

  /** Every instance to where its body is. */
  update(): void {
    for (const { mesh, props } of this.meshes.values()) {
      for (const [i, prop] of props.entries()) {
        const at = prop.body.translation()
        const turn = prop.body.rotation()
        position.set(at.x, at.y, at.z)
        rotation.set(turn.x, turn.y, turn.z, turn.w)
        mesh.setMatrixAt(i, matrix.compose(position, rotation, one))
      }
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  dispose(): void {
    for (const { mesh } of this.meshes.values()) disposeObject(mesh)
    this.meshes.clear()
    this.object.removeFromParent()
    this.object.clear()
  }
}
