import {
  FLAT,
  createChartFrame,
  shapeFrame,
  shapeToChart,
  shapeToWorld,
  shapeUp,
  type WorldShape,
} from '@buggies/physics'
import * as THREE from 'three'

// What is drawn where the map has it, drawn where that is in the world: on
// the flat, just where the map has it; on a planet, carried round onto the
// sphere, stood upright there, and scaled as the map is there.

const frame = createChartFrame()
const point = { x: 0, y: 0, z: 0 }
const basis = new THREE.Matrix4()

/** A world's shape, for the drawing: the map's points in the world, and the world's back on the map. */
export class Globe {
  readonly shape: WorldShape

  constructor(shape: WorldShape = FLAT) {
    this.shape = shape
  }

  get round(): boolean {
    return this.shape.kind === 'planet'
  }

  /** A map point, this high over the map's ground, in the world. */
  toWorld(x: number, height: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    shapeToWorld(this.shape, x, height, z, point)
    return out.set(point.x, point.y, point.z)
  }

  /** A world point on the map: across, how high, and down. */
  toMap(at: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
    shapeToChart(this.shape, at, point)
    return out.set(point.x, point.y, point.z)
  }

  /** The way up at a world point. */
  upAt(at: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
    shapeUp(this.shape, at, point)
    return out.set(point.x, point.y, point.z)
  }

  /** The turn that stands the map's axes upright on the world at a map point, and how the map is scaled there. */
  standing(x: number, z: number, out: THREE.Quaternion): number {
    shapeFrame(this.shape, x, z, frame)
    if (this.shape.kind === 'flat') {
      out.identity()
      return 1
    }
    const { east, up, south } = frame
    basis.makeBasis(new THREE.Vector3(east.x, east.y, east.z), new THREE.Vector3(up.x, up.y, up.z), new THREE.Vector3(south.x, south.y, south.z))
    out.setFromRotationMatrix(basis)
    return frame.scale
  }

  /**
   * Put a thing where the map has it: at the map point `at`, turned by
   * `turn` about the map's own axes, as the world has it there. A thing, a
   * robot or a saucer, is its own size anywhere, however the map is scaled.
   */
  place(object: THREE.Object3D, at: THREE.Vector3, turn: THREE.Quaternion): void {
    if (!this.round) {
      object.position.copy(at)
      object.quaternion.copy(turn)
      return
    }
    this.standing(at.x, at.z, object.quaternion)
    object.quaternion.multiply(turn)
    this.toWorld(at.x, at.y, at.z, object.position)
  }

  /**
   * A map matrix, as the world has it: its translation carried round, its
   * turn stood upright, and its scale scaled as the map is there, or left
   * as it is for a thing the size it is anywhere, as a banana is.
   */
  bendMatrix(matrix: THREE.Matrix4, out: THREE.Matrix4, withMap = true): THREE.Matrix4 {
    if (!this.round) return out.copy(matrix)
    matrix.decompose(position, rotation, scaling)
    const k = this.standing(position.x, position.z, standingTurn)
    this.toWorld(position.x, position.y, position.z, position)
    return out.compose(position, standingTurn.multiply(rotation), withMap ? scaling.multiplyScalar(k) : scaling)
  }

  /**
   * Bend everything under a root laid out on the map onto the world: every
   * mesh's own points, and every instance of an instanced one placed whole,
   * upright and scaled where it stands. A node marked `whole` is placed
   * whole, as an instance is, and what is under it is left as it is, free to
   * move within it. Nothing is done on the flat.
   */
  bendAll(root: THREE.Object3D): void {
    if (!this.round) return
    root.updateMatrixWorld(true)
    const meshes: THREE.Object3D[] = []
    const wholes: THREE.Object3D[] = []
    const within = (node: THREE.Object3D): boolean => node.parent !== null && node !== root && (wholes.includes(node.parent) || within(node.parent))
    root.traverse((node) => {
      if (within(node)) return
      if (node.userData.whole === true) wholes.push(node)
      else if (node instanceof THREE.InstancedMesh || node instanceof THREE.Mesh || node instanceof THREE.Line) meshes.push(node)
    })
    for (const node of wholes) {
      const parent = node.parent === null ? new THREE.Matrix4() : node.parent.matrixWorld.clone().invert()
      node.matrix.copy(parent.multiply(this.bendMatrix(node.matrixWorld, instance)))
      node.matrixAutoUpdate = false
    }
    for (const node of meshes) {
      if (node instanceof THREE.InstancedMesh) this.bendInstances(node)
      else this.bendPoints(node as THREE.Mesh | THREE.Line)
    }
  }

  /** Every instance of an instanced mesh put where it stands on the world. */
  bendInstances(mesh: THREE.InstancedMesh): void {
    if (!this.round) return
    const own = mesh.matrixWorld.clone()
    mesh.position.set(0, 0, 0)
    mesh.quaternion.identity()
    mesh.scale.set(1, 1, 1)
    mesh.updateMatrix()
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, instance)
      instance.premultiply(own)
      mesh.setMatrixAt(i, this.bendMatrix(instance, instance))
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.computeBoundingBox()
  }

  /** A mesh's or a line's points, carried where its own transform put them on the map, onto the world. */
  bendPoints(node: THREE.Mesh | THREE.Line): void {
    if (!this.round) return
    const geometry = node.geometry.clone()
    geometry.applyMatrix4(node.matrixWorld)
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < positions.count; i++) {
      this.toWorld(positions.getX(i), positions.getY(i), positions.getZ(i), position)
      positions.setXYZ(i, position.x, position.y, position.z)
    }
    positions.needsUpdate = true
    if (node instanceof THREE.Mesh) geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
    node.geometry.dispose()
    node.geometry = geometry
    node.position.set(0, 0, 0)
    node.quaternion.identity()
    node.scale.set(1, 1, 1)
    node.updateMatrix()
    // Its parents' transforms are baked in: the mesh stands on its own under them from here.
    if (node.parent !== null) {
      node.parent.updateMatrixWorld(true)
      node.applyMatrix4(node.parent.matrixWorld.clone().invert())
    }
  }
}

const position = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const scaling = new THREE.Vector3()
const standingTurn = new THREE.Quaternion()
const instance = new THREE.Matrix4()

/** No turn at all: a thing stood as it stands on the map. */
export const UPRIGHT = new THREE.Quaternion()

/** The flat world, for whatever has no other. */
export const FLAT_GLOBE = new Globe(FLAT)
