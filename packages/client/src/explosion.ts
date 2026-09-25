import type { Vec3 } from '@buggies/physics'
import * as THREE from 'three'

/** How many pieces a car comes apart into. */
const PIECES = 48
/** How long a burst is on screen, in seconds. */
const LIFE = 2.4
/** How fast the pieces leave, in m/s, and how hard they fall. */
const SPEED = 19
const GRAVITY = 18
/** The fireball's size at its biggest, and how long it takes to get there. */
const FLASH_RADIUS = 9
const FLASH_TIME = 0.5
/** A second, slower ball of fire and smoke that hangs after the flash. */
const CLOUD_RADIUS = 6
const CLOUD_TIME = 1.6

/** A shockwave's ring: how long it takes to reach its full size and fade out, and how wide its band is, as a share of its radius. */
const SHOCK_TIME = 0.5
const SHOCK_BAND = 0.2
const SHOCK = new THREE.Color('#bfe8ff')

const FIRE = new THREE.Color('#ff9a2e')
const SMOKE = new THREE.Color('#2b2622')
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

interface Burst {
  group: THREE.Group
  pieces: THREE.Mesh[]
  velocities: THREE.Vector3[]
  spins: THREE.Vector3[]
  flash: THREE.Mesh
  cloud: THREE.Mesh
  pieceMaterial: THREE.MeshStandardMaterial
  flashMaterial: THREE.MeshBasicMaterial
  cloudMaterial: THREE.MeshBasicMaterial
  age: number
}

interface Shock {
  ring: THREE.Mesh
  material: THREE.MeshBasicMaterial
  radius: number
  age: number
}

/**
 * Cars blowing up: a flash, a ball of fire that rises and turns to smoke, and
 * a spray of burning pieces that fly out, fall, and go dark. Shockwaves: a
 * ring flat around the car, racing out to the wave's reach and fading. All
 * purely for show; what they do is the simulation's.
 */
export class Explosions {
  readonly object = new THREE.Group()

  private bursts: Burst[] = []
  private shocks: Shock[] = []
  private readonly band = new THREE.RingGeometry(1 - SHOCK_BAND, 1, 64).rotateX(-Math.PI / 2)
  private readonly piece = new THREE.BoxGeometry(0.5, 0.35, 0.5)
  private readonly ball = new THREE.SphereGeometry(1, 14, 10)

  burst(at: Vec3): void {
    const group = new THREE.Group()
    group.position.set(at.x, at.y, at.z)
    const pieceMaterial = new THREE.MeshStandardMaterial({
      color: FIRE,
      emissive: FIRE,
      emissiveIntensity: 1.2,
      roughness: 0.8,
      transparent: true,
    })
    const flashMaterial = new THREE.MeshBasicMaterial({ color: FIRE, transparent: true, opacity: 0.9 })
    const pieces: THREE.Mesh[] = []
    const velocities: THREE.Vector3[] = []
    const spins: THREE.Vector3[] = []
    // Pieces leave along a sunflower of directions, so the spray is even
    // without a random number in sight.
    for (let i = 0; i < PIECES; i++) {
      const y = 0.15 + (0.85 * (i + 0.5)) / PIECES
      const r = Math.sqrt(1 - y * y)
      const angle = i * GOLDEN_ANGLE
      const speed = SPEED * (0.6 + (0.4 * ((i * 7) % PIECES)) / PIECES)
      const mesh = new THREE.Mesh(this.piece, pieceMaterial)
      mesh.castShadow = true
      group.add(mesh)
      pieces.push(mesh)
      velocities.push(new THREE.Vector3(Math.cos(angle) * r * speed, y * speed, Math.sin(angle) * r * speed))
      spins.push(new THREE.Vector3(Math.sin(angle) * 9, Math.cos(angle * 2) * 7, Math.cos(angle) * 9))
    }
    const flash = new THREE.Mesh(this.ball, flashMaterial)
    flash.scale.setScalar(0.5)
    group.add(flash)
    const cloudMaterial = new THREE.MeshBasicMaterial({ color: FIRE, transparent: true, opacity: 0.7, depthWrite: false })
    const cloud = new THREE.Mesh(this.ball, cloudMaterial)
    cloud.scale.setScalar(1)
    cloud.position.y = 1
    group.add(cloud)
    this.object.add(group)
    this.bursts.push({ group, pieces, velocities, spins, flash, cloud, pieceMaterial, flashMaterial, cloudMaterial, age: 0 })
  }

