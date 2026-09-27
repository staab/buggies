import { createRng, randomInt, randomRange } from '@buggies/physics'
import { CLOUD_HEIGHT } from '@buggies/game'
import { randomDirection, tangentFrame, type World } from '@buggies/terrain'
import * as THREE from 'three'

/** How many clouds float over a planet, and how many puffs each is made of. */
const CLOUDS = 110
const PUFFS = { min: 5, max: 9 } as const
/** How big a puff is across, how flat, and how far from its cloud's middle it may drift. */
const PUFF_RADIUS = { min: 7, max: 14 } as const
const PUFF_FLATNESS = 0.45
const PUFF_SPREAD = 22
/** How far above or below the cloud height a cloud floats. */
const CLOUD_RISE = { min: -8, max: 12 } as const
/** How long the wind takes to carry the clouds once round the planet, in seconds. */
const CLOUD_ROUND = 1800
const CLOUD_SALT = 0xc10d

/**
 * The clouds over a planet: puffs of white, flattened and see-through,
 * gathered into clouds scattered over the whole of it high over the land,
 * all of them carried round the planet together by the wind. Where they
 * are is the planet's seed's, so everyone sees the same sky.
 */
export function buildClouds(world: World): THREE.Object3D {
  const rng = createRng((world.seed ^ CLOUD_SALT) >>> 0)
  const puffs: THREE.Matrix4[] = []
  const middle = { x: 0, y: 0, z: 0 }
  const up = new THREE.Vector3()
  const east = new THREE.Vector3()
  const south = new THREE.Vector3()
  const at = new THREE.Vector3()
  const basis = new THREE.Matrix4()
  for (let k = 0; k < CLOUDS; k++) {
    randomDirection(rng, middle)
    const frame = tangentFrame(middle)
    up.set(middle.x, middle.y, middle.z)
    east.set(frame.east.x, frame.east.y, frame.east.z)
    south.set(-frame.north.x, -frame.north.y, -frame.north.z)
    const height = world.radius + CLOUD_HEIGHT + randomRange(rng, CLOUD_RISE.min, CLOUD_RISE.max)
    for (let n = randomInt(rng, PUFFS.min, PUFFS.max); n > 0; n--) {
      const radius = randomRange(rng, PUFF_RADIUS.min, PUFF_RADIUS.max)
      const across = randomRange(rng, -PUFF_SPREAD, PUFF_SPREAD)
      const down = randomRange(rng, -PUFF_SPREAD, PUFF_SPREAD) * 0.6
      const lift = randomRange(rng, 0, radius * 0.4)
      at.copy(up).multiplyScalar(height + lift).addScaledVector(east, across).addScaledVector(south, down)
      // Flat along the way up where the cloud is, wide across it.
      basis.makeBasis(east, up, south).scale(new THREE.Vector3(radius, radius * PUFF_FLATNESS, radius)).setPosition(at)
      puffs.push(basis.clone())
    }
  }
  const material = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false })
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), material, puffs.length)
  puffs.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.frustumCulled = false
  const clouds = new THREE.Group()
  clouds.name = 'clouds'
  clouds.add(mesh)
  // Carried round the planet's axis by the wind, by the game's time.
  clouds.userData.move = (seconds: number): void => {
    clouds.rotation.y = (seconds / CLOUD_ROUND) * 2 * Math.PI
  }
  return clouds
}
