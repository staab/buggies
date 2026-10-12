import { gridDirection, groundIndex, nearestGridPoint, platformEdge, platformTop, roofedAt, sealedAt, type World } from '@buggies/terrain'
import * as THREE from 'three'

import { groundTone, type WorldLook } from './world-looks.ts'
import { meshGeometry } from './world-mesh.ts'

/**
 * The roof over what a world closes in, a mesh a face of its grid, facing
 * down into the rooms under it: glass over a dome or a sea tunnel, seen
 * through and from both sides; or rock over a cavern, seen from under it,
 * and throwing no shadow, so that the rooms are lit as the open is.
 */
export function buildRoof(world: World, look: WorldLook): THREE.Object3D | null {
  const { roof, ground } = world
  const finish = look.roof
  if (roof.length === 0 || finish === null) return null
  const { n, radius, heights } = ground
  const material = finish.rock
    ? new THREE.MeshStandardMaterial({ color: finish.color, roughness: 1, metalness: 0, flatShading: true })
    : new THREE.MeshStandardMaterial({ color: finish.color, roughness: 0.05, metalness: 0.3, transparent: true, opacity: finish.opacity, depthWrite: false, side: THREE.DoubleSide })
  const group = new THREE.Group()
  group.name = 'roof'
  const direction = { x: 0, y: 0, z: 0 }
  for (let face = 0; face < 6; face++) {
    const positions: number[] = []
    const indices: number[] = []
    const known = new Map<number, number>()
    const corner = (i: number, j: number): number => {
      const at = groundIndex(ground, face, i, j)
      const index = known.get(at)
      if (index !== undefined) return index
      gridDirection(n, face, i, j, direction)
      const r = radius + roof[at]!
      positions.push(direction.x * r, direction.y * r, direction.z * r)
      known.set(at, positions.length / 3 - 1)
      return positions.length / 3 - 1
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const corners = [groundIndex(ground, face, i, j), groundIndex(ground, face, i + 1, j), groundIndex(ground, face, i, j + 1), groundIndex(ground, face, i + 1, j + 1)]
        if (!corners.every((at) => roofedAt(roof, at)) || corners.every((at) => sealedAt(roof, heights, at))) continue
        const a = corner(i, j)
        const b = corner(i + 1, j)
        const c = corner(i, j + 1)
        const d = corner(i + 1, j + 1)
        // Wound to face in, toward the planet's middle.
        indices.push(a, c, b, b, c, d)
      }
    }
    if (indices.length === 0) continue
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = finish.rock ? 'roof' : 'glass'
    group.add(mesh)
  }
  return group
}

/**
 * The round tunnels driven on all the way round, rock seen from inside.
 * Along its middle a tube's floor lies on the ground under it, so it is
 * drawn a hair in front of the ground there, never flickering behind it.
 */
export function buildTubes(world: World, look: WorldLook): THREE.Object3D | null {
  if (world.tubes.length === 0) return null
  const group = new THREE.Group()
  group.name = 'tubes'
  const material = new THREE.MeshStandardMaterial({
    color: look.roof?.color ?? look.underside,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })
  for (const tube of world.tubes) {
    const mesh = new THREE.Mesh(meshGeometry(tube), material)
    // A roof, as far as the shadows go: it throws none, or the tunnel would be dark all through.
    mesh.name = 'roof'
    group.add(mesh)
  }
  return group
}

/** How far down a platform's underside hangs, for its reach, how many rings it is made of, and how ragged its rock is. */
const UNDERSIDE = { depth: 0.9, rings: 5, ragged: 0.18 } as const
/** How far under the top the underside's rim is tucked, so no seam shows at the edge. */
const UNDER_TOP = 0.05

/**
 * Each platform floating over a world: its round top, in the colors of
 * the world's ground there, and the rock hung under it, a ragged cone
 * from the top's own edge down to a point under its middle, so the
 * platform's edge is one smooth circle and it is seen to float.
 */
