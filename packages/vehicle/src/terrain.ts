import * as RAPIER from '@dimforge/rapier3d-compat'
import { quatFromYaw } from '@buggies/physics'
import {
  ROUND_KINDS,
  ROAD_GRADE,
  ROAD_SKIRT,
  ROAD_TUNNEL,
  TUNNEL_CLEARANCE,
  TUNNEL_WALL,
  deckShouldered,
  isSurfaceRoad,
  railMesh,
  railRuns,
  roadLift,
  type RailRun,
  sampleHeight,
  tunnelCutFloors,
  tunnelSegments,
  tunnelShellMesh,
  type Heightfield,
  type Road,
  rampFacets,
  sidewalkMesh,
  type Ramp,
  type TerrainMap,
} from '@buggies/terrain'

import {GROUND_GROUPS, WALL_GROUPS} from './groups.ts'

const GROUND_FRICTION = 1.0
const GROUND_RESTITUTION = 0
const ROAD_FRICTION = 1.1
/**
 * Walls are slick: a car that meets one at a shallow angle should scrape along
 * it and carry on, not be stood on its nose by the friction of the hit. The
 * wall's figure wins over the chassis' own, whatever that is.
 */
const WALL_FRICTION = 0.08

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
  // The field has a height a cell, read here by row and column within it.
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
      .setCollisionGroups(GROUND_GROUPS)
      .setFriction(GROUND_FRICTION)
      .setRestitution(GROUND_RESTITUTION),
    body,
  )
}

/**
 * How a road's shoulders are built at a sample: carried down to the ground
 * beside an at-grade run, left off a bridge, or run flat out to the wall of
 * a tunnel, where the ground is cut away and the wheels need something to
 * ride on beside the deck.
 */
type Shoulder = 'ground' | 'none' | 'verge'

/**
 * How far a tunnel's verge runs on under the wall. A car leaning on the wall
 * can have wheels standing out past its chassis, over the wall's footing,
 * and they need floor under them or the car hangs off the wall by its side.
 */
const VERGE_UNDER_WALL = 1

function shoulderOf(road: Road, field: Heightfield, segment: number): Shoulder {
  if (road.structure[segment] === ROAD_TUNNEL) return 'verge'
  return deckShouldered(road, field, segment) ? 'ground' : 'none'
}

/** The four points across a road at one of its samples: shoulder, edge, edge, shoulder. */
function crossSection(
  road: Road,
  field: Heightfield,
  index: number,
  out: number[],
  shoulder: Shoulder,
  lift: number,
): void {
  const count = road.points.length
  // The sample is one of the road's points, and its neighbours are wrapped round a loop or held at an end.
  const point = road.points[index]!
  const previous = road.points[road.closed ? (index - 1 + count) % count : Math.max(index - 1, 0)]!
  const next = road.points[road.closed ? (index + 1) % count : Math.min(index + 1, count - 1)]!
  const dx = next.x - previous.x
  const dz = next.z - previous.z
  const length = Math.hypot(dx, dz) || 1
  const nx = -dz / length
  const nz = dx / length
  const half = road.width / 2
  const y = point.y + lift
  const reach =
    shoulder === 'ground'
      ? half + ROAD_SKIRT
      : shoulder === 'verge'
        ? half + TUNNEL_CLEARANCE + VERGE_UNDER_WALL
        : half

  const leftGround =
    shoulder === 'ground' ? Math.min(sampleHeight(field, point.x + nx * reach, point.z + nz * reach), y) : y
  const rightGround =
    shoulder === 'ground' ? Math.min(sampleHeight(field, point.x - nx * reach, point.z - nz * reach), y) : y

  out.push(
    point.x + nx * reach, leftGround, point.z + nz * reach,
    point.x + nx * half, y, point.z + nz * half,
    point.x - nx * half, y, point.z - nz * half,
    point.x - nx * reach, rightGround, point.z - nz * reach,
  )
}

const LANES = 3

/**
 * The built carriageways, as one triangle mesh. The ground has a bed cut into
 * it under every built road, well below the surface the road is drawn at, so
 * without this a vehicle drives every highway buried to its axles and drops
 * through every bridge. Graded roads carry their shoulders down to the ground
 * with them so the edge is a ramp rather than a kerb to crash into; a bridge
 * gets only its deck, because there is supposed to be nothing beside it; in
 * a tunnel the deck runs level to the wall. A surface road is the ground
 * wherever it is at grade, so only its bridges are built.
 */
