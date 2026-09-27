import { tangentFrame } from '@buggies/terrain'
import * as THREE from 'three'

// Things are drawn where they are on the planet, upright on the way up
// there, away from its middle.

const up = new THREE.Vector3()
const along = new THREE.Vector3()
const right = new THREE.Vector3()
const back = new THREE.Vector3()
const basis = new THREE.Matrix4()

/** The way up at a point. */
export function upAt(at: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
  return out.set(at.x, at.y, at.z).normalize()
}

/** A point this far up from another, into `out`. */
export function lifted(at: { x: number; y: number; z: number }, rise: number, out: THREE.Vector3): THREE.Vector3 {
  upAt(at, up)
  return out.set(at.x + up.x * rise, at.y + up.y * rise, at.z + up.z * rise)
}

/**
 * Stand a model at a point, upright on the way up there and facing along
 * `forward`, its own -z, as a car faces: or facing east, with no way given.
 */
export function standOn(object: THREE.Object3D, at: { x: number; y: number; z: number }, forward?: { x: number; y: number; z: number }): void {
  object.position.set(at.x, at.y, at.z)
  upAt(at, up)
  if (forward === undefined) along.copy(tangentFrame(up).east as THREE.Vector3Like)
  else along.set(forward.x, forward.y, forward.z)
  along.addScaledVector(up, -along.dot(up))
  if (along.lengthSq() < 1e-12) along.copy(tangentFrame(up).east as THREE.Vector3Like)
  along.normalize()
  right.crossVectors(along, up)
  back.copy(along).negate()
  basis.makeBasis(right, up, back)
  object.quaternion.setFromRotationMatrix(basis)
}

/** The turn that stands a thing upright at a point, its x east and its y the way up. */
export function uprightAt(at: { x: number; y: number; z: number }, out: THREE.Quaternion): THREE.Quaternion {
  upAt(at, up)
  along.copy(tangentFrame(up).east as THREE.Vector3Like)
  back.crossVectors(along, up)
  basis.makeBasis(along, up, back)
  return out.setFromRotationMatrix(basis)
}
