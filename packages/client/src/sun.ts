import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

/** Where the light comes from: up and a little to one side, as at mid-morning. */
export const SUN_DIRECTION = new THREE.Vector3(-300, 500, 200).normalize()

/** How far off the disc is drawn, in meters: beyond the island, short of the far plane. */
export const SUN_DISTANCE = 5000

/** The disc's radius at that distance, and its glow's. */
const DISC_RADIUS = 170
const GLOW_RADIUS = 420

/**
 * How much ground the shadows cover around the car, in meters each way.
 * Further than this, the light falls with no shadow, which the fog and the
 * distance hide.
 */
export const SHADOW_REACH = 130

/** How far up the light the shadow camera stands, and how far it sees. */
const SHADOW_STANDOFF = 500
const SHADOW_DEPTH = 1200

/**
 * The sun: a directional light that casts shadows over the ground around
 * whoever is playing, and a bright disc in the sky to look at, along the
 * same line. The light's shadow frustum is small, for sharpness, so it is
 * moved to follow the car each frame.
 */
export class Sun {
  readonly object = new THREE.Group()
  readonly light: THREE.DirectionalLight
  readonly sky: THREE.HemisphereLight

  private readonly disc: THREE.Mesh
  private readonly glow: THREE.Mesh
  private readonly focus = new THREE.Vector3()

  constructor(center: Vec3 = { x: 0, y: 0, z: 0 }) {
    this.sky = new THREE.HemisphereLight('#cfe6ff', '#4a5a3a', 0.9)
    this.light = new THREE.DirectionalLight('#fff4e0', 1.6)
    this.light.castShadow = true
    this.light.shadow.mapSize.set(2048, 2048)
    this.light.shadow.camera.left = -SHADOW_REACH
    this.light.shadow.camera.right = SHADOW_REACH
    this.light.shadow.camera.top = SHADOW_REACH
    this.light.shadow.camera.bottom = -SHADOW_REACH
    this.light.shadow.camera.near = 1
    this.light.shadow.camera.far = SHADOW_DEPTH
    this.light.shadow.bias = -0.0004
    this.light.shadow.normalBias = 0.6
    this.object.add(this.sky, this.light, this.light.target)

    // The disc and its glow, far off along the light and fixed there: the fog
    // is told to leave them alone, or they would be lost in it.
    const discMaterial = new THREE.MeshBasicMaterial({ color: '#fff6d0', fog: false })
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(DISC_RADIUS, 48), discMaterial)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: '#ffe9a8',
      fog: false,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    })
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(GLOW_RADIUS, 48), glowMaterial)
    for (const face of [this.glow, this.disc]) {
      face.frustumCulled = false
      this.object.add(face)
    }
    this.centerOn(center)
    this.follow(center)
  }

  /** Where the disc is drawn. */
  get position(): THREE.Vector3 {
    return this.disc.position
  }

  /** Hang the disc over the middle of an island, so it stands the same way from every corner of it. */
  centerOn(center: Vec3): void {
    for (const face of [this.glow, this.disc]) {
      face.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE).add(center as THREE.Vector3Like)
      face.lookAt(center.x, center.y, center.z)
    }
  }

  /** Bring the shadows to where the action is. */
  follow(at: Vec3): void {
    this.focus.set(at.x, at.y, at.z)
    this.light.target.position.copy(this.focus)
    this.light.position.copy(SUN_DIRECTION).multiplyScalar(SHADOW_STANDOFF).add(this.focus)
    this.light.target.updateMatrixWorld()
  }

  dispose(): void {
    this.light.dispose()
    this.sky.dispose()
    for (const face of [this.disc, this.glow]) {
      face.geometry.dispose()
      ;(face.material as THREE.Material).dispose()
    }
    this.object.removeFromParent()
    this.object.clear()
  }
}
