import * as RAPIER from '@dimforge/rapier3d-compat'
import { qrotate, uprightRotation, v3, type Quat, type Vec3 } from '@buggies/physics'
import { ROUND_KINDS, gridDirection, groundIndex, railMesh, type Heightfield, type RailRun, type World, type WorldMesh } from '@buggies/terrain'

import { GROUND_GROUPS, WALL_GROUPS } from './groups.ts'

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
 * A level test ground, as a heightfield collider. Rapier lays its samples out column by
 * column and centers the shape on its own origin, where a buggies heightfield
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

/** A mesh of the world's, as ground to drive on. */
function addGroundMesh(world: RAPIER.World, mesh: WorldMesh, friction: number): void {
  if (mesh.indices.length === 0) return
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(mesh.positions, mesh.indices)
      .setCollisionGroups(GROUND_GROUPS)
      .setFriction(friction)
      .setRestitution(GROUND_RESTITUTION),
    body,
  )
}

/**
 * A wall to slide along: a solid, wound to face out, so a car is only ever
 * pushed out of it, and with the seams between its facets smoothed over. A
 * chassis corner scraping across a seam otherwise catches on the edge and
 * the car stops dead, however slight the bend.
 */
function addWall(world: RAPIER.World, mesh: WorldMesh): void {
  if (mesh.indices.length === 0) return
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(mesh.positions, mesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setCollisionGroups(WALL_GROUPS)
      .setFriction(WALL_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
    body,
  )
}

/** Guardrails along the given runs, as the wall their mesh draws. */
export function addRailRuns(world: RAPIER.World, runs: RailRun[]): void {
  if (runs.length === 0) return
  addWall(world, railMesh(runs))
}

/** A trunk is this wide, whatever the crown; only the trunk is anything to hit. */
const TRUNK_RADIUS = 0.35

const up = v3()

/** The point this far up from a foot, along the way a turn stands things up. */
function above(at: Vec3, turn: Quat, rise: number): Vec3 {
  qrotate(up, turn, { x: 0, y: 1, z: 0 })
  return { x: at.x + up.x * rise, y: at.y + up.y * rise, z: at.z + up.z * rise }
}

/**
 * Everything standing beside the roads: every building as the box it is
 * drawn as, every tree as its trunk, every boulder as a box its size, and
 * nothing for a shrub or a scree stone, which a car drives through. Slick
 * like a wall, so a car that clips a corner scrapes past rather than
 * sticking to it.
 */
function addBuildings(world: RAPIER.World, map: World): void {
  if (map.buildings.length === 0 && map.trees.length === 0 && map.rocks.length === 0) return
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const stand = (desc: RAPIER.ColliderDesc, middle: Vec3, turn: Quat): void => {
    world.createCollider(
      desc
        .setTranslation(middle.x, middle.y, middle.z)
        .setRotation(turn)
        .setFriction(WALL_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
      body,
    )
  }
  for (const building of map.buildings) {
    // A boat drifts about where it lies, a body of its own that the game moves.
    if (building.kind === 'boat') continue
    const half = building.height / 2
    // The round towers are cylinders; everything else is the box it is drawn as.
    stand(
      ROUND_KINDS.includes(building.kind)
        ? RAPIER.ColliderDesc.cylinder(half, building.width / 2)
        : RAPIER.ColliderDesc.cuboid(building.width / 2, half, building.depth / 2),
      above(building.at, building.turn, half),
      building.turn,
    )
  }
  // A trunk is a wall to the wheels as well: a wheel hanging past the chassis
  // that comes to overlap one would otherwise land its ray inside it, and the
  // suspension would jack the car up onto the tree and hold it there.
  for (const tree of map.trees) {
    if (tree.kind === 'shrub') continue
    const turn = uprightRotation(upOf(tree.at), { x: 0, y: 0, z: -1 })
    stand(RAPIER.ColliderDesc.cylinder(tree.height / 2, TRUNK_RADIUS).setCollisionGroups(WALL_GROUPS), above(tree.at, turn, tree.height / 2), turn)
  }
  // A boulder is a wall to the wheels for the same reason a trunk is.
  for (const rock of map.rocks) {
    if (rock.kind !== 'boulder') continue
    const half = rock.size / 2
    stand(RAPIER.ColliderDesc.cuboid(half, half, half).setCollisionGroups(WALL_GROUPS), above(rock.at, rock.turn, half), rock.turn)
  }
}

/** The way up at a point: away from the planet's middle. */
function upOf(point: Vec3): Vec3 {
  const length = Math.hypot(point.x, point.y, point.z) || 1
  return { x: point.x / length, y: point.y / length, z: point.z / length }
}

/**
 * Put a planet into a physics world: the ground, the roads on it, the
 * tunnels through it, the rails along it, and everything standing on it.
 */
export function addTerrain(world: RAPIER.World, map: World): void {
  addGround(world, map)
  addGroundMesh(world, map.decks, ROAD_FRICTION)
  for (const shell of map.shells) addWall(world, shell)
  addWall(world, map.rails)
  addBuildings(world, map)
  addKickers(world, map.kickers)
  addGroundMesh(world, map.curbs, ROAD_FRICTION)
}

/** How many cells a side a tile of the ground is. */
const GROUND_TILE_CELLS = 32

/** How far under the sea the ground is laid: deeper than this, the sea floor is left out. */
const FLOOR_DEPTH = 6

/**
 * The planet's ground, as a mesh of the cells that matter: every cell of
 * its grid with a corner on land or in the shallows, cut in two, at the
 * height it is bored to under a tunnel. The deep sea floor is left out,
 * and a sphere under it all catches anything that sinks that far.
 */
function addGround(world: RAPIER.World, map: World): void {
  const { ground, bored } = map
  const { n, radius } = ground
  const floor = map.seaLevel - FLOOR_DEPTH
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const direction = v3()
  // In tiles, a mesh each: what rests on the ground is tested against the few cells round it, not
  // against one mesh the size of the planet, which costs a prop at rest ten times what it should.
  for (let face = 0; face < 6; face++) {
    for (let tileJ = 0; tileJ < n; tileJ += GROUND_TILE_CELLS) {
      for (let tileI = 0; tileI < n; tileI += GROUND_TILE_CELLS) {
        const positions: number[] = []
        const indices: number[] = []
        const used = new Map<number, number>()
        const corner = (i: number, j: number): number => {
          const at = groundIndex(ground, face, i, j)
          const known = used.get(at)
          if (known !== undefined) return known
          gridDirection(n, face, i, j, direction)
          const r = radius + bored[at]!
          positions.push(direction.x * r, direction.y * r, direction.z * r)
          used.set(at, positions.length / 3 - 1)
          return positions.length / 3 - 1
        }
        for (let j = tileJ; j < Math.min(tileJ + GROUND_TILE_CELLS, n); j++) {
          for (let i = tileI; i < Math.min(tileI + GROUND_TILE_CELLS, n); i++) {
            const heights = [bored[groundIndex(ground, face, i, j)]!, bored[groundIndex(ground, face, i + 1, j)]!, bored[groundIndex(ground, face, i, j + 1)]!, bored[groundIndex(ground, face, i + 1, j + 1)]!]
            if (Math.max(...heights) < floor) continue
            const a = corner(i, j)
            const b = corner(i + 1, j)
            const c = corner(i, j + 1)
            const d = corner(i + 1, j + 1)
            // Wound to face out, away from the planet's middle.
            indices.push(a, b, c, b, d, c)
          }
        }
        if (indices.length === 0) continue
        // A plain mesh: smoothing its internal edges over treats it as the skin of a solid, which an
        // open sheet of ground is not, and props resting on it then sink through it.
        world.createCollider(
          RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices))
            .setCollisionGroups(GROUND_GROUPS)
            .setFriction(GROUND_FRICTION)
            .setRestitution(GROUND_RESTITUTION),
          body,
        )
      }
    }
  }
  let deepest = floor
  for (const height of bored) deepest = Math.min(deepest, height)
  world.createCollider(
    RAPIER.ColliderDesc.ball(radius + deepest - 1)
      .setCollisionGroups(GROUND_GROUPS)
      .setFriction(GROUND_FRICTION)
      .setRestitution(GROUND_RESTITUTION),
    body,
  )
}

/**
 * The ramps on the road shoulders: solid kickers, ground to the wheels like
 * a road, built facet by facet as convex slices from the foot up to the lip.
 */
function addKickers(world: RAPIER.World, kickers: readonly Float32Array[]): void {
  if (kickers.length === 0) return
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  for (const hull of kickers) {
    const slice = RAPIER.ColliderDesc.convexHull(hull)
    if (slice === null) continue
    world.createCollider(slice.setCollisionGroups(GROUND_GROUPS).setFriction(ROAD_FRICTION).setRestitution(GROUND_RESTITUTION), body)
  }
}
