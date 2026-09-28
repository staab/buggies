import { CLOUD_HEIGHT } from '@buggies/game'
import { createRng, randomInt, randomRange } from '@buggies/physics'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

/** How many clouds float over each square kilometer, and how many puffs each is made of. */
const CLOUDS_PER_KM2 = 4
const PUFFS = { min: 5, max: 9 } as const
/** How big a puff is across, how flat, and how far from its cloud's middle it may drift. */
const PUFF_RADIUS = { min: 7, max: 14 } as const
const PUFF_FLATNESS = 0.45
const PUFF_SPREAD = 22
/** How far above or below the cloud height a cloud floats. */
const CLOUD_RISE = { min: -8, max: 12 } as const
/** How far past the island's edges the clouds reach, as a share of its width. */
const CLOUD_MARGIN = 0.25
/** How fast the wind carries them, in m/s, and which way. */
const WIND_SPEED = 4
const WIND = new THREE.Vector2(0.8, 0.6)
const CLOUD_SALT = 0xc10d

interface Cloud {
  /** Where its middle starts, and each of its puffs about that. */
  readonly x: number
  readonly z: number
  readonly puffs: readonly THREE.Matrix4[]
}

/**
 * The clouds over an island: puffs of white, flattened and see-through,
 * gathered into clouds scattered over it and out past its shores, high over
 * the land, all carried the same way by the wind and coming round again on
 * the far side when they drift off. Where they are is the island's seed's,
 * and when, the game's time, so everyone sees the same sky.
 */
export function buildClouds(map: TerrainMap): THREE.Object3D {
  const rng = createRng((map.seed ^ CLOUD_SALT) >>> 0)
  const extent = map.size * map.cellSize
  const margin = extent * CLOUD_MARGIN
  const span = extent + margin * 2
  const count = Math.round((span / 1000) ** 2 * CLOUDS_PER_KM2)
  const clouds: Cloud[] = []
  let total = 0
  const basis = new THREE.Matrix4()
  for (let k = 0; k < count; k++) {
    const x = randomRange(rng, -margin, extent + margin)
    const z = randomRange(rng, -margin, extent + margin)
    const height = map.seaLevel + CLOUD_HEIGHT + randomRange(rng, CLOUD_RISE.min, CLOUD_RISE.max)
    const puffs: THREE.Matrix4[] = []
    for (let n = randomInt(rng, PUFFS.min, PUFFS.max); n > 0; n--) {
      const radius = randomRange(rng, PUFF_RADIUS.min, PUFF_RADIUS.max)
      const across = randomRange(rng, -PUFF_SPREAD, PUFF_SPREAD)
      const along = randomRange(rng, -PUFF_SPREAD, PUFF_SPREAD) * 0.6
      const lift = randomRange(rng, 0, radius * 0.4)
      // Flat, and wide across.
      basis.makeScale(radius, radius * PUFF_FLATNESS, radius).setPosition(across, height + lift, along)
      puffs.push(basis.clone())
    }
    total += puffs.length
    clouds.push({ x, z, puffs })
  }
  const material = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false })
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), material, total)
  mesh.frustumCulled = false
  const group = new THREE.Group()
  group.name = 'clouds'
  group.add(mesh)
  const placed = new THREE.Matrix4()
  const wind = WIND.clone().normalize()
  const wrap = (value: number): number => ((((value + margin) % span) + span) % span) - margin
  // Carried by the wind by the game's time, and round again from the far side past the edge.
  group.userData.move = (seconds: number): void => {
    const blown = seconds * WIND_SPEED
    let index = 0
    for (const cloud of clouds) {
      const x = wrap(cloud.x + wind.x * blown)
      const z = wrap(cloud.z + wind.y * blown)
      for (const puff of cloud.puffs) {
        placed.copy(puff)
        placed.elements[12]! += x
        placed.elements[14]! += z
        mesh.setMatrixAt(index++, placed)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  group.userData.move(0)
  return group
}

/** Move the clouds of a terrain view to where the wind has them this many seconds into the game. */
export function moveClouds(view: THREE.Object3D, seconds: number): void {
  const clouds = view.getObjectByName('clouds')
  ;(clouds?.userData.move as ((seconds: number) => void) | undefined)?.(seconds)
}
