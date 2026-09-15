import * as RAPIER from '@dimforge/rapier3d-compat'
import {
  ROAD_GRADE,
  ROAD_SKIRT,
  ROAD_SURFACE,
  boreFloorAt,
  buildTunnelHoles,
  sampleHeight,
  tunnelSegments,
  type Heightfield,
  type Road,
  type TerrainMap,
} from '@buggies/terrain'

const GROUND_FRICTION = 1.0
const GROUND_RESTITUTION = 0
const ROAD_FRICTION = 1.1

/**
 * How far under its road the floor of a bore is cut, matching the bed a graded
 * road is given. Cutting only to the road leaves the ground a few centimetres
 * proud of the deck wherever the tunnel climbs, and a few centimetres proud is
 * a lip across the road that a vehicle at speed hits as a step.
 */
const BORE_BED = 0.6

/**
 * The ground, as a heightfield collider. Rapier lays its samples out column by
 * column and centres the shape on its own origin, where a buggies heightfield
 * runs row by row from the world corner, so both have to be translated.
 */
export function addHeightfield(
  world: RAPIER.World,
  field: Heightfield,
  heights: Float32Array = field.heights,
): void {
  const { width, depth, cellSize } = field
  const columns = width - 1
  const rows = depth - 1
  const packed = new Float32Array(width * depth)
  for (let row = 0; row < depth; row++) {
    for (let col = 0; col < width; col++) {
      packed[col * depth + row] = heights[row * width + col]!
    }
  }

  const spanX = columns * cellSize
  const spanZ = rows * cellSize
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(spanX / 2, 0, spanZ / 2),
  )
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(rows, columns, packed, { x: spanX, y: 1, z: spanZ })
      .setFriction(GROUND_FRICTION)
      .setRestitution(GROUND_RESTITUTION),
    body,
  )
}

/** The four points across a road at one of its samples: shoulder, edge, edge, shoulder. */
function crossSection(
  road: Road,
  field: Heightfield,
  index: number,
  out: number[],
  skirted: boolean,
): void {
  const count = road.points.length
  const point = road.points[index]!
  const previous = road.points[road.closed ? (index - 1 + count) % count : Math.max(index - 1, 0)]!
  const next = road.points[road.closed ? (index + 1) % count : Math.min(index + 1, count - 1)]!
  const dx = next.x - previous.x
  const dz = next.z - previous.z
  const length = Math.hypot(dx, dz) || 1
  const nx = -dz / length
  const nz = dx / length
  const half = road.width / 2
  const y = point.y + ROAD_SURFACE
  const reach = skirted ? half + ROAD_SKIRT : half

  const leftGround = skirted
    ? Math.min(sampleHeight(field, point.x + nx * reach, point.z + nz * reach), y)
    : y
  const rightGround = skirted
    ? Math.min(sampleHeight(field, point.x - nx * reach, point.z - nz * reach), y)
    : y

  out.push(
    point.x + nx * reach, leftGround, point.z + nz * reach,
    point.x + nx * half, y, point.z + nz * half,
    point.x - nx * half, y, point.z - nz * half,
    point.x - nx * reach, rightGround, point.z - nz * reach,
  )
}

const LANES = 3

/**
 * The carriageways, as one triangle mesh. The ground already has a bed cut
 * into it under every road, well below the surface the road is drawn at, so
 * without this a vehicle drives every road buried to its axles and drops
 * through every bridge. Graded roads carry their shoulders down to the ground
 * with them so the edge is a ramp rather than a kerb to crash into; a bridge
 * gets only its deck, because there is supposed to be nothing beside it.
 */
function addRoads(world: RAPIER.World, map: TerrainMap): void {
  const positions: number[] = []
  const indices: number[] = []
  const field = map.heightfield

  for (const road of map.roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    for (let i = 0; i < segmentCount; i++) {
      const structure = road.structure[i]!
      const skirted = structure === ROAD_GRADE
      const base = positions.length / 3
      crossSection(road, field, i, positions, skirted)
      crossSection(road, field, (i + 1) % count, positions, skirted)

      // Without a shoulder the outer pair sits exactly on the edge pair, and
      // the lanes either side of the carriageway come out as zero-area
      // triangles. A mesh full of those does not just waste space: the solver
      // gets contacts with no usable normal off them, and vehicles near one
      // stick to nothing and grind to a halt.
      const first = skirted ? 0 : 1
      const last = skirted ? LANES : LANES - 1
      for (let lane = first; lane < last; lane++) {
        const a = base + lane
        const b = base + lane + 1
        const c = base + LANES + 1 + lane
        const d = base + LANES + 2 + lane
        indices.push(a, c, b, b, c, d)
      }
    }
  }
  if (indices.length === 0) return

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices))
      .setFriction(ROAD_FRICTION)
      .setRestitution(GROUND_RESTITUTION),
    body,
  )
}

/**
 * The ground as a collider has to be the ground as it is drawn, and where a
 * tunnel runs those differ: the mesh drops the faces that would stand inside
 * the bore, and nothing here can drop a heightfield cell — rapier has no way
 * to remove one. Cutting those cells back to the road they are bored for comes
 * to the same thing for anything driving through: the hill stops reaching into
 * the tunnel, and the cells outside the bore are still there as its walls.
 */
function boredGround(map: TerrainMap): Float32Array {
  const segments = tunnelSegments(map.roads)
  if (segments.length === 0) return map.heightfield.heights

  const { width, cellSize } = map.heightfield
  const heights = Float32Array.from(map.heightfield.heights)
  const hole = buildTunnelHoles(map.heightfield, segments)
  for (let cell = 0; cell < hole.length; cell++) {
    if (hole[cell] === 0) continue
    const floor = boreFloorAt(segments, (cell % width) * cellSize, Math.floor(cell / width) * cellSize)
    if (floor !== null) heights[cell] = Math.min(heights[cell]!, floor - BORE_BED)
  }
  return heights
}

/** Put a generated island into a physics world: the ground, and the roads on it. */
export function addTerrain(world: RAPIER.World, map: TerrainMap): void {
  addHeightfield(world, map.heightfield, boredGround(map))
  addRoads(world, map)
}
