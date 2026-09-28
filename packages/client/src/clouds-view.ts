import { createRng, randomInt, randomRange } from '@buggies/physics'
import { CLOUD_HEIGHT } from '@buggies/game'
import { randomDirection, tangentFrame, type World } from '@buggies/terrain'
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/** How many clouds float over a planet, and how many puffs each is made of besides the one in its middle. */
const CLOUDS = 110
const PUFFS = { min: 4, max: 8 } as const
/** How big the middle puff is across, and the others round it; how flat they are; and how far out round the middle they stand, as a share of the two radii. */
const CORE_RADIUS = { min: 11, max: 16 } as const
const PUFF_RADIUS = { min: 6, max: 12 } as const
const PUFF_FLATNESS = 0.45
const PUFF_OUT = { min: 0.45, max: 0.85 } as const
/** How far under its middle a cloud's flat bottom is, as a share of the middle puff's height. */
const CLOUD_BASE = 0.55
/** How finely a cloud's skin is cut: an icosahedron split this many times. */
const CLOUD_DETAIL = 3
/** How far above or below the cloud height a cloud floats. */
const CLOUD_RISE = { min: -8, max: 12 } as const
/** How long the wind takes to carry the clouds once round the planet, in seconds. */
const CLOUD_ROUND = 1800
const CLOUD_SALT = 0xc10d

/** A puff, in its cloud's own frame, across and up and along: where its middle is, and how big it is across. */
interface Puff {
  x: number
  y: number
  z: number
  radius: number
}

/**
 * How far out from its cloud's middle the cloud reaches this way: to the far
 * side of whichever puff reaches farthest along it. The middle puff is round
 * the middle, so every way meets one. Each puff is flattened up and down, so
 * the way and the puff are both stretched back up by its flatness to meet a
 * round one.
 */
function reach(puffs: readonly Puff[], dx: number, dy: number, dz: number): number {
  const sy = dy / PUFF_FLATNESS
  const a = dx * dx + sy * sy + dz * dz
  let far = 0
  for (const puff of puffs) {
    const cy = puff.y / PUFF_FLATNESS
    const b = dx * puff.x + sy * cy + dz * puff.z
    const c = puff.x * puff.x + cy * cy + puff.z * puff.z - puff.radius * puff.radius
    const disc = b * b - a * c
    if (disc < 0) continue
    far = Math.max(far, (b + Math.sqrt(disc)) / a)
  }
  return far
}

/** A unit ball's skin, its corners shared by the faces round them so it shades smooth once pushed out of round. */
function ballSkin(): THREE.BufferGeometry {
  return mergeVertices(new THREE.IcosahedronGeometry(1, CLOUD_DETAIL).deleteAttribute('normal').deleteAttribute('uv'))
}

/**
 * The clouds over a planet: each one soft white skin, flattened and
 * see-through, wrapped round the puffs it is heaped from with a flat
 * bottom, scattered over the whole of the planet high over the land, all
 * of them carried round it together by the wind. Where they are is the
 * planet's seed's, so everyone sees the same sky.
 */
export function buildClouds(world: World): THREE.Object3D {
  const rng = createRng((world.seed ^ CLOUD_SALT) >>> 0)
  const skin = ballSkin()
  const ball = skin.getAttribute('position')
  const index = skin.getIndex()!
  const corners = ball.count
  const positions = new Float32Array(CLOUDS * corners * 3)
  const indices = new Uint32Array(CLOUDS * index.count)
  const middle = { x: 0, y: 0, z: 0 }
  const up = new THREE.Vector3()
  const east = new THREE.Vector3()
  const south = new THREE.Vector3()
  const at = new THREE.Vector3()
  const puffs: Puff[] = []
  for (let k = 0; k < CLOUDS; k++) {
    randomDirection(rng, middle)
    const frame = tangentFrame(middle)
    up.set(middle.x, middle.y, middle.z)
    east.set(frame.east.x, frame.east.y, frame.east.z)
    south.set(-frame.north.x, -frame.north.y, -frame.north.z)
    const height = world.radius + CLOUD_HEIGHT + randomRange(rng, CLOUD_RISE.min, CLOUD_RISE.max)
    // The middle puff, and the rest heaped round it, each overlapping it and a little higher the nearer the middle.
    const core = randomRange(rng, CORE_RADIUS.min, CORE_RADIUS.max)
    puffs.length = 0
    puffs.push({ x: 0, y: 0, z: 0, radius: core })
    for (let n = randomInt(rng, PUFFS.min, PUFFS.max); n > 0; n--) {
      const radius = randomRange(rng, PUFF_RADIUS.min, PUFF_RADIUS.max)
      const angle = randomRange(rng, 0, Math.PI * 2)
      const out = (core + radius) * randomRange(rng, PUFF_OUT.min, PUFF_OUT.max)
      puffs.push({ x: Math.cos(angle) * out, y: randomRange(rng, 0, radius * 0.4) * PUFF_FLATNESS, z: Math.sin(angle) * out * 0.6, radius })
    }
    const base = -core * PUFF_FLATNESS * CLOUD_BASE
    const offset = k * corners
    for (let i = 0; i < corners; i++) {
      const dx = ball.getX(i)
      const dy = ball.getY(i)
      const dz = ball.getZ(i)
      const r = reach(puffs, dx, dy, dz)
      // Across and up and along the cloud, out on the planet: its bottom cut flat.
      at.copy(up).multiplyScalar(height + Math.max(dy * r, base)).addScaledVector(east, dx * r).addScaledVector(south, dz * r)
      at.toArray(positions, (offset + i) * 3)
    }
    for (let i = 0; i < index.count; i++) indices[k * index.count + i] = offset + index.getX(i)
  }
  skin.dispose()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const material = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.userData.clouds = CLOUDS
  const clouds = new THREE.Group()
  clouds.name = 'clouds'
  clouds.add(mesh)
  // Carried round the planet's axis by the wind, by the game's time.
  clouds.userData.move = (seconds: number): void => {
    clouds.rotation.y = (seconds / CLOUD_ROUND) * 2 * Math.PI
  }
  return clouds
}
