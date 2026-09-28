import { DEFAULT_WORLD_TUNING, restingRideHeight, type VehicleTuning } from '@buggies/game'
import * as THREE from 'three'

import { litByNight, nightAt } from './night.ts'

/** The light of a headlamp, how big a lamp is and its halo, and how far across each other they stand, as a share of the car's width. */
const LAMP_LIGHT = new THREE.Color('#fff1cf')
const LAMP = { radius: 0.13, halo: 0.45, apart: 0.62 } as const
/** The pool the lamps throw on the road ahead: how wide, how long, and how bright at full night. */
const POOL = { width: 7, length: 16, opacity: 0.4 } as const
/**
 * The driver's own beam, a real light on everything ahead: how far it
 * reaches, how wide it spreads, how soft its edge is, how bright it is at
 * full night, and how far ahead it is aimed at the road.
 */
const BEAM = { distance: 90, angle: 0.6, penumbra: 0.55, intensity: 600, aim: 24 } as const

/** A soft pool of light, brightest by the car and across its middle, fading out ahead and to the sides. */
function poolTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const across = (x + 0.5) / size - 0.5
      // v runs from the car, at 0, to the far end of the pool, at 1.
      const v = (y + 0.5) / size
      const spread = 0.18 + 0.22 * v
      const value = Math.exp(-(across * across) / (2 * spread * spread)) * Math.min(v * 6, 1) * (1 - v) ** 1.5
      const at = (y * size + x) * 4
      data[at] = data[at + 1] = data[at + 2] = Math.round(value * 255)
      data[at + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.needsUpdate = true
  return texture
}

/** A glow that shows where it is night: added over what is behind it, its opacity this at full night. */
function nightGlow(color: THREE.Color, opacity: number, map: THREE.Texture | null = null): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  // As dark as it is where each car is, not where the play is.
  material.onBeforeCompile = (shader) => litByNight(shader, 'alpha')
  material.customProgramCacheKey = () => 'night-glow'
  return material
}

/** Below this much night the lamps are not drawn at all, so the day costs nothing for them. */
const LAMPS_FROM = 0.02

/** Every car's lamps share these: the lamps' glow, their halos' and the pool's, as bright as the night is dark. */
let shared: { lamp: THREE.MeshBasicMaterial; halo: THREE.MeshBasicMaterial; pool: THREE.MeshBasicMaterial; square: THREE.PlaneGeometry } | null = null

function sharedParts(): NonNullable<typeof shared> {
  shared ??= {
    lamp: nightGlow(LAMP_LIGHT, 1),
    halo: nightGlow(LAMP_LIGHT, 0.35),
    pool: nightGlow(LAMP_LIGHT, POOL.opacity, poolTexture()),
    // Lying on the ground, facing up.
    square: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  }
  return shared
}

/** A pair of discs this big either side of the nose, facing forward along -Z, as one geometry: one draw for both. */
const pairs = new Map<string, THREE.BufferGeometry>()

function discPair(radius: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const key = `${radius} ${x} ${y} ${z}`
  let pair = pairs.get(key)
  if (pair === undefined) {
    const disc = new THREE.CircleGeometry(radius, 20).rotateY(Math.PI)
    const left = disc.clone().translate(x, y, z)
    const right = disc.translate(-x, y, z)
    pair = new THREE.BufferGeometry()
    const count = left.getAttribute('position').count
    const positions = new Float32Array(count * 6)
    positions.set(left.getAttribute('position').array as Float32Array, 0)
    positions.set(right.getAttribute('position').array as Float32Array, count * 3)
    pair.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const index = left.getIndex()!.array
    const indices = new Uint16Array(index.length * 2)
    for (let i = 0; i < index.length; i++) {
      indices[i] = index[i]!
      indices[index.length + i] = index[i]! + count
    }
    pair.setIndex(new THREE.BufferAttribute(indices, 1))
    left.dispose()
    right.dispose()
    pairs.set(key, pair)
  }
  return pair
}

/**
 * A car's headlights: two lamps on its nose that glow as the night comes on,
 * and the pool of light they throw on the road ahead. The car someone drives
 * from this screen carries a real beam too, lighting whatever is ahead of it.
 * In the chassis's frame: front toward -Z, the chassis's middle at the origin.
 */
export class Headlights {
  readonly object = new THREE.Group()
  private readonly beam: THREE.SpotLight | null

  constructor(tuning: VehicleTuning, beam: boolean) {
    const parts = sharedParts()
    const front = -tuning.chassisHalfLength - 0.04
    const height = -tuning.chassisHalfHeight * 0.15
    const ground = -restingRideHeight(tuning, DEFAULT_WORLD_TUNING.gravity)
    const x = tuning.chassisHalfWidth * LAMP.apart
    this.object.add(
      new THREE.Mesh(discPair(LAMP.radius, x, height, front), parts.lamp),
      new THREE.Mesh(discPair(LAMP.halo, x, height, front - 0.02), parts.halo),
    )
    if (beam) {
      this.beam = new THREE.SpotLight(LAMP_LIGHT, 0, BEAM.distance, BEAM.angle, BEAM.penumbra, 2)
      this.beam.position.set(0, height, front)
      this.beam.target.position.set(0, ground, front - BEAM.aim)
      this.object.add(this.beam, this.beam.target)
    } else {
      // Without a beam of its own, the light on the road ahead is only drawn.
      this.beam = null
      const pool = new THREE.Mesh(parts.square, parts.pool)
      pool.scale.set(POOL.width, 1, POOL.length)
      pool.position.set(0, ground + 0.06, front - POOL.length / 2)
      this.object.add(pool)
    }
    for (const mesh of this.object.children) {
      mesh.castShadow = false
      mesh.receiveShadow = false
    }
  }

  /** As bright as the night is dark where the car is; out once it is wrecked, and not drawn at all by day. */
  update(wrecked: boolean, at: { x: number; y: number; z: number }): void {
    const night = nightAt(at)
    const on = !wrecked && night > LAMPS_FROM
    // The beam stays in the scene, only dimmed, so the count of lights, and so every shader, stays as it was.
    for (const child of this.object.children) if (child !== this.beam && child !== this.beam?.target) child.visible = on
    if (this.beam !== null) this.beam.intensity = on ? night * BEAM.intensity : 0
  }

  dispose(): void {
    this.beam?.dispose()
    this.object.removeFromParent()
  }
}
