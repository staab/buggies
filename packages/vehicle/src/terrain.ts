import * as RAPIER from '@dimforge/rapier3d-compat'
import { qrotate, uprightRotation, v3, type Quat, type Vec3 } from '@buggies/physics'
import { MUSHROOM_STEM, ROUND_KINDS, SIGN_PANEL, WORLD_TRAITS, buriedCell, gridDirection, groundIndex, platformTop, roofedAt, sealedAt, trunkRadius, type Heightfield, type World, type WorldMesh } from '@buggies/terrain'

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
export function addWall(world: RAPIER.World, mesh: WorldMesh): void {
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

const up = v3()

/** The point this far up from a foot, along the way a turn stands things up. */
function above(at: Vec3, turn: Quat, rise: number): Vec3 {
  qrotate(up, turn, { x: 0, y: 1, z: 0 })
  return { x: at.x + up.x * rise, y: at.y + up.y * rise, z: at.z + up.z * rise }
}

/**
 * Everything standing beside the roads: every building as the box it is
 * drawn as, a sign as its pole and its panel, a giant mushroom as its
 * stem, every tree as its trunk, every boulder as a box its size, and
 * nothing for a shrub, a strand of kelp, a scree stone or a coral head,
 * which a car drives through. Slick like a wall, so a car that
 * clips a corner scrapes past rather than sticking to it.
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
    // A sign is a panel up on a pole, with room to drive under the panel beside the pole.
    if (building.kind === 'sign') {
      const pole = (building.height - SIGN_PANEL.height) / 2
      stand(RAPIER.ColliderDesc.cylinder(pole, SIGN_PANEL.poleRadius).setCollisionGroups(WALL_GROUPS), above(building.at, building.turn, pole), building.turn)
      stand(
        RAPIER.ColliderDesc.cuboid(building.width / 2, SIGN_PANEL.height / 2, building.depth / 2),
        above(building.at, building.turn, building.height - SIGN_PANEL.height / 2),
        building.turn,
      )
      continue
    }
    // A giant mushroom is its stem: there is room to drive under its cap.
    if (building.kind === 'mushroom') {
      const half = (building.height * MUSHROOM_STEM.height) / 2
      stand(RAPIER.ColliderDesc.cylinder(half, building.width * MUSHROOM_STEM.radius).setCollisionGroups(WALL_GROUPS), above(building.at, building.turn, half), building.turn)
      continue
    }
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
  // Only the trunk is anything to hit, whatever the crown. A trunk is a wall to the wheels as well: a wheel hanging past the chassis
  // that comes to overlap one would otherwise land its ray inside it, and the
  // suspension would jack the car up onto the tree and hold it there.
  for (const tree of map.trees) {
    if (tree.kind === 'shrub' || tree.kind === 'kelp') continue
    const turn = uprightRotation(upOf(tree.at), { x: 0, y: 0, z: -1 })
    stand(RAPIER.ColliderDesc.cylinder(tree.height / 2, trunkRadius(tree)).setCollisionGroups(WALL_GROUPS), above(tree.at, turn, tree.height / 2), turn)
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
 * Put a planet into a physics world: the ground, the roof over whatever
 * it closes in, its round tunnels, the roads on it, the tunnels through
 * it, the rails along it, and everything standing on it.
 */
export function addTerrain(world: RAPIER.World, map: World): void {
  addGround(world, map)
  addRoof(world, map)
  // A round tunnel is driven on all the way round.
  for (const tube of map.tubes) addGroundMesh(world, tube, GROUND_FRICTION)
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
 * A sheet over the ground's grid, a mesh a tile of it, of the cells
 * `used` takes, each corner at the height `heightOf` gives it, wound to
 * face out from the planet's middle or in toward it.
 */
function addSheet(
  world: RAPIER.World,
  map: World,
  heightOf: (at: number) => number,
  used: (corners: readonly number[]) => boolean,
  inward: boolean,
  groups: number,
  friction: number,
): void {
  const { ground } = map
  const { n, radius } = ground
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const direction = v3()
  // In tiles, a mesh each: what rests on the ground is tested against the few cells round it, not
  // against one mesh the size of the planet, which costs a prop at rest ten times what it should.
  for (let face = 0; face < 6; face++) {
    for (let tileJ = 0; tileJ < n; tileJ += GROUND_TILE_CELLS) {
      for (let tileI = 0; tileI < n; tileI += GROUND_TILE_CELLS) {
        const positions: number[] = []
        const indices: number[] = []
        const known = new Map<number, number>()
        const corner = (i: number, j: number): number => {
          const at = groundIndex(ground, face, i, j)
          const index = known.get(at)
          if (index !== undefined) return index
          gridDirection(n, face, i, j, direction)
          const r = radius + heightOf(at)
          positions.push(direction.x * r, direction.y * r, direction.z * r)
          known.set(at, positions.length / 3 - 1)
          return positions.length / 3 - 1
        }
        for (let j = tileJ; j < Math.min(tileJ + GROUND_TILE_CELLS, n); j++) {
          for (let i = tileI; i < Math.min(tileI + GROUND_TILE_CELLS, n); i++) {
            const corners = [groundIndex(ground, face, i, j), groundIndex(ground, face, i + 1, j), groundIndex(ground, face, i, j + 1), groundIndex(ground, face, i + 1, j + 1)]
            if (!used(corners)) continue
            const a = corner(i, j)
            const b = corner(i + 1, j)
            const c = corner(i, j + 1)
            const d = corner(i + 1, j + 1)
            if (inward) indices.push(a, c, b, b, c, d)
            else indices.push(a, b, c, b, d, c)
          }
        }
        if (indices.length === 0) continue
        // A plain mesh: smoothing its internal edges over treats it as the skin of a solid, which an
        // open sheet of ground is not, and props resting on it then sink through it.
        world.createCollider(
          RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices))
            .setCollisionGroups(groups)
            .setFriction(friction)
            .setRestitution(GROUND_RESTITUTION),
          body,
        )
      }
    }
  }
}