export function buildPlatforms(world: World, look: WorldLook): THREE.Object3D | null {
  if (world.platforms.length === 0) return null
  const group = new THREE.Group()
  group.name = 'platforms'
  const top = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  const rock = new THREE.MeshStandardMaterial({ color: look.underside, roughness: 1, metalness: 0, flatShading: true })
  const color = new THREE.Color()
  for (const platform of world.platforms) {
    // The top, colored as the ground's grid is under it: by height, and as a city's where it is one.
    const mesh = platformTop(platform, world.radius)
    const district = world.districtOf[nearestGridPoint(world, platform.center)]!
    groundTone(look, platform.height, platform.height - 1, platform.height + 1, world.seaLevel, district, color)
    const colors = new Float32Array(mesh.positions.length)
    for (let k = 0; k < colors.length; k += 3) color.toArray(colors, k)
    const geometry = meshGeometry(mesh)
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const surface = new THREE.Mesh(geometry, top)
    surface.name = 'ground'
    group.add(surface)
    group.add(underside(world, platform, rock))
  }
  return group
}

/** The rock under a platform: rings from its edge, tucked under its top, narrowing and ragged, down to a point under its middle. */
function underside(world: World, platform: World['platforms'][number], material: THREE.Material): THREE.Mesh {
  const edge = platformEdge(platform, world.radius)
  const sides = edge.length
  const depth = platform.radius * UNDERSIDE.depth
  const positions: number[] = []
  const indices: number[] = []
  const middle = new THREE.Vector3(platform.center.x, platform.center.y, platform.center.z).normalize()
  for (let ring = 0; ring < UNDERSIDE.rings; ring++) {
    const share = ring / UNDERSIDE.rings
    // Narrowing faster than it falls, so the rock bellies out under the top before it comes to its point.
    const narrow = 1 - share * share
    for (let k = 0; k < sides; k++) {
      const out = edge[k]!
      const way = new THREE.Vector3(out.x, out.y, out.z).lerp(middle, 1 - narrow).normalize()
      const shake = ring === 0 ? 0 : UNDERSIDE.ragged * (2 * ragged(k, ring, platform.radius) - 1)
      const height = platform.height - UNDER_TOP - depth * share * (1 + shake * 0.5)
      // Pulled in or out from the line down to the point, by how ragged the rock is there.
      way.lerp(middle, -shake * narrow * 0.3).normalize()
      way.multiplyScalar(world.radius + height)
      positions.push(way.x, way.y, way.z)
    }
  }
  const tip = middle.clone().multiplyScalar(world.radius + platform.height - UNDER_TOP - depth)
  positions.push(tip.x, tip.y, tip.z)
  const at = (ring: number, k: number): number => ring * sides + (k % sides)
  const point = UNDERSIDE.rings * sides
  for (let ring = 0; ring < UNDERSIDE.rings; ring++) {
    for (let k = 0; k < sides; k++) {
      // Wound to face out and down, away from the top.
      if (ring === UNDERSIDE.rings - 1) indices.push(at(ring, k), at(ring, k + 1), point)
      else indices.push(at(ring, k), at(ring, k + 1), at(ring + 1, k), at(ring, k + 1), at(ring + 1, k + 1), at(ring + 1, k))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'underside'
  return mesh
}

/** A number from 0 to 1 that only these three numbers decide, the same each time it is asked. */
function ragged(x: number, y: number, z: number): number {
  const v = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719) * 43758.5453
  return v - Math.floor(v)
}

/** The light a world has of its own, lit wherever the sun is: a cavern's glow, the sea's blue down its tunnels. */
export function buildGlow(look: WorldLook): THREE.Object3D | null {
  if (look.glow === null) return null
  const light = new THREE.AmbientLight(look.glow.color, look.glow.intensity)
  light.name = 'glow'
  return light
}
