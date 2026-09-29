import type { Vec3 } from '@buggies/physics'
import { sunDirection } from '@buggies/game'
import * as THREE from 'three'

import { DUSK, setSunWay } from './night.ts'

/** Where the light comes from before the planet has turned at all. */
export const SUN_DIRECTION = new THREE.Vector3(-300, 500, 200).normalize()

/** The sky by day, at sunset and sunrise, and by night. */
const DAY_SKY = new THREE.Color('#a9cbe6')
const DUSK_SKY = new THREE.Color('#c8452a')
const NIGHT_SKY = new THREE.Color('#000000')
/** How much of the day there is when the sky is reddest, between the night's black and the day's blue. */
const REDDEST = 0.45
const SPACE = new THREE.Color('#000000')
/**
 * How bright the sun's light is, and the sky's: the same all round the
 * planet, which is lit only on the side facing the sun, the sky's light from
 * that side and the dark of the night from the other.
 */
const SUN_LIGHT = 1.6
const SKY_LIGHT = 0.75

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
  /** The way to the sun from the planet's middle, as it has turned. */
  private readonly direction = SUN_DIRECTION.clone()
  private readonly center = new THREE.Vector3()
  private readonly turned = { x: 0, y: 0, z: 0 }
  /** How much of the day there is where the play is, from none at night to all of it. */
  private daylight = 1

  private readonly disc: THREE.Mesh
  private readonly glow: THREE.Mesh
  private readonly focus = new THREE.Vector3()

  constructor(center: Vec3 = { x: 0, y: 0, z: 0 }) {
    // The sky's light from the sun's side of the planet, and the dark of the night side from the other.
    this.sky = new THREE.HemisphereLight('#cfe6ff', '#141c36', SKY_LIGHT)
    this.light = new THREE.DirectionalLight('#fff4e0', SUN_LIGHT)
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
    // Out in the sky, far off any planet: not bent with what is drawn round the car.
    discMaterial.userData.bent = true
    glowMaterial.userData.bent = true
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

  /** Hang the disc over the middle of a planet, so it stands the same way from all round it. */
  centerOn(center: Vec3): void {
    this.center.set(center.x, center.y, center.z)
    this.place()
  }

  /**
   * Turn the planet under the sun to where it is this many seconds into
   * the game, so day and night go round it, and light the whole of it from
   * there: its day side lit and its night side dark.
   */
  turn(seconds: number): void {
    const way = sunDirection(seconds, this.turned)
    this.direction.set(way.x, way.y, way.z)
    this.place()
    this.follow(this.center)
  }

  /**
   * Bring the shadows to where the action is, and, with the way up there,
   * say how much of the day there is overhead, for the sky and the sun's
   * disc. The light is as strong wherever the play is: each point of the
   * planet is lit as the sun stands over its own horizon.
   */
  follow(at: Vec3, up?: Vec3): void {
    this.focus.set(at.x, at.y, at.z)
    this.light.target.position.copy(this.focus)
    this.light.position.copy(this.direction).multiplyScalar(SHADOW_STANDOFF).add(this.focus)
    this.light.target.updateMatrixWorld()
    this.sky.position.copy(this.direction)
    // How much of the day there is where the play is: for the sky overhead, not for how anything is lit.
    const elevation = up === undefined ? 1 : this.direction.x * up.x + this.direction.y * up.y + this.direction.z * up.z
    this.daylight = THREE.MathUtils.smoothstep(elevation, DUSK.below, DUSK.above)
    // With the sun set here, its light reaches nothing the shadows cover: they are not drawn again until it rises.
    // Kept rather than turned off, since turning them off would compile every shader afresh.
    this.light.shadow.autoUpdate = this.daylight > 0
    // Set, the disc is under the horizon.
    this.disc.visible = this.glow.visible = this.daylight > 0
  }

  /**
   * Colour the sky, and the haze over the distance, by how much of the day there is where the play is: blue by
   * day, red near the line between day and night, and black by night; over an airless moon, black by day as by night.
   */
  shade(scene: THREE.Scene, airless = false): void {
    const sky = scene.background instanceof THREE.Color ? scene.background : (scene.background = new THREE.Color())
    if (airless) sky.copy(SPACE)
    else if (this.daylight < REDDEST) sky.lerpColors(NIGHT_SKY, DUSK_SKY, this.daylight / REDDEST)
    else sky.lerpColors(DUSK_SKY, DAY_SKY, (this.daylight - REDDEST) / (1 - REDDEST))
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(sky)
  }

  /** The disc and its glow, out along the way to the sun from the planet's middle, facing it. */
  private place(): void {
    setSunWay(this.direction)
    for (const face of [this.glow, this.disc]) {
      face.position.copy(this.direction).multiplyScalar(SUN_DISTANCE).add(this.center)
      face.lookAt(this.center)
    }
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
