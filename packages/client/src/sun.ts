import { sunDirection } from '@buggies/game'
import { createRng, randomRange, type Vec3 } from '@buggies/physics'
import * as THREE from 'three'

/** Where the light comes from as the game starts: up and a little to one side, as at mid-morning. */
export const SUN_DIRECTION = new THREE.Vector3().copy(sunDirection(0) as THREE.Vector3Like)

/** The sky by day and by night, and how far the sun is below the horizon, and above it, as day turns to night and back. */
const DAY_SKY = new THREE.Color('#a9cbe6')
const NIGHT_SKY = new THREE.Color('#0b1326')
const SPACE = new THREE.Color('#020308')
const DUSK = { below: -0.1, above: 0.15 } as const
/** How bright the sun's light is by day, and the sky's light, by day and at the least by night. */
const SUN_LIGHT = 1.6
const SKY_LIGHT = { day: 0.9, night: 0.28 } as const
/** How many stars come out at night, and how far off they are drawn. */
const STARS = 1400
const STAR_DISTANCE = 4600

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
  private readonly stars: THREE.Points
  private readonly focus = new THREE.Vector3()
  /** The way to the sun, as the day has gone, and the middle of the island it crosses. */
  private readonly direction = SUN_DIRECTION.clone()
  private readonly center = new THREE.Vector3()
  private readonly turned = { x: 0, y: 0, z: 0 }
  /** How much of the day there is, from none at night to all of it. */
  private daylight = 1
  /** Whether there is no air to light up: the sky black and the stars out by day as well as by night. */
  airless = false

  constructor(center: Vec3 = { x: 0, y: 0, z: 0 }) {
    this.sky = new THREE.HemisphereLight('#cfe6ff', '#4a5a3a', SKY_LIGHT.day)
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
    for (const face of [this.glow, this.disc]) {
      face.frustumCulled = false
      this.object.add(face)
    }
    this.stars = buildStars()
    this.object.add(this.stars)
    this.centerOn(center)
    this.follow(center)
  }

  /** Where the disc is drawn. */
  get position(): THREE.Vector3 {
    return this.disc.position
  }

  /** How much of the day there is, from none at night to all of it. */
  get day(): number {
    return this.daylight
  }

  /** Hang the disc over the middle of an island, so it stands the same way from every corner of it. */
  centerOn(center: Vec3): void {
    this.center.set(center.x, center.y, center.z)
    this.stars.position.copy(this.center)
    this.place()
  }

  /**
   * Move the sun to where it is this many seconds into the game, so day
   * turns to night and back, and light the island from there: bright by
   * day, dim under the stars by night, and reddening between.
   */
  turn(seconds: number): void {
    const way = sunDirection(seconds, this.turned)
    this.direction.set(way.x, way.y, way.z)
    this.daylight = THREE.MathUtils.smoothstep(this.direction.y, DUSK.below, DUSK.above)
    this.light.intensity = SUN_LIGHT * this.daylight
    this.sky.intensity = SKY_LIGHT.night + (SKY_LIGHT.day - SKY_LIGHT.night) * this.daylight
    // Set, the disc is under the horizon; the stars come out as it goes.
    this.disc.visible = this.glow.visible = this.direction.y > DUSK.below
    const dark = this.airless ? 0 : this.daylight
    ;(this.stars.material as THREE.PointsMaterial).opacity = 1 - dark
    this.stars.visible = dark < 1
    this.place()
    this.follow(this.focus)
  }

  /** Colour the sky, and the haze over the distance, by how much of the day there is. */
  shade(scene: THREE.Scene): void {
    const sky = scene.background instanceof THREE.Color ? scene.background : (scene.background = new THREE.Color())
    if (this.airless) sky.copy(SPACE)
    else sky.copy(NIGHT_SKY).lerp(DAY_SKY, this.daylight)
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(sky)
  }

  /** Bring the shadows to where the action is. */
  follow(at: Vec3): void {
    this.focus.set(at.x, at.y, at.z)
    this.light.target.position.copy(this.focus)
    this.light.position.copy(this.direction).multiplyScalar(SHADOW_STANDOFF).add(this.focus)
    this.light.target.updateMatrixWorld()
  }

  /** The disc and its glow, far off along the way to the sun from the middle of the island, facing it. */
  private place(): void {
    for (const face of [this.glow, this.disc]) {
      face.position.copy(this.direction).multiplyScalar(SUN_DISTANCE).add(this.center)
      face.lookAt(this.center)
    }
  }

  dispose(): void {
    this.light.dispose()
    this.sky.dispose()
    this.stars.geometry.dispose()
    ;(this.stars.material as THREE.Material).dispose()
    for (const face of [this.disc, this.glow]) {
      face.geometry.dispose()
      ;(face.material as THREE.Material).dispose()
    }
    this.object.removeFromParent()
    this.object.clear()
  }
}

/** The stars, scattered over the sky's dome, the same every night. */
function buildStars(): THREE.Points {
  const rng = createRng(0x57a25)
  const positions = new Float32Array(STARS * 3)
  for (let k = 0; k < STARS; k++) {
    const around = randomRange(rng, 0, Math.PI * 2)
    // Evenly over the dome, down to a little under the horizon.
    const up = randomRange(rng, -0.05, 1)
    const across = Math.sqrt(1 - up * up)
    positions[k * 3] = Math.cos(around) * across * STAR_DISTANCE
    positions[k * 3 + 1] = up * STAR_DISTANCE
    positions[k * 3 + 2] = Math.sin(around) * across * STAR_DISTANCE
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })
  const stars = new THREE.Points(geometry, material)
  stars.frustumCulled = false
  stars.visible = false
  return stars
}
