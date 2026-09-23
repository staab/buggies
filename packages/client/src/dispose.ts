import * as THREE from 'three'

/**
 * Let go of everything a tree of objects holds on the GPU: every geometry
 * and material under it, and any texture a material maps. Shared
 * geometries are freed once, however many meshes had them.
 */
export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Line) && !(node instanceof THREE.Points)) return
    geometries.add(node.geometry)
    if (Array.isArray(node.material)) node.material.forEach((entry) => materials.add(entry))
    else materials.add(node.material)
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => {
    if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose()
    material.dispose()
  })
}