/**
 * The planet's ground, as a mesh of the cells that matter: every cell of
 * its grid with a corner on land or in the shallows, or closed in under a
 * roof, cut in two, at the height it is bored to under a tunnel. The deep
 * sea floor is left out, and so is a cell buried in rock, and a
 * sphere under it all catches anything that sinks that far. A world of
 * floating platforms has only their tops.
 */
function addGround(world: RAPIER.World, map: World): void {
  const { ground, bored, roof } = map
  const floor = map.seaLevel - FLOOR_DEPTH
  // A world of floating platforms stands on their round tops alone, and drops away sheer at their edges.
  for (const platform of map.platforms) addGroundMesh(world, platformTop(platform, map.radius), GROUND_FRICTION)
  if (map.platforms.length === 0) addSheet(
    world,
    map,
    (at) => bored[at]!,
    (corners) => {
      if (buriedCell(roof, ground.heights, corners)) return false
      return corners.some((at) => bored[at]! >= floor || roofedAt(roof, at))
    },
    false,
    GROUND_GROUPS,
    GROUND_FRICTION,
  )
  // Just under the lowest ground, whatever the sea: a moon has none, and its level is far under everything.
  let deepest = Infinity
  for (const height of bored) deepest = Math.min(deepest, height)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.ball(ground.radius + deepest - 1)
      .setCollisionGroups(GROUND_GROUPS)
      .setFriction(GROUND_FRICTION)
      .setRestitution(GROUND_RESTITUTION),
    body,
  )
}

/**
 * The roof over whatever the world closes in, facing down into the rooms
 * under it: a wall to slide along, or, on a world whose cars hold to what
 * they drive on, more ground, to drive along upside down.
 */
function addRoof(world: RAPIER.World, map: World): void {
  const { ground, roof } = map
  if (roof.length === 0) return
  const clings = WORLD_TRAITS[map.kind].cling > 0
  addSheet(
    world,
    map,
    (at) => roof[at]!,
    (corners) => corners.every((at) => roofedAt(roof, at)) && !corners.every((at) => sealedAt(roof, ground.heights, at)),
    true,
    clings ? GROUND_GROUPS : WALL_GROUPS,
    clings ? GROUND_FRICTION : WALL_FRICTION,
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