function addRoads(world: RAPIER.World, map: TerrainMap): void {
  const positions: number[] = []
  const indices: number[] = []
  const field = map.heightfield

  for (const road of map.roads) {
    const count = road.points.length
    const segmentCount = road.closed ? count : count - 1
    const lift = roadLift(road)
    const painted = isSurfaceRoad(road)
    // A segment's structure is within the road's: there is one a segment.
    for (let i = 0; i < segmentCount; i++) {
      const structure = road.structure[i]!
      if (painted && structure === ROAD_GRADE) continue
      const shoulder = shoulderOf(road, field, i)
      const base = positions.length / 3
      crossSection(road, field, i, positions, shoulder, lift)
      crossSection(road, field, (i + 1) % count, positions, shoulder, lift)

      // Without a shoulder the outer pair sits exactly on the edge pair, and
      // the lanes either side of the carriageway come out as zero-area
      // triangles. A mesh full of those does not just waste space: the solver
      // gets contacts with no usable normal off them, and vehicles near one
      // stick to nothing and grind to a halt.
      const first = shoulder === 'none' ? 1 : 0
      const last = shoulder === 'none' ? LANES - 1 : LANES
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
      .setCollisionGroups(GROUND_GROUPS)
      .setFriction(ROAD_FRICTION)
      .setRestitution(GROUND_RESTITUTION),
    body,
  )
}

/**
 * How far beyond the bore the ground is cut away: every cell that reaches
 * into the bore has all four corners cut, so no face of a standing cell
 * leans in over the verge. A cell is `cellSize` square, so a corner can be a
 * diagonal further out than the bit of the cell inside the bore.
 */
function cutMargin(map: TerrainMap): number {
  return map.cellSize * Math.SQRT2
}

/**
 * How thick the shell is as a collider: enough to roof over every face that
 * touches a cut cell, another diagonal beyond the cut, so the hill above a
 * tunnel is still something to drive on. Thicker than drawn, but the extra
 * is buried in the hill.
 */
function shellWall(map: TerrainMap): number {
  return Math.max(TUNNEL_WALL, 2 * cutMargin(map))
}

/**
 * The ground as a collider has to be the ground as it is drawn, and where a
 * tunnel runs those differ: the mesh drops the faces that would stand inside
 * the bore, and nothing here can drop a heightfield cell — rapier has no way
 * to remove one. Cutting those cells back to the road they are bored for comes
 * to the same thing for anything driving through: the hill stops reaching into
 * the tunnel. The cut runs the whole length of the tunnel and a cell's
 * diagonal beyond the bore either side, whatever the hill is doing above: a
 * face from a cut corner inside the bore to a standing one beside it would
 * slice straight back through the bore. The shell is then added as a
 * collider of its own, so the walls and the roof are still there.
 */
function boredGround(map: TerrainMap): Float32Array {
  const segments = tunnelSegments(map.roads)
  if (segments.length === 0) return map.heightfield.heights

  const heights = Float32Array.from(map.heightfield.heights)
  const floors = tunnelCutFloors(map.heightfield, segments, cutMargin(map))
  // The floors cover the field, cell for cell.
  for (const [cell, floor] of floors.entries()) {
    if (Number.isNaN(floor)) continue
    // The bed is cut clear of the deck across the whole bore: the deck runs
    // out to the wall in a tunnel, so nothing drives on the ground here.
    heights[cell] = Math.min(heights[cell]!, floor - BORE_BED)
  }
  return heights
}

/**
 * A wall to slide along: a solid, wound to face out, so a car is only ever
 * pushed out of it, and with the seams between its facets smoothed over. A
 * chassis corner scraping across a seam otherwise catches on the edge and
 * the car stops dead, however slight the bend.
 */
function addWall(world: RAPIER.World, positions: Float32Array, indices: Uint32Array): void {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(positions, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setCollisionGroups(WALL_GROUPS)
      .setFriction(WALL_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
    body,
  )
}

/** The shell around every tunnel, driven against from inside and out. */
function addTunnelShells(world: RAPIER.World, map: TerrainMap): void {
  for (const road of map.roads) {
    const shell = tunnelShellMesh(road, shellWall(map))
    if (shell === null) continue
    addWall(world, shell.positions, shell.indices)
  }
}

/** Guardrails along the given runs, as the wall their mesh draws. */
export function addRailRuns(world: RAPIER.World, runs: RailRun[]): void {
  if (runs.length === 0) return
  const mesh = railMesh(runs)
  addWall(world, mesh.positions, mesh.indices)
}

/** A trunk is this wide, whatever the crown; only the trunk is anything to hit. */
const TRUNK_RADIUS = 0.35

/**
 * Everything standing beside the roads: every building as the box it is
 * drawn as, every tree as its trunk, and nothing for a shrub, which a car
 * drives through. Slick like a wall, so a car that clips a corner scrapes
 * past rather than sticking to it.
 */
function addBuildings(world: RAPIER.World, map: TerrainMap): void {
  if (map.buildings.length === 0 && map.trees.length === 0) return
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const slick = (desc: RAPIER.ColliderDesc): RAPIER.ColliderDesc =>
    desc
      .setFriction(WALL_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
  for (const building of map.buildings) {
    const halfHeight = (building.top - building.bottom) / 2
    // The round towers are cylinders; everything else is the box it is drawn as.
    const shape = ROUND_KINDS.includes(building.kind)
      ? RAPIER.ColliderDesc.cylinder(halfHeight, building.width / 2)
      : RAPIER.ColliderDesc.cuboid(building.width / 2, halfHeight, building.depth / 2)
    world.createCollider(
      slick(
        shape
          .setTranslation(building.x, (building.top + building.bottom) / 2, building.z)
          .setRotation(quatFromYaw(building.yaw)),
      ),
      body,
    )
  }
  // A trunk is a wall to the wheels as well: a wheel hanging past the chassis
  // that comes to overlap one would otherwise land its ray inside it, and the
  // suspension would jack the car up onto the tree and hold it there.
  for (const tree of map.trees) {
    if (tree.kind === 'shrub') continue
    world.createCollider(
      slick(
        RAPIER.ColliderDesc.cylinder(tree.height / 2, TRUNK_RADIUS)
          .setTranslation(tree.x, tree.bottom + tree.height / 2, tree.z)
          .setCollisionGroups(WALL_GROUPS),
      ),
      body,
    )
  }
}

/** The guardrails of a map. */
function addRails(world: RAPIER.World, map: TerrainMap): void {
  addRailRuns(world, railRuns(map.roads))
}

/**
 * Put a generated island into a physics world: the ground, the roads on it,
 * the tunnels through it and the rails along it.
 */
export function addTerrain(world: RAPIER.World, map: TerrainMap): void {
  addHeightfield(world, map.heightfield, boredGround(map))
  addRoads(world, map)
  addTunnelShells(world, map)
  addRails(world, map)
  addBuildings(world, map)
  addRamps(world, map.ramps)
  addSidewalks(world, map)
}

/**
 * The ramps on the road shoulders: solid kickers, ground to the wheels like
 * a road, built facet by facet as convex slices from the foot up to the lip.
 */
export function addRamps(world: RAPIER.World, ramps: Ramp[]): void {
  if (ramps.length === 0) return
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  for (const ramp of ramps) {
    const sx = -ramp.dz * (ramp.width / 2)
    const sz = ramp.dx * (ramp.width / 2)
    const under = ramp.bottom - 1
    const facets = rampFacets(ramp)
    for (const [i, a] of facets.entries()) {
      const b = facets[i + 1]
      if (b === undefined) break
      const ax = ramp.x + ramp.dx * a.along
      const az = ramp.z + ramp.dz * a.along
      const bx = ramp.x + ramp.dx * b.along
      const bz = ramp.z + ramp.dz * b.along
      const slice = RAPIER.ColliderDesc.convexHull(
        new Float32Array([
          ax + sx, a.height, az + sz,
          ax - sx, a.height, az - sz,
          bx + sx, b.height, bz + sz,
          bx - sx, b.height, bz - sz,
          ax + sx, under, az + sz,
          ax - sx, under, az - sz,
          bx + sx, under, bz + sz,
          bx - sx, under, bz - sz,
        ]),
      )
      if (slice === null) continue
      world.createCollider(
        slice
          .setCollisionGroups(GROUND_GROUPS)
          .setFriction(ROAD_FRICTION)
          .setRestitution(GROUND_RESTITUTION),
        body,
      )
    }
  }
}

/** The sidewalks round the city blocks: a kerb's step up off the street, driven on like the road. */
export function addSidewalks(world: RAPIER.World, map: TerrainMap): void {
  if (map.sidewalks.length === 0) return
  const { positions, indices } = sidewalkMesh(map.heightfield, map.sidewalks)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(positions, indices)
      .setCollisionGroups(GROUND_GROUPS)
      .setFriction(ROAD_FRICTION)
      .setRestitution(GROUND_RESTITUTION),
    body,
  )
}
