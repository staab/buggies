import type { WorldMesh } from '@buggies/terrain'
import * as THREE from 'three'

/** A mesh of the world's, with its normals worked out, for drawing. */
export function meshGeometry(mesh: WorldMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3))
  geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1))
  geometry.computeVertexNormals()
  return geometry
}