  /** A shockwave going off here, out to this far. */
  shockwave(at: Vec3, radius: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: SHOCK,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const ring = new THREE.Mesh(this.band, material)
    ring.position.set(at.x, at.y, at.z)
    ring.scale.setScalar(1)
    this.object.add(ring)
    this.shocks.push({ ring, material, radius, age: 0 })
  }

  update(dt: number): void {
    this.updateShocks(dt)
    const alive: Burst[] = []
    for (const burst of this.bursts) {
      burst.age += dt
      const life = burst.age / LIFE
      if (life >= 1) {
        this.remove(burst)
        continue
      }
      alive.push(burst)
      // The velocities and spins were made alongside the pieces, one each.
      for (const [i, mesh] of burst.pieces.entries()) {
        const velocity = burst.velocities[i]!
        const spin = burst.spins[i]!
        velocity.y -= GRAVITY * dt
        mesh.position.addScaledVector(velocity, dt)
        mesh.rotation.x += spin.x * dt
        mesh.rotation.y += spin.y * dt
        mesh.rotation.z += spin.z * dt
      }
      burst.pieceMaterial.color.copy(FIRE).lerp(SMOKE, Math.min(life * 1.6, 1))
      burst.pieceMaterial.emissiveIntensity = Math.max(1.2 - life * 2, 0)
      burst.pieceMaterial.opacity = 1 - life * life
      const swell = Math.min(burst.age / FLASH_TIME, 1)
      burst.flash.scale.setScalar(0.5 + FLASH_RADIUS * swell)
      burst.flashMaterial.opacity = 0.9 * (1 - swell) * (1 - swell)
      // The cloud grows more slowly, rises, and goes from fire to smoke as it thins.
      const bloom = Math.min(burst.age / CLOUD_TIME, 1)
      burst.cloud.scale.setScalar(1 + CLOUD_RADIUS * Math.sqrt(bloom))
      burst.cloud.position.y = 1 + 4 * bloom
      burst.cloudMaterial.color.copy(FIRE).lerp(SMOKE, Math.min(bloom * 1.4, 1))
      burst.cloudMaterial.opacity = 0.7 * (1 - bloom) * (1 - bloom)
    }
    this.bursts = alive
  }

  /** Each ring races out, quickly at first, and fades as it goes. */
  private updateShocks(dt: number): void {
    const alive: Shock[] = []
    for (const shock of this.shocks) {
      shock.age += dt
      const t = shock.age / SHOCK_TIME
      if (t >= 1) {
        shock.ring.removeFromParent()
        shock.material.dispose()
        continue
      }
      alive.push(shock)
      shock.ring.scale.setScalar(1 + (shock.radius - 1) * (1 - (1 - t) ** 3))
      shock.material.opacity = 0.85 * (1 - t) * (1 - t)
    }
    this.shocks = alive
  }

  dispose(): void {
    for (const burst of this.bursts) this.remove(burst)
    this.bursts.length = 0
    for (const shock of this.shocks) {
      shock.ring.removeFromParent()
      shock.material.dispose()
    }
    this.shocks.length = 0
    this.band.dispose()
    this.object.removeFromParent()
    this.piece.dispose()
    this.ball.dispose()
  }

  private remove(burst: Burst): void {
    burst.group.removeFromParent()
    burst.group.clear()
    burst.pieceMaterial.dispose()
    burst.flashMaterial.dispose()
    burst.cloudMaterial.dispose()
  }
}
